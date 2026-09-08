// The account-menu dismiss tests below need real effects and real DOM
// events (a keydown, a pointerdown outside it) — renderToStaticMarkup runs
// no effects at all, so this file renders those few cases into jsdom.
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { AccountBadge, syncLabel, syncTone } from "../auth/AccountBadge.tsx";
import { ProfileView } from "./ProfileView.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The profile at first paint, with a stand-in account.
 *
 * Static markup means no effects: storage has not been read and the server
 * has not been asked. What has to be right at that moment is the shape of
 * the page — who it is for, and that nothing destructive is a single press.
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

const page = (account: Account) =>
  renderToStaticMarkup(
    <AccountContext.Provider value={account}>
      <ProfileView onBack={() => {}} />
    </AccountContext.Provider>,
  );

describe("the profile", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("says who it is for, and offers sign-out and the destructive thing behind a second press", () => {
    const html = page(signedIn);
    expect(html).toContain("Nate");
    expect(html).toContain("n@example.com");
    expect(html).toContain("user_01TEST");
    expect(html).toContain("Sign out");
    expect(html).toContain("Delete everything of mine on the server");
    expect(html).not.toContain("Yes, delete");
    // Nothing to sign into in the test process: the server button cannot go anywhere.
    expect(html).toMatch(/Delete everything of mine on the server<\/button>/);
    expect(html).toContain("None yet. Open a sealed copy");
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

describe("the account menu", () => {
  it("is the name, with the profile and sign-out behind it", () => {
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
    const html = renderToStaticMarkup(
      <AccountContext.Provider value={signedIn}>
        <AccountBadge />
      </AccountContext.Provider>,
    );
    expect(html).not.toContain("Profile");
    expect(html).toContain("Sign out");
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
    });

    // Renders the menu already open, sidestepping the native <details>
    // click-to-toggle path: jsdom fires that "toggle" event as a queued
    // task, which lands outside this render's own act() call.
    function openMenu(closeKey?: unknown) {
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
