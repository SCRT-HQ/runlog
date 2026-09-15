import { describe, expect, it, vi } from "vitest";

// `run.ts` pulls in `../plugin.ts` (through the `Run` class and directly),
// which registers every action - a real import here would load the whole
// plugin just to reach a pure function. `nextPin` touches none of it.
vi.mock("../plugin.ts", () => ({
  store: { state: { runs: [], pinned: null }, dispatch: () => {}, subscribe: () => () => {} },
  sayWho: async () => {},
  wire: {},
}));

import { nextPin } from "./run.ts";

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
});
