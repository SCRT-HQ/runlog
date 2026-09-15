import { describe, expect, it, vi } from "vitest";

// `metric.ts` pulls in `../plugin.ts` (through `store`), which registers
// every action - a real import here would load the whole plugin just to
// reach a pure function. `nextField` touches none of it.
vi.mock("../plugin.ts", () => ({
  store: { state: { runs: [], pinned: null }, dispatch: () => {}, subscribe: () => () => {} },
  sayWho: async () => {},
  wire: {},
}));

import { nextField } from "./metric.ts";

describe("turning the dial", () => {
  it("steps through the fields and wraps", () => {
    expect(nextField("score", 1)).toBe("unit");
    expect(nextField("leader", 1)).toBe("score");
    expect(nextField("score", -1)).toBe("leader");
  });
});
