import { elapsedMs } from "./clock.ts";
import type { RunEvent } from "./events.ts";
import { effectiveEvents } from "./log.ts";
import type { RunState } from "./types.ts";

/**
 * Races across devices.
 *
 * A race is several people playing the same seeded mode of the same pack
 * at once, each in an ordinary run on their own device. The same seed
 * hands everyone the same dice, so the runs agree without ever meeting;
 * what the server holds is each racer's progress, reported by their own
 * device, and the leaderboard is that progress ranked here. Nothing is
 * decided by the server, and no run is ever reduced anywhere but on the
 * device it belongs to.
 */

export interface RaceProgress {
  /** The unit the racer is in; 0 before the first. */
  unit: number;
  /** Units closed so far. */
  unitsDone: number;
  status: "active" | "ended";
  ending?: string;
  /** Time on the clock: the unit clocks where the pack runs them, wall time since the start otherwise. */
  elapsedMs: number;
}

/** Where this run is, as the leaderboard should hear it. */
export function progressOf(state: RunState, events: readonly RunEvent[], nowMs: number): RaceProgress {
  const unitsDone = effectiveEvents(events).filter((e) => e.t === "UnitFinalized").length;
  const clocks = state.clocks.filter((c) => c.id.endsWith(":unit"));
  const ended = state.status === "ended";
  const elapsed =
    clocks.length > 0
      ? clocks.reduce((sum, c) => sum + elapsedMs(c, nowMs), 0)
      : Math.max(0, (ended ? Date.parse(state.updatedAt) : nowMs) - Date.parse(state.startedAt));
  return {
    unit: state.unit,
    unitsDone,
    status: ended ? "ended" : "active",
    ...(state.ending ? { ending: state.ending } : {}),
    elapsedMs: Math.round(elapsed),
  };
}

export interface RaceStanding<T> {
  entry: T;
  /** 1-based; ties share a place. */
  place: number;
}

/**
 * The order of a race: those who have finished first, by units closed
 * and then by the shorter time; then those still going, by units closed,
 * the unit they are in, and time; then those who have not started. Ties
 * on all of it share a place.
 */
export function rankRace<T extends { progress?: RaceProgress | undefined }>(entries: readonly T[]): RaceStanding<T>[] {
  const key = (e: T): [number, number, number, number] => {
    const p = e.progress;
    if (!p) return [2, 0, 0, 0];
    return [p.status === "ended" ? 0 : 1, -p.unitsDone, -p.unit, p.elapsedMs];
  };
  const sorted = [...entries].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return 0;
  });
  const out: RaceStanding<T>[] = [];
  sorted.forEach((entry, i) => {
    const same = i > 0 && key(entry).every((v, j) => v === key(sorted[i - 1]!)[j]);
    out.push({ entry, place: same ? out[i - 1]!.place : i + 1 });
  });
  return out;
}
