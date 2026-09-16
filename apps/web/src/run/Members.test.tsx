import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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
 * environment does not have, so every address would be unfinished. What is
 * under test is the row, not the minting, so the key is simply said to be
 * there.
 */
const reach = vi.hoisted(() => ({ key: "watchkey" as string | null }));
vi.mock("./useReachable.ts", () => ({
  useReachable: () => ({ link: null, key: reach.key, working: false, mint: async () => reach.key }),
}));

/**
 * The live link this device remembers, stood in for.
 *
 * It lives in `localStorage`, which this environment does not have, and
 * whether there is one decides which of the sharing buttons the panel
 * draws.
 */
const live = vi.hoisted(() => ({ link: null as string | null }));
vi.mock("../live/route.ts", async (original) => ({
  ...(await original<typeof import("../live/route.ts")>()),
  liveLinkOf: () => live.link,
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
    const html = panel(twoOf({ shared: true }), syncOf(true, true));
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
   * The owner's own row, on a run the server lists nobody for.
   *
   * That row is built here rather than taken from the server, and it
   * carries the account id the sign-in gave. The deck signs in too, and
   * the server names its connection by the `sub` on the token it sent,
   * which is that same account id: the mark lights.
   */
  it("lights the owner's own row for a deck on the owner's account", () => {
    const html = panel(runOf({ role: "owner" }), syncOf(true, true), {} as Api, { deckSubs: ["user_ME"] });
    expect(rowOf(html, "You")).toContain("Stream Deck connected");
    expect(rowOf(html, "You")).toContain("toolIcon lit");
    // On a row of its own, so nothing is said about a deck nobody is holding.
    expect(html).not.toContain("not at the table");
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
   * The panel is the list of who is here. Everything that asks a question
   * moved behind a button: the form to the sheet, the link to the
   * clipboard, and both paragraphs to the buttons' own titles.
   */
  it("says none of it in paragraphs any more", () => {
    const html = panel(twoOf(), syncOf(true, true));
    expect(html).not.toContain("An address needs a watch key");
    expect(html).not.toContain("They get a link by email");
    expect(html).not.toContain('placeholder="their email"');
    expect(html).not.toContain('aria-label="The live link"');
    expect(html).not.toContain("watches this firing as it happens");
    expect(html).not.toContain("Invited, not yet here");
  });

  /**
   * A key made on another device cannot be shown on this one, and the
   * server keeps only a hash of it. The button used to go gray and blame
   * sharing, which was a different thing and was usually already on. It
   * offers a new key instead, and says on the way in what that costs.
   */
  it("still copies where this device never held the key", () => {
    reach.key = null;
    try {
      const html = panel(twoOf({ shared: true }), syncOf(true, true));
      expect(html).toContain("Copy connection address (this device will need a new watch key)");
      expect(html).not.toContain("Open this run to watchers to get an address");
      expect(html).not.toContain("disabled");
    } finally {
      reach.key = "watchkey";
    }
  });

  /**
   * The one thing a press cannot fix: the socket resolves a watch key to a
   * run of yours that is open to watchers, so a closed run refuses the
   * connection whatever key it carries.
   */
  it("refuses while the run is closed to watchers", () => {
    const html = panel(twoOf(), syncOf(true, true));
    expect(html).toContain('title="Share the run first"');
    expect(html).toContain("disabled");
    expect(html).not.toContain("Copy connection address");
  });

  /**
   * It used to fold itself when the table was one person, which hid the
   * one panel a solo streamer wants open. Open every time now, and still
   * a `details` anybody can fold by hand.
   */
  it("is open whether or not anybody else is at the table", () => {
    const alone = panel(
      runOf({ role: "owner", members: [{ sub: "user_ME", role: "owner", joinedAt: "2026-01-01T00:00:00Z" }] }),
      syncOf(true, true),
    );
    expect(alone).toMatch(/<details[^>]*\sopen/);
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

  /** The chip that says which row is yours, whole: it used to be cut to "yo...". */
  it("keeps the chip on your own row out of the name's track", () => {
    const html = panel(twoOf(), syncOf(true, true));
    expect(html).toContain('<span class="chip you">you</span>');
    expect(html).toContain('<span class="memberName">');
  });
});

/**
 * Inviting and sharing, as three buttons under the rows.
 *
 * Which of them the panel draws is a question about who you are and
 * whether the run is open to watchers; what each one does is in
 * Members.invite.test.tsx, where there is a browser to press them in.
 */
describe("the buttons under the table", () => {
  afterEach(() => {
    live.link = null;
  });

  it("offers inviting and a link to share while the run is closed", () => {
    const html = panel(twoOf(), syncOf(true, true));
    expect(html).toContain(">Invite someone</button>");
    expect(html).toContain(">Share a live link</button>");
    expect(html).not.toContain("Copy live link");
    expect(html).not.toContain("Stop sharing");
    expect(html).toContain('title="Anyone with this link watches the run as it happens, with no account."');
  });

  it("offers copying and stopping once the run is open to watchers", () => {
    live.link = "https://runlog.test/#run/run-1?t=tok";
    const html = panel(twoOf({ shared: true }), syncOf(true, true));
    expect(html).toContain(">Invite someone</button>");
    expect(html).toContain(">Copy live link</button>");
    expect(html).toContain(">Stop sharing</button>");
    expect(html).not.toContain("Share a live link");
  });

  /** Somebody who is not the owner can pass the link on, and nothing else. */
  it("gives a player the copy and none of the rest", () => {
    live.link = "https://runlog.test/#run/run-1?t=tok";
    const html = panel(twoOf({ role: "player", shared: true }), syncOf(true, true));
    expect(html).toContain(">Copy live link</button>");
    expect(html).not.toContain("Invite someone");
    expect(html).not.toContain("Stop sharing");
  });

  it("gives a player nothing at all where there is no link to pass on", () => {
    const html = panel(twoOf({ role: "player" }), syncOf(true, true));
    expect(html).not.toContain("memberActions");
  });

  /** An invitation not yet taken up is a small label and its rows, not a heading. */
  it("labels the invitations quietly", () => {
    const html = panel(twoOf(), syncOf(true, true));
    expect(html).not.toContain("stepLabel");
  });
});
