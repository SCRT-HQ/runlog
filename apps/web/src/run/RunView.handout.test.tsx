// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadPackText, type Setup } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import type { Api } from "../sync/client.ts";
import type { StoredRun } from "../storage/db.ts";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import { syncBus } from "../sync/bus.ts";
import { memoryRunStore } from "./store.ts";
import { RunView } from "./RunView.tsx";

/**
 * The host hands a setup out and everybody else's copy of the run says
 * so. The press announces itself where it was made; every other player
 * at the table was re-equipped without a word until this.
 */

const current: { api: Api | null; setups: Setup[]; tool: string | null } = { api: null, setups: [], tool: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));
vi.mock("./useReachable.ts", () => ({
  useReachable: () => ({ link: null, key: "watchkey", working: false, mint: async () => "watchkey" }),
}));
vi.mock("../control/setups.ts", async (original) => ({
  ...(await original<typeof import("../control/setups.ts")>()),
  setupsHere: async () => current.setups,
}));
vi.mock("../control/builtin.ts", async (original) => ({
  ...(await original<typeof import("../control/builtin.ts")>()),
  builtins: async () => (current.tool ? [{ id: "b", title: "b", pack: kiln.id, profile: { tool: current.tool } }] : []),
}));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;
const mode = Object.keys(kiln.modes)[0]!;

const gesture = vi.fn<Sync["gesture"]>(() => true);
const sync: Sync = {
  available: true,
  enabled: true,
  setEnabled: () => {},
  status: "idle",
  last: null,
  syncNow: () => {},
  setPackSync: async () => {},
  gesture,
  drove: () => {},
};

const me: Account = {
  status: "signed-in",
  user: { id: "user_ME" },
  signOut: () => {},
  getAccessToken: async () => "token",
} as unknown as Account;

const at = "2026-09-16T00:00:00.000Z";
const runId = "run1";

type Member = NonNullable<StoredRun["members"]>[number];

/** The host is somebody else, and this player is at their table. */
const theirs: Member[] = [
  { sub: "user_HOST", role: "owner", joinedAt: at, name: "Mira" },
  { sub: "user_ME", role: "player", joinedAt: at, name: "Nate" },
];

async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) await act(async () => await Promise.resolve());
}

/** The run open on a device, with whoever is at the table. */
async function table(members: Member[] = theirs, record: Partial<StoredRun> = {}): Promise<void> {
  current.api = {
    putSnapshot: async () => {},
    myRaces: async () => [],
    asks: async () => [],
    reactions: async () => [],
    listInvites: async () => [],
    people: async () => [],
    parties: async () => ({ parties: [], servers: [] }),
    streamKeys: async () => [],
    me: async () => ({ profile: null }),
  } as unknown as Api;
  const store = memoryRunStore();
  await store.saveRun({
    runId,
    packId: kiln.id,
    packVersion: kiln.version,
    packTitle: kiln.title,
    events: [{ id: "e1", t: "RunStarted", at, packId: kiln.id, packVersion: kiln.version, runId, mode }] as RunEvent[],
    updatedAt: at,
    role: members.find((m) => m.sub === "user_ME")?.role === "owner" ? "owner" : "player",
    members,
    ...record,
  });
  store.setActiveRunFor(kiln.id, runId);
  render(
    <AccountContext.Provider value={me}>
      <SyncContext.Provider value={sync}>
        <RunView pack={kiln} store={store} />
      </SyncContext.Provider>
    </AccountContext.Provider>,
  );
  await flush();
}

const handout = (from: string | undefined, data: Record<string, unknown>) =>
  act(() => {
    syncBus.emit({ t: "gesture", id: runId, kind: "setup", data, ...(from ? { from } : {}), at });
  });

afterEach(() => {
  current.api = null;
  current.setups = [];
  current.tool = null;
  gesture.mockClear();
  cleanup();
});

describe("a handout at somebody else's table", () => {
  it("says who handed out what", async () => {
    await table();
    await handout("Mira", { title: "Cleric", id: "com.example.setups.cleric" });
    expect(screen.getByRole("status").textContent).toBe("Mira handed out Cleric.");
  });

  /**
   * Two people at one table can show the same name: only a claimed handle
   * is unique, and an account without one is shown its first name. Read
   * off the line, that made this player the host and cost them every
   * handout for the rest of the run.
   */
  it("says so where this player shows the same name as the host", async () => {
    await table([
      { sub: "user_HOST", role: "owner", joinedAt: at, name: "Nate" },
      { sub: "user_ME", role: "player", joinedAt: at, name: "Nate" },
    ]);
    await handout("Nate", { title: "Cleric" });
    expect(screen.getByRole("status").textContent).toBe("Nate handed out Cleric.");
  });

  /**
   * The owner is the only member who can hand a setup out, so a page on
   * the owner's account has nothing to be told. The device that pressed
   * is never sent the line; this is about a second device of theirs.
   */
  it("says nothing on the host's own devices", async () => {
    await table([
      { sub: "user_ME", role: "owner", joinedAt: at, name: "Nate" },
      { sub: "user_HOST", role: "player", joinedAt: at, name: "Mira" },
    ]);
    await handout("Nate", { title: "Cleric" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the host where the table has no name for them", async () => {
    await table([
      { sub: "user_HOST", role: "owner", joinedAt: at },
      { sub: "user_ME", role: "player", joinedAt: at, name: "Nate" },
    ]);
    await handout(undefined, { title: "Cleric" });
    expect(screen.getByRole("status").textContent).toBe("The host handed out Cleric.");
  });

  /** An older copy of the app sends the word with nothing in it; there is nothing to announce. */
  it("says nothing for a handout that names nothing", async () => {
    await table();
    await handout("Mira", {});
    expect(screen.queryByRole("status")).toBeNull();
  });
});

/**
 * The button under Settings, which is not only an announcement: the
 * gesture is what makes the server hand the loadout to whatever is
 * attached, so it goes out whether or not this page can name it.
 */
describe("the Hand out button", () => {
  const starter: Setup = {
    kind: "setup",
    schemaVersion: 1,
    id: "com.example.setups.starter",
    version: "1.0.0",
    title: "Starter",
    tool: "ExampleTool",
    ops: [{ op: "player.give", args: { item: "a bowl" } }],
  };

  /** The Control tab of the settings dialog, on a run the host has open. */
  const openControl = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Control" }));
    // The list of setups on offer is read on the panel's own effect.
    await flush();
  };

  it("sends the word for a saved setup whose credits did not survive", async () => {
    current.setups = [starter];
    current.tool = starter.tool;
    // What a run written by an older build can hold: the operations are
    // there and there is nothing left to call them.
    await table(
      [
        { sub: "user_ME", role: "owner", joinedAt: at, name: "Nate" },
        { sub: "user_HOST", role: "player", joinedAt: at, name: "Mira" },
      ],
      { setup: { from: [{ id: "com.example.setups.starter" }], ops: [{ op: "player.give" }] } },
    );
    await openControl();
    fireEvent.click(screen.getByRole("button", { name: "Hand it out" }));
    // The snapshot goes first, and the word once it has landed.
    await flush();
    expect(gesture).toHaveBeenCalledWith(runId, "setup", {});
    expect(screen.getByText("Handed out. Anyone attached has it now.")).toBeTruthy();
  });

  it("names what it handed out where the run still knows", async () => {
    current.setups = [starter];
    current.tool = starter.tool;
    await table(
      [
        { sub: "user_ME", role: "owner", joinedAt: at, name: "Nate" },
        { sub: "user_HOST", role: "player", joinedAt: at, name: "Mira" },
      ],
      { setup: { from: [{ id: starter.id, title: starter.title, version: starter.version }], ops: starter.ops } },
    );
    await openControl();
    fireEvent.click(screen.getByRole("button", { name: "Hand it out" }));
    await flush();
    expect(gesture).toHaveBeenCalledWith(runId, "setup", { title: "Starter", id: "com.example.setups.starter" });
  });
});
