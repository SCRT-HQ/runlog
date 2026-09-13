import type { Pack } from "@runlog/rules-schema";
import type { RunEvent } from "./events.ts";
import { voidedIds } from "./log.ts";
import type { Clock, RunState } from "./types.ts";

/**
 * Clocks: a stopwatch that times a unit, a timer that limits it.
 *
 * A clock is four events in the log, started, paused, resumed, stopped, 
 * and nothing else. The log holds timestamps, not a ticking number, so a
 * reload lands on a clock still running from where it was, a second device
 * sees the same time, and a stopped clock's elapsed is written once and
 * kept. What ticks is the view, from these timestamps and the present.
 */

/** The clock a unit runs, if the mode or the pack says so. */
export function unitClockFor(pack: Pack, state: RunState | null): NonNullable<Pack["unit"]["clock"]> | null {
  const mode = pack.modes[state?.mode ?? pack.defaultMode];
  return mode?.clock ?? pack.unit.clock ?? null;
}

/** Milliseconds a clock has run, at the given moment. */
export function elapsedMs(clock: Clock, nowMs: number): number {
  if (clock.elapsedMs !== null) return clock.elapsedMs;
  const live = clock.runningSince ? Math.max(0, nowMs - Date.parse(clock.runningSince)) : 0;
  return clock.accumulatedMs + live;
}

/** Milliseconds a timer has left, at the given moment; null for a stopwatch. */
export function remainingMs(clock: Clock, nowMs: number): number | null {
  if (clock.seconds === null) return null;
  return clock.seconds * 1000 - elapsedMs(clock, nowMs);
}

/** "12:34", or "1:02:03" past an hour. Tenths only when asked, for a stopwatch under a minute. */
export function formatClock(ms: number, tenths = false): string {
  const total = Math.max(0, Math.floor(ms / 100)) / 10;
  const s = Math.floor(total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  const base = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  return tenths ? `${base}.${Math.floor((total - s) * 10)}` : base;
}

/** Clocks still going, or paused: anything not yet stopped. */
export function liveClocks(state: RunState): Clock[] {
  return state.clocks.filter((c) => c.status !== "done");
}

/** The clock a unit ran, stopped or not. */
export function clockOfUnit(state: RunState, unit: number): Clock | undefined {
  // The latest: a unit played again after a rewind has a clock of its own.
  return state.clocks.findLast((c) => c.unit === unit && c.id.endsWith(":unit"));
}

/** When a running timer runs out: its deadline, or null for a stopwatch, a paused clock or a stopped one. */
export function deadlineOf(clock: Clock, nowMs: number): number | null {
  if (clock.kind !== "timer" || clock.status !== "running" || clock.seconds === null) return null;
  return nowMs + (clock.seconds * 1000 - elapsedMs(clock, nowMs));
}

/**
 * The events that stop every running timer whose time is up, each stamped
 * with the moment it ran out rather than the moment somebody noticed. The
 * app's own clock notices as it ticks; a table with nobody watching it
 * (a bot's, say) notices at the next press, or when a scheduled job does.
 */
export function ranOutEvents(state: RunState, nowMs: number): RunEvent[] {
  return liveClocks(state).flatMap((c) => {
    const deadline = deadlineOf(c, nowMs);
    if (deadline === null || deadline > nowMs || c.seconds === null) return [];
    return [{ t: "ClockStopped", at: new Date(deadline).toISOString(), clock: c.id, elapsedMs: c.seconds * 1000, expired: true } satisfies RunEvent];
  });
}

/** The events that stop every live clock now, with its elapsed written in. Used when a unit closes. */
export function stopClocksEvents(state: RunState, at: string, nowMs = Date.parse(at)): RunEvent[] {
  return liveClocks(state).map((c) => ({ t: "ClockStopped", at, clock: c.id, elapsedMs: elapsedMs(c, nowMs) }));
}

/**
 * The event that starts a unit's clock, when the mode or the pack runs one
 * automatically; or, `byHand`, one the pack leaves to the player to start.
 */
export function unitClockStart(pack: Pack, state: RunState | null, unit: number, at: string, byHand = false): RunEvent | null {
  const config = unitClockFor(pack, state);
  if (!config || (config.auto === false && !byHand)) return null;
  // A clock that waits for a phase does not start with the unit. It is
  // started by whatever brings the flow to that phase; see `clockOnPhase`.
  if (config.startsOn !== undefined && !byHand) return null;
  // A unit played again after a rewind gets a clock of its own; the first one's time still counts.
  const taken = state?.clocks.filter((c) => c.unit === unit && c.id.endsWith(":unit")).length ?? 0;
  return {
    t: "ClockStarted",
    at,
    clock: taken > 0 ? `u${unit}.${taken + 1}:unit` : `u${unit}:unit`,
    kind: config.kind,
    label: config.label ?? `${pack.vocabulary.unit.one} ${unit}`,
    ...(config.kind === "timer" ? secondsOf(config, state) : {}),
  };
}

/**
 * How long a timer runs: what the dial says, or what the pack said.
 *
 * Read at the moment it starts, so turning the dial changes the next
 * one and leaves the one running alone. A dial at nothing is nothing to
 * go on, so the pack's own number stands.
 */
function secondsOf(config: { minutes?: number; minutesFrom?: string }, state: RunState | null): { seconds: number } | Record<string, never> {
  const dial = config.minutesFrom !== undefined ? state?.resources[config.minutesFrom] : undefined;
  const minutes = dial && dial > 0 ? dial : config.minutes;
  return minutes ? { seconds: Math.round(minutes * 60) } : {};
}

/**
 * Whether a clock for this unit was started and then taken back.
 *
 * An undo does not drop events, it names them void, so the log still
 * says what happened and what the player decided about it. Which is the
 * only way to tell "this clock has not started yet" from "this clock
 * was started and undone": in the folded state those look identical,
 * and something that starts a clock whenever one is missing will put
 * back what the player just took away, for ever.
 */
export function clockStartUndone(events: readonly RunEvent[], unit: number): boolean {
  const gone = voidedIds(events);
  return events.some((e) => e.t === "ClockStarted" && e.clock.startsWith(`u${unit}`) && e.clock.endsWith(":unit") && e.id !== undefined && gone.has(e.id));
}

/**
 * The event that starts a unit's clock on arriving at a phase, for a
 * pack whose unit draws before it plays.
 *
 * Ten minutes of play is ten minutes of play; the two rolls in front of
 * it are not what the clock is for, and starting it at the top of the
 * unit meant reading four results against a timer that was already
 * spending them. Null unless this is the phase, and unless the unit's
 * clock has not already started.
 */
export function clockOnPhase(pack: Pack, state: RunState | null, phaseId: string, at: string, events: readonly RunEvent[] = []): RunEvent | null {
  const config = unitClockFor(pack, state);
  if (!config || config.startsOn !== phaseId || !state || state.unit === 0) return null;
  if (state.clocks.some((c) => c.unit === state.unit && c.id.endsWith(":unit"))) return null;
  // Undone is an answer. Without this the undo that reaches the clock is
  // the one undo that cannot land: the event goes, this puts it back,
  // and the player never gets past it to the step before.
  if (clockStartUndone(events, state.unit)) return null;
  return {
    t: "ClockStarted",
    at,
    clock: `u${state.unit}:unit`,
    kind: config.kind,
    label: config.label ?? `${pack.vocabulary.unit.one} ${state.unit}`,
    ...(config.kind === "timer" ? secondsOf(config, state) : {}),
  };
}
