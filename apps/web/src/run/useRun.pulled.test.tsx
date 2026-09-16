// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import { syncBus } from "../sync/bus.ts";
import { memoryRunStore, type RunStore } from "./store.ts";
import { useRun } from "./useRun.ts";

/**
 * What a sync pass is allowed to do to a run somebody is playing.
 *
 * A pass that pulled nothing new still rewrote the record and told the app
 * a run had arrived, and the answer here was to reload the log and throw
 * away the block in flight. On a run whose server counter sits past its
 * last event that happened every two seconds, so a roll begun at the first
 * step never lasted long enough to be answered.
 *
 * The store is the memory one with `keeps` turned on: the hook only
 * listens for pulls where writes are kept, and nothing here should touch
 * IndexedDB.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;
const mode = Object.keys(kiln.modes)[0]!;

afterEach(cleanup);

/** A handful of microtask turns: enough for the store's promise chain to settle. */
async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const runId = "run1";
const at = "2026-09-15T00:00:00.000Z";
const started = [{ id: "e1", t: "RunStarted" as const, at, packId: kiln.id, packVersion: kiln.version, runId, mode }] as RunEvent[];

async function openRun(events: RunEvent[] = started) {
  const store: RunStore = { ...memoryRunStore(), keeps: true };
  await store.saveRun({ runId, packId: kiln.id, packVersion: kiln.version, packTitle: kiln.title, events, updatedAt: at, seq: 1 });
  store.setActiveRunFor(kiln.id, runId);
  const hook = renderHook(() => useRun(kiln, store));
  await waitFor(() => expect(hook.result.current.hydrated).toBe(true));
  return { store, hook };
}

describe("a run being played while sync pulls", () => {
  it("keeps the block in flight when the pulled log is the one the page already holds", async () => {
    const { hook } = await openRun();
    act(() => hook.result.current.begin({ kind: "table", label: "Kiln Check", tableId: "check", keyPrefix: "check" }));
    expect(hook.result.current.pending?.request?.kind).toBe("roll");

    act(() => syncBus.pulled("run", [runId]));
    await flush();

    expect(hook.result.current.pending?.request?.kind).toBe("roll");
    expect(hook.result.current.events).toHaveLength(1);
  });

  it("still takes a log that grew elsewhere, and lets the block in flight go", async () => {
    const { store, hook } = await openRun();
    act(() => hook.result.current.begin({ kind: "table", label: "Kiln Check", tableId: "check", keyPrefix: "check" }));
    expect(hook.result.current.pending).not.toBeNull();

    await store.saveRun({
      runId,
      packId: kiln.id,
      packVersion: kiln.version,
      packTitle: kiln.title,
      events: [...started, { id: "e2", t: "UnitEntered", at }] as RunEvent[],
      updatedAt: at,
      seq: 2,
    });
    act(() => syncBus.pulled("run", [runId]));
    await flush();

    expect(hook.result.current.events).toHaveLength(2);
    expect(hook.result.current.pending).toBeNull();
  });
});
