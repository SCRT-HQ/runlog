import { describe, expect, it } from "vitest";
import type { StoredRun } from "../storage/db.ts";
import { elsewhere, pickUp, runLine, runTitle } from "./home.ts";

const run = (runId: string, packId: string, updatedAt: string, extra: Partial<StoredRun> = {}): StoredRun =>
  ({ runId, packId, packVersion: "1", events: [], updatedAt, startedAt: updatedAt, ...extra }) as unknown as StoredRun;

const packs = [{ id: "a" }, { id: "b" }];

describe("what the strip picks up", () => {
  it("prefers the run this device touched last, when it is still here", () => {
    const runs = [run("r1", "a", "2026-01-02"), run("r2", "b", "2026-01-03")];
    expect(pickUp(packs, runs, { packId: "a", runId: "r1" })?.run?.runId).toBe("r1");
  });

  it("falls back to the newest run, then to the first pack alone, then to nothing", () => {
    const runs = [run("r1", "a", "2026-01-02"), run("r2", "b", "2026-01-03"), run("r3", "a", "2026-01-04", { deletedAt: "2026-01-05" })];
    expect(pickUp(packs, runs, { packId: "a", runId: "gone" })?.run?.runId).toBe("r2");
    expect(pickUp(packs, [], null)).toEqual({ pack: { id: "a" } });
    expect(pickUp([], runs, null)).toBeNull();
  });

  it("ignores runs of packs no longer on the shelf", () => {
    expect(pickUp([{ id: "a" }], [run("r2", "b", "2026-01-03")], null)).toEqual({ pack: { id: "a" } });
  });

  it("words a run by its name, or how far it is", () => {
    expect(runLine(run("r", "a", "2026-01-01", { events: [{ t: "RunStarted" }, { t: "RunRenamed", name: "Tuesday" }] }), "Day")).toBe("Tuesday");
    expect(runLine(run("r", "a", "2026-01-01", { events: [{ t: "RunStarted" }, { t: "UnitEntered" }, { t: "UnitEntered" }] }), "Day")).toBe("Day 2");
    expect(runLine(run("r", "a", "2026-01-01"), "Day")).toBe("not started");
  });

  it("titles a run by its name, or the pack's word for a run and when it began", () => {
    expect(runTitle(run("r", "a", "2026-01-01", { events: [{ t: "RunStarted", at: "2026-09-01T00:00:00Z" }, { t: "RunRenamed", name: "The long weekend" }] }), "Firing")).toBe("The long weekend");
    expect(runTitle(run("r", "a", "2026-01-01", { events: [{ t: "RunStarted", at: "2026-09-07T12:00:00Z" }] }), "Firing")).toBe("Firing from Sep 7");
  });
});

describe("what else the account has going", () => {
  it("says nothing when this device's own run is the account's last one too", () => {
    const runs = [run("r1", "a", "2026-01-02")];
    const device = pickUp(packs, runs, { packId: "a", runId: "r1" });
    expect(elsewhere(packs, runs, device, "r1")).toBeNull();
  });

  it("points at the account's run when it is a different one this device already holds", () => {
    const runs = [run("r1", "a", "2026-01-02"), run("r2", "b", "2026-01-03")];
    const device = pickUp(packs, runs, { packId: "a", runId: "r1" });
    expect(elsewhere(packs, runs, device, "r2")?.run?.runId).toBe("r2");
  });

  it("says nothing when the account's run has not reached this device, or nobody is signed in", () => {
    const runs = [run("r1", "a", "2026-01-02")];
    const device = pickUp(packs, runs, { packId: "a", runId: "r1" });
    expect(elsewhere(packs, runs, device, "somewhere-else")).toBeNull();
    expect(elsewhere(packs, runs, device, null)).toBeNull();
  });
});
