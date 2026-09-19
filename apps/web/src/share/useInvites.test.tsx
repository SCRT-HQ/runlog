// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import type { Api, PendingInvite } from "../sync/client.ts";
import { useInvites } from "./useInvites.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invite = (token: string, inviter: string): PendingInvite => ({
  token,
  role: "player",
  createdAt: "2026-01-01T00:00:00Z",
  expiresAt: "2026-02-01T00:00:00Z",
  packId: "pack_1",
  packTitle: "Ember Trail",
  session: null,
  inviter,
  alreadyIn: false,
});

const signedIn = (id: string): Account => ({
  status: "signed-in",
  user: {
    object: "user",
    id,
    email: `${id}@example.com`,
    emailVerified: true,
    firstName: id,
    lastName: null,
    profilePictureUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastSignInAt: null,
    externalId: undefined,
  },
  signOut: () => {},
  getAccessToken: async () => "token",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useInvites account ownership", () => {
  const mounted: Array<() => void> = [];

  afterEach(() => {
    for (const unmount of mounted.splice(0)) unmount();
    vi.useRealTimers();
  });

  function traceHook() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const trace: string[][] = [];

    function Probe({ api }: { api: Api | null }) {
      const result = useInvites(api, true);
      trace.push(result.invites.map((item) => item.inviter ?? ""));
      return <span>{result.invites.map((item) => item.inviter).join(",")}</span>;
    }

    const render = (account: Account, api: Api | null) => {
      const first = trace.length;
      act(() => {
        root.render(
          <AccountContext.Provider value={account}>
            <Probe api={api} />
          </AccountContext.Provider>,
        );
      });
      return trace[first];
    };

    mounted.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    return { container, render, trace };
  }

  it("returns an empty snapshot in the first checking and next-owner renders", async () => {
    const a = deferred<PendingInvite[]>();
    const b = deferred<PendingInvite[]>();
    const apiA = { myInvites: vi.fn(() => a.promise) } as unknown as Api;
    const apiB = { myInvites: vi.fn(() => b.promise) } as unknown as Api;
    const view = traceHook();

    view.render(signedIn("A"), apiA);
    await act(async () => a.resolve([invite("a", "Alice")]));
    expect(view.container.textContent).toBe("Alice");

    expect(view.render({ status: "checking", signIn: () => {} }, null)).toEqual([]);
    expect(view.render(signedIn("B"), apiB)).toEqual([]);
  });

  it("ignores A's late answer after B is current and then shows only B's answer", async () => {
    const a = deferred<PendingInvite[]>();
    const b = deferred<PendingInvite[]>();
    const apiA = { myInvites: vi.fn(() => a.promise) } as unknown as Api;
    const apiB = { myInvites: vi.fn(() => b.promise) } as unknown as Api;
    const view = traceHook();

    view.render(signedIn("A"), apiA);
    expect(view.render({ status: "checking", signIn: () => {} }, null)).toEqual([]);
    expect(view.render(signedIn("B"), apiB)).toEqual([]);

    await act(async () => a.resolve([invite("a", "Alice")]));
    expect(view.container.textContent).toBe("");

    await act(async () => b.resolve([invite("b", "Bob")]));
    expect(view.container.textContent).toBe("Bob");
    expect(view.trace.at(-1)).toEqual(["Bob"]);
  });
});
