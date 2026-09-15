import { describe, expect, it, vi } from "vitest";

// As in `roll.test.ts`: `undo.ts` reaches the wire through `../plugin.ts`,
// which registers every action and opens a socket. Only the undo key is
// under test.
const mock = vi.hoisted(() => ({ pressed: [] as unknown[] }));
vi.mock("../plugin.ts", () => ({
  store: {
    get state() {
      return { on: true, flash: null };
    },
    dispatch: () => {},
    subscribe: () => () => {},
  },
  sayWho: async () => {},
  wire: {
    press: (p: unknown) => {
      mock.pressed.push(p);
      return "r1";
    },
  },
}));

const { Undo } = await import("./undo.ts");

const key = () => ({ id: "a1", isKey: () => true, isDial: () => false, showOk: async () => {}, showAlert: async () => {} });

describe("pressing the undo key", () => {
  it("asks the run to take back the last result", async () => {
    await new Undo().onKeyDown({ action: key() } as never);
    expect(mock.pressed).toEqual([{ press: "undo" }]);
  });
});
