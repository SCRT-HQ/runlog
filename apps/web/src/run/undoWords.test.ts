import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import { undoWords } from "./undoWords.ts";

/**
 * What Undo says it will take back.
 *
 * The naming is the pack's, so a title can only ever repeat a word the pack
 * already wrote. Where the last move is one the pack has no name for, the
 * one app sentence in here is what it says.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

const at = "2026-09-14T00:00:00.000Z";
const started = { id: "e1", t: "RunStarted", at, packId: kiln.id, packVersion: kiln.version, runId: "run1", mode: "standard" };
const log = (...rest: unknown[]) => [started, ...rest] as RunEvent[];

describe("what undo takes back", () => {
  it("says so plainly when there is nothing to take back", () => {
    expect(undoWords(kiln, log())).toBe("Undo the last thing");
  });

  it("names the unit just entered, in the pack's word for one", () => {
    expect(undoWords(kiln, log({ id: "e2", t: "UnitEntered", at }))).toBe(`Undo ${kiln.vocabulary.unit.one} 1`);
    expect(
      undoWords(
        kiln,
        log(
          { id: "e2", t: "UnitEntered", at },
          { id: "e3", t: "StepCompleted", at, phase: "enter", step: 0 },
          { id: "e4", t: "UnitEntered", at },
        ),
      ),
    ).toBe(`Undo ${kiln.vocabulary.unit.one} 2`);
  });

  it("names a roll by the table it was on", () => {
    const events = log(
      { id: "e2", t: "UnitEntered", at },
      { id: "e3", t: "Rolled", at, purpose: "check", dice: "d100", total: 12, values: [12], source: "player" },
    );
    expect(undoWords(kiln, events)).toBe(`Undo ${kiln.tables["check"]!.title}`);
  });

  it("names a step by the label the pack gave it", () => {
    const step = kiln.phases[0]!.steps[0]!;
    if (!("label" in step) || !step.label) throw new Error("the demo pack's first step lost its label");
    const events = log({ id: "e2", t: "UnitEntered", at }, { id: "e3", t: "StepCompleted", at, phase: "enter", step: 0 });
    expect(undoWords(kiln, events)).toBe(`Undo ${step.label}`);
  });

  it("falls back where the pack has no name for the move", () => {
    const events = log({ id: "e2", t: "UnitEntered", at }, { id: "e3", t: "Checked", at, step: "work#0", item: "0", on: true });
    expect(undoWords(kiln, events)).toBe("Undo the last thing");
  });

  it("says nothing about a move already undone", () => {
    const events = log(
      { id: "e2", t: "UnitEntered", at },
      { id: "e3", t: "Rolled", at, purpose: "check", dice: "d100", total: 12, values: [12], source: "player" },
      { id: "e4", t: "Undone", at, ids: ["e3"] },
    );
    expect(undoWords(kiln, events)).toBe(`Undo ${kiln.vocabulary.unit.one} 1`);
  });
});
