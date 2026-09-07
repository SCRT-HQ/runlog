import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { progressOf, rankRace, type RaceProgress, type RunEvent, type RunState } from "@runlog/engine";
import { useAccount } from "../auth/Account.tsx";
import { loadRun, saveRun, type StoredRun } from "../storage/db.ts";
import type { Race, RaceEntry } from "../sync/client.ts";
import { useApi } from "../sync/useApi.ts";

/**
 * This run's race, if it is in one.
 *
 * A run made by "Start a race" or "Join" remembers its race. A run that
 * arrived by sync does not, so the account's races are searched once for
 * an entry naming this run, and the answer is written back. Progress is
 * reported when it changes, and again on every refresh so the clock on
 * everyone's leaderboard keeps moving; the leaderboard itself is fetched
 * on a slow poll, and on every return to the tab.
 */

const POLL_MS = 10_000;
const SETTLE_MS = 1500;

export interface RaceView {
  race: Race | null;
  standings: Array<{ entry: RaceEntry; place: number; me: boolean }>;
  owner: boolean;
  busy: boolean;
  refresh: () => void;
  invite: (email: string) => Promise<string>;
  end: () => Promise<void>;
  rename: (name: string) => Promise<void>;
}

export function useRace(record: StoredRun | null, state: RunState | null, events: readonly RunEvent[]): RaceView {
  const api = useApi();
  const account = useAccount();
  const me = account.status === "signed-in" ? account.user.id : null;
  const runId = record?.runId ?? null;
  const [race, setRace] = useState<Race | null>(null);
  const [busy, setBusy] = useState(false);
  const raceId = record?.raceId ?? race?.meta.id ?? null;
  const lastSent = useRef<string>("");

  const load = useCallback(async () => {
    if (!api || !runId) return;
    if (raceId) {
      const found = await api.getRace(raceId);
      if (found) setRace(found);
      return;
    }
    // Not marked here: look through the account's races for this run.
    const mine = await api.myRaces();
    const found = mine.find((r) => r.entries.some((e) => e.sub === me && e.sessionId === runId)) ?? null;
    if (!found) return;
    setRace(found);
    const stored = await loadRun(runId);
    if (stored && !stored.raceId) await saveRun({ ...stored, raceId: found.meta.id });
  }, [api, runId, raceId, me]);

  const report = useCallback(
    async (force: boolean) => {
      if (!api || !raceId || !state) return;
      const progress = progressOf(state, events, Date.now());
      const key = JSON.stringify({ ...progress, elapsedMs: 0 });
      if (!force && key === lastSent.current) return;
      lastSent.current = key;
      try {
        const updated = await api.putRaceEntry(raceId, { progress });
        if (updated) setRace(updated);
      } catch {
        // The next change or poll tries again.
        lastSent.current = "";
      }
    },
    [api, raceId, state, events],
  );

  // Find it, and keep it fresh.
  useEffect(() => {
    if (!api || !runId) return;
    let live = true;
    const tick = () => {
      if (!live || document.visibilityState !== "visible") return;
      void load();
      if (race && !race.meta.endedAt) void report(true);
    };
    void load();
    const poll = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      live = false;
      clearInterval(poll);
      window.removeEventListener("focus", tick);
    };
    // `race` is read for its ended flag only; the poll reads the latest through `report`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, runId, raceId, load]);

  // A change of unit or status goes out soon after it happens.
  useEffect(() => {
    if (!raceId || !state || race?.meta.endedAt) return;
    const t = setTimeout(() => void report(false), SETTLE_MS);
    return () => clearTimeout(t);
  }, [raceId, state, race?.meta.endedAt, report]);

  const standings = useMemo(
    () => (race ? rankRace(race.entries).map((s) => ({ entry: s.entry, place: s.place, me: s.entry.sub === me })) : []),
    [race, me],
  );

  const owner = Boolean(race && me && race.meta.ownerSub === me);
  const withBusy = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  return {
    race,
    standings,
    owner,
    busy,
    refresh: () => void load(),
    invite: (email) => withBusy(async () => (api && raceId ? (await api.inviteToRace(raceId, email)).code : "")),
    end: () =>
      withBusy(async () => {
        if (!api || !raceId) return;
        const updated = await api.patchRace(raceId, { ended: true });
        if (updated) setRace(updated);
      }),
    rename: (name) =>
      withBusy(async () => {
        if (!api || !raceId) return;
        const updated = await api.patchRace(raceId, { name });
        if (updated) setRace(updated);
      }),
  };
}

export type { RaceProgress };
