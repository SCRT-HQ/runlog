import { describe, expect, it } from "vitest";
import type { RunEvent } from "./events.ts";
import { progressOf, rankRace, type RaceProgress } from "./race.ts";
import type { RunState } from "./types.ts";

const at = "2026-01-01T00:00:00.000Z";
const state = (over: Partial<RunState> = {}): RunState =>
  ({
    status: "active",
    startedAt: at,
    updatedAt: "2026-01-01T00:10:00.000Z",
    unit: 2,
    clocks: [],
    ending: null,
    ...over,
  }) as RunState;
const ev = (t: RunEvent["t"], id: string, extra: Record<string, unknown> = {}): RunEvent => ({ t, at, id, ...extra }) as RunEvent;

describe("where a run is", () => {
  it("counts closed units from the log and time from the start when there is no clock", () => {
    const events = [ev("RunStarted", "e0"), ev("UnitEntered", "e1"), ev("UnitFinalized", "e2"), ev("UnitEntered", "e3")];
    const p = progressOf(state(), events, Date.parse(at) + 90_000);
    expect(p).toEqual({ unit: 2, unitsDone: 1, status: "active", elapsedMs: 90_000 });
  });

  it("does not count a unit whose closing was undone", () => {
    const events = [ev("RunStarted", "e0"), ev("UnitEntered", "e1"), ev("UnitFinalized", "e2"), ev("Undone", "e3", { ids: ["e2"] })];
    expect(progressOf(state({ unit: 1 }), events, Date.parse(at)).unitsDone).toBe(0);
  });

  it("adds up the unit clocks where the pack runs them, and stops the wall clock at the end", () => {
    const clocks = [
      { id: "u1:unit", kind: "stopwatch", label: "", seconds: null, unit: 1, status: "done", accumulatedMs: 60_000, runningSince: null, elapsedMs: 60_000 },
      { id: "u2:unit", kind: "stopwatch", label: "", seconds: null, unit: 2, status: "running", accumulatedMs: 0, runningSince: at, elapsedMs: null },
    ] as RunState["clocks"];
    expect(progressOf(state({ clocks }), [], Date.parse(at) + 30_000).elapsedMs).toBe(90_000);
    const ended = progressOf(state({ status: "ended", ending: "keep" }), [], Date.parse(at) + 999_999_000);
    expect(ended).toMatchObject({ status: "ended", ending: "keep", elapsedMs: 600_000 });
  });
});

describe("the order of a race", () => {
  const p = (over: Partial<RaceProgress>): RaceProgress => ({ unit: 1, unitsDone: 0, status: "active", elapsedMs: 0, ...over });
  it("puts the finished first, then the furthest along, then the fastest, and ties share a place", () => {
    const entries = [
      { name: "slow finisher", progress: p({ status: "ended", unitsDone: 5, elapsedMs: 900 }) },
      { name: "not started" },
      { name: "mid", progress: p({ unitsDone: 2, unit: 3, elapsedMs: 500 }) },
      { name: "fast finisher", progress: p({ status: "ended", unitsDone: 5, elapsedMs: 800 }) },
      { name: "mid twin", progress: p({ unitsDone: 2, unit: 3, elapsedMs: 500 }) },
      { name: "behind", progress: p({ unitsDone: 1, unit: 2, elapsedMs: 100 }) },
    ];
    expect(rankRace(entries).map((s) => [s.place, s.entry.name])).toEqual([
      [1, "fast finisher"],
      [2, "slow finisher"],
      [3, "mid"],
      [3, "mid twin"],
      [5, "behind"],
      [6, "not started"],
    ]);
  });
});
