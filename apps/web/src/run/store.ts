import type { RunEvent } from "@runlog/engine";
import {
  clearLegacyRun,
  currentRun,
  forgetRun,
  loadRun,
  runsFor,
  saveRun,
  takeLegacyRun,
  type StoredRun,
} from "../storage/db.ts";
import { syncBus } from "../sync/bus.ts";
import { activeRunFor, forgetActive, setActiveRunFor, setLastActive, type LastActive } from "./active.ts";

/**
 * Where a run's log lives while it is played.
 *
 * The device store is the real one: IndexedDB, the slot that says which
 * run each pack has open, and the sync bus that carries writes to other
 * devices. The memory store is for a run that must not outlive the
 * screen — a pack designer trying a draft, a player testing a pack — where
 * nothing may be written, nothing may sync, and a draft with the same id
 * as a real pack must not touch that pack's runs.
 */
export interface RunStore {
  runsFor(packId: string): Promise<StoredRun[]>;
  loadRun(runId: string): Promise<StoredRun | null>;
  currentRun(packId: string): Promise<StoredRun | null>;
  saveRun(record: StoredRun): Promise<unknown>;
  forgetRun(runId: string): Promise<void>;
  takeLegacyRun(packId: string): StoredRun | null;
  clearLegacyRun(packId: string): void;
  activeRunFor(packId: string): string | null;
  setActiveRunFor(packId: string, runId: string | null): void;
  setLastActive(last: LastActive | null): void;
  forgetActive(packId: string, runId: string): void;
  /** Tell the rest of the app a run changed here; the device store hands it to sync. */
  changed(runId: string): void;
  /**
   * True when what is written here is kept: other devices hear about it,
   * and a step half-done is remembered across a reload. The memory store
   * keeps nothing past the screen, so neither applies.
   */
  keeps: boolean;
}

export const deviceRunStore: RunStore = {
  runsFor,
  loadRun,
  currentRun,
  saveRun,
  forgetRun,
  takeLegacyRun,
  clearLegacyRun,
  activeRunFor,
  setActiveRunFor,
  setLastActive,
  forgetActive,
  changed: (runId) => syncBus.localChange("run", runId),
  keeps: true,
};

/**
 * A store that forgets everything when it is let go of. One is made per
 * test run, so two drafts tried in turn never see each other's runs.
 */
export function memoryRunStore(): RunStore {
  const runs = new Map<string, StoredRun>();
  const active = new Map<string, string | null>();
  const live = (packId: string) =>
    [...runs.values()].filter((r) => r.packId === packId && !r.deletedAt).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return {
    runsFor: async (packId) => live(packId),
    loadRun: async (runId) => runs.get(runId) ?? null,
    currentRun: async (packId) => live(packId)[0] ?? null,
    saveRun: async (record) => {
      runs.set(record.runId, { ...record, events: [...(record.events as RunEvent[])] });
    },
    forgetRun: async (runId) => {
      runs.delete(runId);
    },
    takeLegacyRun: () => null,
    clearLegacyRun: () => {},
    activeRunFor: (packId) => active.get(packId) ?? null,
    setActiveRunFor: (packId, runId) => {
      active.set(packId, runId);
    },
    setLastActive: () => {},
    forgetActive: (packId, runId) => {
      if (active.get(packId) === runId) active.delete(packId);
    },
    changed: () => {},
    keeps: false,
  };
}
