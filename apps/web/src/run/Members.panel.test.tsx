// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import type { Api, Invite, Reaction } from "../sync/client.ts";
import type { StoredRun } from "../storage/db.ts";
import { forgetProfile } from "../sync/useProfile.ts";
import { Members } from "./Members.tsx";

/** The People panel's disclosure contract, exercised through Members. */

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));
vi.mock("./useReachable.ts", () => ({
  useReachable: () => ({ link: null, key: "watchkey", working: false, mint: async () => "watchkey" }),
}));
vi.mock("../live/route.ts", async (original) => ({
  ...(await original<typeof import("../live/route.ts")>()),
  liveLinkOf: () => null,
  rememberLiveLink: () => {},
}));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

const signedIn: Account = {
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

const sync: Sync = {
  available: true,
  enabled: true,
  setEnabled: () => {},
  status: "idle",
  last: null,
  syncNow: () => {},
  setPackSync: async () => {},
  gesture: () => false,
  drove: () => {},
};

const runOf = (extra: Partial<StoredRun> = {}): StoredRun => ({
  runId: "run-1",
  packId: kiln.id,
  packVersion: kiln.version,
  events: [],
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
  members: [{ sub: "user_ME", name: "Nate", role: "owner", joinedAt: "2026-01-01T00:00:00Z" }],
  ...extra,
});

const apiWith = ({ invites = [], reactions = [] }: { invites?: Invite[]; reactions?: Reaction[] } = {}): Api =>
  ({
    me: async () => ({ profile: null }),
    reactions: async () => reactions,
    react: async () => reactions,
    listInvites: async () => invites,
    people: async () => [],
    parties: async () => ({ parties: [], servers: [] }),
  }) as unknown as Api;

function view(account: Account, run: StoredRun = runOf()) {
  return (
    <AccountContext.Provider value={account}>
      <SyncContext.Provider value={sync}>
        <Members pack={kiln} run={run} />
      </SyncContext.Provider>
    </AccountContext.Provider>
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function panel() {
  return document.querySelector("details") as HTMLDetailsElement;
}

/** jsdom does not produce a details toggle from a click. */
function press() {
  const details = panel();
  details.open = !details.open;
  fireEvent(details, new Event("toggle", { bubbles: false }));
  return details;
}

afterEach(() => {
  cleanup();
  current.api = null;
  localStorage.clear();
  forgetProfile();
});

describe("the People disclosure", () => {
  it("starts open when signed out, with one summary rather than a nested one", () => {
    render(view({ status: "local" }, runOf({ role: undefined, members: [] })));

    expect(panel().open).toBe(true);
    expect(panel().className).toBe("panel people");
    expect(panel().querySelectorAll("summary")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("People at the table");
  });

  it("remembers a fold for this run's People panel", async () => {
    current.api = apiWith();
    const first = render(view(signedIn));
    await flush();
    expect(panel().open).toBe(true);

    press();
    expect(localStorage.getItem("runlog:disclosure.v1:panel:run-1:people")).toBe("shut");
    first.unmount();

    render(view(signedIn));
    expect(panel().open).toBe(false);
  });

  it("does not call existing invitations new when a remembered-folded panel first hydrates", async () => {
    localStorage.setItem("runlog:disclosure.v1:panel:run-1:people", "shut");
    current.api = apiWith({
      invites: [
        {
          token: "invite-existing",
          email: "kel@example.com",
          role: "player",
          createdAt: "2026-09-16T00:00:00Z",
          expiresAt: "2026-09-23T00:00:00Z",
          accepted: false,
        },
      ],
    });

    render(view(signedIn));
    expect(panel().open).toBe(false);
    await flush();

    expect(screen.getByText("kel@example.com")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "new" })).toBeNull();
  });

  it("marks a folded panel when the roster changes and clears the mark on open", async () => {
    current.api = apiWith();
    const { rerender } = render(view(signedIn));
    await flush();
    press();

    rerender(
      view(
        signedIn,
        runOf({
          members: [
            { sub: "user_ME", name: "Nate", role: "owner", joinedAt: "2026-01-01T00:00:00Z" },
            { sub: "user_KEL", name: "Kel", role: "viewer", joinedAt: "2026-09-17T00:00:00Z" },
          ],
        }),
      ),
    );
    expect(screen.getByRole("img", { name: "new" })).toBeTruthy();

    press();
    expect(screen.queryByRole("img", { name: "new" })).toBeNull();
  });

  it("marks a newly pending invitation while folded", async () => {
    current.api = apiWith();
    const { rerender } = render(view(signedIn));
    await flush();
    press();

    current.api = apiWith({
      invites: [
        {
          token: "invite-1",
          email: "kel@example.com",
          role: "player",
          createdAt: "2026-09-17T00:00:00Z",
          expiresAt: "2026-09-24T00:00:00Z",
          accepted: false,
        },
      ],
    });
    rerender(view(signedIn));
    await flush();

    expect(screen.getByRole("img", { name: "new" })).toBeTruthy();
  });

  it("does not mark reaction-only updates", async () => {
    const api = apiWith();
    api.react = async () => [{ emoji: "👏", name: "Kel", at: "2026-09-17T00:00:00Z" }];
    current.api = api;
    render(view(signedIn));
    await flush();
    press();

    fireEvent.click(screen.getByRole("button", { name: "👏" }));
    await flush();

    expect(document.querySelector(".reactRecent")).not.toBeNull();
    expect(screen.queryByRole("img", { name: "new" })).toBeNull();
  });
});
