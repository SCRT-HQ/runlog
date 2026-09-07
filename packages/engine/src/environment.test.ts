import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import {
  baseName,
  describeDifference,
  externalName,
  reconcile,
  type ExternalSubject,
} from "./environment.ts";
import type { RunEvent } from "./events.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}
const kiln = loadPack("packs/demo/pack.yaml");

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent =>
  ({ t, at: NOW, ...props }) as RunEvent;

/** A run in which `names` were made, in order. */
function run(names: string[], extra: RunEvent[] = []) {
  const log: RunEvent[] = [
    ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
  ];
  for (const name of names) {
    log.push(ev("UnitEntered"), ev("SubjectDeclared", { subjectType: name }), ev("UnitFinalized"));
  }
  return reduce(kiln, [...log, ...extra]);
}

/** What the environment reports, in the order it reports it. */
const out = (...names: string[]): ExternalSubject[] =>
  names.map((name, i) => ({ id: `t${i + 1}`, name, index: i + 1 }));

const kinds = (pack: Pack, state: ReturnType<typeof run>, external: ExternalSubject[]) =>
  reconcile(pack, state, external).differences.map((d) => d.kind);

describe("reconciling the run against the world outside it", () => {
  it("says nothing when the two agree", () => {
    const state = run(["Tall vase", "Lidded jar"]);
    expect(kinds(kiln, state, out("Tall vase", "Lidded jar"))).toEqual([]);
  });

  it("matches through the state marks the app asks you to write", () => {
    // The board's own label carries its states in brackets. A track named that
    // way is the *same* track, not a different one.
    const state = run(["Tall vase"], [ev("StateApplied", { state: "sealed", subject: 1 })]);
    const expected = externalName(kiln, state.subjects[0]!);
    expect(expected).toContain("[");
    expect(kinds(kiln, state, out(expected))).toEqual([]);
  });

  it("notices a name that has drifted from what the board says", () => {
    const state = run(["Tall vase"], [ev("StateApplied", { state: "sealed", subject: 1 })]);
    const diffs = reconcile(kiln, state, out("Tall vase")).differences;
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ kind: "nameDrift", subject: 1 });
    expect(describeDifference(kiln, diffs[0]!)).toContain("the board says");
  });

  it("reports something the run made that is not out there", () => {
    const state = run(["Tall vase", "Lidded jar"]);
    const diffs = reconcile(kiln, state, out("Tall vase")).differences;
    expect(diffs).toEqual([{ kind: "missingOutside", subject: 2, expected: "Lidded jar" }]);
  });

  it("reports something out there the run has never heard of", () => {
    const state = run(["Tall vase"]);
    const diffs = reconcile(kiln, state, out("Tall vase", "Reference track")).differences;
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ kind: "unknownInside" });
  });

  /**
   * The difference that actually costs a player something. Anchored-offset
   * targeting counts positions: if the run and the session disagree about the
   * order, the app shows its working, the working is internally consistent,
   * and it lands on the wrong thing.
   */
  it("reports an order the run and the environment disagree about", () => {
    const state = run(["Tall vase", "Lidded jar"]);
    const diffs = reconcile(kiln, state, out("Lidded jar", "Tall vase")).differences;
    expect(diffs.every((d) => d.kind === "outOfOrder")).toBe(true);
    expect(diffs).toHaveLength(2);
    expect(describeDifference(kiln, diffs[0]!)).toContain("Targeting counts positions");
  });

  it("does not let an unrelated track make everything after it look misplaced", () => {
    // A reference track or a bus sits in the session without being part of the
    // game. Order is compared only among the things both sides know about.
    const state = run(["Tall vase", "Lidded jar"]);
    const external: ExternalSubject[] = [
      { id: "ref", name: "Reference", index: 1 },
      { id: "t1", name: "Tall vase", index: 2 },
      { id: "t2", name: "Lidded jar", index: 3 },
    ];
    expect(kinds(kiln, state, external)).toEqual(["unknownInside"]);
  });

  it("ignores a subject the game has taken out of play", () => {
    // Removed on purpose: an environment that no longer holds it agrees.
    const state = run(["Tall vase", "Lidded jar"], [ev("SubjectRemoved", { subject: 2 })]);
    expect(kinds(kiln, state, out("Tall vase"))).toEqual([]);
  });

  it("says nothing about a subject not yet declared", () => {
    // Nothing to match on until the player has said what it is.
    const state = run(["Tall vase"], [ev("UnitEntered")]);
    expect(state.subjects).toHaveLength(2);
    expect(kinds(kiln, state, out("Tall vase"))).toEqual([]);
  });

  it("does not match two subjects to one track", () => {
    // Two Pieces genuinely called the same thing; one track for them both.
    const state = run(["Bowl", "Bowl"]);
    const diffs = reconcile(kiln, state, out("Bowl")).differences;
    expect(diffs).toEqual([{ kind: "missingOutside", subject: 2, expected: "Bowl" }]);
  });

  it("is not thrown by case or stray whitespace", () => {
    const state = run(["Tall vase"]);
    expect(kinds(kiln, state, out("  TALL VASE  "))).toEqual(["nameDrift"]);
  });

  it("hands back the pairs it matched, for anything that needs both ids", () => {
    const state = run(["Tall vase", "Lidded jar"]);
    const { matched } = reconcile(kiln, state, out("Tall vase", "Lidded jar"));
    expect(matched).toEqual([
      { subject: 1, external: { id: "t1", name: "Tall vase", index: 1 } },
      { subject: 2, external: { id: "t2", name: "Lidded jar", index: 2 } },
    ]);
  });
});

describe("baseName", () => {
  it("strips the state marks the label carries", () => {
    expect(baseName("Tall vase [SLD]")).toBe("tall vase");
    expect(baseName("  Lidded jar  ")).toBe("lidded jar");
    expect(baseName("Bowl")).toBe("bowl");
  });
});
