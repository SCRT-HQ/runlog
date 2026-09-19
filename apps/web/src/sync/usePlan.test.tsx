// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import type { Api, Me, PlanCapabilities } from "./client.ts";
import { PlanProvider } from "./PlanProvider.tsx";
import { usePlan } from "./usePlan.ts";

const current = vi.hoisted(() => ({ api: null as Api | null }));
vi.mock("./useApi.ts", () => ({ useApi: () => current.api }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return {
    promise: new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
    resolve,
    reject,
  };
}

const caps = (over: Partial<PlanCapabilities> = {}): PlanCapabilities => ({
  hostTables: false,
  waivePublisherFee: false,
  hostServers: false,
  ...over,
});

const meOf = (over: Partial<Me> = {}): Me => ({
  sub: "A",
  sid: "s",
  env: "test",
  profile: { createdAt: "", lastSeenAt: "" },
  entitlements: [],
  gates: true,
  servers: false,
  serversOpen: false,
  publishersOpen: true,
  capabilities: caps(),
  ...over,
});

type SignedInUser = Extract<Account, { status: "signed-in" }>["user"];
const signedIn = (id: string): Account => ({
  status: "signed-in",
  user: { id } as SignedInUser,
  signOut: () => {},
  getAccessToken: async () => "token",
});

const apiOf = (me: Api["me"]): Api => ({ me }) as Api;

function Probe({ name = "plan" }: { name?: string }) {
  const plan = usePlan();
  const owner = plan.state.kind === "ready" || plan.state.kind === "loading" || plan.state.kind === "error" ? plan.state.ownerId : "";
  return (
    <div>
      <output aria-label={name} data-owner={owner} data-kind={plan.state.kind}>
        {plan.access("hostTables")}
      </output>
      <button type="button" onClick={() => void plan.refresh()}>
        refresh {name}
      </button>
    </div>
  );
}

const tree = (account: Account, children = <Probe />) => (
  <AccountContext.Provider value={account}>
    <PlanProvider>{children}</PlanProvider>
  </AccountContext.Provider>
);

afterEach(() => {
  cleanup();
  current.api = null;
});

describe("plan access", () => {
  it("keeps a local copy open without requesting account state", () => {
    const me = vi.fn<Api["me"]>();
    current.api = apiOf(me);

    render(tree({ status: "local" }));

    expect(screen.getByLabelText("plan").textContent).toBe("available");
    expect(me).not.toHaveBeenCalled();
  });

  it("fails closed while checking and when signed out", () => {
    const checking: Account = { status: "checking", signIn: () => {} };
    const anonymous: Account = { status: "anonymous", signIn: () => {}, signUp: () => {} };
    const view = render(tree(checking));

    expect(screen.getByLabelText("plan").textContent).toBe("checking");
    view.rerender(tree(anonymous));
    expect(screen.getByLabelText("plan").textContent).toBe("sign-in");
  });

  it("shows checking until a signed-in request confirms gates are open", async () => {
    const answer = deferred<Me>();
    current.api = apiOf(vi.fn(() => answer.promise));

    render(tree(signedIn("A")));
    expect(screen.getByLabelText("plan").textContent).toBe("checking");
    expect(screen.getByLabelText("plan").dataset.owner).toBe("A");

    await act(async () => answer.resolve(meOf({ gates: false })));

    expect(screen.getByLabelText("plan").textContent).toBe("available");
    expect(screen.getByLabelText("plan").dataset.kind).toBe("ready");
  });

  it("requires the semantic capability when gates are on", async () => {
    current.api = apiOf(vi.fn().mockResolvedValue(meOf()));
    const view = render(tree(signedIn("A")));

    await waitFor(() => expect(screen.getByLabelText("plan").textContent).toBe("upgrade"));

    current.api = apiOf(vi.fn().mockResolvedValue(meOf({ capabilities: caps({ hostTables: true }) })));
    view.rerender(tree({ status: "checking", signIn: () => {} }));
    view.rerender(tree(signedIn("A")));
    await waitFor(() => expect(screen.getByLabelText("plan").textContent).toBe("available"));
  });

  it("enters an error state when the request rejects and refresh retries", async () => {
    const me = vi
      .fn<Api["me"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(meOf({ capabilities: caps({ hostTables: true }) }));
    current.api = apiOf(me);
    render(tree(signedIn("A")));

    await waitFor(() => expect(screen.getByLabelText("plan").textContent).toBe("error"));
    fireEvent.click(screen.getByRole("button", { name: "refresh plan" }));

    await waitFor(() => expect(screen.getByLabelText("plan").textContent).toBe("available"));
    expect(me).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["another account", meOf({ sub: "B" })],
    ["missing capabilities", { ...meOf(), capabilities: undefined } as unknown as Me],
    ["malformed capabilities", { ...meOf(), capabilities: { hostTables: true } } as unknown as Me],
  ])("rejects a response for %s", async (_case, answer) => {
    current.api = apiOf(vi.fn().mockResolvedValue(answer));
    render(tree(signedIn("A")));

    await waitFor(() => expect(screen.getByLabelText("plan").textContent).toBe("error"));
  });

  it("updates every consumer from one refreshed snapshot", async () => {
    const me = vi
      .fn<Api["me"]>()
      .mockResolvedValueOnce(meOf())
      .mockResolvedValueOnce(meOf({ capabilities: caps({ hostTables: true }) }));
    current.api = apiOf(me);
    render(
      tree(
        signedIn("A"),
        <>
          <Probe name="first" />
          <Probe name="second" />
        </>,
      ),
    );
    await waitFor(() => expect(screen.getByLabelText("first").textContent).toBe("upgrade"));

    fireEvent.click(screen.getByRole("button", { name: "refresh first" }));

    await waitFor(() => {
      expect(screen.getByLabelText("first").textContent).toBe("available");
      expect(screen.getByLabelText("second").textContent).toBe("available");
    });
    expect(me).toHaveBeenCalledTimes(2);
  });

  it("hides owner A immediately and ignores its late response after switching to B", async () => {
    const answerA = deferred<Me>();
    const answerB = deferred<Me>();
    current.api = apiOf(vi.fn(() => answerA.promise));
    const view = render(tree(signedIn("A")));
    expect(screen.getByLabelText("plan").dataset.owner).toBe("A");

    view.rerender(tree({ status: "checking", signIn: () => {} }));
    expect(screen.getByLabelText("plan").dataset.owner).not.toBe("A");
    expect(screen.getByLabelText("plan").textContent).toBe("checking");

    current.api = apiOf(vi.fn(() => answerB.promise));
    view.rerender(tree(signedIn("B")));
    expect(screen.getByLabelText("plan").dataset.owner).toBe("B");

    await act(async () => answerA.resolve(meOf({ sub: "A", capabilities: caps({ hostTables: true }) })));
    expect(screen.getByLabelText("plan").dataset.owner).not.toBe("A");
    expect(screen.getByLabelText("plan").textContent).toBe("checking");

    await act(async () => answerB.resolve(meOf({ sub: "B", capabilities: caps({ hostTables: true }) })));
    expect(screen.getByLabelText("plan").dataset.owner).toBe("B");
    expect(screen.getByLabelText("plan").textContent).toBe("available");
  });

  it("keeps the newest same-owner refresh when an older request resolves late", async () => {
    const older = deferred<Me>();
    const newer = deferred<Me>();
    const me = vi.fn<Api["me"]>().mockResolvedValueOnce(meOf()).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    current.api = apiOf(me);
    render(tree(signedIn("A")));
    await waitFor(() => expect(screen.getByLabelText("plan").textContent).toBe("upgrade"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "refresh plan" }));
      fireEvent.click(screen.getByRole("button", { name: "refresh plan" }));
    });
    await act(async () => newer.resolve(meOf({ capabilities: caps({ hostTables: true }) })));
    expect(screen.getByLabelText("plan").textContent).toBe("available");

    await act(async () => older.resolve(meOf({ capabilities: caps({ hostTables: false }) })));
    expect(screen.getByLabelText("plan").textContent).toBe("available");
  });
});

describe("the provider-less test fallback", () => {
  it.each([
    [{ status: "local" } as Account, "available"],
    [{ status: "checking", signIn: () => {} } as Account, "checking"],
    [{ status: "anonymous", signIn: () => {}, signUp: () => {} } as Account, "sign-in"],
    [signedIn("A"), "checking"],
  ])("derives safe access for $0.status", (account, access) => {
    render(
      <AccountContext.Provider value={account}>
        <Probe />
      </AccountContext.Provider>,
    );
    expect(screen.getByLabelText("plan").textContent).toBe(access);
  });
});
