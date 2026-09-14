import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountProvider } from "./Account.tsx";
import { AccountBadge } from "./AccountBadge.tsx";

/**
 * The first paint, before WorkOS has been asked.
 *
 * Static markup is that moment exactly: effects have not run. It has to show
 * the app whether or not a client is configured, signing in is an offer, not
 * a door, and the header has to be right from the start, because a button
 * that appears a second later is a header that shuffles.
 */
describe("the account", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("shows the app straight away when there is nothing to sign into", () => {
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "");
    const html = renderToStaticMarkup(
      <AccountProvider>
        <main>the app</main>
      </AccountProvider>,
    );
    expect(html).toBe("<main>the app</main>");
  });

  it("shows the app straight away when there is, too", () => {
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
    const html = renderToStaticMarkup(
      <AccountProvider>
        <main>the app</main>
      </AccountProvider>,
    );
    expect(html).toContain("<main>the app</main>");
    expect(html).not.toContain("Checking who is here");
  });

  it("offers a menu with no doors where there is nothing to sign into", () => {
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "");
    const html = renderToStaticMarkup(
      <AccountProvider>
        <AccountBadge />
      </AccountProvider>,
    );
    expect(html).toContain("Menu");
    expect(html).not.toContain("Sign in");
    expect(html).toContain("Theme");
  });

  it("keeps the theme in the menu, whether or not there is a settings sheet to open", () => {
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "");
    /*
     * It used to be one or the other: a Settings item where the app had a
     * sheet, the theme itself where it did not. Changing the theme is the
     * one thing in there somebody does on a whim and undoes ten seconds
     * later, and it was behind a dialog that had to be shut to see what
     * it did.
     */
    const withSheet = renderToStaticMarkup(
      <AccountProvider>
        <AccountBadge onOpenSettings={() => {}} />
      </AccountProvider>,
    );
    expect(withSheet).toContain("Settings");
    expect(withSheet).toContain("<select");
    // And the sheet no longer claims the theme is in it.
    expect(withSheet).toContain("sounds, dice, rolls");
    expect(withSheet).not.toContain("theme, sounds, dice, rolls");

    const without = renderToStaticMarkup(
      <AccountProvider>
        <AccountBadge />
      </AccountProvider>,
    );
    expect(without).toContain("<select");
  });

  it("offers sign-in from the first paint where there is", () => {
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
    const html = renderToStaticMarkup(
      <AccountProvider>
        <AccountBadge />
      </AccountProvider>,
    );
    expect(html).toContain("Sign in");
    // Not pressable until the client exists, but present so nothing moves.
    expect(html).toContain("disabled");
  });
});
