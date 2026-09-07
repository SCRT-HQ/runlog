import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { AccountBadge, syncLabel, syncTone } from "../auth/AccountBadge.tsx";
import { ProfileView } from "./ProfileView.tsx";

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
});
