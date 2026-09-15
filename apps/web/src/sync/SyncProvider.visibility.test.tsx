// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { setLastActive } from "../run/active.ts";
import { SyncProvider } from "./SyncProvider.tsx";

/**
 * The doorbell must not drop when the tab a deck is pressing through goes
 * behind OBS, the game, or another monitor: that is where a streamer keeps
 * it, not an edge case. `SyncProvider` is rendered for real here, with the
 * engine and the socket faked out from underneath it -- this is about
 * whether `openSocket`/`closeSocket` are called, not what a sync pass does.
 */

// A pass that never does anything: what happens to the socket is the
// question, and a real engine would want IndexedDB and a network this test
// has no business touching.
vi.mock("./engine.ts", () => ({
  createEngine: () => ({
    sync: async () => ({ status: "idle" as const, pushed: 0, pulled: 0, at: "" }),
    last: () => null,
  }),
  storageDb: async () => ({}),
}));

const liveSockets: { closed: boolean }[] = [];
let openLiveCalls = 0;
vi.mock("./socket.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./socket.ts")>();
  return {
    ...actual,
    openLive: () => {
      openLiveCalls += 1;
      const fake = { closed: false };
      liveSockets.push(fake);
      return {
        watch: () => {},
        gesture: () => false,
        drove: () => {},
        close: () => {
          fake.closed = true;
        },
        open: true,
      };
    },
  };
});

const signedIn: Account = {
  status: "signed-in",
  user: {
    object: "user",
    id: "user_ME",
    // Empty, not absent: the guard on the profile-address effect is
    // `!account.user.email`, and a truthy one would fire a real fetch this
    // test has no server to answer.
    email: "",
    emailVerified: true,
    firstName: "Nate",
    lastName: null,
    profilePictureUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastSignInAt: null,
    externalId: undefined,
  },
  signOut: () => {},
  getAccessToken: async () => "token",
};

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

beforeEach(() => {
  vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
  setLastActive({ packId: "demo", runId: "run1" });
  setVisibility("visible");
  liveSockets.length = 0;
  openLiveCalls = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  localStorage.clear();
});

async function mount() {
  render(
    <AccountContext.Provider value={signedIn}>
      <SyncProvider>{null}</SyncProvider>
    </AccountContext.Provider>,
  );
  // Let the mounting effect's microtasks (createApi, the fake engine's
  // sync) settle before a test looks at what it did.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the doorbell while the tab is hidden", () => {
  it("stays open when the tab is hidden", async () => {
    await mount();
    expect(openLiveCalls).toBe(1);
    const held = liveSockets[0]!;

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(held.closed).toBe(false);
  });

  it("opens even for a tab that was already hidden at mount", async () => {
    setVisibility("hidden");
    await mount();
    expect(openLiveCalls).toBe(1);
    expect(liveSockets[0]!.closed).toBe(false);
  });

  it("still closes on unmount", async () => {
    const { unmount } = render(
      <AccountContext.Provider value={signedIn}>
        <SyncProvider>{null}</SyncProvider>
      </AccountContext.Provider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => unmount());

    expect(liveSockets[0]!.closed).toBe(true);
  });
});
