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
  /** Every event the key pushed into the store, which is how it flashes. */
  dispatched: [] as Array<Record<string, unknown>>,
  /** The pack file the account answers with, or nothing and the reason why. */
  pack: null as { id: string; title: string } | null,
  why: "unsynced" as string,
  fetched: [] as string[],
  /** The deck and the profile the key asked the app to switch to. */
  switched: [] as Array<[string, string]>,
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
    profiles: {
      switchToProfile: async (device: string, name: string) => {
        mock.switched.push([device, name]);
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
    dispatch: (e: Record<string, unknown>) => {
      mock.dispatched.push(e);
    },
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
    return mock.pack ? { ok: true, pack: mock.pack } : { ok: false, why: mock.why, say: `${mock.why} here` };
  },
}));
vi.mock("../installed.ts", () => ({
  installedProfiles: () => mock.installed,
  hasProfileFor: (pack: { title?: string }, profiles: Array<{ name: string }>) => profiles.some((p) => p.name === pack.title),
  installedFor: (pack: { title?: string }, profiles: Array<{ name: string }>) =>
    profiles.some((p) => p.name === pack.title) ? "imported" : null,
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
  device: { id: "deck-1", type: 2 },
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
    mock.why = "unsynced";
    mock.dispatched = [];
    mock.installed = [];
    mock.switched = [];
  });

  it("alerts with no pack chosen, and says so in the log", async () => {
    const alerts: string[] = [];
    await press(undefined, alerts);
    expect(alerts).toEqual(["alert"]);
    expect(mock.opened).toEqual([]);
    expect(mock.logged.filter((l) => l.includes("no pack set"))).toHaveLength(1);
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

  it("alerts and says which way it went wrong, not just that it did", async () => {
    for (const why of ["unsynced", "deleted", "unreadable", "unreachable"]) {
      mock.logged = [];
      mock.why = why;
      const alerts: string[] = [];
      await press({ id: "com.example.only-here", title: "Only Here" }, alerts);

      expect(alerts).toEqual(["alert"]);
      expect(mock.opened).toEqual([]);
      expect(mock.logged.filter((l) => l.includes(why))).toHaveLength(1);
    }
  });

  it("falls back to the pack file when the run has nothing to lay out yet", async () => {
    // Attached to a run of this pack, but its snapshot names no pack at
    // all yet, so the run build comes back with nothing. The pack file
    // covers exactly that.
    mock.state = { snapshot: { run: { id: "s1", packId: "com.example.ember-trail" }, offer: {} } };
    mock.pack = { id: "com.example.ember-trail", title: "Ember Trail", moves: { "push-on": {} } } as never;
    const oks: string[] = [];
    await press({ id: "com.example.ember-trail", title: "Ember Trail" }, [], oks);

    expect(mock.fetched).toEqual(["com.example.ember-trail"]);
    expect(oks).toEqual(["ok"]);
  });

  it("says the app will make a copy where the pack already had a profile", async () => {
    mock.state = onRun("com.example.ember-trail");
    mock.installed = [{ name: "Ember Trail" }];
    const oks: string[] = [];
    await press({ id: "com.example.ember-trail", title: "Ember Trail" }, [], oks);

    // Handed over all the same: the second picker is there to reinstall,
    // and the app is the one that decides what to call what it imports.
    expect(oks).toEqual(["ok"]);
    expect(mock.opened).toHaveLength(1);
    // And the key says so, through the flash every other key uses.
    // The ref names the key that was pressed, so a second Install key set
    // to another pack is not made to say what happened on this one.
    expect(mock.dispatched).toEqual([{ t: "drove", ref: "imported-as-copy:a1", ok: true }]);
    expect(mock.logged.filter((l) => l.includes("name this one a copy"))).toHaveLength(1);
  });

  it("says nothing of the sort where the pack had none", async () => {
    mock.state = onRun("com.example.ember-trail");
    const oks: string[] = [];
    await press({ id: "com.example.ember-trail", title: "Ember Trail" }, [], oks);
    expect(oks).toEqual(["ok"]);
    expect(mock.dispatched).toEqual([]);
  });

  it("switches to the shipped profile for a pack that ships one, and hands nothing over", async () => {
    // The Stream Deck app installs a profile the plugin declares the first
    // time a deck is put on it, so there is nothing to build and nothing
    // for the streamer to import. Building here would leave them two
    // profiles for one pack.
    const oks: string[] = [];
    await press({ id: "com.scrthq.runlog.long-kiln", title: "The Long Kiln" }, [], oks);

    expect(mock.switched).toEqual([["deck-1", "profiles/demo-xl"]]);
    expect(mock.opened).toEqual([]);
    expect(mock.fetched).toEqual([]);
    expect(oks).toEqual(["ok"]);
    // And the key says where the profile came from, through the flash the
    // copy line uses, named after the key that was pressed.
    expect(mock.dispatched).toEqual([{ t: "drove", ref: "switched-to-shipped:a1", ok: true }]);
    expect(mock.logged.filter((l) => l.includes("ships with the plugin, switched to it"))).toHaveLength(1);
  });

  it("switches for a shipped pack even where the deck is on a run of it", async () => {
    // The run is the better source for a pack nobody shipped a profile
    // for. This one is in the package already, laid out from the same file.
    mock.state = onRun("com.scrthq.runlog.long-kiln");
    const oks: string[] = [];
    await press({ id: "com.scrthq.runlog.long-kiln", title: "The Long Kiln" }, [], oks);

    expect(mock.switched).toHaveLength(1);
    expect(mock.opened).toEqual([]);
    expect(oks).toEqual(["ok"]);
  });

  it("has nothing to switch to for a shipped pack on a deck it lays nothing out for", async () => {
    // A Pedal: no grid, so no shipped profile for it either. The build
    // path answers, and says no the way it does for any other pack.
    mock.pack = { id: "com.scrthq.runlog.long-kiln", title: "The Long Kiln", moves: { "push-on": {} } } as never;
    const alerts: string[] = [];
    await new Install().onKeyDown({
      action: { ...key(alerts, []), device: { id: "deck-1", type: 5 } },
      payload: { settings: { pack: { id: "com.scrthq.runlog.long-kiln", title: "The Long Kiln" } } },
    } as never);

    expect(mock.switched).toEqual([]);
    expect(alerts).toEqual(["alert"]);
    expect(mock.logged.filter((l) => l.includes("nothing to lay out"))).toHaveLength(1);
  });

  it("says so in the log for a deck it lays nothing out for", async () => {
    // A Pedal: the generator has no grid for it, so a press has nothing to
    // hand over and the log says why rather than the key alerting in silence.
    mock.pack = { id: "com.example.ember-trail", title: "Ember Trail", moves: { "push-on": {} } } as never;
    const alerts: string[] = [];
    await new Install().onKeyDown({
      action: { ...key(alerts, []), device: { type: 5 } },
      payload: { settings: { pack: { id: "com.example.ember-trail", title: "Ember Trail" } } },
    } as never);

    expect(alerts).toEqual(["alert"]);
    expect(mock.logged.filter((l) => l.includes("nothing to lay out"))).toHaveLength(1);
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
