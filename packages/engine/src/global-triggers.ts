import type { Pack, TriggerPoint } from "@runlog/rules-schema";
import { testPredicates } from "./execute.ts";
import type { RunState } from "./types.ts";

/**
 * Triggers the pack declares at the top level rather than on a table entry.
 *
 * These belong to the game itself rather than to any one result: something
 * that happens every unit, or once the run is over. Rolling to see what the
 * finished run was worth is the obvious case — it is not a consequence of
 * anything you did, it simply happens at the end.
 *
 * Like counter thresholds, these are *detected* here and executed elsewhere,
 * because firing one runs actions and actions may need the player.
 */

export interface PendingGlobalTrigger {
  index: number;
  /** Stable key, recorded in the log once it has fired. */
  key: string;
  label: string;
  on: TriggerPoint;
}

/** The lifecycle points a run has currently reached. */
function reached(state: RunState): TriggerPoint[] {
  if (state.status === "ended") return ["onRunEnd"];
  return state.unit > 0 ? ["onEnterUnit"] : [];
}

/**
 * A run-level trigger is keyed by the run, so it fires once. A per-unit one is
 * keyed by the unit, or it would fire again on every read for as long as the
 * unit lasted.
 */
export function globalTriggerKey(index: number, on: TriggerPoint, unit: number): string {
  return on === "onRunEnd" ? `global:${index}` : `global:${index}:u${unit}`;
}

export function pendingGlobalTriggers(pack: Pack, state: RunState): PendingGlobalTrigger[] {
  const points = new Set<string>(reached(state));
  const due: PendingGlobalTrigger[] = [];

  pack.triggers?.forEach((trigger, index) => {
    if (!points.has(trigger.on)) return;
    const key = globalTriggerKey(index, trigger.on, state.unit);
    if (state.firedOnce.includes(key)) return;

    // A condition the player must judge is offered rather than hidden: the
    // question gets asked when they take it, exactly as a move does.
    const held = testPredicates(pack, state, trigger.when, { answers: {}, now: "" }, "all");
    if (held.status === "done" && !held.value) return;

    due.push({ index, key, label: trigger.label ?? "The game acts", on: trigger.on });
  });
  return due;
}
