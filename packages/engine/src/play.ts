import { rollDice, type ChecklistItem, type Pack } from "@runlog/rules-schema";
import type { RunEvent } from "./events.ts";
import { createRandom, streamSeed } from "./rng.ts";
import { reduce } from "./reduce.ts";
import { checklistOf, currentlyDue, itemText, nextStep, type ActiveStep } from "./flow.ts";
import { openNotes, type AnswerValue } from "./execute.ts";
import { answer, drive, type DriveAction, type Pending } from "./drive.ts";
import type { InputRequest, Obligation, RunState } from "./types.ts";

export { currentlyDue };

/**
 * Playing a pack, headlessly.
 *
 * A pack's fixtures could only replay a hand-written event log and check the
 * state that came out — never actually run a table roll, an action list, an
 * obligation or a move. That leaves the entire flow untested: an author could
 * break `nextStep`, a trigger, or a move's availability and no fixture would
 * notice, because nothing had ever driven them.
 *
 * `playThrough` drives a pack the same way the app does — `enterUnit`,
 * `declareSubject`, a table roll via `executeTableRoll`, a move via
 * `executeMove`, an obligation via `executeObligation`, `finalizeUnit` — from
 * a short script, answering the engine's interruptions from a table of
 * answers (or, for a seeded run, by rolling from the seed itself). What comes
 * out is exactly what a real run produces: an event log and the state folded
 * from it.
 *
 * It is built on `drive`/`answer`, the same primitives a headless caller (a
 * Discord bot, say) drives one action at a time: a script step is one
 * `drive` call, and the loop that resolves whatever it asks for is the same
 * request/answer round trip, just run synchronously here instead of across
 * two Lambda invocations.
 */

export type PlayAnswerValue = AnswerValue;

/**
 * What a script step answers the engine's requests with.
 *
 * A key is either a request's own deterministic key (for a nested roll or
 * prompt an author has copied out of a failure message), a die notation like
 * "d100" or "d6" (matched to requests of that kind in the order they are
 * asked), or a prompt kind such as "chooseSubject" or "confirm" (matched the
 * same way). A list of values under one of the latter two answers successive
 * asks of that shape in order; a bare value answers only the first.
 */
export type PlayAnswers = Record<string, PlayAnswerValue | PlayAnswerValue[]>;

interface PlayStepBase {
  /** Answers for whatever the engine asks while this step runs. */
  answers?: PlayAnswers;
}

export type PlayStep = PlayStepBase &
  (
    | { enter: number }
    | { declare: string }
    | { step: string }
    | { finalize: Record<string, never> }
    | { move: string }
    | { settle: string }
    | { tick: string }
  );

export interface PlayOptions {
  /** Mode to play in. Defaults to the pack's default mode. */
  mode?: string;
  /** Seed for the run. Unanswered rolls are drawn from it; see `PlayAnswers`. */
  seed?: string;
  /** How many people are playing. */
  players?: number;
  /** What to call the run, if anything. */
  name?: string;
  /** Optional requirements this run says it lacks. */
  lacks?: string[];
  /** Starting timestamp; events count up from it one second apart. Defaults to a fixed moment, so two plays of the same script produce an identical log. */
  now?: string;
}

/** One request the engine made during the play-through, and how it was answered. */
export interface PlayRequest {
  /** Index of the script step during which this was asked. */
  step: number;
  key: string;
  kind: InputRequest["kind"];
  label: string;
  answer: PlayAnswerValue;
  /** Whether the answer came from the script, or was rolled from the seed because none was given. */
  source: "given" | "seed";
}

export interface PlayResult {
  state: RunState;
  events: RunEvent[];
  requests: PlayRequest[];
}

/**
 * Thrown when the engine asks for something the script never answers and no
 * seed can supply — an unhandled roll, an unanswered prompt, a judgment the
 * script forgot. Names the request and what the script did offer, so an
 * author fixing the fixture is not left guessing.
 */
export class PlayError extends Error {
  readonly request?: InputRequest;
  readonly step?: number;
  readonly given: string[];

  constructor(message: string, opts: { request?: InputRequest; step?: number; given?: string[] } = {}) {
    super(message);
    this.name = "PlayError";
    this.request = opts.request;
    this.step = opts.step;
    this.given = opts.given ?? [];
  }
}

function requestLabel(request: InputRequest): string {
  switch (request.kind) {
    case "roll":
      return request.label ?? `${request.dice} for ${request.purpose}`;
    case "prompt":
      return request.label;
    case "ask":
      return request.question;
    case "chooseTarget":
      return request.label;
  }
}

/** The queue name a request is matched against, once its exact key misses. */
function queueName(request: InputRequest): string {
  if (request.kind === "roll") return request.dice;
  if (request.kind === "prompt") return request.promptKind;
  return request.kind; // "ask" | "chooseTarget"
}

/** Events since the current unit began, for counting how many times a purpose has already rolled. */
function eventsThisUnit(events: readonly RunEvent[]): readonly RunEvent[] {
  const start = events.map((e) => e.t).lastIndexOf("UnitEntered");
  return start >= 0 ? events.slice(start) : events;
}

function countRolls(events: readonly RunEvent[], purpose: string): number {
  return events.filter((e) => e.t === "Rolled" && e.purpose === purpose).length;
}

/**
 * Drive one action and answer the engine's interruptions for it — a table
 * roll, an action list, a move, an obligation — from a script step's table
 * of answers, exactly as the app's own request/answer loop would if a
 * player supplied them one at a time.
 */
function runBlock(
  pack: Pack,
  action: DriveAction,
  opts: {
    stepAnswers: PlayAnswers | undefined;
    seed: string | undefined;
    events: () => readonly RunEvent[];
    unit: number;
    scriptIndex: number;
    describeStep: () => string;
    given: () => string[];
    requests: PlayRequest[];
    at: string;
  },
): RunEvent[] {
  // Queues, one list per key the script gave, consumed in the order requests
  // of that shape are asked. An exact request key is checked first and is
  // never drawn from these — it answers itself, however many times it recurs.
  const queues = new Map<string, PlayAnswerValue[]>();
  for (const [key, value] of Object.entries(opts.stepAnswers ?? {})) {
    queues.set(key, Array.isArray(value) ? [...value] : [value]);
  }

  let result = drive(pack, opts.events(), action, { now: opts.at, seed: opts.seed });

  for (let guard = 0; guard < 500; guard++) {
    if (result.status === "done") return result.events;
    const request = result.request;
    const pending: Pending = result.pending;

    const exact = opts.stepAnswers?.[request.key];
    if (exact !== undefined) {
      const value = Array.isArray(exact) ? exact[0]! : exact;
      opts.requests.push({ step: opts.scriptIndex, key: request.key, kind: request.kind, label: requestLabel(request), answer: value, source: "given" });
      result = answer(pack, opts.events(), pending, request.key, value, { now: opts.at });
      continue;
    }

    const q = queues.get(queueName(request));
    if (q && q.length > 0) {
      const value = q.shift()!;
      opts.requests.push({ step: opts.scriptIndex, key: request.key, kind: request.kind, label: requestLabel(request), answer: value, source: "given" });
      result = answer(pack, opts.events(), pending, request.key, value, { now: opts.at });
      continue;
    }

    if (opts.seed !== undefined && request.kind === "roll") {
      const occurrence =
        countRolls(eventsThisUnit(opts.events()), request.purpose) + countRolls(pending.partial, request.purpose);
      const random = createRandom(streamSeed(opts.seed, opts.unit, request.purpose, occurrence));
      const { total } = rollDice(request.dice, random);
      opts.requests.push({ step: opts.scriptIndex, key: request.key, kind: request.kind, label: requestLabel(request), answer: total, source: "seed" });
      // `autoRoll: true` on `answer` marks this key generated rather than
      // physical, the same distinction a "roll for me" button makes in the app.
      result = answer(pack, opts.events(), pending, request.key, total, { now: opts.at, autoRoll: true });
      continue;
    }

    throw new PlayError(
      `no answer for ${request.kind} request "${request.key}" (${requestLabel(request)}) at script step #${opts.scriptIndex} (${opts.describeStep()}); answers given: ${
        opts.given().length ? opts.given().join(", ") : "(none)"
      }`,
      { request, step: opts.scriptIndex, given: opts.given() },
    );
  }
  throw new Error(`execution never completed at script step #${opts.scriptIndex}`);
}

/** Play a pack from a script of steps, driving it exactly as the app would. */
export function playThrough(pack: Pack, script: readonly PlayStep[], options: PlayOptions = {}): PlayResult {
  const mode = options.mode ?? pack.defaultMode;
  const seed = options.seed;
  const lacks = options.lacks ?? [];
  let clock = Date.parse(options.now ?? "2020-01-01T00:00:00.000Z");
  const now = (): string => {
    const iso = new Date(clock).toISOString();
    clock += 1000;
    return iso;
  };

  let events: RunEvent[] = [];
  let state: RunState;
  const requests: PlayRequest[] = [];

  const commit = (next: RunEvent[]): void => {
    events = [...events, ...next];
    state = reduce(pack, events);
  };

  const opening: RunEvent[] = [
    {
      t: "RunStarted",
      at: now(),
      packId: pack.id,
      packVersion: pack.version,
      mode,
      ...(seed ? { seed } : {}),
      ...(options.players && options.players > 1 ? { players: options.players } : {}),
      ...(lacks.length > 0 ? { lacks } : {}),
    },
  ];
  for (const [deckId, deck] of Object.entries(pack.decks ?? {})) {
    if (deck.kind !== "cards" || deck.drawAtStart < 1) continue;
    const rng = seed ? createRandom(`${seed}:deal`) : Math.random;
    const pool = [...deck.cards];
    for (let n = 0; n < deck.drawAtStart && pool.length > 0; n++) {
      const [card] = pool.splice(Math.floor(rng() * pool.length), 1);
      if (card) opening.push({ t: "CardDrawn", at: now(), deck: deckId, cardId: card.id });
    }
  }
  if (options.name?.trim()) opening.push({ t: "RunRenamed", at: now(), name: options.name.trim() });
  commit(opening);

  const given = (raw: PlayStep): string[] => Object.keys(raw.answers ?? {});

  const runBlockFor = (action: DriveAction, index: number, raw: PlayStep, at: string): RunEvent[] =>
    runBlock(pack, action, {
      stepAnswers: raw.answers,
      seed,
      events: () => events,
      unit: state.unit,
      scriptIndex: index,
      describeStep: () => JSON.stringify({ ...raw, answers: undefined }),
      given: () => given(raw),
      requests,
      at,
    });

  /** Tick every point on a step's checklist, script-convenience style: a script names the step, not each box. */
  const tickAll = (active: ActiveStep, items: ChecklistItem[]): RunEvent[] =>
    items.map((_, i) => ({ t: "Checked" as const, at: now(), step: `${active.phase.id}#${active.index}`, item: `${i}`, on: true }));

  const finalizeCurrentUnit = (active: ActiveStep, index: number): void => {
    if (active.step.kind !== "finalizeUnit") {
      throw new PlayError(
        `cannot finalize at script step #${index}: the active step is "${active.phase.id}#${active.index}" (${active.step.kind}), not finalizeUnit`,
        { step: index },
      );
    }
    commit(tickAll(active, checklistOf(active.step)));
    const at = now();
    const result = drive(pack, events, { finalize: true }, { now: at });
    if (result.status !== "done") throw new Error("unreachable: finalize never awaits");
    commit(result.events);
  };

  script.forEach((raw, index) => {
    if ("enter" in raw) {
      const at = now();
      const result = drive(pack, events, { enter: true }, { now: at });
      if (result.status !== "done") throw new Error("unreachable: enter never awaits");
      commit(result.events);
      if (state.unit !== raw.enter) {
        throw new PlayError(
          `script step #${index} expected to enter unit ${raw.enter}, but the run is now at unit ${state.unit}`,
          { step: index },
        );
      }
      return;
    }

    if ("declare" in raw) {
      const active = nextStep(pack, state);
      if (!active || active.step.kind !== "declareSubject") {
        throw new PlayError(
          `cannot declare at script step #${index}: the active step is ${active ? `"${active.phase.id}#${active.index}" (${active.step.kind})` : "none"}, not declareSubject`,
          { step: index },
        );
      }
      const at = now();
      const result = drive(pack, events, { declare: raw.declare }, { now: at });
      if (result.status !== "done") throw new Error("unreachable: declare never awaits");
      commit(result.events);
      return;
    }

    if ("step" in raw) {
      const [phaseId, indexPart] = raw.step.split("#");
      const active = nextStep(pack, state);
      if (!active) {
        throw new PlayError(`script step #${index} ("${raw.step}"): no active step — the unit is finished or has not begun`, { step: index });
      }
      if (active.phase.id !== phaseId || (indexPart !== undefined && active.index !== Number(indexPart))) {
        throw new PlayError(
          `script step #${index} ("${raw.step}") is not the active step; the run is waiting on "${active.phase.id}#${active.index}"`,
          { step: index },
        );
      }

      switch (active.step.kind) {
        case "rollTable": {
          const table = active.step.table;
          // A step whose table still owes extra rolls this unit stays open:
          // `drive`'s completion event is `ExtraRollTaken`, not `StepCompleted`,
          // and the same step must be rolled again.
          for (let guard = 0; guard < 20; guard++) {
            const rollAt = now();
            const rolled = runBlockFor({ step: true }, index, raw, rollAt);
            commit(rolled);
            const last = rolled[rolled.length - 1];
            if (last?.t === "ExtraRollTaken" && last.table === table) continue;
            break;
          }
          break;
        }
        case "actions": {
          const at = now();
          commit(runBlockFor({ step: true }, index, raw, at));
          break;
        }
        case "manual": {
          commit(tickAll(active, checklistOf(active.step)));
          const at = now();
          const result = drive(pack, events, { step: true }, { now: at });
          if (result.status !== "done") throw new Error("unreachable: a manual step never awaits");
          commit(result.events);
          break;
        }
        case "declareSubject":
          throw new PlayError(
            `script step #${index} ("${raw.step}") is a declareSubject step; use { declare: "<type>" } instead`,
            { step: index },
          );
        case "finalizeUnit":
          finalizeCurrentUnit(active, index);
          break;
      }
      return;
    }

    if ("finalize" in raw) {
      const active = nextStep(pack, state);
      if (!active) {
        throw new PlayError(`cannot finalize at script step #${index}: no active step`, { step: index });
      }
      finalizeCurrentUnit(active, index);
      return;
    }

    if ("move" in raw) {
      const move = pack.moves?.[raw.move];
      if (!move) throw new PlayError(`script step #${index}: no such move "${raw.move}"`, { step: index });
      const at = now();
      commit(runBlockFor({ move: raw.move }, index, raw, at));
      return;
    }

    if ("settle" in raw) {
      const candidates: Obligation[] = [...currentlyDue(pack, state), ...openNotes(state)];
      const target = candidates.find((o) => o.id === raw.settle || o.text === raw.settle);
      if (!target) {
        throw new PlayError(`script step #${index}: no due obligation matching "${raw.settle}"`, { step: index });
      }
      const at = now();
      commit(runBlockFor({ settle: target.id }, index, raw, at));
      return;
    }

    // "tick"
    const active = nextStep(pack, state);
    if (!active) throw new PlayError(`cannot tick "${raw.tick}" at script step #${index}: no active step`, { step: index });
    const list = checklistOf(active.step);
    const itemIndex = list.findIndex((item) => itemText(item) === raw.tick);
    if (itemIndex < 0) {
      throw new PlayError(`script step #${index}: no checklist item "${raw.tick}" on the active step`, { step: index });
    }
    const at = now();
    const result = drive(pack, events, { tick: { index: itemIndex, on: true } }, { now: at });
    if (result.status !== "done") throw new Error("unreachable: a tick never awaits");
    commit(result.events);
  });

  return { state: state!, events, requests };
}
