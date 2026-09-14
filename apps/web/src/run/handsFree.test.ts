import { describe, expect, it } from "vitest";
import type { Step } from "@runlog/rules-schema";
import { closesTheUnit, startsItself } from "./handsFree.ts";

/**
 * Hands-free takes two presses out of a unit, and the whole risk of it is
 * taking a third by accident. A press that carries a decision, or a press
 * the *game* was owed, has to survive; so the cases below are mostly the
 * ones where the answer is no.
 */

const roll: Step = { kind: "rollTable", table: "call", optional: false };
const close: Step = { kind: "finalizeUnit" };
const closeWithConfirm: Step = { kind: "finalizeUnit", confirm: ["The call was honored."] };

const asked = {
  handsFree: true,
  live: true,
  settled: true,
  step: close as Step | null,
  owed: 0,
  thresholds: 0,
  globals: 0,
};

describe("a step that starts itself", () => {
  it("is a table roll, which asks nothing before it runs", () => {
    expect(startsItself(roll)).toBe(true);
  });

  it("is nothing that takes something typed, ticked, or chosen", () => {
    expect(startsItself({ kind: "declareSubject" })).toBe(false);
    expect(startsItself({ kind: "manual", label: "Mix it" })).toBe(false);
    expect(startsItself(close)).toBe(false);
    expect(startsItself({ kind: "actions", do: [] })).toBe(false);
  });
});

describe("reading the result closing the unit", () => {
  it("does, when the only thing left is a close with nothing to confirm", () => {
    expect(closesTheUnit(asked)).toBe(true);
  });

  it("does not, in a pack that never asked for it", () => {
    expect(closesTheUnit({ ...asked, handsFree: false })).toBe(false);
  });

  it("does not while the step is still asking something", () => {
    expect(closesTheUnit({ ...asked, settled: false })).toBe(false);
  });

  it("does not for a watcher, or once the run has ended", () => {
    expect(closesTheUnit({ ...asked, live: false })).toBe(false);
  });

  it("does not when the step ahead is not the closing one", () => {
    expect(closesTheUnit({ ...asked, step: roll })).toBe(false);
    expect(closesTheUnit({ ...asked, step: null })).toBe(false);
  });

  it("does not when the close has something to confirm, which is a decision", () => {
    expect(closesTheUnit({ ...asked, step: closeWithConfirm })).toBe(false);
  });

  it("does not while anything is owed, or the game has something left to do", () => {
    expect(closesTheUnit({ ...asked, owed: 1 })).toBe(false);
    expect(closesTheUnit({ ...asked, thresholds: 1 })).toBe(false);
    expect(closesTheUnit({ ...asked, globals: 1 })).toBe(false);
  });
});
