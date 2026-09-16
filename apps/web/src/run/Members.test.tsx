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
import type { AttachedTool } from "./useAttachedTools.ts";
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

/**
 * The run's reachability, stood in for.
 *
 * `useReachable` reads the watch key from `localStorage`, which this
 * environment does not have, so every address would be unfinished and
 * every copy button disabled. What is under test is the row, not the
 * minting, so the key is simply said to be there.
 */
const reach = vi.hoisted(() => ({ key: "watchkey" as string | null }));
vi.mock("./useReachable.ts", () => ({ useReachable: () => ({ link: null, key: reach.key, working: false }) }));

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
  gesture: () => false,
  drove: () => {},
});

const runOf = (extra: Partial<StoredRun> = {}): StoredRun => ({
  runId: "run-1",
  packId: kiln.id,
  packVersion: kiln.version,
  events: [],
  updatedAt: "2026-01-01T00:00:00Z",
  ...extra,
});

const panel = (run: StoredRun, sync: Sync, api: Api | null = {} as Api, attached: { tools?: AttachedTool[]; deckSubs?: string[] } = {}) => {
  current.api = api;
  return renderToStaticMarkup(
    <AccountContext.Provider value={signedIn}>
      <SyncContext.Provider value={sync}>
        <Members pack={kiln} run={run} tools={attached.tools ?? []} deckSubs={attached.deckSubs ?? []} />
      </SyncContext.Provider>
    </AccountContext.Provider>,
  );
};

/** A run with rules for a tool, which is what puts the plug on the rows. */
const withTool = { control: { rows: [{ tag: "curse", ops: [{ op: "speffect.apply", args: { id: 1 } }] }] } };

/** Two people, for the tests about what each of them has plugged in. */
const twoOf = (extra: Partial<StoredRun> = {}) =>
  runOf({
    role: "owner",
    members: [
      { sub: "user_ME", name: "Nate", role: "owner", joinedAt: "2026-01-01T00:00:00Z" },
      { sub: "user_KEL", name: "Kel", role: "player", joinedAt: "2026-01-01T00:00:00Z" },
    ],
    ...extra,
  });

/** The marks on one person's row, in the order the panel draws them. */
const rowOf = (html: string, name: string) => html.split(`<strong>${name}</strong>`)[1]?.split("</div>")[0] ?? "";

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
    // Which of the two is still happening, said plainly: "Reaching your
    // account" read as though signing in had not taken, and it had.
    expect(html).toContain("has not reached your account yet");
    expect(html).not.toContain("Reaching your account");
    expect(html).not.toContain("Turn sync on");
  });

  /**
   * A solo run has a player. The server's member list is the people it
   * knows about, and for a run nobody has been invited to that is
   * nobody, so the panel used to show an empty box to the one person
   * certainly sitting there.
   */
  it("shows you, even where the server knows of nobody", () => {
    const html = panel(runOf({ role: "owner" }), syncOf(true, true));
    expect(html).toContain("owner");
    expect(html).toContain("you</span>");
  });

  it("does not show you twice where the server does list you", () => {
    const html = panel(
      runOf({ role: "owner", members: [{ sub: "user_ME", role: "owner", joinedAt: "2026-01-01T00:00:00Z" }] }),
      syncOf(true, true),
    );
    expect(html.match(/chip you/g)?.length ?? 0).toBe(1);
  });

  /**
   * Setting a tool up is a thing you do per person, while looking at the
   * list of who is playing. It used to be only behind Settings, with one
   * address and a note saying to add a seat by hand.
   */
  it("offers an address for the table and one for each person", () => {
    const html = panel(twoOf(), syncOf(true, true));
    expect(html).toContain("The table");
    // One for the table and one each, and none for somebody with no name
    // to put in a seat.
    expect(html.match(/aria-label="Copy connection address"/g)?.length ?? 0).toBe(3);
  });

  /**
   * The plugin signs the user in, so the run knows whose deck is on it.
   * A count could not say that; a mark on the row can.
   */
  it("lights the deck mark on the row of whoever has one, and leaves the rest dim", () => {
    const html = panel(twoOf(), syncOf(true, true), {} as Api, { deckSubs: ["user_ME"] });
    expect(rowOf(html, "Nate")).toContain("Stream Deck connected");
    expect(rowOf(html, "Nate")).toContain("toolIcon lit");
    expect(rowOf(html, "Kel")).toContain("No Stream Deck connected");
    expect(rowOf(html, "Kel")).toContain("toolIcon dim");
  });

  /**
   * The plug is about a custom tool, and a run with no rules for one has
   * nothing to say about it. So the column appears only where the run
   * carries a control profile.
   */
  it("shows a tool mark only where the run has rules for a tool", () => {
    const without = panel(twoOf(), syncOf(true, true));
    expect(without).not.toContain("No tool connected");

    const html = panel(twoOf(withTool), syncOf(true, true), {} as Api, { tools: [{ seat: "Kel", app: "DemoTool" }] });
    expect(rowOf(html, "Kel")).toContain("DemoTool connected");
    expect(rowOf(html, "Nate")).toContain("No tool connected");
  });

  /**
   * A tool that named no seat dialed the table's address, so it is the
   * table's. It used to light the owner's row as well, which read as two
   * tools where there was one.
   */
  it("gives a seatless tool to the table and to nobody's row", () => {
    const html = panel(twoOf(withTool), syncOf(true, true), {} as Api, { tools: [{ app: "DemoTool", sub: "stream:user_ME" }] });
    expect(rowOf(html, "The table")).toContain("DemoTool connected");
    expect(rowOf(html, "Nate")).toContain("No tool connected");
    expect(rowOf(html, "Kel")).toContain("No tool connected");
  });

  /**
   * A deck signs in on its own account, which need not be one the run
   * lists. No row can carry it, and the old count in the Attached panel
   * is gone, so it is said in a line of its own rather than dropped.
   */
  it("says so when a deck is on an account the table does not list", () => {
    const one = panel(twoOf(), syncOf(true, true), {} as Api, { deckSubs: ["user_ME", "user_STRANGER"] });
    expect(one).toContain("A Stream Deck not at the table is on this run.");
    expect(rowOf(one, "Nate")).toContain("Stream Deck connected");

    const two = panel(twoOf(), syncOf(true, true), {} as Api, { deckSubs: ["user_STRANGER", "user_OTHER"] });
    expect(two).toContain("2 Stream Decks not at the table are on this run.");

    // Every deck accounted for on a row: nothing extra to say.
    const none = panel(twoOf(), syncOf(true, true), {} as Api, { deckSubs: ["user_ME", "user_KEL"] });
    expect(none).not.toContain("not at the table");
  });

  /**
   * Two lines of explaining went: a watch key is minted with the run now,
   * and what an invitation does belongs on the box you type into.
   */
  it("says none of it in paragraphs any more", () => {
    const html = panel(twoOf(), syncOf(true, true));
    expect(html).not.toContain("An address needs a watch key");
    expect(html).toContain('title="They get a link by email, sign in, and the run appears on their devices.');
    // Once, on the input, and nowhere as a sentence under it.
    expect(html.match(/They get a link by email/g)?.length ?? 0).toBe(1);
  });

  /**
   * An address cannot be finished without a watch key. The button says so
   * and refuses rather than putting an unfinished address on the
   * clipboard.
   */
  it("refuses to copy an address it cannot finish", () => {
    reach.key = null;
    try {
      const html = panel(twoOf(), syncOf(true, true));
      expect(html).toContain("Open this run to watchers to get an address");
      expect(html).toContain("disabled");
    } finally {
      reach.key = "watchkey";
    }
  });

  it("is folded when it is only you, and open when somebody else is at the table", () => {
    const alone = panel(
      runOf({ role: "owner", members: [{ sub: "user_ME", role: "owner", joinedAt: "2026-01-01T00:00:00Z" }] }),
      syncOf(true, true),
    );
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
