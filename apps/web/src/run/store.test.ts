import { describe, expect, it } from "vitest";
import type { StoredRun } from "../storage/db.ts";
import { memoryRunStore } from "./store.ts";

const record = (runId: string, packId: string, updatedAt: string): StoredRun => ({
  runId,
  packId,
  packVersion: "1",
  events: [{ t: "RunStarted", at: updatedAt, packId, packVersion: "1", runId, mode: "standard" }],
  updatedAt,
});

/**
 * The store a trial plays in. It keeps a run only as long as it is held,
 * knows which run a pack has open, and never sees another store's runs:
 * a draft tried twice starts clean both times, and a draft that borrows a
 * real pack's id never meets that pack's runs.
 */
describe("a run store that forgets", () => {
  it("holds what is saved, newest first, and forgets on request", async () => {
    const store = memoryRunStore();
    await store.saveRun(record("a", "p", "2026-01-01T00:00:00Z"));
    await store.saveRun(record("b", "p", "2026-01-02T00:00:00Z"));
    await store.saveRun(record("c", "other", "2026-01-03T00:00:00Z"));
    expect((await store.runsFor("p")).map((r) => r.runId)).toEqual(["b", "a"]);
    expect((await store.currentRun("p"))?.runId).toBe("b");
    expect((await store.loadRun("c"))?.packId).toBe("other");
    await store.forgetRun("b");
    expect((await store.currentRun("p"))?.runId).toBe("a");
  });

  it("remembers which run a pack has open, and drops it when that run is forgotten", async () => {
    const store = memoryRunStore();
    expect(store.activeRunFor("p")).toBeNull();
    store.setActiveRunFor("p", "a");
    expect(store.activeRunFor("p")).toBe("a");
    store.forgetActive("p", "z");
    expect(store.activeRunFor("p")).toBe("a");
    store.forgetActive("p", "a");
    expect(store.activeRunFor("p")).toBeNull();
  });

  it("shares nothing between two stores, and keeps nothing past itself", async () => {
    const one = memoryRunStore();
    const two = memoryRunStore();
    await one.saveRun(record("a", "p", "2026-01-01T00:00:00Z"));
    expect(await two.runsFor("p")).toEqual([]);
    expect(one.keeps).toBe(false);
    expect(one.takeLegacyRun("p")).toBeNull();
  });

  it("copies the log in, so the caller's array can move on", async () => {
    const store = memoryRunStore();
    const r = record("a", "p", "2026-01-01T00:00:00Z");
    await store.saveRun(r);
    r.events.push({ t: "UnitEntered", at: "2026-01-01T00:00:01Z" });
    expect((await store.loadRun("a"))?.events).toHaveLength(1);
  });
});
