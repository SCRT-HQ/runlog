import { describe, expect, it } from "vitest";
import { motionBetween } from "./motion.ts";
import type { LiveSnapshot } from "./snapshot.ts";

const base: LiveSnapshot = {
  v: 1,
  at: "2026-01-01T00:00:00Z",
  packId: "kiln",
  packTitle: "The Long Kiln",
  runName: null,
  mode: "Standard",
  words: { run: "Firing", unit: "Stage", units: "Stages" },
  status: "active",
  ending: null,
  unit: 2,
  where: null,
  step: null,
  phases: [],
  quoted: true,
  standings: [],
  contestants: 0,
  subjects: [{ id: 1, name: "Piece 1", type: "a cup", states: [], finalized: true }],
  counters: [{ id: "streak", label: "Streak", value: 1 }],
  resources: [{ id: "glaze", label: "Glaze", value: 3, max: 6 }],
  clocks: [],
  progress: { unitsDone: 1, elapsedMs: 0, timed: true },
  score: { label: "Stages closed", text: "1 stages", value: 1, better: "higher" },
  forcedUnits: 0,
  log: [{ n: 1, unit: 1, where: "Stage 1, Form", hit: null, text: "A cup" }],
};

describe("what moved between two snapshots", () => {
  it("moves nothing on the first snapshot", () => {
    const m = motionBetween(null, base);
    expect(m.turned).toBe(false);
    expect(m.freshFrom).toBe(Infinity);
  });

  it("notices a new unit, new lines, a piece struck, a state put on, and numbers that changed", () => {
    const next: LiveSnapshot = {
      ...base,
      unit: 3,
      subjects: [{ id: 1, name: "Piece 1", type: "a cup", states: ["cracked"], finalized: true }, { id: 2, name: "Piece 2", type: null, states: [], finalized: false }],
      counters: [{ id: "streak", label: "Streak", value: 0 }],
      resources: [{ id: "glaze", label: "Glaze", value: 3, max: 6 }],
      log: [{ n: 2, unit: 3, where: "Stage 3, Kiln Check", hit: 1, text: "Thermal shock" }, ...base.log],
    };
    const m = motionBetween(base, next);
    expect(m.turned).toBe(true);
    expect(m.freshFrom).toBe(1);
    expect([...m.struck]).toEqual([1]);
    expect([...m.states]).toEqual(["1:cracked"]);
    expect([...m.counters]).toEqual(["streak"]);
    expect(m.resources.size).toBe(0);
  });
});
