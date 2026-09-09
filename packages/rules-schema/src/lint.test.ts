import { describe, expect, it } from "vitest";
import { parsePack } from "./parse.ts";
import { lintPack } from "./lint.ts";
import { Pack } from "./pack.ts";

/**
 * A minimal well-formed pack. Individual tests mutate a clone of this so each
 * one isolates exactly the defect it is about.
 */
function basePack(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "dev.runlog.fixture",
    version: "1.0.0",
    title: "Fixture",
    license: { id: "CC0-1.0", redistributable: true },
    capabilities: [],
    vocabulary: {
      run: { one: "Run", many: "Runs" },
      unit: { one: "Unit", many: "Units" },
      subject: { one: "Subject", many: "Subjects" },
    },
    tables: {
      simple: {
        resolution: "lookup",
        title: "Simple",
        roll: "d6",
        entries: [
          { id: "a", range: [1, 3], text: "low" },
          { id: "b", range: [4, 6], text: "high" },
        ],
      },
    },
    phases: [
      {
        id: "only",
        label: "Only",
        steps: [{ kind: "finalizeUnit" }],
      },
    ],
    modes: { standard: { label: "Standard" } },
    defaultMode: "standard",
  };
}

const codesOf = (pack: Record<string, unknown>) => {
  const parsed = Pack.parse(pack);
  return lintPack(parsed).map((x) => x.code);
};

describe("lintPack", () => {
  it("accepts a minimal coherent pack", () => {
    const result = parsePack(basePack());
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  describe("license", () => {
    it("wants the terms in text for proprietary and custom licenses, and nothing more for the rest", () => {
      expect(codesOf({ ...basePack(), license: { id: "proprietary", redistributable: false } })).toContain("license/text-required");
      expect(codesOf({ ...basePack(), license: { id: "custom", redistributable: true, text: "   " } })).toContain("license/text-required");
      expect(codesOf({ ...basePack(), license: { id: "custom", redistributable: true, text: "Do as you like." } })).not.toContain("license/text-required");
      expect(codesOf({ ...basePack(), license: { id: "MIT", redistributable: true } })).not.toContain("license/text-required");
    });
  });

  describe("table ranges", () => {
    it("flags a gap in the middle of a lookup table", () => {
      const p = basePack();
      // 1-3 and 5-6: a roll of 4 has nowhere to land.
      (p.tables as any).simple.entries[1].range = [5, 6];
      expect(codesOf(p)).toContain("table/range-gap");
    });

    it("flags a gap at the top of the dice range", () => {
      const p = basePack();
      (p.tables as any).simple.entries[1].range = [4, 5];
      const diags = lintPack(Pack.parse(p));
      expect(diags.map((d) => d.code)).toContain("table/range-gap");
      expect(diags[0]!.message).toContain("6");
    });

    it("flags overlapping ranges", () => {
      const p = basePack();
      (p.tables as any).simple.entries[1].range = [3, 6];
      expect(codesOf(p)).toContain("table/range-overlap");
    });

    it("flags entries outside what the dice can roll", () => {
      const p = basePack();
      (p.tables as any).simple.entries[1].range = [4, 9];
      expect(codesOf(p)).toContain("table/range-unrollable");
    });

    it("accepts a d100 table that tiles 1..100 exactly", () => {
      const p = basePack();
      (p.tables as any).big = {
        resolution: "lookup",
        title: "Big",
        roll: "d100",
        entries: [
          { id: "x", range: [1, 69], text: "x" },
          { id: "y", range: [70, 99], text: "y" },
          { id: "z", range: [100, 100], text: "z" },
        ],
      };
      expect(codesOf(p)).not.toContain("table/range-gap");
    });

    it("catches the classic off-by-one where 100 is left uncovered", () => {
      const p = basePack();
      (p.tables as any).big = {
        resolution: "lookup",
        title: "Big",
        roll: "d100",
        entries: [
          { id: "x", range: [1, 69], text: "x" },
          { id: "y", range: [70, 99], text: "y" },
        ],
      };
      const diags = lintPack(Pack.parse(p));
      const gap = diags.find((d) => d.code === "table/range-gap");
      expect(gap?.message).toContain("100");
    });
  });

  describe("reference integrity", () => {
    it("flags a rollOn pointing at a table that does not exist", () => {
      const p = basePack();
      (p.tables as any).simple.entries[0].triggers = [
        { on: "immediately", do: [{ do: "rollOn", table: "ghost" }] },
      ];
      expect(codesOf(p)).toContain("ref/unknown-table");
    });

    it("flags an entry granting an undeclared state", () => {
      const p = basePack();
      (p.tables as any).simple.entries[0].grants = ["nonexistent"];
      expect(codesOf(p)).toContain("ref/unknown-state");
    });

    it("flags a defaultMode that is not among the modes", () => {
      const p = basePack();
      p.defaultMode = "missing";
      expect(codesOf(p)).toContain("ref/unknown-mode");
    });

    it("flags a step rolling on an unknown table", () => {
      const p = basePack();
      (p.phases as any)[0].steps.unshift({ kind: "rollTable", table: "ghost" });
      expect(codesOf(p)).toContain("ref/unknown-table");
    });
  });

  describe("structural coherence", () => {
    it("flags a pack in which no unit can ever be completed", () => {
      const p = basePack();
      (p.phases as any)[0].steps = [{ kind: "manual", label: "do a thing" }];
      expect(codesOf(p)).toContain("phase/no-finalize");
    });

    it("flags resolveTarget without a targeting strategy", () => {
      const p = basePack();
      (p.tables as any).simple.entries[0].triggers = [
        { on: "immediately", do: [{ do: "resolveTarget" }] },
      ];
      expect(codesOf(p)).toContain("targeting/unavailable");
    });

    it("flags a deck that draws more cards than it holds", () => {
      const p = basePack();
      (p as any).decks = {
        d: {
          kind: "cards",
          title: "D",
          drawAtStart: 3,
          cards: [{ id: "one", title: "One", text: "t" }],
        },
      };
      expect(codesOf(p)).toContain("deck/overdraw");
    });

    it("warns about a counter nothing can ever change", () => {
      const p = basePack();
      (p as any).counters = { inert: { label: "Inert" } };
      expect(codesOf(p)).toContain("counter/inert");
    });
  });

  /**
   * Unlike most `ref/unknown-*` checks, a dangling score reference cannot
   * break a run: `scoreOf` is total, so the worst case is a scoreboard that
   * quietly reads zero. That is why these are warnings rather than errors.
   */
  describe("score", () => {
    it("accepts a valid block naming a counter that exists", () => {
      const p = basePack();
      (p as any).counters = { blocks: { label: "Blocks", incrementOn: [{ on: "unitFinalized" }] } };
      (p as any).score = { counter: "blocks", tiebreak: "time" };
      const codes = codesOf(p);
      expect(codes).not.toContain("score/unknown-counter");
      expect(codes).not.toContain("score/unknown-resource");
    });

    it("warns when a score names a counter that does not exist", () => {
      const p = basePack();
      (p as any).score = { counter: "ghost" };
      const diag = lintPack(Pack.parse(p)).find((d) => d.code === "score/unknown-counter");
      expect(diag?.level).toBe("warning");
    });

    it("warns when a score names a resource that does not exist", () => {
      const p = basePack();
      (p as any).score = { resource: "ghost" };
      const diag = lintPack(Pack.parse(p)).find((d) => d.code === "score/unknown-resource");
      expect(diag?.level).toBe("warning");
    });

    it("warns when a score is by time but nothing in the pack runs a clock", () => {
      const p = basePack();
      (p as any).score = { time: true };
      const diag = lintPack(Pack.parse(p)).find((d) => d.code === "score/no-clock");
      expect(diag?.level).toBe("warning");
    });

    it("stays quiet about time once the pack runs a unit clock", () => {
      const p = basePack();
      (p as any).unit = { createsSubject: true, min: 1, max: 20, clock: { kind: "stopwatch" } };
      (p as any).score = { time: true };
      expect(codesOf(p)).not.toContain("score/no-clock");
    });

    it("checks a mode's own time score against that mode's own clock, not the pack's", () => {
      const p = basePack();
      p.modes = { standard: { label: "Standard", score: { time: true } } };
      expect(codesOf(p)).toContain("score/no-clock");

      const timed = basePack();
      timed.modes = { standard: { label: "Standard", score: { time: true }, clock: { kind: "stopwatch" } } };
      expect(codesOf(timed)).not.toContain("score/no-clock");
    });
  });

  /**
   * A trigger the pack owns outright has no result to hang from, so only the
   * points the run itself passes through can reach it. A pack that writes its
   * reckoning for `onFinalize` would otherwise validate clean and then never
   * fire it: the failure is entirely silent at play time.
   */
  describe("pack-level triggers", () => {
    it("accepts the points a run actually reaches", () => {
      const p = basePack();
      p.triggers = [
        { on: "onRunEnd", do: [{ do: "note", text: "the reckoning" }] },
        { on: "onEnterUnit", do: [{ do: "note", text: "every unit" }] },
      ];
      expect(codesOf(p)).not.toContain("trigger/unreachable-point");
    });

    it("flags a point a pack-level trigger can never see", () => {
      const p = basePack();
      p.triggers = [{ on: "onFinalize", do: [{ do: "note", text: "never happens" }] }];
      expect(codesOf(p)).toContain("trigger/unreachable-point");
    });
  });

  describe("players and roles", () => {
    const withPlayers = (players: Record<string, unknown>) => {
      const p = basePack();
      p.modes = { standard: { label: "Standard", players } };
      return p;
    };

    it("accepts a rotating mode that has roles to rotate", () => {
      const codes = codesOf(
        withPlayers({
          min: 2,
          max: 4,
          rotate: "clockwise",
          roles: [{ id: "lead", label: "Lead" }],
        }),
      );
      expect(codes).not.toContain("mode/rotate-without-roles");
      expect(codes).not.toContain("mode/roles-without-players");
    });

    it("flags rotation with nothing to rotate", () => {
      expect(codesOf(withPlayers({ min: 2, max: 4, rotate: "clockwise" }))).toContain(
        "mode/rotate-without-roles",
      );
    });

    it("flags every role acting, which says nothing", () => {
      const acting = (acts: boolean[]) => withPlayers({ min: 2, max: 2, roles: acts.map((a, i) => ({ id: `r${i}`, label: `Role ${i}`, acts: a })) });
      expect(codesOf(acting([true, true]))).toContain("mode/all-roles-act");
      expect(codesOf(acting([true, false]))).not.toContain("mode/all-roles-act");
      expect(codesOf(acting([false, false]))).not.toContain("mode/all-roles-act");
    });

    it("flags roles in a mode only one person plays", () => {
      expect(
        codesOf(withPlayers({ min: 1, max: 1, roles: [{ id: "lead", label: "Lead" }] })),
      ).toContain("mode/roles-without-players");
    });

    it("flags a player range that cannot be satisfied", () => {
      expect(codesOf(withPlayers({ min: 4, max: 2 }))).toContain("mode/player-range");
    });
  });

  describe("capabilities", () => {
    it("warns when a pack uses a feature it did not declare", () => {
      const p = basePack();
      (p as any).counters = {
        c: { label: "C", incrementOn: [{ on: "unitEntered" }] },
      };
      const diags = lintPack(Pack.parse(p));
      const cap = diags.find((x) => x.code === "capability/undeclared");
      expect(cap?.message).toContain("counters");
      expect(cap?.level).toBe("warning");
    });

    it("stays quiet when the capability is declared", () => {
      const p = basePack();
      p.capabilities = ["counters"];
      (p as any).counters = {
        c: { label: "C", incrementOn: [{ on: "unitEntered" }] },
      };
      expect(codesOf(p)).not.toContain("capability/undeclared");
    });

    /** Whether any `capability/undeclared` diagnostic names clockRules specifically. */
    const clockRulesWarning = (diags: ReturnType<typeof lintPack>) =>
      diags.find((d) => d.code === "capability/undeclared" && d.message.includes("clockRules"));

    it("warns when a global trigger reacts to a timer running out without declaring clockRules", () => {
      const p = basePack();
      p.capabilities = ["deferredTriggers"];
      (p as any).triggers = [{ on: "onTimerExpired", do: [{ do: "note", text: "Ring it." }] }];
      expect(clockRulesWarning(lintPack(Pack.parse(p)))).toBeDefined();
    });

    it("warns when a predicate reads how long a clock has run without declaring clockRules", () => {
      const p = basePack();
      (p as any).moves = {
        ring: {
          label: "Ring",
          available: [{ clockRan: "unit", is: { gte: 1 } }],
          do: [{ do: "note", text: "Ring it." }],
        },
      };
      expect(clockRulesWarning(lintPack(Pack.parse(p)))).toBeDefined();
    });

    it("warns when clockRanOver is buried inside a nested predicate", () => {
      // allOf/anyOf/not wrap the predicates that actually reference a clock,
      // so the walk that finds them has to recurse, not just look one level in.
      const p = basePack();
      (p as any).moves = {
        ring: {
          label: "Ring",
          available: [{ allOf: [{ not: { clockRanOver: "unit", is: { gte: 2 } } }] }],
          do: [{ do: "note", text: "Ring it." }],
        },
      };
      expect(clockRulesWarning(lintPack(Pack.parse(p)))).toBeDefined();
    });

    it("stays quiet about clockRules once it is declared", () => {
      const p = basePack();
      p.capabilities = ["deferredTriggers", "clockRules"];
      (p as any).triggers = [{ on: "onTimerExpired", do: [{ do: "note", text: "Ring it." }] }];
      expect(clockRulesWarning(lintPack(Pack.parse(p)))).toBeUndefined();
    });

    it("does not ask for clockRules from an ordinary clock, only from the extra vocabulary", () => {
      // Running a clock at all is `timers`; onTimerExpired and clockRan/clockRanOver
      // are the separate, additive capability this feature introduces.
      const p = basePack();
      p.capabilities = ["timers"];
      (p as any).unit = { clock: { kind: "timer", minutes: 5 } };
      expect(clockRulesWarning(lintPack(Pack.parse(p)))).toBeUndefined();
    });
  });
});

describe("parsePack gates", () => {
  it("refuses an unknown schema version rather than guessing", () => {
    const p = basePack();
    p.schemaVersion = 99;
    const result = parsePack(p);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("pack/unsupported-schema-version");
  });

  it("refuses a pack requiring a capability this build lacks", () => {
    const p = basePack();
    p.capabilities = ["timeTravel"];
    const result = parsePack(p);
    expect(result.ok).toBe(false);
    // Rejected at the schema layer, since the capability enum is closed.
    expect(result.diagnostics.some((x) => x.path.startsWith("capabilities"))).toBe(true);
  });

  it("rejects unknown top-level keys instead of silently ignoring them", () => {
    const p = basePack();
    (p as any).housRules = { typo: true };
    const result = parsePack(p);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(parsePack("nope").ok).toBe(false);
    expect(parsePack(null).ok).toBe(false);
  });
});
