import { deviceFlow } from "@runlog/session";
import { describe, expect, it, vi } from "vitest";

/**
 * `plugin.ts` is the whole plugin: it registers nine actions, opens a wire
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
  /** The plugin's own listener for a change to the global settings. */
  globals: (_: { settings: Record<string, unknown> }) => {},
}));
vi.mock("@elgato/streamdeck", () => {
  class SingletonAction {}
  return {
    default: {
      logger: { setLevel: () => {}, info: () => {}, error: () => {} },
      ui: {
        action: null,
        onSendToPlugin: () => {},
        sendToPropertyInspector: async (m: unknown) => {
          mock.sent.push(m);
        },
      },
      settings: {
        getGlobalSettings: async () => ({}),
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
  const attach = (id: string, packId?: string) => {
    store.dispatch({ t: "runs", runs: [{ id }], any: true });
    store.dispatch({ t: "snapshot", snapshot: { run: { id, ...(packId ? { packId } : {}) } } });
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

  it("puts a run of a pack it ships no layout for on the generic profile", () => {
    drop();
    mock.switched = [];
    attach("r2", "com.example.bought");
    expect(mock.switched).toEqual([
      ["deck-xl", "profiles/runlog-xl"],
      ["deck-plus", "profiles/runlog-plus"],
    ]);
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
});
