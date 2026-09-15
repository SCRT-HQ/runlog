import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As in `setup.test.ts`: `command.ts` reaches the store through `../plugin.ts`,
// which registers every action and opens a wire. Only the command key is under test.
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

const { Command } = await import("./command.ts");

const key = (alerts: string[]) => ({
  id: "a1",
  isKey: () => true,
  isDial: () => false,
  showAlert: async () => {
    alerts.push("alert");
  },
  showOk: async () => {},
});

describe("pressing the command key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.pressed = [];
  });
  afterEach(() => vi.useRealTimers());

  it("answers with the command it was set to", async () => {
    const settings = { command: { id: "start-of-the-dlc", title: "Start of the DLC" } };
    await new Command().onKeyDown({ action: key([]), payload: { settings } } as never);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { command: "start-of-the-dlc" } }]);
  });

  it("alerts and sends nothing with no command chosen", async () => {
    const alerts: string[] = [];
    await new Command().onKeyDown({ action: key(alerts), payload: { settings: {} } } as never);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });
});
