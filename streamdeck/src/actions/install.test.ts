import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The key that builds a profile for any pack the account holds.
 *
 * Everything it reaches outside is faked: the library routes, the Stream
 * Deck app's profile folder, and the generator's own file write. What is
 * held here is which of the two sources a press reads - the run the deck is
 * on, or the pack file off the account - and how the picker is filled.
 */
const mock = vi.hoisted(() => ({
  opened: [] as string[],
  logged: [] as string[],
  sent: [] as Array<Record<string, unknown>>,
  state: { snapshot: null } as Record<string, unknown>,
  /** The packs the account is holding, and the profiles the app already has. */
  packs: [] as Array<{ id: string; title: string }>,
  installed: [] as Array<{ name: string }>,
  /** The pack file the account answers with, or nothing for one it has not synced. */
  pack: null as { id: string; title: string } | null,
  fetched: [] as string[],
}));
vi.mock("@elgato/streamdeck", () => ({
  default: {
    system: {
      openUrl: (url: string) => {
        mock.opened.push(url);
      },
    },
    logger: {
      info: (line: string) => {
        mock.logged.push(line);
      },
    },
    ui: {
      sendToPropertyInspector: async (m: Record<string, unknown>) => {
        mock.sent.push(m);
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
  apiBase: () => "https://runlog.test",
  wire: { press: () => "r1" },
}));
vi.mock("../library.ts", () => ({
  libraryPacks: async () => mock.packs,
  fetchPack: async (_base: string, id: string) => {
    mock.fetched.push(id);
    return mock.pack;
  },
}));
vi.mock("../installed.ts", () => ({
  installedProfiles: () => mock.installed,
  hasProfileFor: (pack: { title?: string }, profiles: Array<{ name: string }>) => profiles.some((p) => p.name === pack.title),
}));
// The generator writes a file beside the plugin; what comes out of it is
// `profiles-on-demand.test.ts`, and what is held here is that it was asked.
vi.mock("node:fs", () => ({
  mkdirSync: () => {},
  writeFileSync: () => {},
}));

const { Install } = await import("./install.ts");

const key = (alerts: string[], oks: string[]) => ({
  id: "a1",
  device: { type: 2 },
  isKey: () => true,
  isDial: () => false,
  showAlert: async () => {
    alerts.push("alert");
  },
  showOk: async () => {
    oks.push("ok");
  },
});

const press = async (pack: { id: string; title: string } | undefined, alerts: string[] = [], oks: string[] = []) =>
  new Install().onKeyDown({ action: key(alerts, oks), payload: { settings: pack ? { pack } : {} } } as never);

/** A snapshot of a run of this pack, with a layout to build from. */
const onRun = (packId: string) => ({
  snapshot: {
    run: { id: "s1", packId, packTitle: "Ember Trail" },
    offer: { moves: [{ id: "push-on" }], setups: [{ id: "com.example.setups.starter", title: "Starter kit" }] },
    layout: { moves: [{ id: "push-on" }, { id: "hold" }], counters: [], resources: [] },
  },
});

describe("pressing the install key", () => {
  beforeEach(() => {
    mock.opened = [];
    mock.logged = [];
    mock.fetched = [];
    mock.state = { snapshot: null };
    mock.pack = null;
  });

  it("alerts with no pack chosen", async () => {
    const alerts: string[] = [];
    await press(undefined, alerts);
    expect(alerts).toEqual(["alert"]);
    expect(mock.opened).toEqual([]);
  });

  it("builds from the run where the deck is on one of that pack", async () => {
    mock.state = onRun("com.example.ember-trail");
    const oks: string[] = [];
    await press({ id: "com.example.ember-trail", title: "Ember Trail" }, [], oks);

    // The pack file was never asked for: the run has the layout and the
    // setups, which is more than the file carries.
    expect(mock.fetched).toEqual([]);
    expect(oks).toEqual(["ok"]);
    expect(decodeURIComponent(mock.opened[0]!)).toContain("com.example.ember-trail-xl.streamDeckProfile");
  });

  it("fetches the pack where the deck is on another run, or none", async () => {
    mock.state = onRun("com.example.salt-and-signal");
    mock.pack = { id: "com.example.ember-trail", title: "Ember Trail", moves: { "push-on": {} } } as never;
    const oks: string[] = [];
    await press({ id: "com.example.ember-trail", title: "Ember Trail" }, [], oks);

    expect(mock.fetched).toEqual(["com.example.ember-trail"]);
    expect(oks).toEqual(["ok"]);
    expect(decodeURIComponent(mock.opened[0]!)).toContain("com.example.ember-trail-xl.streamDeckProfile");
  });

  it("alerts and says why for a pack the account has not synced", async () => {
    const alerts: string[] = [];
    await press({ id: "com.example.only-here", title: "Only Here" }, alerts);

    expect(alerts).toEqual(["alert"]);
    expect(mock.opened).toEqual([]);
    expect(mock.logged.filter((l) => l.includes("not synced"))).toHaveLength(1);
  });
});

describe("the picker the install key's settings show", () => {
  it("splits the library by whether the app already has a profile", async () => {
    mock.sent = [];
    mock.packs = [
      { id: "com.example.ember-trail", title: "Ember Trail" },
      { id: "com.example.salt-and-signal", title: "Salt and Signal" },
    ];
    mock.installed = [{ name: "Salt and Signal copy" }, { name: "Salt and Signal" }];

    await new Install().onPropertyInspectorDidAppear();

    const packs = mock.sent.find((m) => m.t === "packs")!;
    expect(packs.without).toEqual([{ id: "com.example.ember-trail", title: "Ember Trail" }]);
    expect(packs.with).toEqual([{ id: "com.example.salt-and-signal", title: "Salt and Signal" }]);
  });
});
