import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { createRandom } from "@runlog/engine";
import { resolveRoll, toDisplayDice } from "./rolling.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}
const kiln = loadPack("packs/demo/pack.yaml");
const signal = loadPack("packs/sketches/salt-and-signal.yaml");

describe("presenting a roll as physical dice", () => {
  describe("percentile dice", () => {
    /**
     * A d100 is not a hundred-sided object. It is a tens die reading 00–90 and
     * a ones die reading 0–9, and getting that wrong would show the player
     * dice they are not holding.
     */
    it("splits a d100 into a tens and a ones die", () => {
      expect(toDisplayDice("d100", [45], 45)).toEqual([
        { faces: 10, display: "40", label: "tens" },
        { faces: 10, display: "5", label: "ones" },
      ]);
    });

    it("reads a round result as tens and zero", () => {
      const [tens, ones] = toDisplayDice("d100", [70], 70);
      expect(tens!.display).toBe("70");
      expect(ones!.display).toBe("0");
    });

    it("reads a single-digit result off the 00 face", () => {
      const [tens, ones] = toDisplayDice("d100", [7], 7);
      expect(tens!.display).toBe("00");
      expect(ones!.display).toBe("7");
    });

    it("reads 100 as double zero, the way the dice actually land", () => {
      const [tens, ones] = toDisplayDice("d100", [100], 100);
      expect(tens!.display).toBe("00");
      expect(ones!.display).toBe("0");
    });

    it("round-trips every possible result", () => {
      for (let t = 1; t <= 100; t++) {
        const [tens, ones] = toDisplayDice("d100", [t], t);
        const read = Number(tens!.display) + Number(ones!.display);
        expect(read === 0 ? 100 : read, `d100 showing ${t}`).toBe(t);
      }
    });
  });

  it("shows one die per die actually rolled", () => {
    const dice = toDisplayDice("2d10", [3, 7], 10);
    expect(dice.map((d) => d.display)).toEqual(["3", "7"]);
    expect(dice.every((d) => d.faces === 10)).toBe(true);
  });

  it("keeps the shape of an unusual die", () => {
    expect(toDisplayDice("d12", [11], 11)).toEqual([
      { faces: 12, display: "11", label: "d12" },
    ]);
  });

  it("distinguishes the action die from the opposition", () => {
    const table = signal.tables.signal!;
    const result = resolveRoll(table, signal, createRandom("fixed"));
    expect(result.dice).toHaveLength(3); // one action die, two challenge dice
    expect(result.dice[0]!.label).toBe("action");
    expect(result.dice.filter((d) => d.variant === "challenge")).toHaveLength(2);
  });

  it("has no dice for a keyed draw, which is a card and not a roll", () => {
    const result = resolveRoll(signal.tables.tideSuits!, signal, createRandom("x"));
    expect(result.dice).toEqual([]);
    expect(result.headline).toMatch(/hearts|diamonds|clubs|spades/);
  });
});

describe("seeded rolling", () => {
  /**
   * The property the animation must never break: the value is decided by the
   * seeded source before anything moves, so presentation cannot change fate.
   */
  it("gives the same result for the same seed", () => {
    const a = resolveRoll(kiln.tables.check!, kiln, createRandom("shared-kiln"));
    const b = resolveRoll(kiln.tables.check!, kiln, createRandom("shared-kiln"));
    expect(a.headline).toBe(b.headline);
    expect(a.entryId).toBe(b.entryId);
    expect(a.dice).toEqual(b.dice);
  });

  it("gives a different result for a different seed", () => {
    const stream = createRandom("one");
    const other = createRandom("two");
    const a = Array.from({ length: 8 }, () => resolveRoll(kiln.tables.check!, kiln, stream));
    const b = Array.from({ length: 8 }, () => resolveRoll(kiln.tables.check!, kiln, other));
    expect(a.map((r) => r.headline)).not.toEqual(b.map((r) => r.headline));
  });

  it("reproduces a whole sequence, not merely a single roll", () => {
    // This is what a shared seed actually promises: two people meet the same
    // dice in the same order.
    const walk = (seed: string) => {
      const next = createRandom(seed);
      return Array.from({ length: 10 }, () => resolveRoll(kiln.tables.check!, kiln, next).headline);
    };
    expect(walk("dungeon-42")).toEqual(walk("dungeon-42"));
  });

  it("always lands on an entry the pack actually declares", () => {
    const next = createRandom("coverage");
    for (let i = 0; i < 300; i++) {
      const result = resolveRoll(kiln.tables.check!, kiln, next);
      expect(result.entryId).not.toBeNull();
    }
  });
});
