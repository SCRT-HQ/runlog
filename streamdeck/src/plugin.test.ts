import { deviceFlow } from "@runlog/session";
import { describe, expect, it, vi } from "vitest";

/**
 * `plugin.ts` is the whole plugin: it registers eight actions, opens a wire
 * and dials the Stream Deck software the moment it is imported. The SDK and
 * the two modules that reach outside are faked so importing it here does
 * nothing but build the module, and `sent` is what an inspector would have
 * been told.
 */
const mock = vi.hoisted(() => ({ sent: [] as unknown[] }));
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
      settings: { getGlobalSettings: async () => ({}), onDidReceiveGlobalSettings: () => {} },
      actions: { registerAction: () => {} },
      profiles: { switchToProfile: async () => {} },
      devices: [],
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
const { codeFromLines } = await import("./plugin.ts");
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
