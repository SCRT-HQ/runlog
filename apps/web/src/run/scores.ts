import type { Pack } from "@runlog/rules-schema";
import { compareScores, formatScore, reduce, scoreOf, type RunEvent, type RunScore } from "@runlog/engine";
import type { StoredRun } from "../storage/db.ts";

/**
 * A run that has ended, reduced once to the number it made.
 *
 * Everything past this point — the best of them, a run's place among them —
 * reads this array rather than folding the log again, since a side column
 * and a setup screen both want the same answer from the same runs.
 */
export interface ScoredRun {
  runId: string;
  name: string | null;
  endedAt: string;
  score: RunScore;
  text: string;
}

/**
 * Every ended run of this pack, best first.
 *
 * A run still in progress has no score to beat yet, and a log this device
 * cannot make sense of — cut short, from a version the engine no longer
 * reads — is skipped rather than shown wrong: history that cannot be read
 * back is not the same as history that says nothing happened.
 */
export function scoresOf(pack: Pack, runs: readonly StoredRun[], nowMs: number): ScoredRun[] {
  const scored: ScoredRun[] = [];
  for (const run of runs) {
    const events = run.events as RunEvent[];
    let state;
    try {
      state = reduce(pack, events);
    } catch {
      continue;
    }
    if (state.status !== "ended") continue;
    const score = scoreOf(pack, state, events, nowMs);
    scored.push({
      runId: run.runId,
      name: state.name,
      endedAt: state.updatedAt,
      score,
      text: formatScore(score, pack),
    });
  }
  scored.sort((a, b) => compareScores(a.score, b.score));
  return scored;
}

/** The best of a list already in best-first order, or null when there is none. */
export function bestOf(scored: readonly ScoredRun[]): ScoredRun | null {
  return scored[0] ?? null;
}

/**
 * Where one run stands among the rest: 1 for the best, ties sharing a place
 * the way the moderated scoreboard's `standings` already does.
 */
export function placeOf(scored: readonly ScoredRun[], runId: string): number | null {
  let place = 0;
  for (let i = 0; i < scored.length; i++) {
    const row = scored[i]!;
    const prev = scored[i - 1];
    place = prev && compareScores(prev.score, row.score) === 0 ? place : i + 1;
    if (row.runId === runId) return place;
  }
  return null;
}
