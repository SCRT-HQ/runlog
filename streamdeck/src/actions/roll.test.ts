import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As in `press.test.ts`: `roll.ts` reaches the store through `../plugin.ts`,
// which registers every action and opens a wire. Only the roll key is under test.
const mock = vi.hoisted(() => ({ pressed: [] as unknown[], snapshot: null as unknown }));
vi.mock("../plugin.ts", () => ({
  store: {
    get state() {
      return { runs: [], pinned: null, snapshot: mock.snapshot };
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

const { Roll } = await import("./roll.ts");

const key = (alerts: string[]) => ({
  id: "a1",
  isKey: () => true,
  isDial: () => false,
  showAlert: async () => {
    alerts.push("alert");
  },
  showOk: async () => {},
});

describe("pressing the roll key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.pressed = [];
    mock.snapshot = null;
  });
  afterEach(() => vi.useRealTimers());

  it("sends the roll when it is on offer", async () => {
    mock.snapshot = { offer: { primary: { id: "roll", label: "Roll the Weather", kind: "rollTable" } } };
    await new Roll().onKeyDown({ action: key([]) } as never);
    expect(mock.pressed).toEqual([{ press: "primary" }]);
  });

  it("alerts and sends nothing when no roll is on offer", async () => {
    const alerts: string[] = [];
    mock.snapshot = { offer: { primary: { id: "carry-on", label: "Carry on", kind: "move" } } };
    await new Roll().onKeyDown({ action: key(alerts) } as never);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });

  it("alerts with no offer at all", async () => {
    const alerts: string[] = [];
    await new Roll().onKeyDown({ action: key(alerts) } as never);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });
});
