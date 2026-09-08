import type { Action, Pack } from "@runlog/rules-schema";
import type { RunEvent } from "./events.ts";
import { createRandom, streamSeed } from "./rng.ts";
import { nextUnit, reduce } from "./reduce.ts";
import {
  checklistOf,
  closeUnitEvents,
  currentlyDue,
  itemOptional,
  itemText,
  nextStep,
  stepCompletionEvents,
  type ActiveStep,
} from "./flow.ts";
import {
  availableMoves,
  dueObligations,
  executeActions,
  executeMove,
  executeObligation,
  executeTableRoll,
  openNotes,
  type AnswerValue,
  type ExecContext,
  type ExecResult,
} from "./execute.ts";
import { stopClocksEvents, unitClockStart } from "./clock.ts";
import { challenges, moderation, type Challenge } from "./moderated.ts";
import type { InputRequest, Obligation, RunState } from "./types.ts";

/**
 * Driving a run one action at a time.
 *
 * `playThrough` plays a whole scripted run in one call, which is right for a
 * fixture but wrong for a Discord bot: a Lambda answers one button press,
 * writes down where it got to, and forgets everything until the next press.
 * `drive` and `answer` are that shape. Each call does exactly one thing —
 * advance the flow, or take one more step through an interrupted block — and
 * either finishes with events to commit or hands back a `Pending` the caller
 * can serialize, store, and resume later with the next answer.
 *
 * This is the same interruptible-execution model `execute.ts` already has
 * (a block re-runs from the top, replaying answers, until it stops asking);
 * `drive`/`answer` just expose it one round trip at a time instead of
 * looping through a whole script synchronously. `playThrough` is built on
 * top of these now, rather than duplicating the loop.
 */

/** What can happen right now, for a caller deciding what button to offer. */
export interface Agenda {
  phase: "setup" | "betweenUnits" | "step" | "ended";
  active: ActiveStep | null;
  /** The active step's checklist or confirm points, with what is ticked so far. */
  checklist: Array<{ index: number; key: string; text: string; on: boolean }>;
  due: Obligation[];
  /** Ids of moves offered right now. */
  moves: string[];
  canFinalize: boolean;
  /** This unit's scoring results, in a moderated run; empty otherwise. */
  challenges: Challenge[];
}

const EMPTY_AGENDA = (phase: Agenda["phase"]): Agenda => ({
  phase,
  active: null,
  checklist: [],
  due: [],
  moves: [],
  canFinalize: false,
  challenges: [],
});

/** What is ticked on a step, read back from the log by its key. Mirrors `apps/web/src/run/stepChecks.ts`'s `ticksFor`. */
function ticksFor(state: RunState, key: string): Set<string> {
  const prefix = `${key}|`;
  return new Set(state.checks.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
}

/** Every non-optional point on the active step's checklist is ticked. */
function checklistSatisfied(state: RunState, active: ActiveStep): boolean {
  const items = checklistOf(active.step);
  if (items.length === 0) return true;
  const key = `${active.phase.id}#${active.index}`;
  const ticked = ticksFor(state, key);
  return items.every((item, i) => itemOptional(item) || ticked.has(String(i)));
}

/** What the caller can do at this point in the run: the state and the log, boiled down to a menu. */
export function agenda(pack: Pack, state: RunState | null, events: readonly RunEvent[]): Agenda {
  if (!state || state.unit === 0) return EMPTY_AGENDA("setup");
  if (state.status === "ended") return EMPTY_AGENDA("ended");

  const active = nextStep(pack, state);
  const due = currentlyDue(pack, state);
  const blocking = [...due, ...dueObligations(state, "onFinalize")].filter((o) => !o.resolved);
  const checklist = active
    ? checklistOf(active.step).map((item, index) => ({
        index,
        key: `${active.phase.id}#${active.index}`,
        text: itemText(item),
        on: ticksFor(state, `${active.phase.id}#${active.index}`).has(String(index)),
      }))
    : [];
  const moves = availableMoves(pack, state, active ? "anytime" : ["betweenUnits", "beforeEnding"]).map((m) => m.id);
  const rule = moderation(pack, state);

  return {
    phase: active ? "step" : "betweenUnits",
    active,
    checklist,
    due,
    moves,
    canFinalize: active?.step.kind === "finalizeUnit" && blocking.length === 0,
    challenges: rule ? challenges(pack, state) : [],
  };
}

/** One action a caller may ask the run to take. Named for the general case: nothing here is specific to any one pack. */
export type DriveAction =
  | { enter: true }
  | { declare: string }
  | { step: true }
  | { tick: { index: number; on: boolean } }
  | { finalize: true }
  | { move: string }
  | { settle: string };

export interface DriveContext {
  /** Stamped on every event this call produces. */
  now: string;
  /** A seeded run rolls from its seed stream; see `randomFor`. */
  seed?: string;
  /**
   * Roll on the player's behalf instead of waiting for a physical die.
   *
   * At the top of a block (`drive`) this turns rolling on; mid-block
   * (`answer`, where a request is already awaiting) it instead marks the
   * one answer just given as generated rather than physical — the same
   * distinction `useRun`'s `answer(key, value, machineRolled)` makes, folded
   * into the one flag this narrower call surface has room for.
   */
  autoRoll?: boolean;
  /**
   * Present only so `drive` and `answer` can share one context type; `drive`
   * never reads it; `answer` takes the block it is resuming as its own
   * parameter instead, since that is what a caller actually has in hand.
   */
  pending?: Pending;
  /**
   * Mints an id for each event and one shared id for everything one action
   * produces — the `move` a shared log undoes as a batch. Ids are minted at
   * the edge in the running app (see `useRun.commit`); tests and
   * `playThrough` normally omit this and get unstamped events, exactly as
   * the engine has always produced them.
   */
  mintId?: () => string;
}

export type DriveResult = { status: "done"; events: RunEvent[] } | { status: "awaiting"; request: InputRequest; pending: Pending };

/** What kind of block is in flight, for resuming it. Mirrors `useRun.Pending`'s `kind`. */
export type PendingKind = "table" | "actions" | "obligation" | "move";

/**
 * A block of work that has begun, is waiting on an answer, and commits
 * nothing until it finishes.
 *
 * Deliberately a plain object with no functions or class instances: it sits
 * in DynamoDB between two HTTP requests to a Lambda, so it must survive a
 * `JSON.stringify`/`JSON.parse` round trip unchanged. `completes` names a
 * phase and step index rather than carrying the `Phase` itself for the same
 * reason — the pack is looked up again from `pack`, which every caller
 * already has.
 */
export interface Pending {
  kind: PendingKind;
  tableId?: string;
  actions?: Action[];
  obligationId?: string;
  moveId?: string;
  /** This block's own identity, for seeding its random stream; not passed into the exec's own request keys. */
  keyPrefix: string;
  answers: Record<string, AnswerValue>;
  /** Keys the driver answered on the caller's behalf, kept out of the physical count. */
  generated: string[];
  request: InputRequest;
  /** What the block has produced so far, uncommitted — for showing the receipt between two questions. */
  partial: RunEvent[];
  /** The step this work belongs to, recorded as done when the block completes. */
  completes?: { phaseId: string; index: number };
  /** A move that is the unit's outcome: closes the unit when it completes. */
  closesUnit?: boolean;
  /** The unit the block began in, so a resumed roll draws from the same stream. */
  unit: number;
  seed?: string;
  autoRoll?: boolean;
  /** The shared id every event this block eventually commits will carry; unset when `ctx.mintId` was never given. */
  move?: string;
}

/**
 * Thrown when an action does not fit where the run is — the active step is
 * not the kind the action expects, an index or id names nothing, a
 * checklist the action depends on is not yet satisfied. A headless caller
 * has no disabled button to stop it from asking; this is the refusal that
 * takes that button's place.
 */
export class DriveError extends Error {
  readonly action?: DriveAction;

  constructor(message: string, action?: DriveAction) {
    super(message);
    this.name = "DriveError";
    this.action = action;
  }
}

/**
 * The stream a seeded run draws from for a request keyed by `keyPrefix`,
 * addressed by unit and occurrence exactly as `useRun.randomSource` does —
 * moved here so the driver rolls a shared seed the same way the app would
 * have, and any caller (the bot included) can reproduce it. Unseeded rolls
 * still need a source when the caller asked the driver to roll on its
 * behalf; `createRandom()` with no seed supplies one.
 */
export function randomFor(pack: Pack, state: RunState, events: readonly RunEvent[], keyPrefix: string, seed?: string): () => number {
  const seededRun = Boolean(seed) && Boolean(pack.modes[state.mode]?.seeded);
  if (seededRun) {
    const before = events.filter((e) => e.t === "Rolled" && e.purpose === keyPrefix && unitOf(events, e) === state.unit).length;
    return createRandom(streamSeed(seed!, state.unit, keyPrefix, before));
  }
  if (seed) return createRandom(`${seed}:${events.length}`);
  return createRandom();
}

/** Which unit an event happened in, counted from the `UnitEntered` markers ahead of it. Mirrors `useRun`'s private helper of the same job. */
function unitOf(events: readonly RunEvent[], event: RunEvent): number {
  let seen = 0;
  for (const e of events) {
    if (e.t === "UnitEntered") seen += 1;
    if (e === event) return seen;
  }
  return -1;
}

/** Whether this block should roll for itself rather than ask, and with what source label. */
function rollingContext(pack: Pack, state: RunState, events: readonly RunEvent[], keyPrefix: string, seed: string | undefined, autoRoll: boolean | undefined): Pick<ExecContext, "random" | "seeded"> {
  const seededRun = Boolean(seed) && Boolean(pack.modes[state.mode]?.seeded);
  if (!seededRun && !autoRoll) return {};
  return { random: randomFor(pack, state, events, keyPrefix, seed), seeded: seededRun };
}

/** Stamp ids and a shared `move` onto a finished batch, when the caller wants ids at all. */
function stamp(ctx: DriveContext, events: RunEvent[], move: string | undefined): DriveResult {
  if (!ctx.mintId) return { status: "done", events };
  const batch = move ?? ctx.mintId();
  return { status: "done", events: events.map((e) => ({ ...e, id: e.id ?? ctx.mintId!(), move: e.move ?? batch })) };
}

interface BlockMeta {
  kind: PendingKind;
  keyPrefix: string;
  exec: (ctx: ExecContext) => ExecResult;
  tableId?: string;
  actions?: Action[];
  obligationId?: string;
  moveId?: string;
  completes?: { phaseId: string; index: number };
  closesUnit?: boolean;
}

function completionEvents(pack: Pack, state: RunState, meta: Pick<BlockMeta, "completes" | "closesUnit">, at: string): RunEvent[] {
  if (meta.completes) {
    const phase = pack.phases.find((p) => p.id === meta.completes!.phaseId);
    if (!phase) return [];
    return stepCompletionEvents(phase, meta.completes.index, state, at);
  }
  if (meta.closesUnit) return [...stopClocksEvents(state, at), ...closeUnitEvents(pack, state, at)];
  return [];
}

function runBlock(
  pack: Pack,
  state: RunState,
  events: readonly RunEvent[],
  meta: BlockMeta,
  answers: Record<string, AnswerValue>,
  generated: string[],
  ctx: DriveContext,
  move: string | undefined,
): DriveResult {
  // `ExecContext.keyPrefix` is left unset here, on purpose: execute.ts's own
  // default (the table, move or obligation's own id) is what `playThrough`
  // has always produced and what its fixtures name requests by. `meta.keyPrefix`
  // still addresses this block's own random stream below — a block's identity
  // for reproducing its rolls is not the same thing as how its requests are
  // named, and only the app's interactive `useRun` currently conflates them.
  const execCtx: ExecContext = {
    answers,
    generatedAnswers: generated,
    now: ctx.now,
    ...rollingContext(pack, state, events, meta.keyPrefix, ctx.seed, ctx.autoRoll),
  };
  const result = meta.exec(execCtx);
  if (result.status === "awaiting") {
    const pending: Pending = {
      kind: meta.kind,
      tableId: meta.tableId,
      actions: meta.actions,
      obligationId: meta.obligationId,
      moveId: meta.moveId,
      keyPrefix: meta.keyPrefix,
      answers,
      generated,
      request: result.request!,
      partial: result.events,
      completes: meta.completes,
      closesUnit: meta.closesUnit,
      unit: state.unit,
      seed: ctx.seed,
      autoRoll: ctx.autoRoll,
      move,
    };
    return { status: "awaiting", request: result.request!, pending };
  }
  return stamp(ctx, [...result.events, ...completionEvents(pack, state, meta, ctx.now)], move);
}

function execFor(pack: Pack, state: RunState, pending: Pending): (ctx: ExecContext) => ExecResult {
  switch (pending.kind) {
    case "table":
      return (ctx) => executeTableRoll(pack, state, pending.tableId!, ctx);
    case "obligation":
      return (ctx) => executeObligation(pack, state, pending.obligationId!, ctx);
    case "move":
      return (ctx) => executeMove(pack, state, pending.moveId!, ctx);
    case "actions":
      return (ctx) => executeActions(pack, state, pending.actions ?? [], ctx);
  }
}

/** Take one action against a run, driving it exactly as far as it will go without another answer. */
export function drive(pack: Pack, events: readonly RunEvent[], action: DriveAction, ctx: DriveContext): DriveResult {
  const state = reduce(pack, events);

  if ("enter" in action) {
    const unit = nextUnit(state);
    const clock = unitClockStart(pack, state, unit, ctx.now);
    return stamp(ctx, [{ t: "UnitEntered", at: ctx.now }, ...(clock ? [clock] : [])], undefined);
  }

  if ("declare" in action) {
    const active = nextStep(pack, state);
    if (!active || active.step.kind !== "declareSubject") {
      throw new DriveError(`cannot declare: the active step is ${active ? `"${active.phase.id}#${active.index}" (${active.step.kind})` : "none"}, not declareSubject`, action);
    }
    return stamp(
      ctx,
      [{ t: "SubjectDeclared", at: ctx.now, subjectType: action.declare }, ...stepCompletionEvents(active.phase, active.index, state, ctx.now)],
      undefined,
    );
  }

  if ("tick" in action) {
    const active = nextStep(pack, state);
    if (!active) throw new DriveError("cannot tick: no active step", action);
    const items = checklistOf(active.step);
    if (action.tick.index < 0 || action.tick.index >= items.length) {
      throw new DriveError(`cannot tick: the active step has no checklist item #${action.tick.index}`, action);
    }
    const key = `${active.phase.id}#${active.index}`;
    return stamp(ctx, [{ t: "Checked", at: ctx.now, step: key, item: `${action.tick.index}`, on: action.tick.on }], undefined);
  }

  if ("finalize" in action) {
    const active = nextStep(pack, state);
    if (!active || active.step.kind !== "finalizeUnit") {
      throw new DriveError(`cannot finalize: the active step is ${active ? `"${active.phase.id}#${active.index}" (${active.step.kind})` : "none"}, not finalizeUnit`, action);
    }
    if (!checklistSatisfied(state, active)) {
      throw new DriveError("cannot finalize: not every confirmation on the active step is ticked", action);
    }
    return stamp(
      ctx,
      [...stopClocksEvents(state, ctx.now), { t: "UnitFinalized", at: ctx.now }, ...stepCompletionEvents(active.phase, active.index, state, ctx.now)],
      undefined,
    );
  }

  if ("move" in action) {
    const moveDef = pack.moves?.[action.move];
    if (!moveDef) throw new DriveError(`no such move "${action.move}"`, action);
    return runBlock(
      pack,
      state,
      events,
      {
        kind: "move",
        moveId: action.move,
        keyPrefix: `move:${action.move}`,
        exec: (ec) => executeMove(pack, state, action.move, ec),
        closesUnit: Boolean(moveDef.finalizes),
      },
      {},
      [],
      ctx,
      ctx.mintId?.(),
    );
  }

  if ("settle" in action) {
    const obligation = [...currentlyDue(pack, state), ...openNotes(state)].find((o) => o.id === action.settle);
    if (!obligation) throw new DriveError(`no due obligation "${action.settle}"`, action);
    return runBlock(
      pack,
      state,
      events,
      {
        kind: "obligation",
        obligationId: obligation.id,
        keyPrefix: `ob:${obligation.id}`,
        exec: (ec) => executeObligation(pack, state, obligation.id, ec),
      },
      {},
      [],
      ctx,
      ctx.mintId?.(),
    );
  }

  // { step: true }
  const active = nextStep(pack, state);
  if (!active) throw new DriveError("cannot step: no active step — the unit is finished or has not begun", action);
  const key = `${active.phase.id}#${active.index}`;
  const completes = { phaseId: active.phase.id, index: active.index };

  switch (active.step.kind) {
    case "rollTable": {
      const tableId = active.step.table;
      return runBlock(
        pack,
        state,
        events,
        { kind: "table", tableId, keyPrefix: `u${state.unit}:${key}`, exec: (ec) => executeTableRoll(pack, state, tableId, ec), completes },
        {},
        [],
        ctx,
        ctx.mintId?.(),
      );
    }
    case "actions": {
      const list = active.step.do;
      return runBlock(
        pack,
        state,
        events,
        { kind: "actions", actions: list, keyPrefix: `u${state.unit}:${key}`, exec: (ec) => executeActions(pack, state, list, ec), completes },
        {},
        [],
        ctx,
        ctx.mintId?.(),
      );
    }
    case "manual":
      if (!checklistSatisfied(state, active)) {
        throw new DriveError("cannot step: not every point on the active step's checklist is ticked", action);
      }
      return stamp(ctx, stepCompletionEvents(active.phase, active.index, state, ctx.now), undefined);
    case "declareSubject":
      throw new DriveError(`cannot step: the active step is declareSubject; use a "declare" action`, action);
    case "finalizeUnit":
      return drive(pack, events, { finalize: true }, ctx);
  }
}

/**
 * Resume a block one answer further.
 *
 * Re-runs the block from the top with the new answer folded in, exactly as
 * `execute.ts` always has — resuming is not a different code path, only a
 * different starting set of answers. `autoRoll` on this call, unlike on
 * `drive`, marks `value` itself as generated rather than physical; see
 * `DriveContext.autoRoll`.
 */
export function answer(pack: Pack, events: readonly RunEvent[], pending: Pending, key: string, value: AnswerValue, ctx: DriveContext): DriveResult {
  const state = reduce(pack, events);
  const answers = { ...pending.answers, [key]: value };
  const generated = ctx.autoRoll ? [...pending.generated, key] : pending.generated;
  const meta: BlockMeta = {
    kind: pending.kind,
    keyPrefix: pending.keyPrefix,
    exec: execFor(pack, state, pending),
    tableId: pending.tableId,
    actions: pending.actions,
    obligationId: pending.obligationId,
    moveId: pending.moveId,
    completes: pending.completes,
    closesUnit: pending.closesUnit,
  };
  return runBlock(
    pack,
    state,
    events,
    meta,
    answers,
    generated,
    { ...ctx, seed: pending.seed, autoRoll: pending.autoRoll },
    pending.move,
  );
}
