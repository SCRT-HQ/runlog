import type { StoredRun } from "../storage/db.ts";

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
