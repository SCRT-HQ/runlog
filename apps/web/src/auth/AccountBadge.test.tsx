import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { AccountContext, type Account } from "./Account.tsx";
import { AccountBadge } from "./AccountBadge.tsx";
import { forgetProfile, rememberProfile } from "../sync/useProfile.ts";

const account = (firstName: string | null): Extract<Account, { status: "signed-in" }> => ({
  status: "signed-in",
  user: {
    object: "user",
    id: "user_TEST",
    email: "private@example.com",
    emailVerified: true,
    firstName,
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

function menu(firstName: string | null, handle?: string) {
  rememberProfile({
    createdAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-01T00:00:00Z",
    ...(handle === undefined ? {} : { handle }),
  });
  return renderToStaticMarkup(
    <AccountContext.Provider value={account(firstName)}>
      <AccountBadge />
    </AccountContext.Provider>,
  );
}

afterEach(() => forgetProfile());

describe("the account menu identity", () => {
  it("uses the chosen handle before the account first name", () => {
    const html = menu("Nate", "Ember Keeper");

    expect(html).toContain('aria-label="Account menu for Ember Keeper"');
    expect(html).not.toContain('aria-label="Account menu for Nate"');
  });

  it("uses the first name when no chosen handle exists", () => {
    const html = menu("Nate", "   ");

    expect(html).toContain('aria-label="Account menu for Nate"');
    expect(html).not.toContain("private@example.com");
  });

  it("uses Account instead of an email when the available names are blank", () => {
    const html = menu("   ", "   ");

    expect(html).toContain('aria-label="Account menu for Account"');
    expect(html).toContain(">Account</span>");
    expect(html).not.toContain("private@example.com");
  });

  it("keeps a long chosen handle in the trigger's accessible name", () => {
    const handle = "SupercalifragilisticexpialidociousAccountKeeper";
    const html = menu("Nate", handle);

    expect(html).toContain(`aria-label="Account menu for ${handle}"`);
    expect(html).toContain(`<span class="accountLabel">${handle}</span>`);
  });
});
