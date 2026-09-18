// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Api, Profile } from "../sync/client.ts";
import { forgetProfile, useProfile } from "../sync/useProfile.ts";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { NameGate } from "../auth/NameGate.tsx";
import { focusables } from "../ui/useFocusTrap.ts";
import { HostedProvider, useHosted } from "./HostedProvider.tsx";
import { TermsGate } from "./TermsGate.tsx";

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));

const signOut = vi.fn();
const signedIn: Extract<Account, { status: "signed-in" }> = {
  status: "signed-in",
  user: {
    object: "user",
    id: "user_ME",
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
  signOut,
  getAccessToken: async () => "token",
};

const hosted = {
  operator: "Example",
  support: "support@example.com",
  termsVersion: "v2",
  links: { terms: "https://example.com/terms", privacy: "https://example.com/privacy" },
  features: { billing: false, testing: false },
};

const profile = (termsVersion?: string): Profile => ({
  createdAt: "2026-01-01T00:00:00Z",
  lastSeenAt: "2026-01-01T00:00:00Z",
  name: "Nate",
  ...(termsVersion ? { termsVersion } : {}),
});

const me = (p: Profile) => ({ sub: "user_ME", sid: "session", env: "test", profile: p, entitlements: [] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function show(account: Account = signedIn, includeName = false) {
  return render(
    <AccountContext.Provider value={account}>
      <HostedProvider value={hosted}>
        <main>
          <button>Page action</button>
        </main>
        <TermsGate />
        {includeName && <NameGate />}
      </HostedProvider>
    </AccountContext.Provider>,
  );
}

function ProfileProbe() {
  const { profile } = useProfile();
  return <output aria-label="Cached profile">{profile?.name ?? "none"}</output>;
}

afterEach(() => {
  cleanup();
  forgetProfile();
  current.api = null;
  signOut.mockClear();
});

describe("the terms gate", () => {
  it("stays hidden without a signed-in API result that needs acceptance", async () => {
    show({ status: "local" });
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();

    current.api = { me: async () => me(profile("v2")) } as unknown as Api;
    show();
    await act(async () => void (await Promise.resolve()));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();

    current.api = { me: async () => Promise.reject(new Error("offline")) } as unknown as Api;
    show();
    await act(async () => void (await Promise.resolve()));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("owns focus and background interaction until the required choice is made", async () => {
    current.api = { me: async () => me(profile()) } as unknown as Api;
    show();
    const dialog = await screen.findByRole("dialog", { name: "Before you go on" });

    expect(document.activeElement?.textContent).toBe("I accept");
    expect(screen.getByText("Page action").closest("[inert]")).not.toBeNull();
    expect(focusables(document.body).map((element) => element.textContent)).toEqual([
      "terms of service",
      "privacy policy",
      "I accept",
      "Sign out instead",
    ]);
    screen.getByText("Sign out instead").focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement?.textContent).toBe("terms of service");
    const escaped = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(escaped);
    expect(escaped.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Before you go on" })).toBe(dialog);
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole("dialog", { name: "Before you go on" })).toBe(dialog);
  });

  it("keeps a rejected acceptance retryable without sending duplicates", async () => {
    const first = deferred<Profile>();
    const second = deferred<Profile>();
    const saved: Array<{ termsVersion?: string }> = [];
    current.api = {
      me: async () => me(profile()),
      putProfile: (change: Parameters<Api["putProfile"]>[0]) => {
        saved.push(change);
        return saved.length === 1 ? first.promise : second.promise;
      },
    } as unknown as Api;
    show(signedIn, true);
    const accept = await screen.findByRole("button", { name: "I accept" });
    fireEvent.click(accept);
    fireEvent.click(accept);
    expect(saved).toEqual([{ termsVersion: "v2" }]);
    const saving = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(saving.getAttribute("aria-busy")).toBe("true");
    await act(async () => first.reject(new Error("private backend detail")));
    expect(screen.getByRole("alert").textContent).toBe("We couldn't save your acceptance. Check your connection and try again.");
    expect(screen.queryByText("private backend detail")).toBeNull();
    const retry = screen.getByRole("button", { name: "I accept" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("dialog", { name: "Before you go on" })).toBeTruthy();

    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(saved).toEqual([{ termsVersion: "v2" }, { termsVersion: "v2" }]);
    await act(async () => second.resolve({ ...profile("v2"), name: "Accepted account" }));

    expect(await screen.findByLabelText("Shown as")).toBe(document.activeElement);
    expect(screen.queryByRole("dialog", { name: "Before you go on" })).toBeNull();
  });

  it("stores the accepted profile so the name gate follows in the same session", async () => {
    const stale = profile();
    const accepted = { ...stale, termsVersion: "v2", termsAcceptedAt: "2026-09-17T00:00:00Z" };
    current.api = {
      me: async () => me(stale),
      putProfile: async () => accepted,
    } as unknown as Api;
    show(signedIn, true);
    fireEvent.click(await screen.findByRole("button", { name: "I accept" }));

    expect(await screen.findByLabelText("Shown as")).toBe(document.activeElement);
    expect(screen.queryByRole("dialog", { name: "Before you go on" })).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("signs out without recording acceptance", async () => {
    const putProfile = vi.fn();
    current.api = { me: async () => me(profile()), putProfile } as unknown as Api;
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out instead" }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(putProfile).not.toHaveBeenCalled();
  });

  it("ignores an old acceptance response after the account and API change", async () => {
    const save = deferred<Profile>();
    current.api = { me: async () => me(profile()), putProfile: () => save.promise } as unknown as Api;
    function ChangingAccount() {
      const [here, setHere] = useState(true);
      const account: Account = here
        ? {
            ...signedIn,
            signOut: () => {
              forgetProfile();
              current.api = null;
              setHere(false);
            },
          }
        : { status: "local" };
      return (
        <AccountContext.Provider value={account}>
          <HostedProvider value={hosted}>
            <TermsGate />
            <ProfileProbe />
          </HostedProvider>
        </AccountContext.Provider>
      );
    }
    render(<ChangingAccount />);
    fireEvent.click(await screen.findByRole("button", { name: "I accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out instead" }));
    expect(screen.getByLabelText("Cached profile").textContent).toBe("none");

    await act(async () => save.resolve({ ...profile("v2"), name: "Old account" }));
    expect(screen.getByLabelText("Cached profile").textContent).toBe("none");
  });

  it("clears save feedback and ignores a late rejection when the account changes", async () => {
    const first = deferred<Profile>();
    const second = deferred<Profile>();
    let saves = 0;
    const api = {
      me: async () => me(profile()),
      putProfile: () => (++saves === 1 ? first.promise : second.promise),
    } as unknown as Api;
    current.api = api;
    const view = show();
    fireEvent.click(await screen.findByRole("button", { name: "I accept" }));
    await act(async () => first.reject(new Error("first account failed")));
    expect(screen.getByRole("alert")).toBeTruthy();

    const nextAccount: Extract<Account, { status: "signed-in" }> = {
      ...signedIn,
      user: { ...signedIn.user, id: "user_NEXT", email: "next@example.com" },
    };
    view.rerender(
      <AccountContext.Provider value={nextAccount}>
        <HostedProvider value={hosted}>
          <main>
            <button>Page action</button>
          </main>
          <TermsGate />
        </HostedProvider>
      </AccountContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "I accept" })).toBe(document.activeElement);
    });
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "I accept" }));
    view.rerender(
      <AccountContext.Provider value={{ ...nextAccount, user: { ...nextAccount.user, id: "user_THIRD" } }}>
        <HostedProvider value={hosted}>
          <main>
            <button>Page action</button>
          </main>
          <TermsGate />
        </HostedProvider>
      </AccountContext.Provider>,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "I accept" })).toBe(document.activeElement);
    });
    await act(async () => second.reject(new Error("old account failed")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "I accept" })).toBe(document.activeElement);
  });

  it.each(["account", "API", "terms version"] as const)("does not commit old save feedback when the %s changes", async (change) => {
    const save = deferred<Profile>();
    current.api = {
      me: async () => me(profile()),
      putProfile: () => save.promise,
    } as unknown as Api;
    const hostedValue = { ...hosted };
    const commits: Array<{ alert: string | null; version: string | undefined }> = [];

    function CommitProbe() {
      const observedHosted = useHosted();
      useLayoutEffect(() => {
        commits.push({
          alert: document.body.querySelector('[role="alert"]')?.textContent ?? null,
          version: observedHosted?.termsVersion,
        });
      });
      return null;
    }

    function gate(account: Account) {
      return (
        <AccountContext.Provider value={account}>
          <HostedProvider value={hostedValue}>
            <TermsGate />
            <CommitProbe />
          </HostedProvider>
        </AccountContext.Provider>
      );
    }

    const view = render(gate(signedIn));
    fireEvent.click(await screen.findByRole("button", { name: "I accept" }));
    await act(async () => save.reject(new Error("old context failed")));
    expect(screen.getByRole("alert")).toBeTruthy();
    commits.length = 0;

    const nextAccount: Account = change === "account" ? { ...signedIn, user: { ...signedIn.user, id: "user_NEXT" } } : signedIn;
    if (change === "API") current.api = { me: async () => me(profile()) } as unknown as Api;
    if (change === "terms version") hostedValue.termsVersion = "v3";
    view.rerender(gate(nextAccount));

    expect(commits[0]).toEqual({ alert: null, version: change === "terms version" ? "v3" : "v2" });
  });
});
