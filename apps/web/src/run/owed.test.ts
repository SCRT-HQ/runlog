import { describe, expect, it } from "vitest";
import type { Pack } from "@runlog/rules-schema";
import { owedOn, settleWords, settledOn, stillOwed, thresholdWords } from "./owed.ts";

/**
 * The word on an owed thing's button. "Resolve" read as confirming that
 * somebody had already seen to it; the button is where the trigger runs,
 * so it says what pressing it will do.
 */
const pack = {
  tables: {
    mutation: {
      resolution: "lookup",
      title: "Mutation",
      roll: "d100",
      entries: [
        {
          id: "cull",
          range: [88, 88],
          text: "Upon finalizing, roll d6.",
          triggers: [
            {
              on: "onFinalize",
              label: "Delete half?",
              do: [
                { do: "roll", dice: "d6", into: "cull" },
                { do: "branch", on: "cull", cases: [{ in: [4, 5, 6], then: [{ do: "note", text: "Delete half." }] }] },
              ],
            },
          ],
        },
        {
          id: "mark",
          range: [1, 1],
          text: "Mark it.",
          triggers: [{ on: "onFinalize", do: [{ do: "modCounter", counter: "dread", by: 1 }] }],
        },
        {
          id: "pick",
          range: [2, 2],
          text: "Choose one.",
          triggers: [{ on: "onFinalize", do: [{ do: "prompt", kind: "chooseSubject", label: "Which?" }] }],
        },
      ],
    },
  },
  counters: {
    dread: { label: "Dread", initial: 0, triggers: [{ when: { gte: 3 }, label: "The reckoning", do: [{ do: "rollOn", table: "mutation" }] }] },
  },
} as unknown as Pack;

const ref = (entryId: string) => ({ kind: "trigger", ref: { kind: "tableEntry" as const, table: "mutation", entryId, index: 0 } });

describe("what an owed thing's button says", () => {
  it("names the dice where settling it rolls some", () => {
    expect(settleWords(pack, ref("cull"))).toBe("Roll d6");
  });

  it("says a choice is coming where it is a choice", () => {
    expect(settleWords(pack, ref("pick"))).toBe("Choose");
  });

  it("applies what asks nothing of the player", () => {
    expect(settleWords(pack, ref("mark"))).toBe("Apply it");
  });

  it("says nothing of a note but that it is done by hand", () => {
    expect(settleWords(pack, { kind: "note" })).toBe("Apply it");
  });

  it("reads a counter's trigger the same way, through the table it rolls on", () => {
    expect(thresholdWords(pack, "dread", 0)).toBe("Roll d100");
  });
});

describe("what the game owes on a result, and what it has paid", () => {
  const state = (obligations: unknown[]) => ({ obligations }) as never;
  const on = { table: "mutation", entryId: "cull" };
  const trigger = (resolved: boolean, entryId = "cull") => ({
    id: `o:${entryId}:${resolved}`,
    kind: "trigger",
    resolved,
    ref: { kind: "tableEntry", table: "mutation", entryId, index: 0 },
  });

  it("owes on a result whose trigger has not run", () => {
    const owed = owedOn(state([trigger(false)]));
    expect(stillOwed(owed, on)).toBe(true);
    expect(settledOn(owed, on)).toBe(false);
  });

  it("has paid once it has run", () => {
    const owed = owedOn(state([trigger(true)]));
    expect(stillOwed(owed, on)).toBe(false);
    expect(settledOn(owed, on)).toBe(true);
  });

  it("still owes where the same result was drawn twice and only one is paid", () => {
    const owed = owedOn(state([trigger(true), trigger(false)]));
    expect(stillOwed(owed, on)).toBe(true);
  });

  it("says nothing about a result the pack hung nothing on", () => {
    const owed = owedOn(state([trigger(false, "other")]));
    expect(stillOwed(owed, on)).toBe(false);
    expect(settledOn(owed, on)).toBe(false);
    // A note is the player's to tick off, not the game's to settle.
    expect(owedOn(state([{ id: "n", kind: "note", resolved: false }])).size).toBe(0);
  });
});
