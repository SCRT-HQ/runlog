// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import type { Api, Me, PublisherView } from "../sync/client.ts";
import { PlanProvider } from "../sync/PlanProvider.tsx";
import { usePlan, type Plan } from "../sync/usePlan.ts";
import { rememberProfileReturn, type ProfileReturnDestination, type ProfileReturnIntent } from "./returns.ts";
import { useProfileReturn } from "./useProfileReturn.ts";

const boundary = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("../sync/useApi.ts", () => ({ useApi: () => boundary.api }));

const KEY = "runlog:profile-return";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const signedIn = (id: string): Account =>
  ({
    status: "signed-in",
    user: { id, email: `${id}@example.com` },
    signOut: () => {},
    getAccessToken: async () => "token",
  }) as unknown as Account;
const checking: Account = { status: "checking", signIn: () => {} };

function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    refreshEntitlements: vi.fn(async () => {}),
    refreshPublisherConnect: vi.fn(async () => null),
    ...overrides,
  } as unknown as Api;
}

function fakePlan(refresh: Plan["refresh"] = vi.fn(async () => {})): Plan {
  return { state: { kind: "loading", ownerId: "A" }, access: () => "checking", refresh };
}

type Props = {
  account: Account;
  api: Api | null;
  plan: Plan;
  openProfile: (page: ProfileReturnDestination, how: "replace") => void;
};

function Harness(props: Props) {
  const { message } = useProfileReturn(props);
  return <p role="status">{message ?? ""}</p>;
}

function mount(props: Props, strict = false) {
  const tree = (next: Props) => (strict ? <StrictMode>{<Harness {...next} />}</StrictMode> : <Harness {...next} />);
  const view = render(tree(props));
  return { ...view, update: (next: Props) => view.rerender(tree(next)) };
}

const flush = () => act(async () => void (await Promise.resolve()));

const remember = (intent: ProfileReturnIntent) => rememberProfileReturn(sessionStorage, intent);

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  boundary.api = null;
});

describe("restoring a Billing or Connect return", () => {
  it.each([
    ["plus", "account", "The payment for Plus went through. It can take a moment to show here."],
    ["server", "servers", "The payment for Runlog for servers went through. It can take a moment to show here."],
    ["hosted-licensing", "publishing", "The payment for hosted licensing went through. It can take a moment to show here."],
  ] as const)("brings a completed %s Checkout back to %s after reading it again", async (product, destination, message) => {
    remember({ kind: "checkout", ownerId: "A", product, destination });
    history.replaceState(null, "", `/?from=mail&billing=done&product=${product}&destination=${destination}#packs`);
    const entitlements = deferred<void>();
    const planRefresh = deferred<void>();
    const api = fakeApi({ refreshEntitlements: vi.fn(() => entitlements.promise) });
    const refresh = vi.fn(() => planRefresh.promise);
    const openProfile = vi.fn();

    mount({ account: signedIn("A"), api, plan: fakePlan(refresh), openProfile });
    expect(location.pathname + location.search + location.hash).toBe("/?from=mail#packs");
    expect(api.refreshEntitlements).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => entitlements.resolve());
    expect(refresh).toHaveBeenCalledOnce();
    expect(openProfile).not.toHaveBeenCalled();

    await act(async () => planRefresh.resolve());
    expect(openProfile).toHaveBeenCalledExactlyOnceWith(destination, "replace");
    expect(screen.getByRole("status").textContent).toBe(message);
    expect(api.refreshPublisherConnect).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("says nothing was charged for a canceled Checkout, without reading anything again", async () => {
    remember({ kind: "checkout", ownerId: "A", product: "server", destination: "servers" });
    history.replaceState(null, "", "/?billing=canceled&product=server&destination=servers");
    const api = fakeApi();
    const refresh = vi.fn(async () => {});
    const openProfile = vi.fn();

    mount({ account: signedIn("A"), api, plan: fakePlan(refresh), openProfile });
    await flush();

    expect(openProfile).toHaveBeenCalledExactlyOnceWith("servers", "replace");
    expect(screen.getByRole("status").textContent).toBe("Nothing was charged.");
    expect(api.refreshEntitlements).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns the Portal to the page that opened it, after the plan is read again", async () => {
    remember({ kind: "portal", ownerId: "A", destination: "publishing" });
    history.replaceState(null, "", "/?billing=managed&destination=publishing");
    const api = fakeApi();
    const refresh = vi.fn(async () => {});
    const openProfile = vi.fn();

    mount({ account: signedIn("A"), api, plan: fakePlan(refresh), openProfile });
    await flush();

    expect(refresh).toHaveBeenCalledOnce();
    expect(api.refreshEntitlements).not.toHaveBeenCalled();
    expect(openProfile).toHaveBeenCalledExactlyOnceWith("publishing", "replace");
  });

  it.each([
    ["connected", { connectReady: true }, "Payouts are set up. You can list packs for sale."],
    ["connected", { connectReady: false }, "Stripe is still checking a few things; press Refresh in a moment."],
    ["connect-again", { connectReady: false }, "That link had expired. Set up payouts again to continue where you left off."],
  ] as const)("brings Connect's %s return back to Publishing and reads only the payouts again", async (outcome, publisher, message) => {
    remember({ kind: "publisher-connect", ownerId: "A", destination: "publishing" });
    history.replaceState(null, "", `/?publisher=${outcome}&destination=publishing`);
    const api = fakeApi({ refreshPublisherConnect: vi.fn(async () => publisher as PublisherView) });
    const refresh = vi.fn(async () => {});
    const openProfile = vi.fn();

    mount({ account: signedIn("A"), api, plan: fakePlan(refresh), openProfile });
    await flush();

    expect(api.refreshPublisherConnect).toHaveBeenCalledOnce();
    expect(api.refreshEntitlements).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(openProfile).toHaveBeenCalledExactlyOnceWith("publishing", "replace");
    expect(screen.getByRole("status").textContent).toBe(message);
  });

  it("still lands on the page and says the plan could not be read when reading it again fails", async () => {
    remember({ kind: "checkout", ownerId: "A", product: "plus", destination: "account" });
    history.replaceState(null, "", "/?billing=done&product=plus&destination=account");
    const api = fakeApi({ refreshEntitlements: vi.fn(async () => Promise.reject(new Error("offline"))) });
    const openProfile = vi.fn();

    mount({ account: signedIn("A"), api, plan: fakePlan(), openProfile });
    await flush();

    expect(openProfile).toHaveBeenCalledExactlyOnceWith("account", "replace");
    expect(screen.getByRole("status").textContent).toBe(
      "The payment for Plus went through, but it could not be read just now. Try Refresh in a moment.",
    );
  });
});

describe("a return that is not this account's, or not a return", () => {
  it("ignores account A's return while account B is signed in", async () => {
    remember({ kind: "checkout", ownerId: "A", product: "plus", destination: "account" });
    history.replaceState(null, "", "/?billing=done&product=plus&destination=account");
    const api = fakeApi();
    const refresh = vi.fn(async () => {});
    const openProfile = vi.fn();

    mount({ account: signedIn("B"), api, plan: fakePlan(refresh), openProfile });
    await flush();

    expect(location.search).toBe("");
    expect(api.refreshEntitlements).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(openProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    "?billing=done&product=plus&destination=https://evil.example",
    "?billing=done&product=plus&destination=profile",
    "?billing=refunded&product=plus&destination=account",
    "?publisher=connected&destination=servers",
    "?billing=done&product=server&destination=servers",
  ])("removes and ignores %s", async (search) => {
    remember({ kind: "checkout", ownerId: "A", product: "plus", destination: "account" });
    history.replaceState(null, "", `/${search}#library`);
    const api = fakeApi();
    const refresh = vi.fn(async () => {});
    const openProfile = vi.fn();

    mount({ account: signedIn("A"), api, plan: fakePlan(refresh), openProfile });
    await flush();

    expect(location.pathname + location.search + location.hash).toBe("/#library");
    expect(api.refreshEntitlements).not.toHaveBeenCalled();
    expect(api.refreshPublisherConnect).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(openProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("does nothing for a return with no intent stored in this tab", async () => {
    history.replaceState(null, "", "/?billing=done&product=plus&destination=account");
    const api = fakeApi();
    const openProfile = vi.fn();

    mount({ account: signedIn("A"), api, plan: fakePlan(), openProfile });
    await flush();

    expect(location.search).toBe("");
    expect(api.refreshEntitlements).not.toHaveBeenCalled();
    expect(openProfile).not.toHaveBeenCalled();
  });
});

describe("account changes while a return is being read", () => {
  it.each(["refreshEntitlements", "plan.refresh"] as const)("drops A's late %s once B is signed in", async (stage) => {
    remember({ kind: "checkout", ownerId: "A", product: "server", destination: "servers" });
    history.replaceState(null, "", "/?billing=done&product=server&destination=servers");
    const entitlements = deferred<void>();
    const planRefresh = deferred<void>();
    const apiA = fakeApi({ refreshEntitlements: vi.fn(() => entitlements.promise) });
    const apiB = fakeApi();
    const refresh = vi.fn(() => planRefresh.promise);
    const openProfile = vi.fn();
    const view = mount({ account: signedIn("A"), api: apiA, plan: fakePlan(refresh), openProfile });

    if (stage === "plan.refresh") {
      await act(async () => entitlements.resolve());
      expect(refresh).toHaveBeenCalledOnce();
    }
    view.update({ account: signedIn("B"), api: apiB, plan: fakePlan(refresh), openProfile });
    await act(async () => {
      entitlements.resolve();
      planRefresh.resolve();
    });

    expect(refresh).toHaveBeenCalledTimes(stage === "plan.refresh" ? 1 : 0);
    expect(openProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(apiB.refreshEntitlements).not.toHaveBeenCalled();
  });

  it("drops A's late payouts read once B is signed in", async () => {
    remember({ kind: "publisher-connect", ownerId: "A", destination: "publishing" });
    history.replaceState(null, "", "/?publisher=connected&destination=publishing");
    const payouts = deferred<PublisherView | null>();
    const apiA = fakeApi({ refreshPublisherConnect: vi.fn(() => payouts.promise) });
    const openProfile = vi.fn();
    const view = mount({ account: signedIn("A"), api: apiA, plan: fakePlan(), openProfile });

    view.update({ account: signedIn("B"), api: fakeApi(), plan: fakePlan(), openProfile });
    await act(async () => payouts.resolve({ connectReady: true } as PublisherView));

    expect(openProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("hides A's notice in the first render for B", async () => {
    remember({ kind: "checkout", ownerId: "A", product: "plus", destination: "account" });
    history.replaceState(null, "", "/?billing=canceled&product=plus&destination=account");
    const apiA = fakeApi();
    const openProfile = vi.fn();
    const view = mount({ account: signedIn("A"), api: apiA, plan: fakePlan(), openProfile });
    await flush();
    expect(screen.getByRole("status").textContent).toBe("Nothing was charged.");

    view.update({ account: signedIn("B"), api: fakeApi(), plan: fakePlan(), openProfile });
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("taking a return once", () => {
  it("consumes one callback once under StrictMode", async () => {
    remember({ kind: "checkout", ownerId: "A", product: "plus", destination: "account" });
    history.replaceState(null, "", "/?billing=done&product=plus&destination=account");
    const api = fakeApi();
    const refresh = vi.fn(async () => {});
    const openProfile = vi.fn();

    mount({ account: signedIn("A"), api, plan: fakePlan(refresh), openProfile }, true);
    await flush();
    await flush();

    expect(api.refreshEntitlements).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(openProfile).toHaveBeenCalledExactlyOnceWith("account", "replace");
  });

  it("holds a callback first seen while the account is checking, after the address is cleaned", async () => {
    remember({ kind: "checkout", ownerId: "A", product: "server", destination: "servers" });
    history.replaceState(null, "", "/?billing=done&product=server&destination=servers");
    const api = fakeApi();
    const openProfile = vi.fn();
    const view = mount({ account: checking, api: null, plan: fakePlan(), openProfile }, true);
    await flush();
    expect(location.search).toBe("");
    expect(openProfile).not.toHaveBeenCalled();

    view.update({ account: signedIn("A"), api, plan: fakePlan(), openProfile });
    await flush();

    expect(api.refreshEntitlements).toHaveBeenCalledOnce();
    expect(openProfile).toHaveBeenCalledExactlyOnceWith("servers", "replace");
  });

  it("does not replay after Back, Forward or a fresh mount on the cleaned address", async () => {
    remember({ kind: "checkout", ownerId: "A", product: "plus", destination: "account" });
    history.replaceState(null, "", "/?billing=done&product=plus&destination=account");
    const api = fakeApi();
    const openProfile = vi.fn();
    const view = mount({ account: signedIn("A"), api, plan: fakePlan(), openProfile });
    await flush();
    expect(openProfile).toHaveBeenCalledOnce();

    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    view.update({ account: signedIn("A"), api, plan: fakePlan(), openProfile });
    cleanup();
    mount({ account: signedIn("A"), api, plan: fakePlan(), openProfile });
    await flush();

    expect(location.search).toBe("");
    expect(api.refreshEntitlements).toHaveBeenCalledOnce();
    expect(openProfile).toHaveBeenCalledOnce();
  });
});

describe("the shared plan after a return", () => {
  it("lets every plan consumer see what the return read", async () => {
    remember({ kind: "checkout", ownerId: "A", product: "server", destination: "servers" });
    history.replaceState(null, "", "/?billing=done&product=server&destination=servers");
    const meOf = (hostServers: boolean): Me =>
      ({
        sub: "A",
        gates: true,
        capabilities: { hostTables: false, waivePublisherFee: false, hostServers },
        servers: true,
        serversOpen: true,
        publishersOpen: true,
      }) as unknown as Me;
    let held = false;
    const api = fakeApi({
      me: vi.fn(async () => meOf(held)),
      refreshEntitlements: vi.fn(async () => {
        held = true;
      }),
    });
    boundary.api = api;
    const openProfile = vi.fn();
    const account = signedIn("A");

    function Returning() {
      const plan = usePlan();
      const { message } = useProfileReturn({ account, api, plan, openProfile });
      return <p role="status">{message ?? ""}</p>;
    }
    function Consumer() {
      const plan = usePlan();
      return <p data-testid="servers">{plan.access("hostServers")}</p>;
    }

    render(
      <AccountContext.Provider value={account}>
        <PlanProvider>
          <Returning />
          <Consumer />
        </PlanProvider>
      </AccountContext.Provider>,
    );

    await waitFor(() => expect(openProfile).toHaveBeenCalledExactlyOnceWith("servers", "replace"));
    await waitFor(() => expect(screen.getByTestId("servers").textContent).toBe("available"));
    expect(api.refreshEntitlements).toHaveBeenCalledOnce();
  });
});
