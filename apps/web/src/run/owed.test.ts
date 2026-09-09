import { describe, expect, it } from "vitest";
import type { Pack } from "@runlog/rules-schema";
import { settleWords, thresholdWords } from "./owed.ts";

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
