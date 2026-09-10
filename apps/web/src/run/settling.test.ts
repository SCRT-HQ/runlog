import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { constraintLines, type RunState } from "@runlog/engine";
import { settlingFor } from "./owed.ts";

/**
 * What a closing step's confirmation does about each result it lists,
 * read against the pack that exists to carry shapes like this one.
 *
 * The testing pack's `sealed` phase is the shape: the work itself closes
 * the unit, it is held to a table, and its confirmation lists what that
 * same table drew. Everything below is a question about that overlap,
 * which is where this went wrong twice: once by saying a result in two
 * places, and once by hiding the only box that could answer it.
 *
 * The pack's own scenarios cannot reach any of this. They replay events
 * and assert what the engine reduced them to; this is a decision the app
 * makes about what to draw, so it is checked here, against the same pack.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/testing/engine-testing.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the testing pack did not load");
const pack = loaded.pack;

const sealed = pack.phases.find((p) => p.id === "sealed")!;
const step = sealed.steps[0]!;
if (step.kind !== "manual") throw new Error("the sealed phase's step should be the manual one that closes");
const points = step.checklist ?? [];

/** Two results of the constrained table drawn this unit, and what the run owes on them. */
const state = (owes: Array<{ entryId: string; resolved: boolean }>): RunState =>
  ({
    unit: 1,
    subjects: [{ id: 1, unit: 1, removed: false, states: [] }],
    outcomes: [
      { unit: 1, table: "bench", entryId: pack.tables["bench"]!.entries[0]!.id, targetSubject: null },
      { unit: 1, table: "bench", entryId: pack.tables["bench"]!.entries[1]!.id, targetSubject: null },
    ],
    obligations: owes.map((o, i) => ({
      id: `ob${i}`,
      kind: "trigger",
      text: "owed",
      resolved: o.resolved,
      unit: 1,
      ref: { kind: "tableEntry", table: "bench", entryId: o.entryId, index: 0 },
    })),
  }) as unknown as RunState;

const rules = (s: RunState) => constraintLines(pack, s, step.constrainedBy);
const row = (entryId: string) => ({ key: "k", where: "", text: "", table: "bench", entryId });

describe("a closing step held to the same table its confirmation lists", () => {
  const first = pack.tables["bench"]!.entries[0]!.id;
  const second = pack.tables["bench"]!.entries[1]!.id;

  it("shows both results as rules, since the step is held to that table", () => {
    expect(rules(state([])).map((l) => l.entryId)).toEqual([first, second]);
  });

  it("leaves nothing for the confirmation to list: every rule answers itself", () => {
    const s = state([]);
    const settling = settlingFor(pack, s, rules(s), points);
    // Both are rules, and both have a box on them, so neither is listed again.
    expect(settling.hidden!(row(first))).toBe(true);
    expect(settling.answered!(row(first))).toBe(true);
    expect(settling.answered!(row(second))).toBe(true);
  });

  it("hands a rule the game owes on the move, and one it does not the tick", () => {
    const s = state([{ entryId: first, resolved: false }]);
    const settling = settlingFor(pack, s, rules(s), points);
    expect(settling.owing(row(first))).toBe(true);
    expect(settling.settled(row(first))).toBe(false);
    // The other is nobody's but the player's, and its box is on its rule.
    expect(settling.owing(row(second))).toBe(false);
    expect(settling.answered!(row(second))).toBe(true);
  });

  it("counts a trigger that has run as settled, without a tick", () => {
    const s = state([{ entryId: first, resolved: true }]);
    const settling = settlingFor(pack, s, rules(s), points);
    expect(settling.settled(row(first))).toBe(true);
    expect(settling.owing(row(first))).toBe(false);
  });

  it("points a rule's tick at the box the confirmation was asking in", () => {
    const s = state([]);
    const settling = settlingFor(pack, s, rules(s), points);
    // The point that shows the table is the first of the step's checklist,
    // and the results are the first two outcomes of the run.
    expect(settling.boxes.get(`bench/${first}`)).toEqual(["0:o0"]);
    expect(settling.boxes.get(`bench/${second}`)).toEqual(["0:o1"]);
  });

  it("says nothing about a result of a table this step is not held to", () => {
    const s = state([]);
    const settling = settlingFor(pack, s, rules(s), points);
    const elsewhere = { key: "k", where: "", text: "", table: "duel", entryId: "anything" };
    expect(settling.hidden!(elsewhere)).toBe(false);
    expect(settling.answered!(elsewhere)).toBe(false);
    expect(settling.owing(elsewhere)).toBe(false);
  });
});
