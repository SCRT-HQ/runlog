import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As in `press.test.ts`: `setup.ts` reaches the store through `../plugin.ts`,
// which registers every action and opens a wire. Only the setup key is under test.
const mock = vi.hoisted(() => ({ pressed: [] as unknown[], state: {} as Record<string, unknown> }));
vi.mock("../plugin.ts", () => ({
  store: {
    get state() {
      return mock.state;
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

const { Setup } = await import("./setup.ts");
const { HOLD_MS } = await import("./base.ts");

const key = (alerts: string[]) => ({
  id: "a1",
  isKey: () => true,
  isDial: () => false,
  showAlert: async () => {
    alerts.push("alert");
  },
  showOk: async () => {},
  setTitle: async () => {},
  setImage: async () => {},
  getSettings: async () => ({}),
});

/** A press of a given length: down, wait, up. */
async function press(action: ReturnType<typeof key>, settings: object, ms = 0, on = new Setup()): Promise<InstanceType<typeof Setup>> {
  on.onKeyDown({ action, payload: { settings } } as never);
  vi.advanceTimersByTime(ms);
  await on.onKeyUp({ action, payload: { settings } } as never);
  return on;
}

const offering = (...setups: Array<{ id: string; title: string; group: string }>) => ({
  snapshot: { offer: { setups, commands: [] } },
});

describe("a setup key set to one file", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.pressed = [];
    mock.state = { runs: [], pinned: null, snapshot: null };
  });
  afterEach(() => vi.useRealTimers());

  it("answers with the setup it was set to", async () => {
    await press(key([]), { setup: { id: "leveling", title: "Leveling" } });
    expect(mock.pressed).toEqual([{ press: "answer", answer: { setup: "leveling" } }]);
  });

  it("alerts and sends nothing with neither a setup nor a kind chosen", async () => {
    const alerts: string[] = [];
    await press(key(alerts), {});
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });
});

describe("a setup key set to a kind", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.pressed = [];
    mock.state = {
      runs: [],
      pinned: null,
      ...offering(
        { id: "one", title: "One", group: "loadout" },
        { id: "two", title: "Two", group: "loadout" },
        { id: "warp", title: "Warp", group: "warp" },
      ),
    };
  });
  afterEach(() => vi.useRealTimers());

  it("sends nothing on a press, because a press is how it moves", async () => {
    // The whole point of the browsing key: a hand can run through forty
    // loadouts without applying thirty-nine of them on the way.
    await press(key([]), { group: "loadout" });
    expect(mock.pressed).toEqual([]);
  });

  it("applies the one on the face when the key is held", async () => {
    await press(key([]), { group: "loadout" }, HOLD_MS);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { setup: "one" } }]);
  });

  it("applies the next one after a press has moved it on", async () => {
    const on = await press(key([]), { group: "loadout" });
    await press(key([]), { group: "loadout" }, HOLD_MS, on);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { setup: "two" } }]);
  });

  it("wraps past the last one", async () => {
    const on = await press(key([]), { group: "loadout" });
    await press(key([]), { group: "loadout" }, 0, on);
    await press(key([]), { group: "loadout" }, HOLD_MS, on);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { setup: "one" } }]);
  });

  it("only ever offers its own kind", async () => {
    // Two loadouts and one warp are on offer; a loadout key wraps after two
    // rather than reaching the warp.
    const on = await press(key([]), { group: "loadout" });
    await press(key([]), { group: "loadout" }, 0, on);
    await press(key([]), { group: "loadout" }, HOLD_MS, on);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { setup: "one" } }]);
  });

  it("alerts where the run offers nothing of that kind", async () => {
    const alerts: string[] = [];
    await press(key(alerts), { group: "unlocks" }, HOLD_MS);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });

  it("leaves a setup with no kind out, so an older page cannot fill a Warp key with loadouts", async () => {
    mock.state = { runs: [], pinned: null, snapshot: { offer: { setups: [{ id: "old", title: "Old" }], commands: [] } } };
    const alerts: string[] = [];
    await press(key(alerts), { group: "loadout" }, HOLD_MS);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });
});
