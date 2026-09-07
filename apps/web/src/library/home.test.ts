import { describe, expect, it } from "vitest";
import type { StoredRun } from "../storage/db.ts";
import { pickUp, runLine } from "./home.ts";

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
});
