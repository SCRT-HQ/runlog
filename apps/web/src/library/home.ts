import type { StoredRun } from "../storage/db.ts";
import { onDay } from "../run/RunRow.tsx";

/**
 * What the strip above the shelf points at, worked out from what the
 * device holds. Pure, so it can be tested without a browser.
 */
export interface PickUp<P> {
  pack: P;
  /** The run to continue; absent when the pack has none and Play starts one. */
  run?: StoredRun;
}

/**
 * The run to pick up: the one this device touched last when it is still
 * here, else the newest run of any pack here, else the first pack alone.
 * Nothing when the shelf is empty; the shelf says so itself.
 */
export function pickUp<P extends { id: string }>(packs: readonly P[], runs: readonly StoredRun[], last: { packId: string; runId: string } | null): PickUp<P> | null {
  const byId = new Map(packs.map((p) => [p.id, p]));
  const live = runs.filter((r) => !r.deletedAt && byId.has(r.packId));
  if (last) {
    const run = live.find((r) => r.runId === last.runId);
    const pack = run ? byId.get(run.packId) : undefined;
    if (run && pack) return { pack, run };
  }
  const newest = [...live].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  if (newest) return { pack: byId.get(newest.packId)!, run: newest };
  const first = packs[0];
  return first ? { pack: first } : null;
}

/** A run's line on the strip: its name, or how far it is by the pack's word. */
export function runLine(run: StoredRun, unitWord: string): string {
  const events = run.events as Array<{ t?: unknown; name?: unknown }>;
  const named = events.reduce<string | null>((n, e) => (e.t === "RunRenamed" && typeof e.name === "string" ? e.name.trim() || null : n), null);
  if (named) return named;
  const entered = events.filter((e) => e.t === "UnitEntered").length;
  return entered > 0 ? `${unitWord} ${entered}` : "not started";
}

/** A run's title: its name, or the pack's word for a run and when it began. */
export function runTitle(run: StoredRun, runNoun: string): string {
  const events = run.events as Array<{ at?: unknown; t?: unknown; name?: unknown }>;
  const named = events.reduce<string | null>((n, e) => (e.t === "RunRenamed" && typeof e.name === "string" ? e.name.trim() || null : n), null);
  if (named) return named;
  const first = events[0] as { at?: unknown } | undefined;
  const began = typeof first?.at === "string" ? onDay(first.at) : "";
  return `${runNoun} from ${began}`;
}

/**
 * The run the account touched last, when it is a different run than this
 * device would offer and this device already holds it (sync brings every
 * device's runs down, so a run this device has never heard of has nothing
 * to show a line for). Null when there is nothing else to point at.
 */
export function elsewhere<P extends { id: string }>(
  packs: readonly P[],
  runs: readonly StoredRun[],
  device: PickUp<P> | null,
  accountRunId: string | null,
): PickUp<P> | null {
  if (!accountRunId || accountRunId === device?.run?.runId) return null;
  const byId = new Map(packs.map((p) => [p.id, p]));
  const run = runs.find((r) => r.runId === accountRunId && !r.deletedAt);
  const pack = run ? byId.get(run.packId) : undefined;
  return run && pack ? { pack, run } : null;
}
