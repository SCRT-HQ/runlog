import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As in `press.test.ts`: `setup.ts` reaches the store through `../plugin.ts`,
// which registers every action and opens a wire. Only the setup key is under test.
const mock = vi.hoisted(() => ({ pressed: [] as unknown[] }));
vi.mock("../plugin.ts", () => ({
  store: { state: { runs: [], pinned: null, snapshot: null }, dispatch: () => {}, subscribe: () => () => {} },
  sayWho: async () => {},
  wire: {
    press: (p: unknown) => {
      mock.pressed.push(p);
      return "r1";
    },
  },
}));

const { Setup } = await import("./setup.ts");

const key = (alerts: string[]) => ({
  id: "a1",
  isKey: () => true,
  isDial: () => false,
  showAlert: async () => {
    alerts.push("alert");
  },
  showOk: async () => {},
});

describe("pressing the setup key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.pressed = [];
  });
  afterEach(() => vi.useRealTimers());

  it("answers with the setup it was set to", async () => {
    const settings = { setup: { id: "leveling", title: "Leveling" } };
    await new Setup().onKeyDown({ action: key([]), payload: { settings } } as never);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { setup: "leveling" } }]);
  });

  it("alerts and sends nothing with no setup chosen", async () => {
    const alerts: string[] = [];
    await new Setup().onKeyDown({ action: key(alerts), payload: { settings: {} } } as never);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });
});
