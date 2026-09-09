import type { Mode, Pack, Score as ScoreDef } from "@runlog/rules-schema";
import { formatClock } from "./clock.ts";
import type { RunEvent } from "./events.ts";
import { progressOf } from "./race.ts";
import type { RunState } from "./types.ts";

/**
 * Turning a run into a number to beat.
 *
 * A pack declares what counts as doing well at its own game, a counter, a
 * resource, how far a run got, or how fast, and this reads that declaration
 * off a run the same way `progressOf` already reads a race's leaderboard off
 * one. A pack that declares nothing still gets a score: units closed,
 * tiebreak time, which is exactly what a race already ranks by, so nothing
 * that plays today loses a number to beat tomorrow once this ships.
 */

export type ScoreKey = "counter" | "resource" | "units" | "time";
export type ScoreBetter = "higher" | "lower";

export interface RunScore {
  key: ScoreKey;
  value: number;
  better: ScoreBetter;
  label: string;
  tiebreak?: { key: "time" | "units"; value: number; better: ScoreBetter };
}

/** The tiebreak's own value and direction: fixed by which key it is, never authored. */
function tiebreakOf(
  key: "time" | "units" | undefined,
  pack: Pack,
  state: RunState,
  events: readonly RunEvent[],
  nowMs: number,
): RunScore["tiebreak"] {
  if (!key) return undefined;
  const progress = progressOf(state, events, nowMs);
  return key === "time"
    ? { key, value: progress.elapsedMs, better: "lower" }
    : { key, value: progress.unitsDone, better: "higher" };
}

/** Where a run stands against the number its pack said it should beat. */
export function scoreOf(pack: Pack, state: RunState, events: readonly RunEvent[], nowMs: number): RunScore {
  const mode: Mode | undefined = pack.modes[state.mode];
  // The mode's own score replaces the pack's outright, the same rule as a
  // mode's own clock, so a variant that scores differently is never left
  // having to un-declare the pack's key first.
  const config: ScoreDef | undefined = mode?.score ?? pack.score;
  const progress = progressOf(state, events, nowMs);

  if (!config) {
    // What a race already ranks by: every pack has a score without saying so.
    return {
      key: "units",
      value: progress.unitsDone,
      better: "higher",
      label: `${pack.vocabulary.unit.many} closed`,
      tiebreak: { key: "time", value: progress.elapsedMs, better: "lower" },
    };
  }

  const tiebreak = tiebreakOf(config.tiebreak, pack, state, events, nowMs);

  if ("counter" in config) {
    const def = pack.counters?.[config.counter];
    return {
      key: "counter",
      value: state.counters[config.counter] ?? def?.initial ?? 0,
      better: config.better ?? "higher",
      label: config.label ?? def?.label ?? config.counter,
      ...(tiebreak ? { tiebreak } : {}),
    };
  }
  if ("resource" in config) {
    const def = pack.resources?.[config.resource];
    return {
      key: "resource",
      value: state.resources[config.resource] ?? def?.initial ?? 0,
      better: config.better ?? "higher",
      label: config.label ?? def?.label ?? config.resource,
      ...(tiebreak ? { tiebreak } : {}),
    };
  }
  if ("units" in config) {
    return {
      key: "units",
      value: progress.unitsDone,
      better: config.better ?? "higher",
      label: config.label ?? `${pack.vocabulary.unit.many} closed`,
      ...(tiebreak ? { tiebreak } : {}),
    };
  }
  return {
    key: "time",
    value: progress.elapsedMs,
    better: config.better ?? "lower",
    label: config.label ?? "Time",
    ...(tiebreak ? { tiebreak } : {}),
  };
}

/** Better-first ordering: lower always sorts first, whichever way "better" points. */
const rank = (value: number, better: ScoreBetter): number => (better === "higher" ? -value : value);

/** Orders two scores of the same key: the better one first, ties settled by the tiebreak. */
export function compareScores(a: RunScore, b: RunScore): number {
  const primary = rank(a.value, a.better) - rank(b.value, b.better);
  if (primary !== 0) return primary;
  if (a.tiebreak && b.tiebreak) return rank(a.tiebreak.value, a.tiebreak.better) - rank(b.tiebreak.value, b.tiebreak.better);
  return 0;
}

/**
 * The score's value as a person reads it. Time gets a clock face. A resource
 * or the units fallback gets a plain count with the noun that makes the
 * number legible once it is torn out of its own row: a bare "1,240" says
 * nothing on its own. A counter's label is usually already a whole phrase
 * ("Clean Blocks"), not a noun a number can lead with, so it stays bare.
 */
export function formatScore(score: RunScore, pack: Pack): string {
  if (score.key === "time") return formatClock(score.value);
  const n = score.value.toLocaleString("en-US");
  if (score.key === "resource") return `${n} ${score.label.toLowerCase()}`;
  if (score.key === "units") return `${n} ${pack.vocabulary.unit.many.toLowerCase()}`;
  return n;
}
