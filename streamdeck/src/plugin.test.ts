import { deviceFlow } from "@runlog/session";
import { describe, expect, it, vi } from "vitest";

/**
 * `plugin.ts` is the whole plugin: it registers fourteen actions, opens a wire
 * and dials the Stream Deck software the moment it is imported. The SDK and
 * the two modules that reach outside are faked so importing it here does
 * nothing but build the module, and `sent` is what an inspector would have
 * been told.
 */
const mock = vi.hoisted(() => ({
  sent: [] as unknown[],
  /** The decks plugged in, as the SDK reports them: an id and a `DeviceType`. */
  devices: [] as Array<{ id: string; type: number }>,
  /** Every profile switch asked for, in order. */
  switched: [] as Array<[string, string]>,
  /** Every profile built from a run and handed to the Stream Deck app. */
  handed: [] as string[],
  /** The global settings as the software holds them, and every write of them. */
  settings: {} as Record<string, unknown>,
  wrote: [] as Array<Record<string, unknown>>,
  /** The profiles the Stream Deck app is pretending to already have. */
  installed: [] as Array<{ name: string }>,
  /** Every line the plugin logged. */
  logged: [] as string[],
  /** The plugin's own listener for a change to the global settings. */
  globals: (_: { settings: Record<string, unknown> }) => {},
}));
vi.mock("@elgato/streamdeck", () => {
  class SingletonAction {}
  return {
    default: {
      logger: {
        setLevel: () => {},
        info: (line: string) => {
          mock.logged.push(line);
        },
        error: () => {},
      },
      ui: {
        action: null,
        onSendToPlugin: () => {},
        sendToPropertyInspector: async (m: unknown) => {
          mock.sent.push(m);
        },
      },
      settings: {
        getGlobalSettings: async () => mock.settings,
        setGlobalSettings: async (value: Record<string, unknown>) => {
          mock.settings = value;
          mock.wrote.push(value);
        },
        onDidReceiveGlobalSettings: (fn: (ev: { settings: Record<string, unknown> }) => void) => {
          mock.globals = fn;
        },
      },
      actions: { registerAction: () => {} },
      profiles: {
        switchToProfile: async (device: string, name: string) => {
          mock.switched.push([device, name]);
        },
      },
      devices: mock.devices,
      connect: async () => {},
    },
    action: () => (target: unknown) => target,
    SingletonAction,
  };
});
vi.mock("./socket.ts", () => ({ openWire: () => ({ connect: () => {}, disconnect: () => {}, press: () => null }) }));
// Nothing here writes a profile beside the plugin or opens one: what this
// holds is when the plugin asks for a build, not what comes out of it.
vi.mock("./profiles-on-demand.ts", () => ({
  buildFor: (_state: unknown, device: number) => ({ file: `built-${device}`, bytes: new Uint8Array() }),
  install: (file: string) => {
    mock.handed.push(file);
  },
}));
// The Stream Deck app's own profile folder, faked: what is read off a real
// one is `installed.test.ts`, and what is held here is what the plugin does
// about a pack that already has one.
vi.mock("./installed.ts", () => ({
  installedProfiles: () => mock.installed,
  hasProfileFor: (pack: { title?: string }, profiles: Array<{ name: string }>) => profiles.some((p) => p.name === pack.title),
}));
// Never the real session file: this test signs nobody in and must not read
// the deck's own rotating token off disk.
vi.mock("./session.ts", () => ({
  loadSession: () => null,
  normalizeBase: (s: string) => s,
  signIn: async () => {},
  signOut: () => {},
}));

// The module opens a one-second tick at import; a fake clock swallows it,
// and nothing below waits on a timer.
vi.useFakeTimers();
const { codeFromLines, store } = await import("./plugin.ts");
vi.useRealTimers();

describe("the sign-in code the inspector shows", () => {
  it("is read off the lines the device flow actually says", async () => {
    const say = codeFromLines();
    await deviceFlow("client_deck", "https://api.workos.test", {
      fetch: async (url) =>
        String(url).includes("/authorize/device")
          ? new Response(
              JSON.stringify({
                device_code: "d",
                user_code: "ABCD-EFGH",
                verification_uri: "https://workos.test/device",
                interval: 0,
                expires_in: 60,
              }),
            )
          : new Response(JSON.stringify({ access_token: "a.b.c", refresh_token: "r" })),
      sleep: async () => {},
      say,
      open: () => {},
      now: () => Date.now(),
    });

    // Both halves, once, in the one message: the inspector has nothing to
    // show until it has the page as well as the code.
    expect(mock.sent).toEqual([{ t: "code", code: "ABCD-EFGH", url: "https://workos.test/device" }]);
  });

  it("says nothing for lines that carry neither", () => {
    mock.sent = [];
    const say = codeFromLines();
    say("");
    say("Waiting for you to confirm it there. Ctrl-C gives up.");
    expect(mock.sent).toEqual([]);
  });
});

/**
 * A run attaching, and the deck landing on that run's profile.
 *
 * The state moves through the one store the plugin keeps, so these press on
 * it the way the socket does: the runs the account holds, then the snapshot
 * the attached run publishes. The pack's id is in the snapshot, which is why
 * nothing switches until one lands.
 */
describe("the profile the deck lands on when a run attaches", () => {
  const attach = (id: string, packId?: string, packTitle?: string) => {
    store.dispatch({ t: "runs", runs: [{ id }], any: true });
    store.dispatch({ t: "snapshot", snapshot: { run: { id, ...(packId ? { packId } : {}), ...(packTitle ? { packTitle } : {}) } } });
  };
  const drop = () => store.dispatch({ t: "runs", runs: [], any: false });

  it("waits for the snapshot, then switches every deck it has a layout for", () => {
    mock.devices.push({ id: "deck-xl", type: 2 }, { id: "deck-plus", type: 7 }, { id: "pedal", type: 5 });
    mock.switched = [];

    store.dispatch({ t: "runs", runs: [{ id: "r1" }], any: true });
    expect(mock.switched, "nothing to switch to until the pack is known").toEqual([]);

    store.dispatch({ t: "snapshot", snapshot: { run: { id: "r1", packId: "com.scrthq.runlog.forfeits" } } });
    expect(mock.switched).toEqual([
      ["deck-xl", "profiles/forfeits-xl"],
      ["deck-plus", "profiles/forfeits-plus"],
    ]);

    // Once per attach: the streamer may have paged away since, and every
    // ring of the run publishes another snapshot.
    store.dispatch({ t: "snapshot", snapshot: { run: { id: "r1", packId: "com.scrthq.runlog.forfeits" } } });
    expect(mock.switched).toHaveLength(2);
  });

  it("hands a run of a pack it ships no layout for its own profile, and not the generic one", () => {
    drop();
    mock.switched = [];
    mock.handed = [];
    attach("r2", "com.example.bought");
    // The app asks about the profile it was just handed; the generic one
    // is not offered in the same breath.
    expect(mock.handed).toEqual(["built-2", "built-7"]);
    expect(mock.switched).toEqual([]);
  });

  it("leaves the deck where it is when the setting is off", () => {
    mock.globals({ settings: { switchProfiles: false } });
    drop();
    mock.switched = [];
    attach("r3", "com.scrthq.runlog.forfeits");
    expect(mock.switched).toEqual([]);

    // And takes it up again the moment the setting comes back.
    mock.globals({ settings: { switchProfiles: true } });
    drop();
    attach("r4", "com.scrthq.runlog.forfeits");
    expect(mock.switched).toEqual([
      ["deck-xl", "profiles/forfeits-xl"],
      ["deck-plus", "profiles/forfeits-plus"],
    ]);
  });

  it("builds one from the run for a pack it ships none for, and hands it over", () => {
    mock.handed = [];
    drop();
    attach("r5", "com.example.ember-trail");
    // One per deck it has a grid for.
    expect(mock.handed).toEqual(["built-2", "built-7"]);

    // Once per pack per launch. The Stream Deck app's import prompt is the
    // streamer's to answer, and another run of the same pack asking again
    // is a prompt nobody asked for twice.
    mock.handed = [];
    drop();
    attach("r6", "com.example.ember-trail");
    expect(mock.handed).toEqual([]);
  });

  it("builds nothing for a pack it already ships a profile for", () => {
    mock.handed = [];
    mock.switched = [];
    drop();
    attach("r7", "com.scrthq.runlog.soundclash");
    expect(mock.handed).toEqual([]);
    expect(mock.switched).toEqual([
      ["deck-xl", "profiles/soundclash-xl"],
      ["deck-plus", "profiles/soundclash-plus"],
    ]);
  });

  it("builds nothing at all when the setting is off", () => {
    mock.globals({ settings: { switchProfiles: false } });
    mock.handed = [];
    drop();
    attach("r8", "com.example.salt-and-signal");
    expect(mock.handed).toEqual([]);

    mock.globals({ settings: { switchProfiles: true } });
  });

  it("writes the pack into the settings, so a restart does not offer it again", async () => {
    mock.handed = [];
    mock.wrote = [];
    drop();
    attach("r9", "com.example.the-long-road");
    expect(mock.handed).toEqual(["built-2", "built-7"]);

    // The write is a round trip through the software, so it lands a tick later.
    await vi.waitFor(() => expect(mock.wrote).not.toHaveLength(0));
    expect(mock.wrote.at(-1)!.profilesOffered).toContain("com.example.the-long-road");

    // And a pack the settings arrive already naming is not offered, which
    // is what a restart looks like from here.
    mock.handed = [];
    mock.globals({ settings: { profilesOffered: ["com.example.marsh-light"] } });
    drop();
    attach("r10", "com.example.marsh-light");
    expect(mock.handed).toEqual([]);
  });

  it("leaves a pack alone when the Stream Deck app already has a profile under its title", async () => {
    mock.handed = [];
    mock.switched = [];
    mock.wrote = [];
    mock.logged = [];
    mock.installed = [{ name: "Quarry Road" }];
    drop();
    attach("r11", "com.example.quarry-road", "Quarry Road");

    // Nothing built, nothing handed over, and the deck left where it is: a
    // profile somebody imported is not one this plugin can switch to.
    expect(mock.handed).toEqual([]);
    expect(mock.switched).toEqual([]);
    expect(mock.logged.filter((l) => l.includes("already has one"))).toHaveLength(1);
    // And marked offered, so the folder is not read again for this pack.
    await vi.waitFor(() => expect(mock.wrote).not.toHaveLength(0));
    expect(mock.wrote.at(-1)!.profilesOffered).toContain("com.example.quarry-road");

    mock.installed = [];
  });
});

/**
 * The setups a run publishes, kept for a profile built without one.
 *
 * A pack from the Marketplace names its setups in the offer and nowhere
 * else the deck can reach, so what a run says is written into the global
 * settings and read back on the next launch.
 */
describe("what the deck remembers about a pack's setups", () => {
  it("writes what a run offered into the settings, warps and all", async () => {
    mock.wrote = [];
    store.dispatch({ t: "runs", runs: [], any: false });
    store.dispatch({ t: "runs", runs: [{ id: "r14" }], any: true });
    store.dispatch({
      t: "snapshot",
      snapshot: {
        run: { id: "r14", packId: "com.example.marsh-light" },
        offer: {
          setups: [
            { id: "s1", title: "Starter kit" },
            { id: "s2", title: "Warp to the camp" },
          ],
          commands: [
            { id: "s1", title: "Starter kit" },
            { id: "s2", title: "Warp to the camp" },
          ],
        },
      } as never,
    });

    await vi.waitFor(() => expect(mock.wrote.some((w) => w.setupsSeen)).toBe(true));
    const seen = mock.wrote.findLast((w) => w.setupsSeen)!.setupsSeen as Record<string, unknown>;
    expect(seen["com.example.marsh-light"]).toEqual([
      { id: "s1", title: "Starter kit", warp: false },
      { id: "s2", title: "Warp to the camp", warp: true },
    ]);
  });

  it("writes nothing again for a snapshot that names the same setups", async () => {
    mock.wrote = [];
    store.dispatch({
      t: "snapshot",
      snapshot: {
        run: { id: "r14", packId: "com.example.marsh-light" },
        offer: { setups: [{ id: "s1", title: "Starter kit" }], commands: [{ id: "s2", title: "Warp to the camp" }] },
      } as never,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mock.wrote.filter((w) => w.setupsSeen)).toEqual([]);
  });
});
