// The account-menu dismiss tests below need real effects and real DOM
// events (a keydown, a pointerdown outside it): renderToStaticMarkup runs
// no effects at all, so this file renders those few cases into jsdom.
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { AccountBadge, syncLabel, syncTone } from "../auth/AccountBadge.tsx";
import type { PendingInvite } from "../sync/client.ts";
import { useInvites } from "../share/useInvites.ts";
import { profileHash, profilePageFromHash, type ProfilePage } from "./route.ts";
import { ProfileView } from "./ProfileView.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The invitations a device sees are read by a hook shared with the account
 * menu; mocked here so a test can say how many are waiting without a real
 * server, and both the menu's badge and the Social page agree with it.
 */
vi.mock("../share/useInvites.ts", () => ({ useInvites: vi.fn() }));

function stubInvites(invites: PendingInvite[]) {
  vi.mocked(useInvites).mockReturnValue({ invites, refresh: () => {}, forget: () => {} });
}

// Nothing here waits on a server by default; a test opts into a busier
// account by calling stubInvites again with something in it.
beforeEach(() => stubInvites([]));

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

const page = (account: Account, options: { page?: ProfilePage } = {}) =>
  renderToStaticMarkup(
    <AccountContext.Provider value={account}>
      <ProfileView onBack={() => {}} {...options} />
    </AccountContext.Provider>,
  );

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

  it("asks an anonymous visitor to sign in, and offers the way back", () => {
    const html = page({ status: "anonymous", signIn: () => {}, signUp: () => {} });
    expect(html).toContain("Sign in");
    expect(html).toContain("Back to the game");
    expect(html).not.toContain("Delete everything");
  });

  it("explains itself where there is nothing to sign into", () => {
    const html = page({ status: "local" });
    expect(html).toContain("nothing to sign into");
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
    expect(profilePageFromHash("#profile/account")).toBe("account");
    expect(profilePageFromHash("#profile/social")).toBe("social");
    expect(profilePageFromHash("#profile/servers")).toBe("servers");
    expect(profilePageFromHash("#profile/nonsense")).toBe("profile");
    expect(profilePageFromHash("#guide")).toBeNull();
    expect(profileHash("profile")).toBe("#profile");
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
  });

  it("renders Servers, saying what a server needs where this process has no API, and asks before claiming one a code arrived for", () => {
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

  it("renders Publishing as one paragraph and a link to the Designer, with no publisher, no listings and no keys", () => {
    const html = page(signedIn, { page: "publishing" });
    expect(html).toContain("<h2>Publishing</h2>");
    expect(html).toContain('href="#create"');
    expect(html).not.toContain("Nothing uploaded yet");
    expect(html).not.toContain("Reading…");
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
