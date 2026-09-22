import type { RunState } from "./types.ts";

/**
 * One numeric comparison, in one place.
 *
 * A bound can be a literal, or the current value of a counter, or the
 * current value of a resource. There were two readers of this and only
 * one of them knew that: the predicate evaluator handled every form,
 * and the counter-threshold check destructured `eq`, `gte` and `lte`
 * and quietly ignored the rest. A threshold written against a counter
 * had no bound left to check and so was always due.
 *
 * Both read this now, so a form added here is a form both understand.
 */
export interface Bound {
  eq?: number;
  gte?: number;
  lte?: number;
  /** At least what this counter has reached. */
  gteCounter?: string;
  /** At most what this counter has reached. */
  lteCounter?: string;
  /** At least where this dial is set. */
  gteResource?: string;
  /** At most where this dial is set. */
  lteResource?: string;
  /**
   * At least this far into the run, as a fraction of its planned length.
   * This is what lets a pack say "the last quarter of the run" without
   * knowing whether the run is six units or twenty. A run that never said
   * how long it is has no quarter to be in, so this never matches when
   * `plannedUnits` is null or zero.
   */
  gteFraction?: number;
  /** At most this far into the run, as a fraction of its planned length. Same rule: no planned length, no match. */
  lteFraction?: number;
}

/** Whether a value satisfies every bound named. An empty bound is satisfied. */
export function withinBound(value: number, bound: Bound, state?: RunState): boolean {
  if (bound.eq !== undefined && value !== bound.eq) return false;
  if (bound.gte !== undefined && value < bound.gte) return false;
  if (bound.lte !== undefined && value > bound.lte) return false;
  if (bound.gteCounter !== undefined && value < (state?.counters[bound.gteCounter] ?? 0)) return false;
  if (bound.lteCounter !== undefined && value > (state?.counters[bound.lteCounter] ?? 0)) return false;
  if (bound.gteResource !== undefined && value < (state?.resources[bound.gteResource] ?? 0)) return false;
  if (bound.lteResource !== undefined && value > (state?.resources[bound.lteResource] ?? 0)) return false;
  if (bound.gteFraction !== undefined) {
    const planned = state?.plannedUnits;
    if (!planned || value / planned < bound.gteFraction) return false;
  }
  if (bound.lteFraction !== undefined) {
    const planned = state?.plannedUnits;
    if (!planned || value / planned > bound.lteFraction) return false;
  }
  return true;
}
