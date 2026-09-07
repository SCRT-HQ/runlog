import { describe, expect, it } from "vitest";
import { parseDice, rollDice, tryParseDice } from "./dice.ts";

describe("parseDice", () => {
  it("parses a bare die", () => {
    expect(parseDice("d100")).toMatchObject({ count: 1, faces: 100, modifier: 0, min: 1, max: 100 });
  });

  it("parses multiple dice", () => {
    expect(parseDice("2d10")).toMatchObject({ count: 2, faces: 10, min: 2, max: 20 });
  });

  it("parses modifiers in both directions", () => {
    expect(parseDice("d6+3")).toMatchObject({ modifier: 3, min: 4, max: 9 });
    expect(parseDice("3d6-1")).toMatchObject({ modifier: -1, min: 2, max: 17 });
  });

  it("rejects anything that is not a dice expression", () => {
    for (const bad of ["", "d0", "0d6", "6", "d", "2x10", "d6+", "1d6+1d6"]) {
      expect(() => parseDice(bad), bad).toThrow();
      expect(tryParseDice(bad), bad).toBeNull();
    }
  });
});

describe("rollDice", () => {
  it("is fully determined by the injected random source", () => {
    // A source pinned to 0 yields the minimum face on every die; pinned just
    // under 1 yields the maximum. This is the property that makes seeded runs
    // and replayed logs reproducible.
    expect(rollDice("2d10", () => 0).total).toBe(2);
    expect(rollDice("2d10", () => 0.999999).total).toBe(20);
    expect(rollDice("d6+3", () => 0).total).toBe(4);
  });

  it("reports the individual dice, not just the total", () => {
    const values = [0.05, 0.95];
    let i = 0;
    const result = rollDice("2d10", () => values[i++]!);
    expect(result.dice).toEqual([1, 10]);
    expect(result.total).toBe(11);
  });

  it("never produces a result outside the parsed range", () => {
    const { min, max } = parseDice("3d6-2");
    for (let i = 0; i < 200; i++) {
      const { total } = rollDice("3d6-2", Math.random);
      expect(total).toBeGreaterThanOrEqual(min);
      expect(total).toBeLessThanOrEqual(max);
    }
  });
});
