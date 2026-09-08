import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import type { Api } from "../sync/client.ts";
import type { StoredRun } from "../storage/db.ts";
import { Members } from "./Members.tsx";

/**
 * The People panel at first paint: what it says about where the run stands
 * with the account, and whether it is open or folded.
 *
 * Static markup runs no effects, so nothing is fetched. The API is a stand-in
 * that is either there or not; what is under test is the copy, which used
 * to say "until this run has reached your account through sync" beside an
 * account menu that said "Synced just now".
 */

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));

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

const syncOf = (available: boolean, enabled: boolean): Sync => ({
  available,
  enabled,
  setEnabled: () => {},
  status: enabled ? "idle" : "off",
  last: null,
  syncNow: () => {},
  setPackSync: async () => {},
  gesture: () => {},
});

const runOf = (extra: Partial<StoredRun> = {}): StoredRun => ({
  runId: "run-1",
  packId: kiln.id,
  packVersion: kiln.version,
  events: [],
  updatedAt: "2026-01-01T00:00:00Z",
  ...extra,
});

const panel = (run: StoredRun, sync: Sync, api: Api | null = {} as Api) => {
  current.api = api;
  return renderToStaticMarkup(
    <AccountContext.Provider value={signedIn}>
      <SyncContext.Provider value={sync}>
        <Members pack={kiln} run={run} />
      </SyncContext.Provider>
    </AccountContext.Provider>,
  );
};

describe("people at the table", () => {
  it("asks for a sign-in where there is nothing to ask", () => {
    const html = panel(runOf(), syncOf(false, false), null);
    expect(html).toContain("Sign in to share this firing");
  });

  it("says the firing stays here while sync is off, and offers the switch", () => {
    const html = panel(runOf(), syncOf(true, false));
    expect(html).toContain("stays here");
    expect(html).toContain("Turn sync on");
    expect(html).not.toContain("Reaching your account");
  });

  it("says the firing is on its way while sync is on and the server has not seen it", () => {
    const html = panel(runOf(), syncOf(true, true));
    expect(html).toContain("Reaching your account");
    expect(html).not.toContain("Turn sync on");
  });

  it("is folded when it is only you, and open when somebody else is at the table", () => {
    const alone = panel(runOf({ role: "owner", members: [{ sub: "user_ME", role: "owner", joinedAt: "2026-01-01T00:00:00Z" }] }), syncOf(true, true));
    expect(alone).not.toMatch(/<details[^>]*\sopen/);
    expect(alone).not.toContain("Reaching your account");
    const company = panel(
      runOf({
        role: "owner",
        members: [
          { sub: "user_ME", role: "owner", joinedAt: "2026-01-01T00:00:00Z" },
          { sub: "user_THEM", role: "player", joinedAt: "2026-01-01T00:00:00Z", name: "Jo" },
        ],
      }),
      syncOf(true, true),
    );
    expect(company).toMatch(/<details[^>]*\sopen/);
    expect(company).toContain("Jo");
  });
});
