import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { resolveTargeting } from "./targeting.ts";
import type { RunState, Subject } from "./types.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}

/**
 * The Long Kiln uses the classic scheme: 70-79 anchors on the newest and
 * counts backwards, 80-89 anchors on the oldest and counts forwards, 90-99
 * hands the choice to the player, with wraparound and ineligible subjects
 * skipped.
 */
const kiln = loadPack("packs/demo/pack.yaml");
const ladder = loadPack("packs/sketches/ladder-work.yaml");
const signal = loadPack("packs/sketches/salt-and-signal.yaml");

interface Options {
  untargetable?: number[];
  unfinalized?: number[];
  removed?: number[];
}

/** A run state holding `count` subjects, all eligible unless said otherwise. */
function stateWith(count: number, o: Options = {}): RunState {
  const subjects: Subject[] = Array.from({ length: count }, (_, i) => {
    const id = i + 1;
    return {
      id,
      unit: id,
      type: `Subject ${id}`,
      name: null,
      states: o.untargetable?.includes(id) ? ["sealed"] : [],
      finalized: !o.unfinalized?.includes(id),
      removed: o.removed?.includes(id) ?? false,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  });
  return {
    packId: "test",
    packVersion: "1",
    mode: "standard",
    seed: null,
    name: null,
    players: 1,
    status: "active",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unit: count,
    phasesDone: [],
    stepsDone: [],
    checks: [],
    subjects,
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

const target = (roll: number, count: number, o: Options = {}) =>
  resolveTargeting(kiln, stateWith(count, o), { roll, from: "currentRoll" });

describe("anchored-offset targeting", () => {
  describe("worked examples", () => {
    it("a 74 against a full list counts four back from the newest", () => {
      // Six eligible, anchor is the newest (id 6), four before it is id 2.
      const d = target(74, 6);
      expect(d.outcome).toBe("target");
      expect(d.band).toMatchObject({ anchor: "newest", direction: "before" });
      expect(d.anchorIndex).toBe(5);
      expect(d.rawOffset).toBe(4);
      expect(d.targetSubject).toBe(2);
    });

    it("an 88 against three eligible reduces 8 to 2 and counts forward from the oldest", () => {
      // By hand this is repeated subtraction: 8 - 3 = 5, 5 - 3 = 2.
      const d = target(88, 3);
      expect(d.outcome).toBe("target");
      expect(d.band).toMatchObject({ anchor: "oldest", direction: "after" });
      expect(d.rawOffset).toBe(8);
      expect(d.reducedOffset).toBe(2);
      expect(d.targetSubject).toBe(3);
      expect(d.explain.join(" ")).toContain("8 % 3 = 2");
    });
  });

  describe("the anchor itself", () => {
    it("a ones digit of 0 in the 70s targets the newest", () => {
      const d = target(70, 5);
      expect(d.reducedOffset).toBe(0);
      expect(d.targetSubject).toBe(5);
      expect(d.explain.join(" ")).toContain("targets the anchor itself");
    });

    it("a ones digit of 0 in the 80s targets the oldest", () => {
      expect(target(80, 5).targetSubject).toBe(1);
    });
  });

  describe("wraparound", () => {
    it("wraps off the front of the list when counting backwards", () => {
      // Three eligible, anchor newest (index 2), offset 5 reduces to 2,
      // 2 - 2 = 0, which is in range: id 1.
      expect(target(75, 3).targetSubject).toBe(1);
    });

    it("wraps past the end when counting forwards", () => {
      // Four eligible, anchor oldest (index 0), offset 3, 0 + 3 = 3: id 4.
      expect(target(83, 4).targetSubject).toBe(4);
      // Offset 7 reduces to 3 against four candidates: same place.
      expect(target(87, 4).targetSubject).toBe(4);
    });

    it("reports when it had to wrap", () => {
      // Two eligible, anchor newest (index 1), raw offset 3 → reduced 1 → 0.
      const d = target(73, 2);
      expect(d.targetSubject).toBe(1);
    });

    it("never selects a position outside the list", () => {
      for (let roll = 70; roll <= 89; roll++) {
        for (let n = 1; n <= 7; n++) {
          const d = target(roll, n);
          expect(d.outcome, `roll ${roll} with ${n} eligible`).toBe("target");
          expect(d.targetIndex).toBeGreaterThanOrEqual(0);
          expect(d.targetIndex).toBeLessThan(n);
        }
      }
    });
  });

  describe("eligibility", () => {
    it("skips subjects a state has made untargetable", () => {
      // Ids 2 and 3 are sealed, so the eligible list is [1, 4, 5]. Anchor is
      // the newest of *those*, id 5, and one before it is id 4.
      const d = target(71, 5, { untargetable: [2, 3] });
      expect(d.eligible).toEqual([1, 4, 5]);
      expect(d.targetSubject).toBe(4);
    });

    it("skips subjects that are not finalized yet", () => {
      const d = target(70, 4, { unfinalized: [4] });
      expect(d.eligible).toEqual([1, 2, 3]);
      expect(d.targetSubject).toBe(3);
    });

    it("skips subjects removed from play", () => {
      const d = target(80, 4, { removed: [1] });
      expect(d.eligible).toEqual([2, 3, 4]);
      expect(d.targetSubject).toBe(2);
    });

    it("still triggers with nothing to hit, rather than quietly sparing you", () => {
      const d = target(74, 3, { untargetable: [1, 2, 3] });
      expect(d.outcome).toBe("noEligibleTargets");
      expect(d.targetSubject).toBeNull();
      expect(d.explain.join(" ")).toContain("still triggers");
    });
  });

  describe("bands", () => {
    it("hands 90-99 to the player", () => {
      const d = target(95, 5);
      expect(d.outcome).toBe("playerChoice");
      expect(d.targetSubject).toBeNull();
    });

    it("targets nothing for a roll in no band", () => {
      const d = target(42, 5);
      expect(d.outcome).toBe("outOfBand");
    });
  });

  describe("event-triggered targeting", () => {
    const evt = (roll: number, count: number) =>
      resolveTargeting(kiln, stateWith(count), { roll, from: "event" });

    it("reads an odd tens digit as the first band", () => {
      // 37 → tens 3 is odd → treat as 77 → newest anchor, offset 7.
      const d = evt(37, 4);
      expect(d.originalRoll).toBe(37);
      expect(d.roll).toBe(77);
      expect(d.band).toMatchObject({ anchor: "newest", direction: "before" });
    });

    it("reads an even tens digit as the second band", () => {
      // 44 → tens 4 is even → treat as 84 → oldest anchor, offset 4.
      const d = evt(44, 6);
      expect(d.roll).toBe(84);
      expect(d.band).toMatchObject({ anchor: "oldest", direction: "after" });
      expect(d.targetSubject).toBe(5);
    });

    it("treats a single-digit roll as having a zero tens digit", () => {
      const d = evt(7, 4);
      expect(d.roll).toBe(87);
      expect(d.band).toMatchObject({ anchor: "oldest" });
    });

    it("misses on the declared miss result, and says it still counted", () => {
      const d = evt(100, 4);
      expect(d.outcome).toBe("miss");
      expect(d.targetSubject).toBeNull();
      expect(d.explain.join(" ")).toContain("still counts");
    });
  });

  describe("the derivation", () => {
    it("shows its working, so the player can check it", () => {
      const d = target(88, 3);
      const working = d.explain.join("\n");
      expect(working).toContain("88 is in 80-89");
      expect(working).toContain("anchor on the oldest of 3 eligible");
      expect(working).toContain("counting after");
      expect(working).toContain("8 % 3 = 2");
      expect(working).toContain("Position 3 of 3");
    });
  });
});

describe("other targeting strategies", () => {
  it("player choice, when the pack always defers to the player", () => {
    const d = resolveTargeting(signal, stateWith(4), { roll: 0, from: "currentRoll" });
    expect(d.outcome).toBe("playerChoice");
  });

  it("no targeting at all, for games where nothing reaches backwards", () => {
    const d = resolveTargeting(ladder, stateWith(4), { roll: 74, from: "currentRoll" });
    expect(d.outcome).toBe("outOfBand");
    expect(d.explain.join(" ")).toContain("nothing reaches backwards");
  });

  it("an explicit choice overrides an anchored band", () => {
    const d = resolveTargeting(kiln, stateWith(4), { roll: 74, from: "choice" });
    expect(d.outcome).toBe("playerChoice");
  });
});
