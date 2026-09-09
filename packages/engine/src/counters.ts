import type { Pack } from "@runlog/rules-schema";
import type { RunState } from "./types.ts";

/**
 * Counter thresholds that have come due.
 *
 * A counter can carry a trigger, "six quiet turns in a row and the game comes
 * for you", but firing one means running actions, and actions may need a die
 * roll or a decision from the player. The reducer is pure and total by design,
 * so it cannot do that.
 *
 * Instead the threshold is *detected* here and resolved the same way an
 * obligation is: surfaced to the player, then executed. The counter's own value
 * is derived state; whether its trigger has fired is recorded in the log.
 */

export interface PendingTrigger {
  counter: string;
  index: number;
  /** Stable key, recorded in the log once it has fired. */
  key: string;
  label: string;
  /** The counter's value at the moment it came due. */
  value: number;
}

/**
 * The key under which a fired trigger is recorded.
 *
 * A once-per-run trigger is keyed by the run, so it never returns. Anything
 * else is keyed by the unit, which means "at most once per unit while the
 * threshold holds", without that a trigger whose condition stays true would
 * fire on every render, forever.
 */
export function triggerKey(
  counter: string,
  index: number,
  oncePerRun: boolean,
  unit: number,
): string {
  return oncePerRun ? `counter:${counter}:${index}` : `counter:${counter}:${index}:u${unit}`;
}

export function pendingTriggers(pack: Pack, state: RunState): PendingTrigger[] {
  const due: PendingTrigger[] = [];

  for (const [counterId, def] of Object.entries(pack.counters ?? {})) {
    const value = state.counters[counterId] ?? def.initial;
    def.triggers?.forEach((trigger, index) => {
      const { eq, gte, lte } = trigger.when;
      if (eq !== undefined && value !== eq) return;
      if (gte !== undefined && value < gte) return;
      if (lte !== undefined && value > lte) return;

      const key = triggerKey(counterId, index, trigger.oncePerRun, state.unit);
      if (state.firedOnce.includes(key)) return;

      due.push({
        counter: counterId,
        index,
        key,
        label: trigger.label ?? def.label,
        value,
      });
    });
  }
  return due;
}
