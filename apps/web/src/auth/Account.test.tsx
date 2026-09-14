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

  it("puts the theme first, and sends the rest of the settings to the profile", () => {
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "");
    /*
     * The theme is the one thing in here somebody changes on a whim and
     * undoes ten seconds later, so it is the first thing and it is the
     * switch itself rather than a door to one.
     *
     * Signed out there is no profile to speak of, so Settings stays as
     * the only way to reach the page the rest of them live on.
     */
    const html = renderToStaticMarkup(
      <AccountProvider>
        <AccountBadge onOpenProfile={() => {}} />
      </AccountProvider>,
    );
    expect(html).toContain("<select");
    expect(html).toContain("Settings");
    expect(html).toContain("sounds, dice, rolls");
    // The theme is not something Settings holds any more.
    expect(html).not.toContain("theme, sounds, dice, rolls");
    // And the switch comes before the door.
    expect(html.indexOf("<select")).toBeLessThan(html.indexOf("Settings"));
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
