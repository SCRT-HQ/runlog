// The account-menu dismiss tests below need real effects and real DOM
// events (a keydown, a pointerdown outside it): renderToStaticMarkup runs
// no effects at all, so this file renders those few cases into jsdom.
// @vitest-environment jsdom
import { StrictMode, act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { AccountBadge, syncLabel, syncTone } from "../auth/AccountBadge.tsx";
import type { Api, PendingInvite, Profile } from "../sync/client.ts";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import { useInvites } from "../share/useInvites.ts";
import { PROFILE_PAGES, profileHash, profilePageFromHash, type ProfilePage } from "./route.ts";
import { ProfileView } from "./ProfileView.tsx";
import type { Plan } from "../sync/usePlan.ts";
import { whoIsHere } from "../storage/who.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The invitations a device sees are read by a hook shared with the account
 * menu; mocked here so a test can say how many are waiting without a real
 * server, and both the menu's badge and the Social page agree with it.
 */
const inviteBoundary = vi.hoisted(() => ({ value: [] as unknown[] | null }));
vi.mock("../share/useInvites.ts", async (original) => {
  const real = await original<typeof import("../share/useInvites.ts")>();
  return {
    ...real,
    useInvites: (api: Parameters<typeof real.useInvites>[0], open: boolean) =>
      inviteBoundary.value === null ? real.useInvites(api, open) : { invites: inviteBoundary.value, refresh: () => {}, forget: () => {} },
  };
});
const apiBoundary = vi.hoisted(() => ({
  create: null as null | ((base: string, getAccessToken: () => Promise<string>) => unknown),
}));
vi.mock("../sync/client.ts", async (original) => {
  const real = await original<typeof import("../sync/client.ts")>();
  return {
    ...real,
    createApi: (base: string, getAccessToken: () => Promise<string>) =>
      apiBoundary.create ? apiBoundary.create(base, getAccessToken) : real.createApi(base, getAccessToken),
  };
});
const storageBoundary = vi.hoisted(() => ({
  listLicenses: null as null | (() => Promise<unknown[]>),
  listPacks: null as null | (() => Promise<unknown[]>),
  listRuns: null as null | (() => Promise<unknown[]>),
}));
vi.mock("../storage/db.ts", async (original) => {
  const real = await original<typeof import("../storage/db.ts")>();
  return {
    ...real,
    listLicenses: () => (storageBoundary.listLicenses ? storageBoundary.listLicenses() : real.listLicenses()),
    listPacks: () => (storageBoundary.listPacks ? storageBoundary.listPacks() : real.listPacks()),
    listRuns: () => (storageBoundary.listRuns ? storageBoundary.listRuns() : real.listRuns()),
  };
});
const planResult = vi.hoisted(() => ({ value: null as Plan | null }));
vi.mock("../sync/usePlan.ts", () => ({ usePlan: () => planResult.value }));

const plan = (servers = false): Plan => ({
  state: {
    kind: "ready",
    ownerId: "user_01TEST",
    gates: true,
    capabilities: { hostTables: false, waivePublisherFee: false, hostServers: false },
    offers: { servers, serversOpen: true, publishersOpen: true },
  },
  access: () => "upgrade",
  refresh: async () => {},
});

function stubInvites(invites: PendingInvite[]) {
  inviteBoundary.value = invites;
}

// Nothing here waits on a server by default; a test opts into a busier
// account by calling stubInvites again with something in it.
beforeEach(() => {
  stubInvites([]);
  planResult.value = plan(false);
  apiBoundary.create = null;
  storageBoundary.listLicenses = null;
  storageBoundary.listPacks = null;
  storageBoundary.listRuns = null;
});

const invite = (token: string): PendingInvite => ({
  token,
  role: "player",
  createdAt: "2026-01-01T00:00:00Z",
  expiresAt: "2026-02-01T00:00:00Z",
  packId: "pack_1",
  packTitle: "Ember Trail",
  session: null,
  inviter: "Someone",
  alreadyIn: false,
});

/**
 * The profile at first paint, with a stand-in account.
 *
 * Static markup means no effects: storage has not been read and the server
 * has not been asked. What has to be right at that moment is the shape of
 * the page, who it is for, and that nothing destructive is a single press.
 */

const signedIn: Account = {
  status: "signed-in",
  user: {
    object: "user",
    id: "user_01TEST",
    email: "n@example.com",
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

const signedInAs = (id: string, firstName: string): Extract<Account, { status: "signed-in" }> => ({
  ...signedIn,
  user: { ...signedIn.user, id, firstName, email: `${firstName.toLowerCase()}@example.com` },
  getAccessToken: async () => `token-${id}`,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const page = (account: Account, options: { page?: ProfilePage } = {}) =>
  renderToStaticMarkup(
    <AccountContext.Provider value={account}>
      <ProfileView onBack={() => {}} {...options} />
    </AccountContext.Provider>,
  );

function railIds(html: string): string[] {
  const root = document.createElement("div");
  root.innerHTML = html;
  return Array.from(root.querySelectorAll("nav[aria-label='Profile pages'] a")).map((link) => link.getAttribute("href") ?? "");
}

describe("the profile", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    stubInvites([]);
  });

  it("says who it is for, with an id worth copying rather than reading", () => {
    const html = page(signedIn);
    expect(html).toContain("Nate");
    expect(html).toContain("n@example.com");
    expect(html).toContain('data-account-id="user_01TEST"');
    expect(html).toContain("Copy account id");
    // The raw id is not left sitting in the page for a shoulder-surfer to read.
    expect(html).not.toMatch(/>user_01TEST</);
  });

  it("shows the sync table with a column for this device and one for the account", () => {
    const html = page(signedIn, { page: "profile" });
    expect(html).toContain("On this device");
    expect(html).toContain("In your account");
    expect(html).toContain(">Runs<");
    expect(html).toContain(">Packs<");
    expect(html).toContain("License keys");
  });

  it("keeps the device sync switch and manual action wired on Profile", () => {
    const setEnabled = vi.fn();
    const syncNow = vi.fn();
    const sync: Sync = {
      available: true,
      enabled: true,
      setEnabled,
      status: "synced",
      last: null,
      syncNow,
      setPackSync: async () => {},
      gesture: () => false,
      drove: () => {},
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AccountContext.Provider value={signedIn}>
          <SyncContext.Provider value={sync}>
            <ProfileView page="profile" onBack={() => {}} />
          </SyncContext.Provider>
        </AccountContext.Provider>,
      );
    });

    const switchInput = container.querySelector(".syncSwitch input") as HTMLInputElement;
    expect(switchInput.checked).toBe(true);
    act(() => switchInput.click());
    expect(setEnabled).toHaveBeenCalledWith(false);

    const syncButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Sync now");
    act(() => syncButton?.click());
    expect(syncNow).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  });

  it("asks an anonymous visitor to sign in, and offers the way back", () => {
    const html = page({ status: "anonymous", signIn: () => {}, signUp: () => {} });
    expect(html).toContain("Sign in");
    expect(html).toContain("Back to the game");
    expect(html).not.toContain("Delete everything");
  });

  it("takes a local private route straight to device Settings", () => {
    const html = page({ status: "local" });
    expect(html).toContain("This device");
    expect(railIds(html)).toEqual(["#profile/settings"]);
    expect(html).not.toContain(">Sign in<");
  });
});

describe("the profile's pages", () => {
  afterEach(() => {
    stubInvites([]);
    sessionStorage.clear();
  });

  it("reads a page from the hash, and a bare #profile as the first one", () => {
    expect(profilePageFromHash("#profile")).toBe("profile");
    expect(profilePageFromHash("#profile/publishing")).toBe("publishing");
    expect(profilePageFromHash("#profile/developer")).toBe("developer");
    expect(profilePageFromHash("#profile/account")).toBe("account");
    expect(profilePageFromHash("#profile/social")).toBe("social");
    expect(profilePageFromHash("#profile/servers")).toBe("servers");
    expect(profilePageFromHash("#profile/nonsense")).toBe("profile");
    expect(profilePageFromHash("#guide")).toBeNull();
    expect(profileHash("profile")).toBe("#profile");
    expect(profileHash("developer")).toBe("#profile/developer");
    expect(profileHash("social")).toBe("#profile/social");
  });

  it("renders Profile: the account's identity and what sync has carried", () => {
    const html = page(signedIn, { page: "profile" });
    expect(html).toContain("<h2>Profile</h2>");
    expect(html).toContain("Copy account id");
    expect(html).not.toContain("Sign out");
  });

  it("names Servers in the nav only for an account the tier is open to, or on the page itself", () => {
    // Nothing is known about the plan at first paint, so the tier is not offered.
    expect(page(signedIn, { page: "profile" })).not.toContain(">Servers<");
    // But whoever followed a claim code is on the page, and the page names itself.
    expect(page(signedIn, { page: "servers" })).toContain(">Servers<");

    planResult.value = plan(true);
    expect(page(signedIn, { page: "profile" })).toContain(">Servers<");
  });

  it("renders Servers, saying what a server needs where this process has no API, and asks before claiming one a code arrived for", () => {
    planResult.value = plan(true);
    const html = page(signedIn, { page: "servers" });
    expect(html).toContain("<h2>Servers</h2>");
    expect(html).toContain("hosted copy of Runlog");
    expect(html).not.toContain("Claim it for this account");
    // A code from /setup claim, kept across the sign-in round trip, is offered rather than acted on.
    sessionStorage.setItem("runlog:link", JSON.stringify({ kind: "guild", code: "CLAIMA" }));
    const asked = page(signedIn, { page: "servers" });
    expect(asked).toContain("Discord asked to claim a server for this account");
    expect(asked).toContain("n@example.com");
    expect(asked).toContain("Claim it for this account");
    expect(asked).toContain("Not now");
    // A link code for a Discord account is Social's business, not this page's.
    sessionStorage.setItem("runlog:link", JSON.stringify({ kind: "discord", code: "ABCDEF" }));
    expect(page(signedIn, { page: "servers" })).not.toContain("Discord asked to claim");
  });

  it("renders Publishing without developer-key controls", () => {
    const html = page(signedIn, { page: "publishing" });
    expect(html).toContain("<h2>Publishing</h2>");
    expect(html).not.toContain("Command line");
    expect(html).not.toContain("RUNLOG_API_KEY");
  });

  it("renders Developer keys as its own signed-in page", () => {
    const html = page(signedIn, { page: "developer" });
    expect(html).toContain("<h2>Developer keys</h2>");
    expect(html).toContain("Sign in on a hosted address to make a key for the command line.");
  });

  it("renders Account: the plan, purchases, license keys, your data, and sign-out", () => {
    const html = page(signedIn, { page: "account" });
    expect(html).toContain("<h2>Account</h2>");
    expect(html).toContain("Sign out");
    expect(html).toContain("Delete everything of mine on the server");
    expect(html).not.toContain("Yes, delete");
    expect(html).toContain("None yet. Open a sealed copy");
  });

  it("renders Social: open tables and people played with (inviting a friend needs an API this process has none of)", () => {
    const html = page(signedIn, { page: "social" });
    expect(html).toContain("<h2>Social</h2>");
    expect(html).toContain("Open tables");
    expect(html).toContain("People you have played with");
  });

  it("the Social page lists exactly the invitations waiting, and the nav's count matches", () => {
    stubInvites([invite("t1"), invite("t2")]);
    const html = page(signedIn, { page: "social" });
    expect(html).toContain("Invitations");
    // One badge in the nav, one li per invitation: both agree with the stub.
    expect((html.match(/>2<\/span>/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
  });

  it("carries no badge on Social when nothing is waiting", () => {
    stubInvites([]);
    const html = page(signedIn, { page: "profile" });
    const socialChip = /<a href="#profile\/social"[^>]*>([\s\S]*?)<\/a>/.exec(html)?.[1] ?? "";
    expect(socialChip).not.toContain("menuBadge");
  });
});

describe("profile page policy", () => {
  afterEach(() => {
    planResult.value = plan(false);
    stubInvites([]);
    sessionStorage.clear();
  });

  it("shows only Settings while account status is checking, without offering a sign-in action", () => {
    const signIn = vi.fn();
    const create = vi.fn(() => ({}));
    apiBoundary.create = create;
    const meta = document.createElement("meta");
    meta.name = "runlog:sign-in";
    meta.content = "client_TEST";
    document.head.appendChild(meta);
    const html = page({ status: "checking", signIn }, { page: "account" });

    expect(railIds(html)).toEqual(["#profile/settings"]);
    expect(html).toContain("Checking your account…");
    expect(html).not.toContain(">Sign in<");
    expect(html).not.toContain("<h2>Account</h2>");
    expect(create).not.toHaveBeenCalled();
    meta.remove();
  });

  it("shows only Settings to an anonymous visitor and offers both account doors", () => {
    const html = page({ status: "anonymous", signIn: () => {}, signUp: () => {} }, { page: "publishing" });

    expect(railIds(html)).toEqual(["#profile/settings"]);
    expect(html).toContain(">Sign in<");
    expect(html).toContain("Create an account");
    expect(html).not.toContain("<h2>Publishing</h2>");
  });

  it("renders Settings immediately and requests address replacement for a local private route", () => {
    const onNavigate = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AccountContext.Provider value={{ status: "local" }}>
          <ProfileView page="account" onBack={() => {}} onNavigate={onNavigate} />
        </AccountContext.Provider>,
      );
    });

    expect(railIds(container.innerHTML)).toEqual(["#profile/settings"]);
    expect(container.querySelector("a[aria-current='page']")?.getAttribute("href")).toBe("#profile/settings");
    expect(container.textContent).toContain("This device");
    expect(container.textContent).not.toContain("nothing to sign into");
    expect(onNavigate).toHaveBeenCalledWith("settings", "replace");

    act(() => root.unmount());
    container.remove();
  });

  it("draws the current profile page with the tab rule, keyed on aria-current", () => {
    const html = page({ status: "local" }, { page: "settings" });
    expect(html).toMatch(/class="chip pick pickTab" aria-current="page"/);
    expect(html).not.toContain("chip pick on");
  });

  it("shows every applicable page to a signed-in account without consulting paid capabilities", () => {
    planResult.value = plan(true);
    expect(railIds(page(signedIn, { page: "profile" }))).toEqual([
      "#profile",
      "#profile/publishing",
      "#profile/developer",
      "#profile/account",
      "#profile/social",
      "#profile/servers",
      "#profile/settings",
    ]);
  });

  it("renders a server-specific checking state without exposing the claimed-servers list", () => {
    planResult.value = {
      ...plan(false),
      state: { kind: "loading", ownerId: signedIn.user.id },
    };
    const html = page(signedIn, { page: "servers" });
    expect(html).toContain("Checking server availability…");
    expect(html).not.toContain("Discord servers you claimed");
  });

  it("renders server-specific unavailable and error states instead of silently selecting Profile", () => {
    planResult.value = plan(false);
    const unavailable = page(signedIn, { page: "servers" });
    expect(unavailable).toContain("Servers are not available on this deployment.");
    expect(unavailable).not.toContain("<h2>Profile</h2>");

    planResult.value = {
      ...plan(false),
      state: { kind: "error", ownerId: signedIn.user.id, message: "offline" },
    };
    const failed = page(signedIn, { page: "servers" });
    expect(failed).toContain("Server availability could not be checked.");
    expect(failed).not.toContain("<h2>Profile</h2>");
  });

  it("keeps a pending Discord claim, and its Not now, reachable over an unsupported deployment", () => {
    planResult.value = plan(false);
    sessionStorage.setItem("runlog:link", JSON.stringify({ kind: "guild", code: "CLAIMA" }));
    const html = page(signedIn, { page: "servers" });
    expect(html).toContain("Servers are not available on this deployment.");
    expect(html).toContain("Discord asked to claim a server for this account");
    expect(html).toContain("Not now");
    expect(html).not.toContain("Claim it for this account");
  });

  it("keeps Purchases, License keys, data actions, and Sign out regardless of the plan's own state", async () => {
    const account = signedInAs("user_01TEST", "Alice");
    const api = {
      putProfile: async () => ({ createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z" }),
      myPurchases: async () => [
        { ref: "sale_1", packId: "pack_1", title: "Ember Trail", status: "fulfilled" as const, createdAt: "2026-01-01T00:00:00Z" },
      ],
    } as unknown as Api;
    apiBoundary.create = () => api;
    const meta = document.createElement("meta");
    meta.name = "runlog:sign-in";
    meta.content = "client_TEST";
    document.head.appendChild(meta);
    whoIsHere({ kind: "account", id: account.user.id });
    storageBoundary.listLicenses = vi.fn(async () => []);
    storageBoundary.listPacks = vi.fn(async () => []);
    storageBoundary.listRuns = vi.fn(async () => []);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const states: Plan[] = [
      { state: { kind: "checking" }, access: () => "checking", refresh: async () => {} },
      { state: { kind: "error", ownerId: account.user.id, message: "offline" }, access: () => "error", refresh: async () => {} },
      plan(false),
      { ...plan(false), access: () => "available" },
    ];

    try {
      for (const [index, candidate] of states.entries()) {
        planResult.value = candidate;
        const render = () =>
          root.render(
            <AccountContext.Provider value={account}>
              <ProfileView page="account" onBack={() => {}} />
            </AccountContext.Provider>,
          );
        if (index === 0) {
          await act(async () => {
            render();
            await Promise.resolve();
          });
        } else {
          act(render);
        }
        expect(container.textContent).toContain("Purchases");
        expect(container.textContent).toContain("Ember Trail");
        expect(container.textContent).toContain("License keys");
        expect(container.textContent).toContain("Your data on the server");
        expect(container.textContent).toContain("Delete everything of mine on the server");
        expect(container.textContent).toContain("Sign out");
      }
    } finally {
      act(() => root.unmount());
      container.remove();
      meta.remove();
    }
  });
});

describe("profile account ownership", () => {
  it("keeps private state stable across an ordinary account-context rerender", async () => {
    const getAccessToken = async () => "token-stable";
    const account = { ...signedInAs("user_01TEST", "Alice"), getAccessToken };
    const people = deferred<Array<{ sub: string; name: string; lastPlayedAt: string }>>();
    const api = {
      putProfile: async () => ({
        name: "Alice profile",
        createdAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-01T00:00:00Z",
      }),
      people: () => people.promise,
      connections: async () => ({ available: true, connections: [], discord: null }),
      myInvitations: async () => [],
    } as unknown as Api;
    const create = vi.fn(() => api);
    apiBoundary.create = create;
    const meta = document.createElement("meta");
    meta.name = "runlog:sign-in";
    meta.content = "client_TEST";
    document.head.appendChild(meta);
    whoIsHere({ kind: "account", id: account.user.id });
    storageBoundary.listLicenses = vi.fn(async () => []);
    storageBoundary.listPacks = vi.fn(async () => []);
    storageBoundary.listRuns = vi.fn(async () => []);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <AccountContext.Provider value={account}>
            <ProfileView page="social" onBack={() => {}} />
          </AccountContext.Provider>,
        );
        await Promise.resolve();
      });
      await act(async () => people.resolve([{ sub: "alice", name: "Alice Person", lastPlayedAt: "2026-01-01T00:00:00Z" }]));
      expect(container.textContent).toContain("Alice Person");

      act(() => {
        root.render(
          <AccountContext.Provider value={{ ...account }}>
            <ProfileView page="social" onBack={() => {}} />
          </AccountContext.Provider>,
        );
      });

      expect(container.textContent).toContain("Alice Person");
      expect(create).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      container.remove();
      meta.remove();
    }
  });

  it("clears private children on the first same-owner API render and ignores the old API's late people", async () => {
    const account = signedInAs("user_01TEST", "Alice");
    const nextAccount = { ...account, getAccessToken: async () => "token-replaced" };
    const oldConnections = deferred<{
      available: boolean;
      connections: Array<{ service: "discord"; accountId: string; name: string; linkedAt: string }>;
      discord: null;
    }>();
    const oldPeople = deferred<Array<{ sub: string; name: string; lastPlayedAt: string }>>();
    const nextConnections = deferred<{ available: boolean; connections: never[]; discord: null }>();
    const nextPeople = deferred<Array<{ sub: string; name: string; lastPlayedAt: string }>>();
    const profile = {
      createdAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-01T00:00:00Z",
    };
    const oldApi = {
      putProfile: async () => profile,
      people: () => oldPeople.promise,
      connections: () => oldConnections.promise,
      myInvitations: async () => [],
    } as unknown as Api;
    const nextApi = {
      putProfile: async () => profile,
      people: () => nextPeople.promise,
      connections: () => nextConnections.promise,
      myInvitations: async () => [],
    } as unknown as Api;
    let made = 0;
    apiBoundary.create = () => (made++ === 0 ? oldApi : nextApi);
    const meta = document.createElement("meta");
    meta.name = "runlog:sign-in";
    meta.content = "client_TEST";
    document.head.appendChild(meta);
    whoIsHere({ kind: "account", id: account.user.id });
    storageBoundary.listLicenses = vi.fn(async () => []);
    storageBoundary.listPacks = vi.fn(async () => []);
    storageBoundary.listRuns = vi.fn(async () => []);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const renderTrace: string[] = [];
    function TracedProfile({ value }: { value: Account }) {
      const boundary = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => {
        renderTrace.push(boundary.current?.textContent ?? "");
      }, [value]);
      return (
        <div ref={boundary}>
          <AccountContext.Provider value={value}>
            <ProfileView page="social" onBack={() => {}} />
          </AccountContext.Provider>
        </div>
      );
    }

    try {
      await act(async () => {
        root.render(<TracedProfile value={account} />);
        await Promise.resolve();
      });
      await act(async () =>
        oldConnections.resolve({
          available: true,
          connections: [
            {
              service: "discord",
              accountId: "alice-discord",
              name: "Alice Discord",
              linkedAt: "2026-01-01T00:00:00Z",
            },
          ],
          discord: null,
        }),
      );
      expect(container.textContent).toContain("Alice Discord");

      act(() => {
        root.render(<TracedProfile value={nextAccount} />);
      });
      expect(renderTrace.at(-1)).not.toContain("Alice Discord");

      await act(async () => {
        nextConnections.resolve({ available: true, connections: [], discord: null });
        nextPeople.resolve([{ sub: "bob", name: "New API Person", lastPlayedAt: "2026-01-01T00:00:00Z" }]);
      });
      expect(container.textContent).toContain("New API Person");

      await act(async () => oldPeople.resolve([{ sub: "alice", name: "Old API Person", lastPlayedAt: "2026-01-01T00:00:00Z" }]));
      expect(container.textContent).toContain("New API Person");
      expect(container.textContent).not.toContain("Old API Person");
    } finally {
      act(() => root.unmount());
      container.remove();
      meta.remove();
    }
  });

  it("keeps the keyed owner's storage live through StrictMode effect replay", async () => {
    whoIsHere({ kind: "account", id: signedIn.user.id });
    storageBoundary.listLicenses = vi.fn(async () => []);
    storageBoundary.listPacks = vi.fn(async () => []);
    storageBoundary.listRuns = vi.fn(async () => [
      {
        runId: "strict-run",
        packId: "strict-pack",
        packTitle: "Strict owner run",
        updatedAt: "2026-01-01T00:00:00Z",
        members: [
          { sub: "one", role: "owner" },
          { sub: "two", role: "player" },
        ],
      },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <StrictMode>
          <AccountContext.Provider value={signedIn}>
            <ProfileView page="social" onBack={() => {}} />
          </AccountContext.Provider>
        </StrictMode>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Strict owner run");
    act(() => root.unmount());
    container.remove();
  });

  it("does not let a ready B Servers page open storage while the device still names A", async () => {
    const accountB = signedInAs("user_02TEST", "Bob");
    const readyForB = plan(true);
    planResult.value = {
      ...readyForB,
      state: readyForB.state.kind === "ready" ? { ...readyForB.state, ownerId: accountB.user.id } : readyForB.state,
    };
    whoIsHere({ kind: "account", id: "user_01TEST" });
    const listLicenses = vi.fn(async () => []);
    const listPacks = vi.fn(async () => []);
    const listRuns = vi.fn(async () => []);
    storageBoundary.listLicenses = listLicenses;
    storageBoundary.listPacks = listPacks;
    storageBoundary.listRuns = listRuns;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AccountContext.Provider value={accountB}>
          <ProfileView page="servers" onBack={() => {}} />
        </AccountContext.Provider>,
      );
      await Promise.resolve();
    });

    expect(listLicenses).not.toHaveBeenCalled();
    expect(listPacks).not.toHaveBeenCalled();
    expect(listRuns).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it("drops A's state on the first B render, ignores A's late private answers, and waits for B's storage owner", async () => {
    const accountA = signedInAs("user_01TEST", "Alice");
    const accountB = signedInAs("user_02TEST", "Bob");
    const aProfile = deferred<Profile>();
    const aPeople = deferred<Array<{ sub: string; name: string; lastPlayedAt: string }>>();
    const aConnections = deferred<{
      available: boolean;
      connections: Array<{ service: "discord"; accountId: string; name: string; linkedAt: string }>;
      discord: null;
    }>();
    const aInvites = deferred<PendingInvite[]>();
    const aGuilds = deferred<{
      guilds: Array<{ guildId: string; name: string; ownerSub: string; claimedAt: string; updatedAt: string }>;
      server: boolean;
      open: boolean;
    }>();
    const bProfile = deferred<Profile>();
    const bPeople = deferred<Array<{ sub: string; name: string; lastPlayedAt: string }>>();
    const bConnections = deferred<{ available: boolean; connections: never[]; discord: null }>();
    const bInvites = deferred<PendingInvite[]>();
    const apiA = {
      putProfile: vi.fn(() => aProfile.promise),
      people: vi.fn(() => aPeople.promise),
      connections: vi.fn(() => aConnections.promise),
      myInvitations: vi.fn(async () => []),
      myInvites: vi.fn(() => aInvites.promise),
      myGuilds: vi.fn(() => aGuilds.promise),
      guildPacks: vi.fn(async () => []),
    } as unknown as Api;
    const apiB = {
      putProfile: vi.fn(() => bProfile.promise),
      people: vi.fn(() => bPeople.promise),
      connections: vi.fn(() => bConnections.promise),
      myInvitations: vi.fn(async () => []),
      myInvites: vi.fn(() => bInvites.promise),
    } as unknown as Api;
    let made = 0;
    apiBoundary.create = () => (made++ === 0 ? apiA : apiB);
    inviteBoundary.value = null;
    const meta = document.createElement("meta");
    meta.name = "runlog:sign-in";
    meta.content = "client_TEST";
    document.head.appendChild(meta);

    let storageOwner: "A" | "B" = "A";
    const listLicenses = vi.fn(async () => []);
    const listPacks = vi.fn(async () => []);
    const listRuns = vi.fn(async () => [
      {
        runId: storageOwner === "A" ? "run-a" : "run-b",
        packId: storageOwner === "A" ? "pack-a" : "pack-b",
        packTitle: storageOwner === "A" ? "Alice private run" : "Bob private run",
        updatedAt: "2026-01-01T00:00:00Z",
        members: [
          { sub: "one", role: "owner" },
          { sub: "two", role: "player" },
        ],
      },
    ]);
    storageBoundary.listLicenses = listLicenses;
    storageBoundary.listPacks = listPacks;
    storageBoundary.listRuns = listRuns;
    whoIsHere({ kind: "account", id: accountA.user.id });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const renderAs = async (account: Account, page: ProfilePage) => {
      await act(async () => {
        root.render(
          <AccountContext.Provider value={account}>
            <ProfileView page={page} onBack={() => {}} />
          </AccountContext.Provider>,
        );
        await Promise.resolve();
      });
    };

    try {
      planResult.value = plan(true);
      await renderAs(accountA, "social");
      expect(container.textContent).toContain("Alice private run");
      await renderAs(accountA, "servers");
      expect(apiA.myGuilds).toHaveBeenCalled();

      await renderAs({ status: "checking", signIn: () => {} }, "social");
      const callsBeforeB = [listLicenses.mock.calls.length, listPacks.mock.calls.length, listRuns.mock.calls.length] as const;
      await renderAs(accountB, "social");
      expect([listLicenses.mock.calls.length, listPacks.mock.calls.length, listRuns.mock.calls.length]).toEqual(callsBeforeB);
      expect(container.textContent).not.toContain("Alice private run");

      await act(async () => {
        aProfile.resolve({
          name: "Alice profile",
          handle: "AliceHandle",
          createdAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-01-01T00:00:00Z",
        });
        aPeople.resolve([{ sub: "alice", name: "Alice Person", lastPlayedAt: "2026-01-01T00:00:00Z" }]);
        aConnections.resolve({
          available: true,
          connections: [
            {
              service: "discord",
              accountId: "alice-discord",
              name: "Alice Discord",
              linkedAt: "2026-01-01T00:00:00Z",
            },
          ],
          discord: null,
        });
        aInvites.resolve([invite("alice-invite")]);
        aGuilds.resolve({
          guilds: [
            {
              guildId: "alice-guild",
              name: "Alice Guild",
              ownerSub: accountA.user.id,
              claimedAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          ],
          server: true,
          open: true,
        });
      });
      expect(container.textContent).not.toMatch(/Alice (profile|Person|Discord|Guild|private run)/);
      expect(container.querySelector(".menuBadge")).toBeNull();

      storageOwner = "B";
      await act(async () => whoIsHere({ kind: "account", id: accountB.user.id }));
      expect(listLicenses.mock.calls.length).toBe(callsBeforeB[0] + 1);
      expect(listPacks.mock.calls.length).toBe(callsBeforeB[1] + 1);
      expect(listRuns.mock.calls.length).toBe(callsBeforeB[2] + 1);
      expect(container.textContent).toContain("Bob private run");

      await act(async () => {
        bProfile.resolve({
          name: "Bob profile",
          createdAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-01-01T00:00:00Z",
        });
        bPeople.resolve([{ sub: "bob", name: "Bob Person", lastPlayedAt: "2026-01-01T00:00:00Z" }]);
        bConnections.resolve({ available: true, connections: [], discord: null });
        bInvites.resolve([{ ...invite("bob-invite"), inviter: "Bob Inviter" }]);
      });
      expect(container.textContent).toContain("Bob Person");
      expect(container.textContent).toContain("Bob Inviter");
      expect(container.textContent).not.toContain("Alice");
    } finally {
      act(() => root.unmount());
      container.remove();
      meta.remove();
      inviteBoundary.value = [];
    }
  });
});

describe("the account menu", () => {
  afterEach(() => stubInvites([]));

  it("is the name, with the profile and sign-out behind it", () => {
    stubInvites([]);
    const html = renderToStaticMarkup(
      <AccountContext.Provider value={signedIn}>
        <AccountBadge onOpenProfile={() => {}} />
      </AccountContext.Provider>,
    );
    expect(html).toContain("<summary");
    expect(html).toContain("Nate");
    expect(html).toContain("Profile");
    expect(html).toContain("Sign out");
    expect(html).toContain('role="menu"');
  });

  it("shows no light and no switch where sync is not available, as in this process", () => {
    stubInvites([]);
    const html = renderToStaticMarkup(
      <AccountContext.Provider value={signedIn}>
        <AccountBadge onOpenProfile={() => {}} />
      </AccountContext.Provider>,
    );
    expect(html).not.toContain("led");
    expect(html).not.toContain("Sync on this device");
  });

  it("lights up by where sync stands", () => {
    expect(syncTone({ available: false, enabled: true, status: "synced" })).toBeNull();
    expect(syncTone({ available: true, enabled: false, status: "off" })).toBe("off");
    expect(syncTone({ available: true, enabled: true, status: "syncing" })).toBe("busy");
    expect(syncTone({ available: true, enabled: true, status: "synced" })).toBe("fine");
    expect(syncTone({ available: true, enabled: true, status: "offline" })).toBe("warn");
    expect(syncLabel({ enabled: false, status: "off", last: null })).toContain("off");
    expect(syncLabel({ enabled: true, status: "unauthorized", last: null })).toContain("Sign in again");
  });

  it("leaves the profile out where nobody wired one", () => {
    stubInvites([]);
    const html = renderToStaticMarkup(
      <AccountContext.Provider value={signedIn}>
        <AccountBadge />
      </AccountContext.Provider>,
    );
    expect(html).not.toContain("Profile");
    expect(html).toContain("Sign out");
  });

  /**
   * The menu used to expand the waiting invitations right there, with their
   * own Join and Decline buttons: the same list this suite now finds on
   * the profile's Social page. The menu's job is only to say how many are
   * waiting and open the door to them.
   */
  describe("invitations", () => {
    it("says nothing when none are waiting", () => {
      stubInvites([]);
      const html = renderToStaticMarkup(
        <AccountContext.Provider value={signedIn}>
          <AccountBadge onOpenProfile={() => {}} />
        </AccountContext.Provider>,
      );
      expect(html).not.toContain("Invitations");
    });

    it("names the count and opens Social, rather than listing them inline", () => {
      stubInvites([invite("t1"), invite("t2")]);
      const onOpenProfile = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(
          <AccountContext.Provider value={signedIn}>
            <AccountBadge onOpenProfile={onOpenProfile} />
          </AccountContext.Provider>,
        );
      });
      const details = container.querySelector("details") as HTMLDetailsElement;
      act(() => {
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
      });
      const entry = Array.from(container.querySelectorAll("button.accountItem")).find((b) => b.textContent?.includes("Invitations"));
      expect(entry?.textContent).toContain("Invitations (2)");
      // No Join/Decline here any more: that list moved to Social.
      expect(container.querySelector(".inviteList")).toBeNull();
      act(() => (entry as HTMLButtonElement).click());
      expect(onOpenProfile).toHaveBeenCalledWith("social");
      act(() => root.unmount());
      container.remove();
    });
  });

  /**
   * It used to have none of this: no Escape, no click outside, no reaction
   * to leaving the page. A reviewer found it stuck open across two page
   * changes with nothing but its own toggle to close it.
   */
  describe("dismisses itself", () => {
    let root: Root;
    let container: HTMLElement;

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
      stubInvites([]);
    });

    // Renders the menu already open, sidestepping the native <details>
    // click-to-toggle path: jsdom fires that "toggle" event as a queued
    // task, which lands outside this render's own act() call.
    function openMenu(closeKey?: unknown) {
      stubInvites([]);
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      const renderWith = (key: unknown) =>
        act(() => {
          root.render(
            <AccountContext.Provider value={signedIn}>
              <AccountBadge closeKey={key} onOpenProfile={() => {}} />
            </AccountContext.Provider>,
          );
        });
      renderWith(closeKey);
      const details = container.querySelector("details") as HTMLDetailsElement;
      act(() => {
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
      });
      return { details, renderWith };
    }

    it("closes on Escape", () => {
      const { details } = openMenu();
      expect(details.hasAttribute("open")).toBe(true);
      act(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(details.hasAttribute("open")).toBe(false);
    });

    it("closes on a click outside it", () => {
      const { details } = openMenu();
      act(() => {
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      });
      expect(details.hasAttribute("open")).toBe(false);
    });

    it("closes when the view changes underneath it", () => {
      const { details, renderWith } = openMenu("play");
      expect(details.hasAttribute("open")).toBe(true);
      renderWith("profile");
      expect(details.hasAttribute("open")).toBe(false);
    });
  });
});

/**
 * The device's settings, as a page of the profile.
 *
 * The same pane the run's settings opens on. Somebody who is not in a run
 * had nowhere at all to turn the sounds off, and somebody who is should
 * not have to leave one to do it, so it is both rather than either.
 */
describe("the settings page", () => {
  it("is one of the profile's pages", () => {
    expect(PROFILE_PAGES.map((p) => p.id)).toContain("settings");
    expect(profilePageFromHash("#profile/settings")).toBe("settings");
    expect(profileHash("settings")).toBe("#profile/settings");
  });

  it("offers what is kept on this device, and says the theme is elsewhere", () => {
    const html = renderToStaticMarkup(<ProfileView page="settings" onBack={() => {}} />);
    expect(html).toContain("Alerts");
    expect(html).toContain("Roll for me, without asking");
    expect(html).toContain("carry on by itself");
    // Not here: it is in the account menu, and saying so beats leaving
    // somebody to hunt for it.
    expect(html).toContain("account menu");
  });

  it("keeps the setups somebody has, as their own section under the device's", () => {
    const html = renderToStaticMarkup(<ProfileView page="settings" onBack={() => {}} />);
    expect(html).toContain("Setups");
    expect(html).toContain("Load a setup from a file");
    // Under the device's settings rather than inside them: that pane is
    // also the first tab of a run's settings, and it is preferences only.
    expect(html.indexOf("Load a setup from a file")).toBeGreaterThan(html.indexOf("carry on by itself"));
  });

  it("says nothing about a run's dice, because there is no run here", () => {
    // The seeded line belongs to an open run. On this page "roll for me"
    // means the default the next run starts with, and is always a choice.
    const html = renderToStaticMarkup(<ProfileView page="settings" onBack={() => {}} />);
    expect(html).not.toContain("rolls from its seed");
  });
});

/**
 * The account menu, in the order somebody reaches for things.
 *
 * The theme is changed on a whim and put back; the profile is where
 * everything about the account is, including its sync controls.
 * Settings was a door to a sheet that is a page of the profile
 * now, so it is not a door any more.
 */
describe("the account menu, signed in", () => {
  const menu = () =>
    renderToStaticMarkup(
      <AccountContext.Provider value={signedIn}>
        <AccountBadge onOpenProfile={() => {}} />
      </AccountContext.Provider>,
    );

  it("offers no Settings of its own, because the profile holds them", () => {
    expect(menu()).not.toContain("sounds, dice, rolls");
  });

  it("does not repeat the address, which is on the profile page itself", () => {
    expect(menu()).not.toContain("n@example.com");
  });

  it("puts the theme first, then the profile, then sign out", () => {
    const html = menu();
    const theme = html.indexOf("<select");
    const profile = html.indexOf("your keys, your data, your devices");
    const signOut = html.lastIndexOf("Sign out");
    expect(theme).toBeGreaterThan(-1);
    expect(profile).toBeGreaterThan(theme);
    expect(signOut).toBeGreaterThan(profile);
  });
});
