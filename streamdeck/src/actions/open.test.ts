import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As in `roll.test.ts`: `open.ts` reaches the store and the address
 * through `../plugin.ts`, which registers every action and opens a wire.
 * The SDK is faked too, because this is the one key that reaches past the
 * software to the streamer's browser.
 */
const mock = vi.hoisted(() => ({
  opened: [] as string[],
  base: "https://runlog.scrthq.com",
  state: { runs: [], pinned: null, snapshot: null } as Record<string, unknown>,
}));
vi.mock("@elgato/streamdeck", () => ({
  default: {
    system: {
      openUrl: (url: string) => {
        mock.opened.push(url);
      },
    },
  },
  action: () => (target: unknown) => target,
  SingletonAction: class {},
}));
vi.mock("../plugin.ts", () => ({
  store: {
    get state() {
      return mock.state;
    },
    dispatch: () => {},
    subscribe: () => () => {},
  },
  sayWho: async () => {},
  apiBase: () => mock.base,
  wire: { press: () => "r1" },
}));

const { Open } = await import("./open.ts");

const key = (alerts: string[]) => ({
  id: "a1",
  isKey: () => true,
  isDial: () => false,
  showAlert: async () => {
    alerts.push("alert");
  },
  showOk: async () => {},
});

const press = async (target: string | undefined, alerts: string[] = []) =>
  new Open().onKeyDown({ action: key(alerts), payload: { settings: target ? { target } : {} } } as never);

describe("pressing the open key", () => {
  beforeEach(() => {
    mock.opened = [];
    mock.base = "https://runlog.scrthq.com";
    mock.state = { runs: [{ id: "s1" }], pinned: null, snapshot: { run: { id: "s1", packId: "demo" } } };
  });

  it("opens the run the deck is following", async () => {
    await press("run");
    expect(mock.opened).toEqual(["https://runlog.scrthq.com/run/s1"]);
  });

  it("opens the guide, whatever the deck is holding", async () => {
    mock.state = { runs: [], pinned: null, snapshot: null };
    await press("guide");
    expect(mock.opened).toEqual(["https://runlog.scrthq.com/guide/stream-deck"]);
  });

  it("opens the pack's rules at the drawer's own address", async () => {
    await press("rules");
    expect(mock.opened).toEqual(["https://runlog.scrthq.com/packs/demo/docs"]);
  });

  it("opens the dock at the address the page copies", async () => {
    await press("dock");
    expect(mock.opened).toEqual(["https://runlog.scrthq.com/dock/controls/s1"]);
  });

  it("opens a new run, which asks nothing of the one the deck is on", async () => {
    mock.state = { runs: [], pinned: null, snapshot: null };
    await press("newrun");
    expect(mock.opened).toEqual(["https://runlog.scrthq.com/create"]);
  });

  it("alerts for the dock when the deck is following no run", async () => {
    const alerts: string[] = [];
    mock.state = { runs: [{ id: "s1" }, { id: "s2" }], pinned: null, snapshot: null };
    await press("dock", alerts);
    expect(mock.opened).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });

  it("opens the copy of Runlog the deck is pointed at", async () => {
    mock.base = "https://runlog.dev.scrthq.com";
    await press("guide");
    await press("run");
    expect(mock.opened).toEqual(["https://runlog.dev.scrthq.com/guide/stream-deck", "https://runlog.dev.scrthq.com/run/s1"]);
  });

  it("alerts and opens nothing with no target chosen", async () => {
    const alerts: string[] = [];
    await press(undefined, alerts);
    expect(mock.opened).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });

  it("alerts for the run when the deck is following none", async () => {
    const alerts: string[] = [];
    mock.state = { runs: [{ id: "s1" }, { id: "s2" }], pinned: null, snapshot: null };
    await press("run", alerts);
    expect(mock.opened).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });

  it("alerts for the rules until a snapshot names the pack", async () => {
    const alerts: string[] = [];
    mock.state = { runs: [{ id: "s1" }], pinned: null, snapshot: null };
    await press("rules", alerts);
    expect(mock.opened).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });

  it("escapes an id that would not sit in an address as it is", async () => {
    mock.state = { runs: [{ id: "a b/c" }], pinned: null, snapshot: null };
    await press("run");
    expect(mock.opened).toEqual(["https://runlog.scrthq.com/run/a%20b%2Fc"]);
  });
});
