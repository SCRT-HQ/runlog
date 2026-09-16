// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import type { Api } from "../sync/client.ts";
import type { StoredRun } from "../storage/db.ts";
import { rememberLiveLink } from "../live/route.ts";
import { forgetProfile } from "../sync/useProfile.ts";
import { Members } from "./Members.tsx";

/**
 * The three buttons under the table, pressed.
 *
 * A browser for this one, because what is under test is what a press
 * does: the sheet that opens, what it sends, what lands on the clipboard.
 * What the panel draws before anything is pressed is in Members.test.tsx.
 */

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));
vi.mock("./useReachable.ts", () => ({ useReachable: () => ({ link: null, key: "watchkey", working: false }) }));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

const LINK = "https://runlog.test/#run/run-1?t=tok";

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

/** What the panel asks the server for on its own, answered with nothing. */
const quiet = {
  me: async () => ({ profile: null }),
  reactions: async () => [],
  listInvites: async () => [],
  people: async () => [],
};

const written: string[] = [];

/** A handful of microtask turns, for the promise chains the presses start. */
async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) await act(async () => await Promise.resolve());
}

const show = async (api: Partial<Api>, run: StoredRun = runOf()) => {
  current.api = { ...quiet, ...api } as unknown as Api;
  render(
    <AccountContext.Provider value={signedIn}>
      <SyncContext.Provider value={sync}>
        <Members pack={kiln} run={run} />
      </SyncContext.Provider>
    </AccountContext.Provider>,
  );
  await flush();
};

beforeEach(() => {
  written.length = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
});

afterEach(() => {
  current.api = null;
  rememberLiveLink("run-1", null);
  forgetProfile();
  cleanup();
});

describe("inviting someone", () => {
  it("opens a sheet, sends the address and the role, and closes on the way out", async () => {
    const sent: Array<[string, string, string]> = [];
    await show({
      createInvite: (async (id: string, to: string, role: string) => {
        sent.push([id, to, role]);
      }) as unknown as Api["createInvite"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Invite someone" }));
    const field = screen.getByLabelText("Email address to invite");
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: "kel@example.com" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "viewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await flush();

    expect(sent).toEqual([["run-1", "kel@example.com", "viewer"]]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Sent to kel@example.com. The link works for seven days.");
    // Back where the press came from, so a keyboard is not left at the top.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Invite someone" }));
  });

  it("stays open, with what went wrong, when it did not send", async () => {
    await show({
      createInvite: (async () => {
        throw new Error("That address is not one we can reach.");
      }) as Api["createInvite"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Invite someone" }));
    fireEvent.change(screen.getByLabelText("Email address to invite"), { target: { value: "kel@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await flush();

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain("That address is not one we can reach.");
  });

  it("closes on Escape", async () => {
    await show({});
    fireEvent.click(screen.getByRole("button", { name: "Invite someone" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await flush(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends nothing while the address is empty", async () => {
    await show({});
    fireEvent.click(screen.getByRole("button", { name: "Invite someone" }));
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("the live link", () => {
  it("copies the link the device remembers", async () => {
    rememberLiveLink("run-1", LINK);
    await show({}, runOf({ shared: true }));

    fireEvent.click(screen.getByRole("button", { name: "Copy live link" }));
    await flush();

    expect(written).toEqual([LINK]);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  /** One press opens the run to watchers and puts the link on the clipboard. */
  it("shares and copies in the one press", async () => {
    await show({ shareRun: (async () => ({ link: LINK })) as Api["shareRun"] });

    fireEvent.click(screen.getByRole("button", { name: "Share a live link" }));
    await flush();

    expect(written).toEqual([LINK]);
    // The slot is the copy button from here on, and it says what just happened.
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeTruthy();
  });

  it("stops sharing, and says the link is dead", async () => {
    rememberLiveLink("run-1", LINK);
    const stopped: string[] = [];
    await show({ unshareRun: (async (id: string) => stopped.push(id)) as unknown as Api["unshareRun"] }, runOf({ shared: true }));

    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    await flush();

    expect(stopped).toEqual(["run-1"]);
    expect(screen.queryByRole("button", { name: "Stop sharing" })).toBeNull();
    expect(screen.getByText("The link is dead; anyone holding it sees nothing now.")).toBeTruthy();
  });
});
