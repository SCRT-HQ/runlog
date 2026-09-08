import {
  rollDice,
  type Action,
  type Pack,
  type Predicate,
  type Table,
  type TargetRef,
  type Trigger,
} from "@runlog/rules-schema";
import type { RunEvent } from "./events.ts";
import { resolveTargeting } from "./targeting.ts";
import { eligibleTargets } from "./eligibility.ts";
import { currentSubject } from "./reduce.ts";
import { clockOfUnit, elapsedMs } from "./clock.ts";
import type { Clock, InputRequest, RunState, TriggerRef } from "./types.ts";

/**
 * Running a pack's actions against run state.
 *
 * Two design choices carry most of the weight here.
 *
 * **Execution is interruptible.** A pack can ask for a die roll the player
 * wants to make with real dice, or for a judgment about the work that the
 * engine has no way to see. So the executor stops and asks, rather than
 * inventing an answer.
 *
 * **Resuming re-runs from the beginning**, replaying answers already given.
 * Actions are pure given (state, answers), so the second pass retraces exactly
 * the same path and stops at the next unanswered question. That removes any
 * need to freeze a call stack, and it means a half-finished resolution commits
 * nothing: events land only once the whole tree completes. An entry either
 * resolves or it does not.
 */

export type AnswerValue = string | number | boolean;

export interface ExecContext {
  /** Answers already given, keyed by the deterministic key of each request. */
  answers: Record<string, AnswerValue>;
  /**
   * When present, rolls are generated instead of asked for. Physical dice are
   * the default, so most of the time this is absent on purpose.
   */
  random?: () => number;
  /**
   * Answer keys whose values the app produced rather than the player.
   *
   * The log records how every roll came about, and a convenience button must
   * not be able to launder a generated number into the record as a physical
   * one. Provenance is the whole reason the field exists.
   */
  generatedAnswers?: readonly string[];
  /**
   * Marks a random source as coming from the run's seed rather than from
   * whatever the browser had lying around, so the log can say which.
   */
  seeded?: boolean;
  /** Timestamp stamped on every generated event. */
  now: string;
  /** Distinguishes executions so their keys cannot collide. */
  keyPrefix?: string;
}

export interface ExecResult {
  status: "done" | "awaiting";
  /** The complete event list for this execution. Commit only when done. */
  events: RunEvent[];
  /** What is needed to carry on. */
  request?: InputRequest;
}

/**
 * Thrown to unwind out to the top when the player must answer something.
 *
 * Written out longhand rather than as a parameter property: the CLI runs on
 * plain Node with `--experimental-strip-types`, which erases annotations
 * without evaluating them and so cannot desugar `constructor(readonly x)`.
 * Keeping the engine loadable that way is what lets someone validate and test
 * a pack with `npx` and no build step.
 */
class NeedInput extends Error {
  readonly request: InputRequest;

  constructor(request: InputRequest) {
    super(`awaiting ${request.kind}`);
    this.request = request;
  }
}

interface Frame {
  pack: Pack;
  state: RunState;
  ctx: ExecContext;
  events: RunEvent[];
  /** Values bound by `roll` and `prompt`, readable by `branch`. */
  vars: Map<string, AnswerValue>;
  /** The subject a consequence is currently aimed at. */
  target: number | null;
}

const at = (f: Frame) => f.ctx.now;

function need(f: Frame, request: InputRequest): AnswerValue {
  const existing = f.ctx.answers[request.key];
  if (existing !== undefined) return existing;
  throw new NeedInput(request);
}

/* ------------------------------------------------------------------ *
 * Predicates
 * ------------------------------------------------------------------ */

interface Bound {
  eq?: number;
  gte?: number;
  lte?: number;
  gteCounter?: string;
  lteCounter?: string;
}

/**
 * Compare a value against a bound, resolving any counter references.
 *
 * The counter variants exist because a rule like "roll a d6 against the number
 * of consequences you have suffered" cannot be written with literals: the
 * threshold is whatever the run has accumulated.
 */
function compare(value: number, bound: Bound, state?: RunState): boolean {
  if (bound.eq !== undefined && value !== bound.eq) return false;
  if (bound.gte !== undefined && value < bound.gte) return false;
  if (bound.lte !== undefined && value > bound.lte) return false;
  if (bound.gteCounter !== undefined && value < (state?.counters[bound.gteCounter] ?? 0)) {
    return false;
  }
  if (bound.lteCounter !== undefined && value > (state?.counters[bound.lteCounter] ?? 0)) {
    return false;
  }
  return true;
}

/**
 * The clock a `clockRan`/`clockRanOver` predicate names: the current unit's
 * own clock for `"unit"`, or the first clock in the current unit carrying
 * that label. Neither is a declared id -- a clock is just whatever a `clock`
 * config or a `startTimer`/`startStopwatch` action happened to call it.
 */
function namedClock(state: RunState, name: string): Clock | undefined {
  if (name === "unit") return clockOfUnit(state, state.unit);
  return state.clocks.find((c) => c.unit === state.unit && c.label === name);
}

function resolveSubjectRef(f: Frame, ref: TargetRef | undefined): number[] {
  const current = currentSubject(f.state);
  switch (ref) {
    case undefined:
    case "thisSubject":
      return current ? [current.id] : [];
    case "targetSubject":
      return f.target === null ? [] : [f.target];
    case "allSubjects":
      return f.state.subjects.filter((s) => !s.removed).map((s) => s.id);
    case "allPriorSubjects":
      return f.state.subjects
        .filter((s) => !s.removed && s.id !== current?.id)
        .map((s) => s.id);
    case "run":
      return [];
    default: {
      const bound = f.vars.get(ref.var);
      return typeof bound === "number" ? [bound] : [];
    }
  }
}

/**
 * A counter's value as this block of work sees it: what the log says, plus
 * whatever the block has already changed and not yet committed. A prompt
 * that sets a count and a draw that reads it in the same step must agree.
 */
function counterNow(f: Frame, id: string): number {
  let value = f.state.counters[id] ?? f.pack.counters?.[id]?.initial ?? Number.NaN;
  for (const e of f.events) {
    if (e.t !== "CounterChanged" || e.counter !== id) continue;
    value = e.set !== undefined ? e.set : (Number.isFinite(value) ? value : 0) + (e.by ?? 0);
  }
  return value;
}

export function evaluatePredicate(f: Frame, p: Predicate, key: string): boolean {
  if ("ask" in p) {
    // The engine models units, subjects, states and counters. It does not
    // model the creative work, so anything about the work itself is a question
    // rather than a computation. Pretending otherwise is how a tool starts
    // lying to its user.
    return need(f, { kind: "ask", key, question: p.ask }) === true;
  }
  if ("unitIndex" in p) return compare(f.state.unit, p.unitIndex, f.state);
  if ("subjectCount" in p) return compare(f.state.subjects.length, p.subjectCount, f.state);
  if ("eligibleTargets" in p) {
    return compare(eligibleTargets(f.pack, f.state).length, p.eligibleTargets, f.state);
  }
  if ("counter" in p) return compare(f.state.counters[p.counter] ?? 0, p.is, f.state);
  if ("resource" in p) return compare(f.state.resources[p.resource] ?? 0, p.is, f.state);
  if ("clockRan" in p) {
    const clock = namedClock(f.state, p.clockRan);
    if (!clock) return false;
    // Read live off the timestamps rather than a stored total, so this holds
    // while the clock is still running and not only after it stops.
    const minutes = elapsedMs(clock, Date.parse(f.ctx.now)) / 60_000;
    return compare(minutes, p.is, f.state);
  }
  if ("clockRanOver" in p) {
    const clock = namedClock(f.state, p.clockRanOver);
    if (!clock || clock.kind !== "timer" || clock.seconds === null) return false;
    const overMs = Math.max(0, elapsedMs(clock, Date.parse(f.ctx.now)) - clock.seconds * 1000);
    return compare(overMs / 60_000, p.is, f.state);
  }
  if ("flag" in p) return (f.state.flags[p.flag] ?? false) === (p.is ?? true);
  if ("subjectHasState" in p) {
    if (f.pack.states?.[p.subjectHasState]?.scope === "run" || p.of === "run") {
      return f.state.runStates.includes(p.subjectHasState);
    }
    const ids = resolveSubjectRef(f, p.of);
    return f.state.subjects.some(
      (s) => ids.includes(s.id) && s.states.includes(p.subjectHasState),
    );
  }
  if ("priorSubjectTagged" in p) {
    return f.state.outcomes.some((o) => {
      const table = f.pack.tables[o.table];
      const entry = table?.entries.find((e) => e.id === o.entryId);
      return entry?.tags?.includes(p.priorSubjectTagged) ?? false;
    });
  }
  if ("modeIs" in p) return p.modeIs.includes(f.state.mode);
  if ("phaseDone" in p) return f.state.phasesDone.includes(p.phaseDone);
  if ("not" in p) return !evaluatePredicate(f, p.not, `${key}!`);
  if ("allOf" in p) return p.allOf.every((q, i) => evaluatePredicate(f, q, `${key}&${i}`));
  return p.anyOf.some((q, i) => evaluatePredicate(f, q, `${key}|${i}`));
}

const allHold = (f: Frame, preds: Predicate[] | undefined, key: string): boolean =>
  (preds ?? []).every((p, i) => evaluatePredicate(f, p, `${key}?${i}`));

/**
 * True when at least one predicate holds.
 *
 * Note the asymmetry with `allHold` on an empty list. "All of nothing" is
 * vacuously true; "any of nothing" is false. That distinction is not
 * pedantic — reading an absent `skipWhen` as "all conditions met" silently
 * skips every phase in the game, which is exactly the bug this replaced.
 */
const anyHold = (f: Frame, preds: Predicate[] | undefined, key: string): boolean =>
  (preds ?? []).some((p, i) => evaluatePredicate(f, p, `${key}?${i}`));

/* ------------------------------------------------------------------ *
 * Rolling and table resolution
 * ------------------------------------------------------------------ */

function obtainRoll(f: Frame, dice: string, key: string, purpose: string, label?: string): number {
  if (f.ctx.random) {
    const { total, dice: values } = rollDice(dice, f.ctx.random);
    f.events.push({
      t: "Rolled",
      at: at(f),
      purpose,
      dice,
      total,
      values,
      source: f.ctx.seeded ? "seeded" : "rng",
    });
    return total;
  }
  const value = Number(need(f, { kind: "roll", key, dice, purpose, label }));
  f.events.push({
    t: "Rolled",
    at: at(f),
    purpose,
    dice,
    total: value,
    values: [value],
    source: f.ctx.generatedAnswers?.includes(key) ? "rng" : "physical",
  });
  return value;
}

/** Find the entry a total selects, for whichever resolution the table uses. */
/**
 * Roll on a table until the result is one this run can do.
 *
 * A pack can say a result `needs` something optional — a barbell, an oven —
 * and a run says at the start what it lacks. A result that needs a lacked
 * thing is drawn again, up to a few times, so the dice never demand what the
 * room does not have. The rolls all land in the log; the last one counts.
 */
function drawTotal(f: Frame, tableId: string, table: Table, key: string): number {
  let total = rollForTable(f, tableId, table, key);
  for (let again = 1; again <= 8 && f.state.lacks.length > 0; again++) {
    const entry = selectEntry(table, total) as { id: string; needs?: string[] } | undefined;
    if (!entry?.needs?.some((n) => f.state.lacks.includes(n))) break;
    total = rollForTable(f, tableId, table, `${key}~${again}`);
  }
  return total;
}

export function selectEntry(table: Table, total: number): { id: string } | undefined {
  switch (table.resolution) {
    case "lookup":
      return table.entries.find((e) => total >= e.range[0] && total <= e.range[1]);
    case "bands":
      return table.entries.find(
        (e) => (e.gte ?? -Infinity) <= total && total <= (e.lte ?? Infinity),
      );
    case "opposed":
      return table.entries.find((e) => e.beats === total);
    case "keyed":
      return table.entries[total];
  }
}

function tableRollExpression(table: Table): string {
  return table.resolution === "opposed" ? table.action : table.resolution === "keyed" ? "" : table.roll;
}

/**
 * Resolve one entry: record it, run whatever fires now, and queue whatever
 * fires later.
 */
function resolveEntry(
  f: Frame,
  tableId: string,
  table: Table,
  entryId: string,
  cause: "phase" | "action" | "manual",
  key: string,
): void {
  const entry = table.entries.find((e) => e.id === entryId);
  if (!entry) return;

  f.events.push({
    t: "OutcomeResolved",
    at: at(f),
    table: tableId,
    entryId,
    cause,
    ...(f.target !== null ? { targetSubject: f.target } : {}),
  });

  for (const state of entry.grants ?? []) {
    const scope = f.pack.states?.[state]?.scope ?? "subject";
    if (scope === "run") {
      f.events.push({ t: "StateApplied", at: at(f), state });
    } else {
      // A granted state lands on whatever the entry reached for, falling back
      // to the subject being made.
      const ids = f.target !== null ? [f.target] : resolveSubjectRef(f, "thisSubject");
      for (const id of ids) f.events.push({ t: "StateApplied", at: at(f), state, subject: id });
    }
  }

  entry.triggers?.forEach((trigger, index) => {
    const ref: TriggerRef = { kind: "tableEntry", table: tableId, entryId, index };
    scheduleOrRun(f, trigger, ref, `${key}/t${index}`);
  });
}

/**
 * Either run a trigger now, or write it into the obligation queue.
 *
 * The deferred case is the whole point of the queue: "after composing, roll
 * d6" is precisely the instruction a person forgets an hour later.
 */
function scheduleOrRun(f: Frame, trigger: Trigger, ref: TriggerRef, key: string): void {
  if (trigger.on === "immediately") {
    if (!allHold(f, trigger.when, key)) return;
    runActions(f, trigger.do, key);
    return;
  }
  const id = obligationId(f, ref, trigger.on);
  f.events.push({
    t: "ObligationAdded",
    at: at(f),
    obligation: {
      id,
      kind: "trigger",
      text: trigger.label ?? describeTrigger(f.pack, ref),
      on: trigger.on,
      ref,
      targetSubject: f.target,
    },
  });
}

function obligationId(f: Frame, ref: TriggerRef, on: string): string {
  const tail =
    ref.kind === "tableEntry"
      ? `${ref.table}.${ref.entryId}.${ref.index}`
      : ref.kind === "card"
        ? `${ref.deck}.${ref.cardId}.${ref.index}`
        : `${ref.counter}.${ref.index}`;
  // Includes the unit, so the same entry rolled twice owes twice.
  return `u${f.state.unit}:${on}:${tail}`;
}

function describeTrigger(pack: Pack, ref: TriggerRef): string {
  if (ref.kind === "tableEntry") {
    const entry = pack.tables[ref.table]?.entries.find((e) => e.id === ref.entryId);
    return entry?.title ?? entry?.text ?? ref.entryId;
  }
  if (ref.kind === "card") {
    const deck = pack.decks?.[ref.deck];
    if (deck?.kind === "cards") {
      const card = deck.cards.find((c) => c.id === ref.cardId);
      return card?.title ?? ref.cardId;
    }
    return ref.cardId;
  }
  return pack.counters?.[ref.counter]?.label ?? ref.counter;
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

function runActions(f: Frame, actions: Action[], key: string): void {
  actions.forEach((action, i) => runAction(f, action, `${key}/${i}`));
}

function runAction(f: Frame, action: Action, key: string): void {
  switch (action.do) {
    case "roll": {
      const total = obtainRoll(f, action.dice, key, action.into, action.label);
      f.vars.set(action.into, total);
      break;
    }

    case "rollOn": {
      const table = f.pack.tables[action.table];
      if (!table) break;
      // "Roll for how many to roll": a total bound earlier says the count —
      // or a counter does, which is how a run keeps a setting the moderator
      // chose once and can nudge later.
      const named = action.timesFrom;
      const bound = named === undefined ? Number.NaN : f.vars.has(named) ? Number(f.vars.get(named)) : counterNow(f, named);
      const times = Number.isFinite(bound) ? Math.max(1, Math.min(10, Math.floor(bound))) : (action.times ?? 1);
      const results: number[] = [];
      for (let n = 0; n < times; n++) {
        results.push(drawTotal(f, action.table, table, `${key}#${n}`));
      }
      let chosen = results;
      if (times > 1 && action.choose === "one") {
        const pick = Number(
          need(f, {
            kind: "prompt",
            key: `${key}!pick`,
            promptKind: "chooseValue",
            label: `Choose which result to apply`,
            options: results.map(String),
          }),
        );
        chosen = [pick];
      }
      for (const total of chosen) {
        const entry = selectEntry(table, total);
        if (entry) resolveEntry(f, action.table, table, entry.id, "action", `${key}=${total}`);
      }
      if (action.into && chosen[0] !== undefined) f.vars.set(action.into, chosen[0]);
      break;
    }

    case "branch": {
      const value = Number(f.vars.get(action.on) ?? 0);
      const hit = action.cases.find(
        (c) => (c.in?.includes(value) ?? false) || (c.is ? compare(value, c.is, f.state) : false),
      );
      if (hit) runActions(f, hit.then, `${key}>`);
      else if (action.else) runActions(f, action.else, `${key}<`);
      break;
    }

    case "prompt": {
      const answer = need(f, {
        kind: "prompt",
        key,
        promptKind: action.kind,
        label: action.label,
        ...(action.options ? { options: action.options } : {}),
        ...(action.eligibleOnly !== undefined ? { eligibleOnly: action.eligibleOnly } : {}),
      });
      if (action.into) f.vars.set(action.into, answer);
      if (action.kind === "chooseSubject" && typeof answer === "number") f.target = answer;
      break;
    }

    case "resolveTarget": {
      const from = action.from ?? "currentRoll";
      const lastRoll = [...f.events].reverse().find((e) => e.t === "Rolled");
      const derivation = resolveTargeting(f.pack, f.state, {
        roll: lastRoll?.t === "Rolled" ? lastRoll.total : 0,
        from,
        ...(f.ctx.random ? { random: f.ctx.random } : {}),
      });

      if (derivation.outcome === "playerChoice") {
        const chosen = Number(
          need(f, {
            kind: "chooseTarget",
            key,
            label: `Choose which ${f.pack.vocabulary.subject.one.toLowerCase()} suffers`,
            eligible: derivation.eligible,
          }),
        );
        f.target = chosen;
      } else {
        f.target = derivation.targetSubject;
      }
      if (action.into && f.target !== null) f.vars.set(action.into, f.target);
      break;
    }

    case "applyState":
    case "removeState": {
      const t = action.do === "applyState" ? "StateApplied" : "StateRemoved";
      const scope = f.pack.states?.[action.state]?.scope ?? "subject";
      if (scope === "run" || action.to === "run") {
        f.events.push({ t, at: at(f), state: action.state });
      } else {
        for (const id of resolveSubjectRef(f, action.to)) {
          f.events.push({ t, at: at(f), state: action.state, subject: id });
        }
      }
      break;
    }

    case "removeSubject":
      for (const id of resolveSubjectRef(f, action.to)) {
        f.events.push({ t: "SubjectRemoved", at: at(f), subject: id });
      }
      break;

    case "ban": {
      const literal = action.subjectType;
      if (literal) {
        f.events.push({ t: "TypeBanned", at: at(f), subjectType: literal });
        break;
      }
      for (const id of resolveSubjectRef(f, action.from ?? "targetSubject")) {
        const type = f.state.subjects.find((s) => s.id === id)?.type;
        if (type) f.events.push({ t: "TypeBanned", at: at(f), subjectType: type });
      }
      break;
    }

    case "forceUnit":
      f.events.push({ t: "UnitForced", at: at(f), count: action.count ?? 1 });
      break;

    case "extraRoll":
      f.events.push({ t: "ExtraRollQueued", at: at(f), table: action.table, count: action.count ?? 1, unit: action.unit ?? "next" });
      break;

    case "rewind":
      f.events.push({ t: "RewindQueued", at: at(f), count: action.count ?? 1 });
      break;

    case "modCounter": {
      const from = action.setFrom !== undefined ? Number(f.vars.get(action.setFrom)) : Number.NaN;
      const set = Number.isFinite(from) ? Math.floor(from) : action.set;
      f.events.push({
        t: "CounterChanged",
        at: at(f),
        counter: action.counter,
        ...(set !== undefined ? { set } : { by: action.by ?? 0 }),
      });
      break;
    }

    case "modResource": {
      const from = action.setFrom !== undefined ? Number(f.vars.get(action.setFrom)) : Number.NaN;
      const set = Number.isFinite(from) ? Math.floor(from) : action.set;
      f.events.push({
        t: "ResourceChanged",
        at: at(f),
        resource: action.resource,
        ...(set !== undefined ? { set } : { by: action.by ?? 0 }),
      });
      break;
    }

    case "grantCard": {
      const deck = f.pack.decks?.[action.deck];
      if (!deck || deck.kind !== "cards") break;
      const held = new Set(f.state.hand.filter((c) => c.deck === action.deck).map((c) => c.cardId));
      const available = deck.cards.filter((c) => !deck.unique || !held.has(c.id));
      for (let n = 0; n < (action.count ?? 1); n++) {
        if (available.length === 0) break;
        const index = f.ctx.random
          ? Math.floor(f.ctx.random() * available.length)
          : available.findIndex(
              (c) =>
                c.id ===
                String(
                  need(f, {
                    kind: "prompt",
                    key: `${key}#${n}`,
                    promptKind: "chooseValue",
                    label: `Draw from ${deck.title}`,
                    options: available.map((c) => c.id),
                  }),
                ),
            );
        const card = available[Math.max(0, index)];
        if (!card) break;
        available.splice(Math.max(0, index), 1);
        f.events.push({ t: "CardDrawn", at: at(f), deck: action.deck, cardId: card.id });
      }
      break;
    }

    case "discardCard": {
      const held = f.state.hand.filter((c) => c.deck === action.deck);
      for (let n = 0; n < Math.min(action.count ?? 1, held.length); n++) {
        const card = held[n];
        if (card) {
          f.events.push({
            t: "CardDiscarded",
            at: at(f),
            deck: action.deck,
            cardId: card.cardId,
          });
        }
      }
      break;
    }

    case "startTimer":
      // A clock on screen, ticking down. The app still cannot make you stop
      // working; it can only tell you when the time you agreed to is up.
      f.events.push({
        t: "ClockStarted",
        at: at(f),
        clock: `${key}:timer`,
        kind: "timer",
        label: action.label ?? "Timer",
        seconds: Math.round(action.minutes * 60),
      });
      break;

    case "startStopwatch":
      f.events.push({
        t: "ClockStarted",
        at: at(f),
        clock: `${key}:stopwatch`,
        kind: "stopwatch",
        label: action.label ?? "Stopwatch",
      });
      break;

    case "note":
      f.events.push({
        t: "ObligationAdded",
        at: at(f),
        obligation: {
          id: `${key}:note`,
          kind: "note",
          text: action.text,
          ...(action.persistent ? { persistent: true } : {}),
        },
      });
      break;

    case "setFlag":
      f.events.push({ t: "FlagSet", at: at(f), flag: action.flag, value: action.value ?? true });
      break;

    case "endRunAttempt":
      f.events.push({
        t: "ObligationAdded",
        at: at(f),
        obligation: {
          id: `${key}:end`,
          kind: "note",
          text: "Attempt to end the run.",
        },
      });
      break;

    case "when": {
      if (allHold(f, action.all, key)) runActions(f, action.then, `${key}>`);
      else if (action.else) runActions(f, action.else, `${key}<`);
      break;
    }
  }
}

/** Roll on a table, in whatever way that table is consulted. */
function rollForTable(f: Frame, tableId: string, table: Table, key: string): number {
  if (table.resolution === "keyed") {
    // A keyed table is drawn, not rolled. Index into it.
    const index = f.ctx.random
      ? Math.floor(f.ctx.random() * table.entries.length)
      : table.entries.findIndex(
          (e) =>
            e.key ===
            String(
              need(f, {
                kind: "prompt",
                key,
                promptKind: "chooseValue",
                label: table.title,
                options: table.entries.map((x) => x.key),
              }),
            ),
        );
    return Math.max(0, index);
  }

  if (table.resolution === "opposed") {
    const action = obtainRoll(f, table.action, `${key}a`, tableId, `${table.title}: action`);
    const bonus = table.addResource ? (f.state.resources[table.addResource] ?? 0) : 0;
    const score = action + bonus;
    let beaten = 0;
    for (let n = 0; n < table.challenge.count; n++) {
      const c = obtainRoll(
        f,
        table.challenge.dice,
        `${key}c${n}`,
        tableId,
        `${table.title}: challenge ${n + 1}`,
      );
      // Ties go to the challenge, which is what gives these games their edge.
      if (score > c) beaten += 1;
    }
    return beaten;
  }

  return obtainRoll(f, tableRollExpression(table), key, tableId, table.title);
}

/* ------------------------------------------------------------------ *
 * Public entry points
 * ------------------------------------------------------------------ */

export function executeActions(
  pack: Pack,
  state: RunState,
  actions: Action[],
  ctx: ExecContext,
): ExecResult {
  const frame: Frame = { pack, state, ctx, events: [], vars: new Map(), target: null };
  try {
    runActions(frame, actions, ctx.keyPrefix ?? "");
    return { status: "done", events: frame.events };
  } catch (e) {
    if (e instanceof NeedInput) {
      return { status: "awaiting", events: frame.events, request: e.request };
    }
    throw e;
  }
}

/** Roll on a table and resolve whatever comes up, triggers and all. */
export function executeTableRoll(
  pack: Pack,
  state: RunState,
  tableId: string,
  ctx: ExecContext,
  cause: "phase" | "action" | "manual" = "phase",
): ExecResult {
  const table = pack.tables[tableId];
  if (!table) return { status: "done", events: [] };
  const frame: Frame = { pack, state, ctx, events: [], vars: new Map(), target: null };
  const key = ctx.keyPrefix ?? tableId;
  try {
    const total = drawTotal(frame, tableId, table, key);
    const entry = selectEntry(table, total);
    if (entry) resolveEntry(frame, tableId, table, entry.id, cause, `${key}=${total}`);
    return { status: "done", events: frame.events };
  } catch (e) {
    if (e instanceof NeedInput) {
      return { status: "awaiting", events: frame.events, request: e.request };
    }
    throw e;
  }
}

/**
 * Evaluate predicates without running anything.
 *
 * Phase and step `skipWhen` clauses need answering before the flow can be
 * drawn, and a clause may legitimately ask the player something. So this has
 * the same interruptible shape as the executor rather than guessing.
 */
export function testPredicates(
  pack: Pack,
  state: RunState,
  preds: Predicate[] | undefined,
  ctx: ExecContext,
  /**
   * How to combine several predicates. `all` for conditions that must each
   * hold, `any` for a list of triggers. Always passed explicitly at the call
   * site: the wrong default here is invisible and catastrophic.
   */
  combine: "all" | "any" = "all",
): { status: "done"; value: boolean } | { status: "awaiting"; request: InputRequest } {
  const frame: Frame = { pack, state, ctx, events: [], vars: new Map(), target: null };
  try {
    const combiner = combine === "any" ? anyHold : allHold;
    return { status: "done", value: combiner(frame, preds, ctx.keyPrefix ?? "") };
  } catch (e) {
    if (e instanceof NeedInput) return { status: "awaiting", request: e.request };
    throw e;
  }
}

/** Where in a unit's flow a move may be offered. */
export type Placement = "anytime" | "betweenUnits" | "beforeEnding";

/**
 * Moves the player may take right now.
 *
 * Everything the player initiates rather than has done to them: spending a
 * one-shot card, re-entering an earlier unit to repair it, resampling the lot
 * and carrying on from the wreckage. Availability is the pack's business, not
 * the engine's.
 */
export function availableMoves(
  pack: Pack,
  state: RunState,
  /**
   * Where in the flow the player is. A list because more than one placement
   * can be open at once — between units, they are both stopping and carrying
   * on — and because taking a list is what makes the alternative impossible:
   * calling this twice and concatenating counted every `anytime` move once per
   * call, and the player was offered it twice.
   */
  where: Placement | readonly Placement[] = "anytime",
): Array<{ id: string; move: NonNullable<Pack["moves"]>[string] }> {
  const places = new Set<Placement>(typeof where === "string" ? [where] : where);
  const out: Array<{ id: string; move: NonNullable<Pack["moves"]>[string] }> = [];

  for (const [id, move] of Object.entries(pack.moves ?? {})) {
    if (move.when !== "anytime" && !places.has(move.when)) continue;
    if (move.oncePerRun && state.firedOnce.includes(`move:${id}`)) continue;
    const frame: Frame = {
      pack,
      state,
      ctx: { answers: {}, now: "" },
      events: [],
      vars: new Map(),
      target: null,
    };
    try {
      // A move whose availability depends on the player's judgment is offered
      // rather than hidden: the question gets asked when they take it.
      if (!allHold(frame, move.available, `move:${id}`)) continue;
    } catch (e) {
      if (!(e instanceof NeedInput)) throw e;
    }
    out.push({ id, move });
  }
  return out;
}

/** Take a move, recording that it was used so a once-per-run one is spent. */
export function executeMove(
  pack: Pack,
  state: RunState,
  moveId: string,
  ctx: ExecContext,
): ExecResult {
  const move = pack.moves?.[moveId];
  if (!move) return { status: "done", events: [] };
  const frame: Frame = { pack, state, ctx, events: [], vars: new Map(), target: null };
  try {
    runActions(frame, move.do, ctx.keyPrefix ?? `move:${moveId}`);
    frame.events.push({ t: "TriggerFired", at: ctx.now, key: `move:${moveId}` });
    return { status: "done", events: frame.events };
  } catch (e) {
    if (e instanceof NeedInput) {
      return { status: "awaiting", events: frame.events, request: e.request };
    }
    throw e;
  }
}

/**
 * Fire a counter's threshold trigger and record that it did.
 *
 * The record is what stops it firing again while the threshold still holds —
 * a counter that stays over its limit would otherwise trip on every read.
 */
export function executeCounterTrigger(
  pack: Pack,
  state: RunState,
  counterId: string,
  index: number,
  key: string,
  ctx: ExecContext,
): ExecResult {
  const trigger = pack.counters?.[counterId]?.triggers?.[index];
  if (!trigger) return { status: "done", events: [] };

  const frame: Frame = { pack, state, ctx, events: [], vars: new Map(), target: null };
  try {
    runActions(frame, trigger.do, ctx.keyPrefix ?? key);
    frame.events.push({ t: "TriggerFired", at: ctx.now, key });
    return { status: "done", events: frame.events };
  } catch (e) {
    if (e instanceof NeedInput) {
      return { status: "awaiting", events: frame.events, request: e.request };
    }
    throw e;
  }
}

/** Obligations that come due at a given point in the lifecycle. */
export function dueObligations(state: RunState, point: string) {
  return state.obligations.filter((o) => !o.resolved && o.kind === "trigger" && o.on === point);
}

/** Notes the player still owes, oldest first. */
export function openNotes(state: RunState) {
  return state.obligations.filter((o) => !o.resolved && o.kind === "note");
}

/** Look up the actions a queued trigger refers to. */
export function actionsForRef(pack: Pack, ref: TriggerRef): Action[] {
  if (ref.kind === "tableEntry") {
    const entry = pack.tables[ref.table]?.entries.find((e) => e.id === ref.entryId);
    return entry?.triggers?.[ref.index]?.do ?? [];
  }
  if (ref.kind === "card") {
    const deck = pack.decks?.[ref.deck];
    if (deck?.kind !== "cards") return [];
    return deck.cards.find((c) => c.id === ref.cardId)?.triggers?.[ref.index]?.do ?? [];
  }
  return pack.counters?.[ref.counter]?.triggers?.[ref.index]?.do ?? [];
}

/**
 * Run a queued trigger and mark it settled.
 *
 * The resolution event is appended only on completion, so an interrupted
 * trigger stays owed rather than half-paid.
 */
export function executeObligation(
  pack: Pack,
  state: RunState,
  obligationId: string,
  ctx: ExecContext,
): ExecResult {
  const obligation = state.obligations.find((o) => o.id === obligationId);
  if (!obligation) return { status: "done", events: [] };

  if (obligation.kind === "note" || !obligation.ref) {
    return {
      status: "done",
      events: [{ t: "ObligationResolved", at: ctx.now, id: obligationId }],
    };
  }

  const actions = actionsForRef(pack, obligation.ref);
  const frame: Frame = {
    pack,
    state,
    ctx,
    events: [],
    vars: new Map(),
    target: obligation.targetSubject ?? null,
  };
  try {
    runActions(frame, actions, ctx.keyPrefix ?? obligationId);
    frame.events.push({ t: "ObligationResolved", at: ctx.now, id: obligationId });
    return { status: "done", events: frame.events };
  } catch (e) {
    if (e instanceof NeedInput) {
      return { status: "awaiting", events: frame.events, request: e.request };
    }
    throw e;
  }
}

/**
 * Fire one of the pack's own triggers — the ones that belong to the game
 * rather than to any result rolled up.
 *
 * Recorded once fired, which is what stops the end-of-run roll from being
 * offered again every time the finished run is reopened.
 */
export function executeGlobalTrigger(
  pack: Pack,
  state: RunState,
  index: number,
  key: string,
  ctx: ExecContext,
): ExecResult {
  const trigger = pack.triggers?.[index];
  if (!trigger) return { status: "done", events: [] };

  const frame: Frame = { pack, state, ctx, events: [], vars: new Map(), target: null };
  try {
    if (!allHold(frame, trigger.when, ctx.keyPrefix ?? key)) {
      return { status: "done", events: [{ t: "TriggerFired", at: ctx.now, key }] };
    }
    runActions(frame, trigger.do, ctx.keyPrefix ?? key);
    frame.events.push({ t: "TriggerFired", at: ctx.now, key });
    return { status: "done", events: frame.events };
  } catch (e) {
    if (e instanceof NeedInput) {
      return { status: "awaiting", events: frame.events, request: e.request };
    }
    throw e;
  }
}
