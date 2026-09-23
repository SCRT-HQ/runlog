// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The hosted build, where the address is a path: paths on, served from the
 * root, a client to sign in with. Set before anything reads them.
 */
vi.hoisted(() => {
  vi.stubEnv("MODE", "development");
  vi.stubEnv("BASE_URL", "/");
  vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
});

type Options = { onRedirectCallback: (r: { state?: unknown }) => void };
/** WorkOS, as far as this page can see it: what comes back, and what a sign-in was asked to carry. */
const workos = vi.hoisted(() => ({
  state: undefined as unknown,
  /** Held until a test lets the return finish, so it can look in between. */
  hold: false,
  finish: null as null | (() => void),
  signedInWith: [] as unknown[],
}));
vi.mock("@workos-inc/authkit-js", () => ({
  createClient: (_id: string, options: Options) =>
    new Promise((resolve) => {
      const returning = new URLSearchParams(location.search).has("code");
      const client = (user: unknown) => ({
        getUser: () => user,
        signIn: async (opts: unknown) => void workos.signedInWith.push(opts),
        signUp: async (opts: unknown) => void workos.signedInWith.push(opts),
        signOut: () => {},
        getAccessToken: async () => "token",
        dispose: () => {},
      });
      if (!returning) {
        resolve(client(null));
        return;
      }
      // What the SDK does on the way back: the code is exchanged, the
      // callback is told, the address is tidied, and the client is handed over.
      const finish = () => {
        options.onRedirectCallback({ state: workos.state });
        const clean = new URL(location.href);
        clean.searchParams.delete("code");
        clean.searchParams.delete("state");
        history.replaceState({}, "", clean);
        resolve(client(USER));
      };
      if (workos.hold) workos.finish = finish;
      else queueMicrotask(finish);
    }),
}));

/*
 * The full-app tests below render `<App />`, which starts lazy bundled-pack
 * loads the moment it mounts. None of these tests open the marketplace or
 * check its listings, so the loads are stubbed out rather than awaited:
 * left real, they are still in flight when the test ends, and the dynamic
 * import fails once the environment is torn down.
 */
vi.mock("../library/marketplace.ts", async (original) => {
  const real = await original<typeof import("../library/marketplace.ts")>();
  return {
    ...real,
    loadMarketplace: async () => [],
    marketplaceEntry: async () => null,
  };
});

const USER = {
  object: "user",
  id: "user_SIGNIN",
  email: "signin@example.com",
  emailVerified: true,
  firstName: "Sign",
  lastName: null,
  profilePictureUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastSignInAt: null,
};

import App from "../App.tsx";
import { AccountProvider, RETURN_KEY, useAccount } from "./Account.tsx";
import { DocDrawerProvider } from "../docs/DocDrawer.tsx";
import { HostedProvider } from "../hosted/HostedProvider.tsx";
import { PlanProvider } from "../sync/PlanProvider.tsx";
import { SyncProvider } from "../sync/SyncProvider.tsx";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { ToastProvider } from "../ui/ToastProvider.tsx";
import { whoIsHere } from "../storage/who.ts";

vi.stubGlobal("scrollTo", vi.fn());
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PACK_TEXT = readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8");

function Status() {
  const account = useAccount();
  return (
    <p>
      {account.status}
      {account.status === "anonymous" && (
        <>
          <button type="button" onClick={account.signIn}>
            Sign in
          </button>
          <button type="button" onClick={account.signUp}>
            Create an account
          </button>
        </>
      )}
    </p>
  );
}

const here = () => `${location.pathname}${location.search}${location.hash}`;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  workos.state = undefined;
  workos.hold = false;
  workos.finish = null;
  workos.signedInWith = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});
afterEach(cleanup);

describe("signing in keeps the page it started from", () => {
  /** The account alone, loaded at an address, left until WorkOS has answered. */
  async function loadAt(address: string, until: string) {
    history.replaceState(null, "", address);
    render(
      <AccountProvider>
        <Status />
      </AccountProvider>,
    );
    await screen.findByText(until, { exact: false });
  }

  it("keeps where a sign-in started, in the tab, beside the state it sends", async () => {
    await loadAt("/profile/account", "anonymous");
    act(() => screen.getByRole("button", { name: "Sign in" }).click());
    expect(workos.signedInWith).toEqual([{ state: { returnTo: "/profile/account" } }]);
    expect(sessionStorage.getItem(RETURN_KEY)).toBe("/profile/account");
  });

  it("keeps where a sign-up started too", async () => {
    await loadAt("/guide/start", "anonymous");
    act(() => screen.getByRole("button", { name: "Create an account" }).click());
    expect(workos.signedInWith).toEqual([{ state: { returnTo: "/guide/start" } }]);
    expect(sessionStorage.getItem(RETURN_KEY)).toBe("/guide/start");
  });

  it("goes back to the kept page when the return comes back without its state", async () => {
    sessionStorage.setItem(RETURN_KEY, "/profile/account");
    await loadAt("/?code=abc", "signed-in");
    expect(here()).toBe("/profile/account");
  });

  it("goes where the state says when both are there", async () => {
    sessionStorage.setItem(RETURN_KEY, "/profile/account");
    workos.state = { returnTo: "/packs" };
    await loadAt("/?code=abc", "signed-in");
    expect(here()).toBe("/packs");
  });

  it("ignores a kept page the checks refuse, and lands on the app as before", async () => {
    for (const refused of ["https://elsewhere.example/profile", "//elsewhere.example/packs", "/nowhere/at/all", "/profile/<script>"]) {
      cleanup();
      sessionStorage.setItem(RETURN_KEY, refused);
      await loadAt("/?code=abc", "signed-in");
      expect(location.origin).toBe("http://localhost:3000");
      expect(here()).toBe("/play");
    }
  });

  it("forgets the kept page once the return has been handled", async () => {
    sessionStorage.setItem(RETURN_KEY, "/profile/account");
    workos.state = { returnTo: "/guide/start" };
    await loadAt("/?code=abc", "signed-in");
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it("leaves the kept page alone on a load that is not a return", async () => {
    sessionStorage.setItem(RETURN_KEY, "/profile/account");
    await loadAt("/packs", "anonymous");
    expect(here()).toBe("/packs");
    expect(sessionStorage.getItem(RETURN_KEY)).toBe("/profile/account");
  });
});

describe("signing in from a section, with a run on the account", () => {
  /**
   * The whole app, as main.tsx builds it, on the way back from WorkOS.
   *
   * The account's shelf has a pack and a run it last had open, and the
   * API says the account is on that run, which is everything that could
   * pull the page over to the run. None of it should: the page asked for
   * is the page shown.
   *
   * The return lands the moment the pack comes into play: after the
   * render that drew the run and before that render's effects have run.
   * A MutationObserver answers in that gap, as a return from the network
   * can in a browser. It is the moment the run's own address used to be
   * written over the page just put back.
   */
  async function returnTo(address: string, via: "state" | "kept") {
    // Stored in a registry of its own, as another visit would have left it.
    vi.resetModules();
    const who = await import("../storage/who.ts");
    who.whoIsHere({ kind: "account", id: USER.id });
    const db = await import("../storage/db.ts");
    const { loadPackText } = await import("@runlog/rules-schema");
    const parsed = loadPackText(PACK_TEXT, "yaml");
    if (!parsed.ok) throw new Error("the demo pack does not load");
    const at = "2026-09-20T00:00:00Z";
    const { id, title, version } = parsed.pack;
    await db.savePack({
      id,
      title,
      version,
      source: PACK_TEXT,
      format: "yaml",
      filename: "pack.yaml",
      importedAt: at,
      updatedAt: at,
      sync: true,
    });
    await db.saveRun({ runId: "run_SYNCED", packId: id, packVersion: version, packTitle: title, events: [], updatedAt: at, role: "owner" });
    localStorage.setItem("runlog:pack", id);
    localStorage.setItem(`runlog:active:${id}`, "run_SYNCED");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/me")
          ? new Response(JSON.stringify({ profile: { currentSessionId: "run_SYNCED" } }), { status: 200 })
          : new Response("{}", { status: 200 }),
      ),
    );

    if (via === "state") workos.state = { returnTo: address };
    else sessionStorage.setItem(RETURN_KEY, address);
    workos.hold = true;
    whoIsHere({ kind: "account", id: USER.id });
    history.replaceState(null, "", "/?code=abc&state=xyz");
    render(
      <HostedProvider>
        <AccountProvider>
          <PlanProvider>
            <ThemeProvider>
              <SyncProvider>
                <DocDrawerProvider>
                  <ToastProvider>
                    <App />
                  </ToastProvider>
                </DocDrawerProvider>
              </SyncProvider>
            </ThemeProvider>
          </PlanProvider>
        </AccountProvider>
      </HostedProvider>,
    );
    const landing = new MutationObserver(() => {
      // The shelf gives way to the run once the pack is in play.
      if (!workos.finish || !document.querySelector("main") || document.querySelector("main.library")) return;
      landing.disconnect();
      workos.finish();
    });
    landing.observe(document.body, { childList: true, subtree: true });
    stopLanding = () => landing.disconnect();
  }
  let stopLanding = () => {};
  afterEach(() => stopLanding());

  /**
   * Waits for the page, the address, and the pack in play behind it. The
   * run's address was written as the pack came into play, which can be
   * after the page has drawn, so the address is read only once the bar
   * offers the way back to the run: by then the pack is in play.
   */
  const settlesOn = (address: string, drawn: () => boolean) =>
    waitFor(() => {
      expect(screen.getByRole("button", { name: "Back to the run" })).toBeTruthy();
      expect(drawn()).toBe(true);
      expect(here()).toBe(address);
    });
  const profile = () => document.querySelector(".profileBody") !== null;
  const shelf = () => document.body.textContent!.includes("Your packs");

  it("lands on the account page it started from, with its state", async () => {
    await returnTo("/profile/account", "state");
    await settlesOn("/profile/account", profile);
  });

  it("lands on the shelf it started from, with its state", async () => {
    await returnTo("/packs", "state");
    await settlesOn("/packs", shelf);
  });

  it("lands on the account page it started from when the state was lost", async () => {
    await returnTo("/profile/account", "kept");
    await settlesOn("/profile/account", profile);
  });
});
