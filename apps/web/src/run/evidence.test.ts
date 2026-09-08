import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import type { RunState } from "@runlog/engine";
import { allMade, evidenceFor, pointMade, pointOf } from "./evidence.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

const constraint = kiln.tables["constraint"]!;
const setback = kiln.tables["setback"]!;

/** A run at stage 2 with one piece per stage and a few results on the books. */
const state = {
  unit: 2,
  subjects: [
    { id: 1, unit: 1, type: "a vase", name: null, states: [], finalized: true, removed: false, createdAt: "" },
    { id: 2, unit: 2, type: "a plate", name: null, states: [], finalized: false, removed: false, createdAt: "" },
  ],
  outcomes: [
    { unit: 1, table: "constraint", entryId: constraint.entries[0]!.id, targetSubject: null, at: "" },
    { unit: 2, table: "constraint", entryId: constraint.entries[1]!.id, targetSubject: null, at: "" },
    { unit: 2, table: "setback", entryId: setback.entries[0]!.id, targetSubject: 1, at: "" },
    { unit: 2, table: "setback", entryId: setback.entries[1]!.id, targetSubject: 2, at: "" },
  ],
} as unknown as RunState;

describe("what a point shows", () => {
  it("reads a plain string as a point with nothing to show", () => {
    expect(pointOf("Do the thing.")).toEqual({ text: "Do the thing." });
  });

  it("lists this unit's results from the named table", () => {
    const shown = evidenceFor(kiln, state, { table: "constraint", scope: "unit" });
    expect(shown.map((s) => s.text)).toEqual([constraint.entries[1]!.title ?? constraint.entries[1]!.text]);
    expect(shown[0]!.where).toBe(`Stage 2, ${constraint.title}`);
  });

  it("lists what reached this unit's subject, and says which", () => {
    const shown = evidenceFor(kiln, state, { table: "setback", scope: "subject" });
    expect(shown).toHaveLength(1);
    expect(shown[0]!.where).toContain("piece #2");
  });

  it("lists everything in the run when asked", () => {
    expect(evidenceFor(kiln, state, { table: "constraint", scope: "run" })).toHaveLength(2);
  });

  it("gathers from several tables when the point names them, in the order they were rolled", () => {
    const both = evidenceFor(kiln, state, { table: ["constraint", "setback"], scope: "run" });
    expect(both).toHaveLength(4);
    expect(both.map((s) => s.where)).toEqual(expect.arrayContaining([expect.stringContaining("Setback"), expect.stringContaining("Constraint")]));
  });
});

describe("when a checklist is done", () => {
  const points = [{ text: "plain" }, { text: "with evidence", shows: { table: "constraint", scope: "unit" as const } }];
  const evidence = [[], [{ key: "o1", where: "", text: "" }, { key: "o2", where: "", text: "" }]];

  it("needs a plain point's own box", () => {
    expect(pointMade(0, [], new Set())).toBe(false);
    expect(pointMade(0, [], new Set(["0"]))).toBe(true);
  });

  it("makes a point with evidence when all of its evidence is ticked, never by its own box", () => {
    expect(pointMade(1, evidence[1]!, new Set(["1"]))).toBe(false);
    expect(pointMade(1, evidence[1]!, new Set(["1:o1"]))).toBe(false);
    expect(pointMade(1, evidence[1]!, new Set(["1:o1", "1:o2"]))).toBe(true);
  });

  it("is done when every point is made", () => {
    expect(allMade(points, evidence, new Set(["0", "1:o1"]))).toBe(false);
    expect(allMade(points, evidence, new Set(["0", "1:o1", "1:o2"]))).toBe(true);
  });

  it("falls back to the point's own box when there was nothing to show", () => {
    // A stage with no constraint rolled still has to be affirmable.
    expect(allMade(points, [[], []], new Set(["0", "1"]))).toBe(true);
  });
});
