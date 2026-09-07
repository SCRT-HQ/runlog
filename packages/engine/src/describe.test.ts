import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Phase } from "@runlog/rules-schema";
import { describePredicate, describeSkip } from "./describe.ts";
import { phaseSkipped } from "./flow.ts";
import { reduce } from "./reduce.ts";
import type { RunEvent } from "./events.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

describe("a predicate, in prose", () => {
  it("says the unit number the way a player counts", () => {
    expect(describePredicate(kiln, { unitIndex: { gte: 2 } })).toBe("after the first stage");
    expect(describePredicate(kiln, { unitIndex: { lte: 1 } })).toBe("during the first stage");
    expect(describePredicate(kiln, { unitIndex: { gte: 3 } })).toBe("from Stage 3 on");
    expect(describePredicate(kiln, { unitIndex: { eq: 4 } })).toBe("in Stage 4");
  });

  it("names counters and states by their labels", () => {
    const counter = Object.keys(kiln.counters ?? {})[0]!;
    const label = kiln.counters![counter]!.label;
    expect(describePredicate(kiln, { counter, is: { gte: 5 } })).toBe(`${label} is 5 or more`);
    const state = Object.keys(kiln.states ?? {})[0]!;
    expect(describePredicate(kiln, { subjectHasState: state, of: "run" })).toContain("the firing is");
  });

  it("joins alternatives with or, and negates in plain words", () => {
    expect(describePredicate(kiln, { anyOf: [{ unitIndex: { eq: 1 } }, { unitIndex: { eq: 2 } }] })).toBe(
      "in Stage 1 or in Stage 2",
    );
    expect(describePredicate(kiln, { not: { flag: "cold" } })).toBe("it is not the case that cold is on");
  });
});

describe("why a phase is out of play", () => {
  const phase: Phase = {
    id: "wedging",
    label: "Wedging",
    skipWhen: [{ unitIndex: { gte: 2 } }],
    steps: [{ kind: "manual", label: "Roll on the class table" }],
  };

  it("is a sentence for a tooltip", () => {
    expect(describeSkip(kiln, phase)).toBe("Wedging is skipped after the first stage.");
  });

  it("is nothing for a phase that always plays", () => {
    expect(describeSkip(kiln, { ...phase, skipWhen: undefined })).toBeNull();
  });

  it("agrees with the flow about when the skip applies", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const events: RunEvent[] = [
      { t: "RunStarted", at, packId: kiln.id, packVersion: kiln.version, mode: kiln.defaultMode },
      { t: "UnitEntered", at },
    ];
    const first = reduce(kiln, events);
    expect(phaseSkipped(kiln, first, phase)).toBe(false);
    const second = reduce(kiln, [...events, { t: "UnitFinalized", at }, { t: "UnitEntered", at }]);
    expect(phaseSkipped(kiln, second, phase)).toBe(true);
  });
});
