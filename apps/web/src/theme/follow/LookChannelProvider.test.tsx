// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { presentationSnapshotKey } from "@runlog/themes";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../../auth/Account.tsx";
import type { LookApi } from "../../sync/lookApi.ts";
import { snapshotForBuiltin } from "../appearance.ts";
import { setDeviceAppearance } from "../useAppearance.ts";

const hooks = vi.hoisted(() => ({
  factory: null as unknown as IDBFactory,
  published: [] as string[],
  api: null as unknown as LookApi,
}));
vi.mock("../../sync/config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sync/config.ts")>()),
  apiBase: () => "https://runlog.test/api/",
}));
vi.mock("../../sync/lookApi.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sync/lookApi.ts")>()),
  createLookApi: () => hooks.api,
}));
vi.mock("./channelStore.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./channelStore.ts")>();
  return {
    ...real,
    openLookChannelStore: (who: Parameters<typeof real.openLookChannelStore>[0]) => real.openLookChannelStore(who, hooks.factory),
  };
});

import { LookChannelProvider, useLookChannel, type LookChannelView } from "./LookChannelProvider.tsx";

const b64url = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwtFor = (sub: string) => `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ sub }))}.x`;
const signedIn = (id: string) =>
  ({ status: "signed-in", user: { id }, signOut: vi.fn(), getAccessToken: vi.fn(async () => jwtFor(id)) }) as unknown as Account;
const guest = { status: "anonymous", signIn: vi.fn(), signUp: vi.fn() } as unknown as Account;
const AT = "2026-09-25T10:00:00.000Z";

function fakeApi(): LookApi {
  let revision = 0;
  return {
    list: async () => [],
    create: async () => ({
      kind: "ok",
      channel: { id: "lk_AAAAAAAAAAAAAAAA", revision: 0, createdAt: AT, updatedAt: AT, publishedAt: null },
      readKey: "r".repeat(32),
      secret: "s".repeat(43),
    }),
    publish: async ({ snapshot, base }) => {
      hooks.published.push(presentationSnapshotKey(snapshot));
      if (base !== revision) return { kind: "stale", revision };
      revision += 1;
      return { kind: "ok", revision };
    },
    transfer: async () => ({ kind: "gone" }),
    relink: async () => ({ kind: "gone" }),
    revoke: async () => true,
  };
}

/** A matchMedia whose light preference a test can flip. */
function mediaQuery(light: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: light,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
  return {
    flip(next: boolean) {
      query.matches = next;
      for (const fn of listeners) fn();
    },
  };
}

let current: LookChannelView;
function Probe() {
  current = useLookChannel();
  return null;
}
const mount = (account: Account) =>
  render(
    <AccountContext.Provider value={account}>
      <LookChannelProvider>
        <Probe />
      </LookChannelProvider>
    </AccountContext.Provider>,
  );
const key = (id: Parameters<typeof snapshotForBuiltin>[0]) => presentationSnapshotKey(snapshotForBuiltin(id));

beforeEach(() => {
  hooks.factory = new IDBFactory();
  hooks.published = [];
  hooks.api = fakeApi();
});
afterEach(() => {
  cleanup();
  setDeviceAppearance({ schemaVersion: 1, mode: "system" });
  Reflect.deleteProperty(window, "matchMedia");
});

describe("the theme link in the app", () => {
  it("offers nothing to a guest", () => {
    mount(guest);
    expect(current.available).toBe(false);
    expect(current.channel).toBeNull();
  });

  it("publishes the applied look a second after Apply, once", async () => {
    mediaQuery(false);
    setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("ember") });
    mount(signedIn("user_1"));
    await waitFor(() => expect(current.available).toBe(true));
    await act(async () => {
      expect(await current.create()).toBe("ok");
    });
    await waitFor(() => expect(current.state.kind).toBe("following"));
    expect(current.channel).toEqual({ id: "lk_AAAAAAAAAAAAAAAA", readKey: "r".repeat(32), published: true });
    expect(hooks.published).toEqual([key("ember")]);
    act(() => {
      setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("daylight") });
      setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("glaze") });
    });
    await waitFor(() => expect(hooks.published).toEqual([key("ember"), key("glaze")]), { timeout: 3000 });
  });

  it("publishes the resolved System look, and again when the operating system switches", async () => {
    const media = mediaQuery(false);
    mount(signedIn("user_1"));
    await waitFor(() => expect(current.available).toBe(true));
    await act(async () => {
      await current.create();
    });
    await waitFor(() => expect(hooks.published).toEqual([key("lights-down")]));
    act(() => media.flip(true));
    await waitFor(() => expect(hooks.published).toEqual([key("lights-down"), key("daylight")]), { timeout: 3000 });
  });

  it("stops publishing the moment the account signs out", async () => {
    mediaQuery(false);
    const page = mount(signedIn("user_1"));
    await waitFor(() => expect(current.available).toBe(true));
    await act(async () => {
      await current.create();
    });
    await waitFor(() => expect(hooks.published).toHaveLength(1));
    page.rerender(
      <AccountContext.Provider value={guest}>
        <LookChannelProvider>
          <Probe />
        </LookChannelProvider>
      </AccountContext.Provider>,
    );
    expect(current.available).toBe(false);
    act(() => setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("glaze") }));
    await new Promise((r) => setTimeout(r, 1500));
    expect(hooks.published).toHaveLength(1);
  });

  it("does not hand one account's link to the next", async () => {
    mediaQuery(false);
    const page = mount(signedIn("user_1"));
    await waitFor(() => expect(current.available).toBe(true));
    await act(async () => {
      await current.create();
    });
    await waitFor(() => expect(current.channel).not.toBeNull());
    page.rerender(
      <AccountContext.Provider value={signedIn("user_2")}>
        <LookChannelProvider>
          <Probe />
        </LookChannelProvider>
      </AccountContext.Provider>,
    );
    await waitFor(() => expect(current.state.kind).toBe("none"));
    expect(current.channel).toBeNull();
  });
});
