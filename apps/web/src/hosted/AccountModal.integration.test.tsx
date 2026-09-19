// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Doc } from "@runlog/rules-schema";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { NameGate } from "../auth/NameGate.tsx";
import { DocDrawerProvider, useDocDrawer } from "../docs/DocDrawer.tsx";
import type { Api, Profile } from "../sync/client.ts";
import { forgetProfile } from "../sync/useProfile.ts";
import { HostedProvider } from "./HostedProvider.tsx";
import { TermsGate } from "./TermsGate.tsx";

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));

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
  signOut: () => {},
  getAccessToken: async () => "token",
};

const hosted = {
  operator: "Example",
  support: "support@example.com",
  termsVersion: "v2",
  links: { terms: "https://example.com/terms", privacy: "https://example.com/privacy" },
  features: { billing: false, testing: false },
};

const stale: Profile = { createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z", name: "Nate" };
const accepted: Profile = { ...stale, termsVersion: "v2", termsAcceptedAt: "2026-09-17T00:00:00Z", handleSetAt: "2026-01-02T00:00:00Z" };
const api = {
  me: async () => ({
    sub: "user_ME",
    sid: "session",
    env: "test",
    profile: stale,
    entitlements: [],
    capabilities: { hostTables: false, waivePublisherFee: false, hostServers: false },
  }),
  putProfile: async () => accepted,
} as unknown as Api;

const doc = {
  kind: "summary",
  layout: "book",
  title: "Example document",
  blocks: [{ kind: "paragraph", text: "Keyboard fixture for com.example.modal." }],
} as Doc;

function Fixture() {
  const drawer = useDocDrawer();
  const [, rerender] = useState(0);
  const [signedInNow, setSignedInNow] = useState(true);
  const account: Account = signedInNow
    ? {
        ...signedIn,
        signOut: () => {
          current.api = null;
          setSignedInNow(false);
        },
      }
    : { status: "local" };
  return (
    <AccountContext.Provider value={account}>
      <HostedProvider value={hosted}>
        <div className="app">
          <main>
            <button onClick={() => drawer.show("Example packet", [{ label: "Briefing", make: () => doc }])}>Open document</button>
            <button
              onClick={() => {
                current.api = api;
                rerender((value) => value + 1);
              }}
            >
              Reveal terms
            </button>
          </main>
          <TermsGate />
        </div>
      </HostedProvider>
    </AccountContext.Provider>
  );
}

async function openIn(order: "drawer-first" | "gate-first") {
  render(
    <DocDrawerProvider>
      <Fixture />
    </DocDrawerProvider>,
  );
  if (order === "drawer-first") fireEvent.click(screen.getByRole("button", { name: "Open document" }));
  fireEvent.click(screen.getByRole("button", { name: "Reveal terms" }));
  const gate = await screen.findByRole("dialog", { name: "Before you go on" });
  if (order === "gate-first") fireEvent.click(screen.getByRole("button", { name: "Open document", hidden: true }));
  const drawer = await screen.findByRole("dialog", { name: "Example document: Briefing", hidden: true });
  await waitFor(() => {
    expect(gate.closest("[inert]")).toBeNull();
    expect(drawer.closest("[inert]")).not.toBeNull();
    expect(gate.contains(document.activeElement)).toBe(true);
  });
  return { gate, drawer };
}

async function waitForDrawerOwner(drawer: HTMLElement) {
  await waitFor(() => {
    expect(drawer.closest("[inert]")).toBeNull();
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("button", { name: "Open document", hidden: true }).closest("[inert]")).not.toBeNull();
  });
}

async function waitForDrawerRelease() {
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Example document: Briefing", hidden: true })).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Open document" }).closest("[inert]")).toBeNull();
  });
}

afterEach(() => {
  cleanup();
  forgetProfile();
  current.api = null;
  location.hash = "";
});

describe("required account gates with the document drawer", () => {
  it.each(["pending", "stale", "failed"].flatMap((readState) => [false, true].map((duplicate) => ({ readState, duplicate }))))(
    "hands off to Name despite a pre-save profile read ($readState, duplicate: $duplicate)",
    async ({ readState, duplicate }) => {
      let finishRead!: (value: Awaited<ReturnType<Api["me"]>>) => void;
      let failRead!: (error: Error) => void;
      const pending = new Promise<Awaited<ReturnType<Api["me"]>>>((resolve, reject) => {
        finishRead = resolve;
        failRead = reject;
      });
      const response = {
        ...(await api.me()),
        profile: duplicate ? { ...stale, handle: "Existing", handleSetAt: "2026-01-02T00:00:00Z" } : stale,
        handleTaken: duplicate,
      };
      current.api = {
        ...api,
        me: vi.fn().mockResolvedValueOnce(response).mockReturnValue(pending),
        putProfile: async () => ({ ...response.profile, termsVersion: "v2" }),
      };
      render(
        <AccountContext.Provider value={signedIn}>
          <HostedProvider value={hosted}>
            <TermsGate />
            <NameGate />
          </HostedProvider>
        </AccountContext.Provider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: "I accept" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Before you go on", hidden: true })).toBeNull());
      if (readState === "stale") await act(async () => finishRead(response));
      if (readState === "failed") await act(async () => failRead(new Error("Offline")));
      expect(await screen.findByRole("dialog", { name: "How should people see you?" })).toBeTruthy();
      if (readState === "pending") await act(async () => finishRead(response));
      expect(screen.getAllByRole("dialog", { name: "How should people see you?" })).toHaveLength(1);
      await waitFor(() => {
        const name = screen.getByRole("dialog", { name: "How should people see you?" });
        expect(name.closest("[inert]")).toBeNull();
        expect(name.contains(document.activeElement)).toBe(true);
      });
      expect(screen.queryByRole("dialog", { name: "Before you go on", hidden: true })).toBeNull();
    },
  );

  it.each(["drawer-first", "gate-first"] as const)("keeps the account gate active when opened %s", async (order) => {
    location.hash = "#keep-this-address";
    const { gate, drawer } = await openIn(order);

    expect(gate.closest("[inert]")).toBeNull();
    expect(drawer.closest("[inert]")).not.toBeNull();
    expect(gate.contains(document.activeElement)).toBe(true);
    expect(location.hash).toBe("#keep-this-address");
    const escaped = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(escaped);
    expect(escaped.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Before you go on" })).toBe(gate);

    fireEvent.click(screen.getByRole("button", { name: "I accept" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Before you go on" })).toBeNull();
      expect(drawer.closest("[inert]")).toBeNull();
      expect(drawer.contains(document.activeElement)).toBe(true);
    });
    expect(drawer.closest("[inert]")).toBeNull();
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("button", { name: "Open document", hidden: true }).closest("[inert]")).not.toBeNull();

    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    await waitForDrawerRelease();
    expect(screen.queryByRole("dialog", { name: "Example document: Briefing", hidden: true })).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Open document" }).closest("[inert]")).toBeNull();
    expect(location.hash).toBe("#keep-this-address");
  });

  it("reactivates the covered drawer when signing out hides an asking gate", async () => {
    const { drawer } = await openIn("drawer-first");
    fireEvent.click(screen.getByRole("button", { name: "Sign out instead" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Before you go on" })).toBeNull());
    await waitForDrawerOwner(drawer);

    expect(drawer.closest("[inert]")).toBeNull();
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("button", { name: "Open document", hidden: true }).closest("[inert]")).not.toBeNull();
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    await waitForDrawerRelease();
    expect(screen.queryByRole("dialog", { name: "Example document: Briefing", hidden: true })).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});
