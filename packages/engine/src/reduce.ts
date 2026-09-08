import type { EventSelector, Pack } from "@runlog/rules-schema";
import type { RunEvent } from "./events.ts";
import { effectiveEvents } from "./log.ts";
import type { RunState, Subject } from "./types.ts";

/**
 * Folding the event log into run state.
 *
 * Pure and total: the same events always produce the same state, and an event
 * that cannot apply is ignored rather than throwing. A log is a historical
 * record, and history does not get to fail to load because one line of it no
 * longer makes sense.
 */

function initialState(pack: Pack, e: Extract<RunEvent, { t: "RunStarted" }>): RunState {
  const counters: Record<string, number> = {};
  for (const [id, def] of Object.entries(pack.counters ?? {})) counters[id] = def.initial;

  const resources: Record<string, number> = {};
  for (const [id, def] of Object.entries(pack.resources ?? {})) resources[id] = def.initial;

  return {
    packId: e.packId,
    packVersion: e.packVersion,
    mode: e.mode,
    seed: e.seed ?? null,
    // A log that never recorded a count still knows how many the mode needs:
    // silence means "the fewest this mode is played by", not "one".
    players: Math.max(1, e.players ?? pack.modes[e.mode]?.players?.min ?? 1),
    status: "active",
    name: null,
    startedAt: e.at,
    updatedAt: e.at,
    unit: 0,
    phasesDone: [],
    stepsDone: [],
    checks: [],
    subjects: [],
    runStates: [],
    counters,
    resources,
    flags: {},
    forcedUnits: 0,
    extraRolls: {},
    extraRollsNext: {},
    rewindNext: 0,
    rewinds: 0,
    bannedTypes: [],
    journal: {},
    hand: [],
    outcomes: [],
    obligations: [],
    firedOnce: [],
    lacks: e.lacks ?? [],
    clocks: [],
    contestants: [],
    awards: [],
    ending: null,
  };
}

const clamp = (n: number, min?: number, max?: number): number => {
  let out = n;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
};

/** Does an event match a selector a counter declared an interest in? */
function matches(event: RunEvent, selector: EventSelector): boolean {
  switch (selector.on) {
    case "runStarted":
      return event.t === "RunStarted";
    case "runEnded":
      return event.t === "RunEnded";
    case "unitEntered":
      return event.t === "UnitEntered";
    case "unitFinalized":
      return event.t === "UnitFinalized";
    case "phaseCompleted":
      return event.t === "PhaseCompleted" && event.phase === selector.phase;
    case "tableRolled":
      return event.t === "Rolled" && event.purpose === selector.table;
    case "outcomeResolved":
      return (
        event.t === "OutcomeResolved" &&
        event.table === selector.table &&
        (selector.cause === "any" || event.cause === selector.cause)
      );
    case "stateApplied":
      return event.t === "StateApplied" && event.state === selector.state;
  }
}

/**
 * Apply a pack's declarative counter rules to one event.
 *
 * One rule here is worth spelling out, because it is the difference between a
 * streak counter working and being subtly wrong.
 *
 * A "streak" counter means *consecutive units in which something did not
 * happen*. Consider a check that itself triggers the very consequence the
 * streak is watching for: within one unit the consequence resolves first, and
 * the phase completes after it. Applying reset and increment in bare event
 * order would leave the counter at 1 when it should be 0 — the streak plainly
 * broke.
 *
 * So a reset dominates the unit it occurs in: once something resets a counter,
 * further increments from that same unit are suppressed. This keeps the
 * obvious authoring — increment on the phase, reset on the consequence —
 * meaning what an author expects it to mean.
 */
function applyCounters(
  pack: Pack,
  state: RunState,
  event: RunEvent,
  resetThisUnit: Set<string>,
): void {
  for (const [id, def] of Object.entries(pack.counters ?? {})) {
    if (def.resetOn?.some((sel) => matches(event, sel))) {
      state.counters[id] = def.initial;
      resetThisUnit.add(id);
      continue;
    }
    if (resetThisUnit.has(id)) continue;
    if (def.incrementOn?.some((sel) => matches(event, sel))) {
      state.counters[id] = clamp((state.counters[id] ?? def.initial) + 1, def.min, def.max);
    }
  }
}

function subjectById(state: RunState, id: number | undefined): Subject | undefined {
  if (id === undefined) return undefined;
  return state.subjects.find((s) => s.id === id);
}

/** The subject currently being made, if the unit produces one. */
export function currentSubject(state: RunState): Subject | undefined {
  return state.subjects.find((s) => s.unit === state.unit && !s.finalized);
}

/** The unit the run enters next: forward, or back where a rewind is queued, never before the first. */
export function nextUnit(state: Pick<RunState, "unit" | "rewindNext"> | null): number {
  if (!state) return 1;
  return state.rewindNext > 0 ? Math.max(1, state.unit - state.rewindNext) : state.unit + 1;
}

export function reduce(pack: Pack, log: readonly RunEvent[]): RunState {
  // What counts: nothing an undo has voided, and no undo itself.
  const events = effectiveEvents(log);
  const first = events[0];
  if (!first || first.t !== "RunStarted") {
    throw new Error("an event log must begin with RunStarted");
  }

  const state = initialState(pack, first);
  // Reset bookkeeping, scoped to the unit in which the reset happened.
  let resetThisUnit = new Set<string>();

  for (const event of events) {
    state.updatedAt = event.at;

    switch (event.t) {
      case "RunStarted":
        break;

      case "RunRenamed":
        state.name = event.name.trim() || null;
        break;

      case "UnitEntered": {
        // Forward, or back where a rewind was queued: a revisited unit
        // keeps its number and is played again from its start.
        if (state.rewindNext > 0) state.rewinds += 1;
        state.unit = nextUnit(state);
        state.rewindNext = 0;
        state.phasesDone = [];
        state.stepsDone = [];
        state.checks = [];
        resetThisUnit = new Set();
        if (state.forcedUnits > 0) state.forcedUnits -= 1;
        // What the last unit owed the next one is owed now.
        state.extraRolls = state.extraRollsNext;
        state.extraRollsNext = {};
        if (pack.unit.createsSubject) {
          state.subjects.push({
            id: state.subjects.length + 1,
            unit: state.unit,
            type: null,
            states: [],
            name: null,
            finalized: false,
            removed: false,
            createdAt: event.at,
          });
        }
        break;
      }

      case "SubjectDeclared": {
        const subject = currentSubject(state);
        if (subject) subject.type = event.subjectType;
        break;
      }

      case "SubjectRenamed": {
        // The name, not the type: what it was declared to be stays true
        // when the player calls it something of their own.
        const subject = state.subjects.find((s) => s.id === event.subject);
        if (subject) subject.name = event.name;
        break;
      }

      case "Rolled":
        break;

      case "OutcomeResolved":
        state.outcomes.push({
          unit: state.unit,
          table: event.table,
          entryId: event.entryId,
          targetSubject: event.targetSubject ?? null,
          at: event.at,
        });
        break;

      case "StateApplied": {
        const def = pack.states?.[event.state];
        const scope = def?.scope ?? "subject";
        // States in a group exclude one another: landed is not also missed.
        // Applying one clears the others on the same holder, here rather than
        // as separate events, so a log written before groups existed reads
        // the same way once the pack declares them.
        const rivals = (held: string[]) =>
          def?.group ? held.filter((s) => s === event.state || pack.states?.[s]?.group !== def.group) : held;
        if (scope === "run" || event.subject === undefined) {
          state.runStates = rivals(state.runStates);
          if (!state.runStates.includes(event.state)) state.runStates.push(event.state);
        } else {
          const subject = subjectById(state, event.subject);
          if (subject) {
            subject.states = rivals(subject.states);
            if (!subject.states.includes(event.state)) subject.states.push(event.state);
          }
        }
        break;
      }

      case "StateRemoved": {
        const scope = pack.states?.[event.state]?.scope ?? "subject";
        if (scope === "run" || event.subject === undefined) {
          state.runStates = state.runStates.filter((s) => s !== event.state);
        } else {
          const subject = subjectById(state, event.subject);
          if (subject) subject.states = subject.states.filter((s) => s !== event.state);
        }
        break;
      }

      case "SubjectRemoved": {
        const subject = subjectById(state, event.subject);
        // The subject leaves play, but its unit still happened. Deleting it
        // would rewrite history and shift every later subject's position,
        // which is exactly what targeting must not have happen underneath it.
        if (subject) subject.removed = true;
        break;
      }

      case "CounterChanged": {
        const def = pack.counters?.[event.counter];
        const current = state.counters[event.counter] ?? def?.initial ?? 0;
        const next = event.set !== undefined ? event.set : current + (event.by ?? 0);
        state.counters[event.counter] = clamp(next, def?.min, def?.max);
        break;
      }

      case "ResourceChanged": {
        const def = pack.resources?.[event.resource];
        const current = state.resources[event.resource] ?? def?.initial ?? 0;
        const next = event.set !== undefined ? event.set : current + (event.by ?? 0);
        state.resources[event.resource] = clamp(next, def?.min ?? 0, def?.max);
        break;
      }

      case "FlagSet":
        state.flags[event.flag] = event.value;
        break;

      case "TypeBanned":
        if (!state.bannedTypes.includes(event.subjectType)) {
          state.bannedTypes.push(event.subjectType);
        }
        break;

      case "UnitForced":
        state.forcedUnits += event.count;
        break;

      case "RewindQueued":
        state.rewindNext += event.count;
        break;

      case "ExtraRollQueued": {
        const bucket = event.unit === "current" ? state.extraRolls : state.extraRollsNext;
        bucket[event.table] = (bucket[event.table] ?? 0) + event.count;
        break;
      }

      case "ExtraRollTaken": {
        const left = (state.extraRolls[event.table] ?? 0) - 1;
        if (left > 0) state.extraRolls[event.table] = left;
        else delete state.extraRolls[event.table];
        break;
      }

      case "StepCompleted": {
        const key = `${event.phase}#${event.step}`;
        if (!state.stepsDone.includes(key)) state.stepsDone.push(key);
        break;
      }

      case "PhaseCompleted":
        if (!state.phasesDone.includes(event.phase)) state.phasesDone.push(event.phase);
        break;

      case "UnitFinalized": {
        for (const subject of state.subjects) {
          if (subject.unit === state.unit) subject.finalized = true;
        }
        // States that last a unit lift now, from everything they are on.
        const lifts = (id: string) => pack.states?.[id]?.until === "unitEnd";
        state.runStates = state.runStates.filter((id) => !lifts(id));
        for (const subject of state.subjects) subject.states = subject.states.filter((id) => !lifts(id));
        for (const who of state.contestants) who.states = who.states.filter((id) => !lifts(id));
        break;
      }

      case "JournalWritten":
        state.journal[event.unit] = event.text;
        break;

      case "CardDrawn":
        state.hand.push({ deck: event.deck, cardId: event.cardId });
        break;

      case "CardPlayed":
      case "CardDiscarded": {
        const index = state.hand.findIndex(
          (c) => c.deck === event.deck && c.cardId === event.cardId,
        );
        if (index >= 0) state.hand.splice(index, 1);
        break;
      }

      case "TriggerFired":
        if (!state.firedOnce.includes(event.key)) state.firedOnce.push(event.key);
        break;

      case "ObligationAdded":
        // Ids are deterministic, so replaying a log cannot duplicate a debt.
        if (!state.obligations.some((o) => o.id === event.obligation.id)) {
          state.obligations.push({ ...event.obligation, resolved: false, unit: state.unit });
        }
        break;

      case "ObligationResolved": {
        const owed = state.obligations.find((o) => o.id === event.id);
        if (owed) owed.resolved = true;
        break;
      }

      case "RunEnded":
        state.status = "ended";
        state.ending = event.ending;
        break;

      case "ClockStarted":
        if (!state.clocks.some((c) => c.id === event.clock)) {
          state.clocks.push({
            id: event.clock,
            kind: event.kind,
            label: event.label,
            seconds: event.kind === "timer" ? (event.seconds ?? null) : null,
            unit: state.unit,
            status: "running",
            startedAt: event.at,
            runningSince: event.at,
            accumulatedMs: 0,
            elapsedMs: null,
            expired: false,
          });
        }
        break;

      case "ClockPaused": {
        const c = state.clocks.find((x) => x.id === event.clock);
        if (c && c.status === "running" && c.runningSince) {
          c.accumulatedMs += Math.max(0, Date.parse(event.at) - Date.parse(c.runningSince));
          c.runningSince = null;
          c.status = "paused";
        }
        break;
      }

      case "ClockResumed": {
        const c = state.clocks.find((x) => x.id === event.clock);
        if (c && c.status === "paused") {
          c.runningSince = event.at;
          c.status = "running";
        }
        break;
      }

      case "ClockStopped": {
        const c = state.clocks.find((x) => x.id === event.clock);
        if (c && c.status !== "done") {
          c.elapsedMs = event.elapsedMs;
          c.runningSince = null;
          c.status = "done";
          c.expired = event.expired === true;
        }
        break;
      }

      case "ContestantAdded":
        if (!state.contestants.some((c) => c.id === event.contestant)) {
          state.contestants.push({ id: event.contestant, name: event.name, states: [] });
        }
        break;

      case "ContestantRemoved":
        state.contestants = state.contestants.filter((c) => c.id !== event.contestant);
        break;

      case "ContestantStateApplied": {
        const who = state.contestants.find((c) => c.id === event.contestant);
        if (!who) break;
        const group = pack.states?.[event.state]?.group;
        if (group) who.states = who.states.filter((s) => s === event.state || pack.states?.[s]?.group !== group);
        if (!who.states.includes(event.state)) who.states.push(event.state);
        break;
      }

      case "ContestantStateRemoved": {
        const who = state.contestants.find((c) => c.id === event.contestant);
        if (who) who.states = who.states.filter((s) => s !== event.state);
        break;
      }

      case "Awarded":
        if (!state.awards.some((a) => a.contestant === event.contestant && a.outcome === event.outcome)) {
          state.awards.push({
            contestant: event.contestant,
            outcome: event.outcome,
            table: event.table,
            entryId: event.entryId,
            points: event.points,
            at: event.at,
          });
        }
        break;

      case "AwardRevoked":
        state.awards = state.awards.filter((a) => !(a.contestant === event.contestant && a.outcome === event.outcome));
        break;

      case "Checked": {
        const key = `${event.step}|${event.item}`;
        if (event.on) {
          if (!state.checks.includes(key)) state.checks.push(key);
        } else {
          state.checks = state.checks.filter((k) => k !== key);
        }
        break;
      }

      case "Corrected":
        // A marker. What it introduces are ordinary events, folded as usual.
        break;

      case "Undone":
        // Never reached: filtered out above. Listed so the switch is total.
        break;
    }

    applyCounters(pack, state, event, resetThisUnit);
  }

  return state;
}

/**
 * Whether the run may end right now.
 *
 * Forced units are the common blocker, and the reason a player cannot simply
 * decide they are finished: the game gets a say.
 */
export function canEndRun(state: RunState): { ok: boolean; reason?: string } {
  if (state.status === "ended") return { ok: false, reason: "the run has already ended" };
  if (state.unit === 0) return { ok: false, reason: "the run has not started" };
  if (state.forcedUnits > 0) {
    return {
      ok: false,
      reason: `${state.forcedUnits} forced unit(s) still queued`,
    };
  }
  return { ok: true };
}
