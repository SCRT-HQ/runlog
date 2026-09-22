import { describe, expect, it } from "vitest";
import { withinBound } from "./bounds.ts";
import type { RunState } from "./types.ts";

/**
 * `gteFraction` and `lteFraction` compare a value against how far into the
 * run's planned length it falls, rather than against a literal or a counter.
 * A run that never said how long it is has no fraction to be past, so these
 * never match without a planned length.
 */

function stateWith(plannedUnits: number | null): RunState {
  return {
    packId: "test",
    packVersion: "1",
    mode: "solo",
    seed: null,
    name: null,
    players: 1,
    status: "active",
    startedAt: "t",
    updatedAt: "t",
    unit: 0,
    plannedUnits,
    phasesDone: [],
    stepsDone: [],
    checks: [],
    subjects: [],
    runStates: [],
    counters: {},
    resources: {},
    flags: {},
    forcedUnits: 0,
    extraRolls: {},
    extraRollsNext: {},
    rewindNext: 0,
    rewinds: 0,
    bannedTypes: [],
    journal: {},
    hand: [],
    outcomes: [],
    obligations: [],
    firedOnce: [],
    lacks: [],
    clocks: [],
    contestants: [],
    awards: [],
    ending: null,
  };
}

describe("gteFraction", () => {
  it("matches once the value reaches the fraction, and stays matched past it", () => {
    const state = stateWith(10);
    expect(withinBound(5, { gteFraction: 0.5 }, state)).toBe(true);
    expect(withinBound(8, { gteFraction: 0.5 }, state)).toBe(true);
  });

  it("does not match below the fraction", () => {
    const state = stateWith(10);
    expect(withinBound(4, { gteFraction: 0.5 }, state)).toBe(false);
  });

  it("never matches when plannedUnits is null or zero", () => {
    expect(withinBound(999, { gteFraction: 0 }, stateWith(null))).toBe(false);
    expect(withinBound(999, { gteFraction: 0 }, stateWith(0))).toBe(false);
  });

  it("never matches with no state at all", () => {
    expect(withinBound(5, { gteFraction: 0.5 })).toBe(false);
  });
});

describe("lteFraction", () => {
  it("matches at and below the fraction", () => {
    const state = stateWith(10);
    expect(withinBound(5, { lteFraction: 0.5 }, state)).toBe(true);
    expect(withinBound(3, { lteFraction: 0.5 }, state)).toBe(true);
  });

  it("does not match past the fraction", () => {
    const state = stateWith(10);
    expect(withinBound(6, { lteFraction: 0.5 }, state)).toBe(false);
  });

  it("never matches when plannedUnits is null or zero", () => {
    expect(withinBound(0, { lteFraction: 1 }, stateWith(null))).toBe(false);
    expect(withinBound(0, { lteFraction: 1 }, stateWith(0))).toBe(false);
  });
});
