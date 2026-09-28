// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { createThemeRecordFromPreset, presentationSnapshotKey, type HexColor } from "@runlog/themes";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { forgetProfile, rememberProfile } from "../sync/useProfile.ts";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { openThemeRepository } from "../theme/themeStorage.ts";
import * as colorSampler from "../theme/browserColorSampler.ts";
import { AppShell } from "./AppShell.tsx";

function viewport(mobile: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: mobile,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return (next: boolean) =>
    act(() => {
      query.matches = next;
      for (const listener of listeners) listener();
    });
}

function shell(account: Account = { status: "local" }) {
  return render(
    <AccountContext.Provider value={account}>
      <ThemeProvider>
        <AppShell
          brand={<a href="/">Runlog</a>}
          pageKey="library"
          items={[{ label: "Packs", icon: "packs", act: () => {} }]}
          onOpenProfile={async () => true}
          onOpenThemes={async () => true}
          onAccountAction={async (action) => {
            action();
            return true;
          }}
        >
          <main>
            <button>Page action</button>
          </main>
        </AppShell>
      </ThemeProvider>
    </AccountContext.Provider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  forgetProfile();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("dismisses with Escape or the backdrop, releases the page, and returns keyboard focus", async () => {
  viewport(true);
  shell();
  const opener = screen.getByRole("button", { name: "Open sidebar" });
  for (const method of ["escape", "backdrop"]) {
    opener.focus();
    fireEvent.click(opener);
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.querySelector("main")!.hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    if (method === "escape") fireEvent.keyDown(window, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: "Dismiss navigation" }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    expect(document.querySelector("main")!.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("");
  }
});

it("preserves the desktop choice while resizing through an open mobile drawer", () => {
  const resize = viewport(false);
  shell();
  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  resize(true);
  expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
  resize(false);
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  expect(document.querySelector("main")!.hasAttribute("inert")).toBe(false);
  resize(true);
  expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
});

it("still toggles when device storage refuses reads and writes", () => {
  viewport(false);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  shell();
  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
});

it("resets a chosen theme through the sidebar and closes the drawer after completion", async () => {
  viewport(true);
  shell();
  const picker = screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement;
  fireEvent.change(picker, { target: { value: "builtin:ember" } });
  await waitFor(() => expect(picker.value).toBe("builtin:ember"));
  fireEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
  fireEvent.click(screen.getByRole("button", { name: "Revert Default Theme" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
  expect(picker.value).toBe("system");
});

it("opens theme contrast review outside the sticky header and restores the picker after cancellation", async () => {
  viewport(false);
  // jsdom cannot sample painted pixels; supply a low-contrast browser sample
  // while retaining the real report, acknowledgement dialog and focus handling.
  vi.spyOn(colorSampler, "createBrowserColorSampler").mockImplementation((snapshot) => ({
    snapshotKey: presentationSnapshotKey(snapshot),
    sample: () => ({ foreground: "#777777" as HexColor, background: "#ffffff" as HexColor }),
    dispose() {},
  }));
  const made = createThemeRecordFromPreset({ id: "sidebar-contrast", name: "Contrast review", presetId: "daylight" });
  if (!made.ok) throw new Error("Invalid fixture");
  const repository = await openThemeRepository({ kind: "local" });
  await repository.saveTheme({ record: made.value, expectedLocalRevision: null });
  repository.close();
  shell();
  await screen.findByRole("option", { name: "Contrast review · Custom" });
  const picker = screen.getByRole("combobox", { name: "Theme" });
  picker.focus();
  fireEvent.change(picker, { target: { value: "saved:sidebar-contrast" } });
  const review = await screen.findByRole("dialog", { name: "Review contrast warnings" });
  // Fixed overlays inside this backdrop-filtered header are clipped to its height
  // and sit behind the sidebar, regardless of the overlay's own z-index.
  expect(review.closest("header")).toBeNull();
  expect(review.contains(document.activeElement)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(document.activeElement).toBe(picker));
});

it("shows signed-in identity and Profile without exposing the account email, and signs out from the drawer", async () => {
  viewport(true);
  rememberProfile({ createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z", handle: "Ember Keeper" });
  const signOut = vi.fn();
  shell({
    status: "signed-in",
    user: {
      object: "user",
      id: "sidebar-user",
      email: "private@example.com",
      emailVerified: true,
      firstName: "Nate",
      lastName: null,
      profilePictureUrl: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      lastSignInAt: null,
      externalId: undefined,
    },
    signOut,
    getAccessToken: async () => "token",
  });
  fireEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
  expect(screen.getByText("Ember Keeper")).toBeTruthy();
  expect(document.body.textContent).not.toContain("private@example.com");
  expect(screen.getByRole("button", { name: "Profile" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
  expect(signOut).toHaveBeenCalledTimes(1);
});
