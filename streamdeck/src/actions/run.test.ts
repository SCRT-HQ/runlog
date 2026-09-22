import { describe, expect, it, vi } from "vitest";

// `run.ts` pulls in `../plugin.ts` (through the `Run` class and directly),
// which registers every action - a real import here would load the whole
// plugin just to reach a pure function. None of these touch it.
vi.mock("../plugin.ts", () => ({
  store: { state: { runs: [], known: [], pinned: null }, dispatch: () => {}, subscribe: () => () => {} },
  sayWho: async () => {},
  readOpenRuns: async () => {},
  wire: {},
}));

import { choices, nextPin, runsForInspector } from "./run.ts";

describe("cycling runs", () => {
  const runs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("moves to the next held run and wraps", () => {
    expect(nextPin(runs, "a")).toBe("b");
    expect(nextPin(runs, "c")).toBe("a");
  });
  it("starts from the first when nothing is pinned", () => {
    expect(nextPin(runs, null)).toBe("a");
  });
  it("has nothing to cycle to with one run", () => {
    expect(nextPin([{ id: "a" }], "a")).toBe("a");
  });
  it("has nothing to cycle to at all with an empty list", () => {
    // Which is what the key reads as "clear the pin" rather than as a shrug:
    // a deck pinned to a run that ended has an empty list and no other way
    // out of the overlay every one of its keys is showing.
    expect(nextPin([], "a")).toBe(null);
    expect(nextPin([], null)).toBe(null);
  });
});

describe("which runs a press moves between", () => {
  const held = [{ id: "a" }];
  const open = [{ id: "a" }, { id: "b" }];

  it("is the held ones, because those are the ones a press does something with", () => {
    expect(choices({ runs: held, known: open } as never)).toEqual(held);
  });

  it("falls back to everything the account has open, so the key still chooses", () => {
    // A deck in front of a stream that has not started, and a deck whose
    // page has let its run go: in both the held list is empty and there is
    // still a choice worth making.
    expect(choices({ runs: [], known: open } as never)).toEqual(open);
  });

  it("is empty when the account has nothing open either", () => {
    expect(choices({ runs: [], known: [] } as never)).toEqual([]);
  });
});

describe("the picker's list", () => {
  it("puts the held runs first and marks which can be pressed", () => {
    const list = runsForInspector({
      runs: [{ id: "b", name: "Friday" }],
      known: [
        { id: "a", name: "Thursday", packTitle: "The Long Kiln" },
        { id: "b", name: "Friday" },
      ],
    });
    expect(list).toEqual([
      { id: "b", name: "Friday", packTitle: undefined, held: true },
      { id: "a", name: "Thursday", packTitle: "The Long Kiln", held: false },
    ]);
  });

  it("lists a run once when it is in both lists", () => {
    const list = runsForInspector({ runs: [{ id: "a" }], known: [{ id: "a" }] });
    expect(list.map((r) => r.id)).toEqual(["a"]);
  });

  it("offers the account's runs with nothing held at all, which is a deck being set up", () => {
    const list = runsForInspector({ runs: [], known: [{ id: "a", name: "Thursday" }] });
    expect(list).toEqual([{ id: "a", name: "Thursday", packTitle: undefined, held: false }]);
  });
});
