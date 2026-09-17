// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import type { Api } from "../sync/client.ts";
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

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));
vi.mock("./useReachable.ts", () => ({
  useReachable: () => ({ link: null, key: "watchkey", working: false, mint: async () => "watchkey" }),
}));
vi.mock("../control/setups.ts", async (original) => ({
  ...(await original<typeof import("../control/setups.ts")>()),
  setupsHere: async () => [],
}));
vi.mock("../control/builtin.ts", async (original) => ({
  ...(await original<typeof import("../control/builtin.ts")>()),
  builtins: async () => [],
}));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;
const mode = Object.keys(kiln.modes)[0]!;

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

const me: Account = {
  status: "signed-in",
  user: { id: "user_ME" },
  signOut: () => {},
  getAccessToken: async () => "token",
} as unknown as Account;

const at = "2026-09-16T00:00:00.000Z";
const runId = "run1";

async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) await act(async () => await Promise.resolve());
}

/** The run open on a player's device, with the host and this player at the table. */
async function table(): Promise<void> {
  current.api = {
    putSnapshot: async () => {},
    myRaces: async () => [],
    asks: async () => [],
    reactions: async () => [],
    listInvites: async () => [],
    people: async () => [],
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
    role: "player",
    members: [
      { sub: "user_HOST", role: "owner", joinedAt: at, name: "Mira" },
      { sub: "user_ME", role: "player", joinedAt: at, name: "Nate" },
    ],
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
  cleanup();
});

describe("a handout at somebody else's table", () => {
  it("says who handed out what", async () => {
    await table();
    await handout("Mira", { title: "Cleric", id: "com.example.setups.cleric" });
    expect(screen.getByRole("status").textContent).toBe("Mira handed out Cleric.");
  });

  /**
   * The server does not send the line back down the socket that sent it,
   * so this is about a second device signed into the same account: the
   * press was this account's own and it already said so.
   */
  it("says nothing about this account's own press", async () => {
    await table();
    await handout("Nate", { title: "Cleric" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the host where the table has no name for whoever pressed it", async () => {
    await table();
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
