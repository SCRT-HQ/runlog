/**
 * Runs written before they had ids.
 *
 * Until v4 a run was keyed by its pack: one run per pack, and nothing to call
 * it by. Sync needs a name that survives leaving this machine, so every run
 * gets one on the way through — and the first event carries it too, so the
 * log names itself wherever it is read back.
 *
 * Pure, so the re-keying can be tested without IndexedDB; the store surgery
 * around it lives in db.ts.
 */

export interface LegacyRun {
  packId: string;
  packVersion: string;
  events: unknown[];
  updatedAt: string;
}

export interface RunWithId extends LegacyRun {
  runId: string;
}

export function migrateRuns(records: LegacyRun[], mint: () => string): RunWithId[] {
  return records.map((r) => {
    const runId = mint();
    const first = r.events[0];
    const events =
      first && typeof first === "object" && (first as { t?: unknown }).t === "RunStarted"
        ? [{ ...(first as object), runId }, ...r.events.slice(1)]
        : r.events;
    return { ...r, runId, events };
  });
}
