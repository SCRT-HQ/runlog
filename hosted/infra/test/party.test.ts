import { describe, expect, it } from "vitest";
import { hashToken } from "../lib/handlers/auth";
import { COMMANDS } from "../lib/handlers/discord/commands";
import { handleInteraction, type InteractionDeps } from "../lib/handlers/discord/interactions";
import {
  autoOpenParties,
  closeParty,
  notePartyHandout,
  openParty,
  PARTY_HANDOUTS_KEPT,
  TICK_MS,
  tickParties,
  type PartyDeps,
} from "../lib/handlers/discord/party";
import { EPHEMERAL, InteractionType, ResponseType, type Interaction } from "../lib/handlers/discord/types";
import type { Guild } from "../lib/handlers/guilds";
import type { SessionMeta, Store } from "../lib/handlers/store";
import { memoryDiscord, memoryGuilds } from "./memory-guilds";

const NOW = "2026-09-16T10:00:00.000Z";
const LINK = "https://runlog.test/r/01RUN?t=livetok";
/** The run's own token, hashed the way the session row keeps it. */
const LIVE_HASH = hashToken("livetok");

const snapshot = {
  v: 1,
  at: NOW,
  packId: "com.example.kiln",
  packTitle: "The Long Kiln",
  runName: "Thursday",
  mode: "Standard Firing",
  words: { run: "Firing", unit: "Stage", units: "Stages" },
  status: "active",
  ending: null,
  unit: 1,
  where: null,
  step: null,
  quoted: false,
  standings: [],
  contestants: 0,
  subjects: [],
  counters: [],
  resources: [],
  clocks: [],
  progress: { unitsDone: 0, elapsedMs: 0, timed: false },
  score: { label: "Stages", text: "0 stages", value: 0, better: "higher" },
  forcedUnits: 0,
  log: [],
  latest: null,
};

/** The little of the store a party reads: whose run it is, and what it last said. */
function runStore(over: Partial<SessionMeta> = {}, held: unknown = snapshot): Store {
  const meta: SessionMeta = {
    id: "01RUN",
    packId: "com.example.kiln",
    packVersion: "1",
    packTitle: "The Long Kiln",
    ownerSub: "user_1",
    createdAt: NOW,
    updatedAt: NOW,
    seq: 4,
    publicTokenHash: LIVE_HASH,
    ...over,
  };
  return {
    async getSession(id: string) {
      return id === "01RUN" ? { meta, members: [] } : null;
    },
    async getSnapshot() {
      return held ? { at: NOW, snapshot: held } : null;
    },
    async manifest() {
      return {
        packs: [],
        sessions: [
          {
            id: "01RUN",
            role: "owner",
            packId: "com.example.kiln",
            packVersion: "1",
            packTitle: "The Long Kiln",
            name: "Thursday",
            ownerSub: "user_1",
            updatedAt: NOW,
            seq: 4,
          },
        ],
        licenses: [],
      };
    },
  } as unknown as Store;
}

async function ready(over: Partial<Guild> = {}) {
  const guilds = memoryGuilds();
  const rest = memoryDiscord();
  await guilds.claimGuild({ guildId: "g1", name: "The Kiln Room", ownerSub: "user_1", claimedAt: NOW, ...over });
  await guilds.putLiveLink("01RUN", LINK, NOW);
  const guild = (await guilds.guild("g1"))!;
  const deps: PartyDeps = { store: runStore(), guilds, rest, now: () => NOW };
  return { guilds, rest, guild, deps };
}

const mira = { discordId: "1001", name: "Mira", sub: "user_1" };

/** A log of `count` lines as a snapshot carries it, newest first; the second names what it hit. */
function lines(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return { n, unit: n, where: `Stage ${n}`, hit: null, ...(n === 2 ? { hitName: "Bowl" } : {}), text: `Line ${n}` };
  }).reverse();
}

describe("opening a watch party", () => {
  it("opens a thread, posts the link and the card, and keeps the record", async () => {
    const { guilds, rest, guild, deps } = await ready();
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(rest.threads[0]).toContain("The Long Kiln");
    expect(rest.posts[0]?.message.content).toContain(LINK);
    expect(rest.posts[0]?.message.components).toEqual([]);
    expect(out.party).toMatchObject({
      sessionId: "01RUN",
      guildId: "g1",
      threadId: "thread_1",
      cardMessageId: "msg_2",
      link: LINK,
      openedBy: "1001",
      openedByName: "Mira",
      openedAt: NOW,
      editedAt: NOW,
    });
    expect(await guilds.party("01RUN", "g1")).toMatchObject({ threadId: "thread_1" });
  });

  it("pins the card where the server pinned its cards, and not otherwise", async () => {
    const plain = await ready();
    await openParty(plain.deps, { guild: plain.guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    expect(plain.rest.pins).toEqual([]);
    const pinned = await ready();
    await pinned.guilds.updateGuild("g1", NOW, { cardMode: "pinned" });
    const guild = (await pinned.guilds.guild("g1"))!;
    await openParty(pinned.deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    expect(pinned.rest.pins).toEqual(["msg_2"]);
  });

  it("refuses a run that is not shared, telling the opener to share it first", async () => {
    const { guilds, guild, deps } = await ready();
    await guilds.clearLiveLink("01RUN");
    const out = await openParty(
      { ...deps, store: runStore({ publicTokenHash: undefined }) },
      {
        guild,
        channelId: "chan",
        sessionId: "01RUN",
        by: mira,
        mayHost: true,
      },
    );
    expect(out).toEqual({ error: "Share the run first: a watch party carries its live link." });
  });

  it("refuses somebody who may not host here, in the server's own words", async () => {
    const { guild, deps } = await ready();
    expect(await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: false })).toEqual({
      error: "Opening a watch party here takes someone who can manage the server, until /setup role names a role.",
    });
    const withRole = await ready();
    await withRole.guilds.updateGuild("g1", NOW, { hostRoleId: "r1" });
    const roled = (await withRole.guilds.guild("g1"))!;
    expect(await openParty(withRole.deps, { guild: roled, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: false })).toEqual({
      error: "Opening a watch party here takes the <@&r1> role.",
    });
  });

  it("refuses a second party in the same server, and points at the one there is", async () => {
    const { guild, deps } = await ready();
    await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    expect(await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true })).toEqual({
      error: "This server already has a watch party on that run: <#thread_1>.",
    });
  });

  it("refuses a run that is somebody else's", async () => {
    const { guild, deps } = await ready();
    const out = await openParty(
      { ...deps, store: runStore({ ownerSub: "user_9" }) },
      {
        guild,
        channelId: "chan",
        sessionId: "01RUN",
        by: mira,
        mayHost: true,
      },
    );
    expect(out).toEqual({ error: "A watch party is for a run of your own." });
  });

  it("refuses where there is nowhere to open it, and where Discord would not", async () => {
    const { guild, deps, rest } = await ready();
    expect(await openParty(deps, { guild, sessionId: "01RUN", by: mira, mayHost: true })).toEqual({
      error: "Nowhere to open the party: say where, or set a channel with /setup channel.",
    });
    rest.down = true;
    expect(await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true })).toEqual({
      error: "Discord would not open a thread here. The bot needs permission to create public threads in this channel.",
    });
  });

  it("refuses a run there is no record of", async () => {
    const { guild, deps } = await ready();
    expect(await openParty(deps, { guild, channelId: "chan", sessionId: "01GONE", by: mira, mayHost: true })).toEqual({
      error: "There is no run by that name.",
    });
  });

  it("refuses a run that has published no snapshot yet", async () => {
    const { guild, deps } = await ready();
    expect(
      await openParty({ ...deps, store: runStore({}, null) }, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true }),
    ).toEqual({ error: "That run has not said anything yet; open it in the app and try again." });
  });

  it("opens in the server's default channel when the caller names none", async () => {
    const { guilds, rest, deps } = await ready();
    await guilds.updateGuild("g1", NOW, { channelId: "runs" });
    const guild = (await guilds.guild("g1"))!;
    await openParty(deps, { guild, sessionId: "01RUN", by: mira, mayHost: true });
    expect(rest.posts[0]?.channel).toBe("thread_1");
    expect(rest.threads).toHaveLength(1);
  });

  /**
   * The app's button and a server opening parties on its own name no
   * channel, and a server nobody ran /setup channel in has no default.
   * Every such party was refused until the bot learned to look.
   */
  it("opens in the first text channel the bot can see where the server has no default", async () => {
    const { guild, deps, rest } = await ready();
    rest.channels.push({ id: "general", name: "general" }, { id: "runs", name: "runs" });
    const out = await openParty(deps, { guild, sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    expect(out.party.channelId).toBe("general");
  });

  it("starts hearing the run from where it stood, so nothing before the party is replayed", async () => {
    const { guild, guilds, rest } = await ready();
    const deps = { store: runStore({}, { ...snapshot, log: lines(3) }), guilds, rest, now: () => NOW };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    expect(out.party.seenN).toBe(3);
  });
});

describe("closing a watch party", () => {
  it("marks it closed, edits the card to say so, and leaves the thread alone", async () => {
    const { guilds, rest, guild, deps } = await ready();
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    const closed = await closeParty(deps, out.party, "byHand");
    expect(closed.closedAt).toBe(NOW);
    expect(closed.closedFor).toBe("byHand");
    const edit = rest.edits.at(-1)!;
    expect(edit.id).toBe("msg_2");
    expect(JSON.stringify(edit.message)).toContain("The firing went on without it.");
    // Nothing is posted and the thread is not archived: Discord closes an idle one.
    expect(rest.posts).toHaveLength(1);
    expect(rest.archived).toEqual([]);
    expect((await guilds.party("01RUN", "g1"))?.closedFor).toBe("byHand");
  });

  it("closes once: a second close edits nothing and posts nothing again", async () => {
    const { rest, guild, deps } = await ready();
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    const closed = await closeParty(deps, out.party, "ended");
    expect(rest.edits).toHaveLength(1);
    // The opening post, and the one line the ending says.
    expect(rest.posts).toHaveLength(2);
    expect(await closeParty(deps, closed, "ended")).toBe(closed);
    expect(rest.edits).toHaveLength(1);
    expect(rest.posts).toHaveLength(2);
  });

  it("says nothing to Discord for a party whose message is gone", async () => {
    const { rest, guild, deps } = await ready();
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    const before = rest.edits.length;
    await closeParty(deps, out.party, "gone");
    expect(rest.edits).toHaveLength(before);
  });
});

const runSub = (
  name: string,
  options: Array<{ name: string; type: number; value: string | boolean; focused?: boolean }> = [],
  over: Partial<Interaction> = {},
): Interaction => ({
  id: "i1",
  application_id: "app",
  type: InteractionType.ApplicationCommand,
  token: "t",
  guild_id: "g1",
  channel_id: "chan",
  member: { user: { id: "1001", username: "mira", global_name: "Mira" }, permissions: String(1 << 5), roles: [] },
  ...over,
  data: { name: "run", options: [{ name, type: 1, options }] },
});

async function botReady() {
  const { guilds, rest, deps } = await ready();
  await guilds.connect("user_1", { service: "discord", accountId: "1001", name: "Mira", linkedAt: NOW });
  const bot: InteractionDeps = {
    guilds,
    appUrl: "https://runlog.test/",
    now: () => NOW,
    store: deps.store as never,
    rest,
    mintId: () => "01ID",
  };
  return { guilds, rest, bot };
}

describe("/run watch", () => {
  it("is a subcommand the bot answers, with autocomplete on the run", () => {
    const run = COMMANDS.find((c) => c.name === "run")!;
    const watch = (
      run as { options: ReadonlyArray<{ name: string; options?: ReadonlyArray<{ name: string; autocomplete?: boolean }> }> }
    ).options.find((o) => o.name === "watch")!;
    expect(watch.options?.find((o) => o.name === "run")?.autocomplete).toBe(true);
    expect((run as { options: ReadonlyArray<{ name: string }> }).options.some((o) => o.name === "unwatch")).toBe(true);
  });

  it("opens the party and answers with the thread", async () => {
    const { guilds, bot } = await botReady();
    const out = await handleInteraction(runSub("watch", [{ name: "run", type: 3, value: "01RUN" }]), bot);
    expect(out.type).toBe(ResponseType.ChannelMessage);
    expect(out.data?.content).toContain("<#thread_1>");
    expect(await guilds.party("01RUN", "g1")).not.toBeNull();
  });

  it("takes a pasted live link in place of a run", async () => {
    const { guilds, bot } = await botReady();
    await guilds.clearLiveLink("01RUN");
    const out = await handleInteraction(runSub("watch", [{ name: "run", type: 3, value: LINK }]), bot);
    expect(out.data?.content).toContain("<#thread_1>");
    expect((await guilds.party("01RUN", "g1"))?.link).toBe(LINK);
  });

  it("posts the link it built from the parts it checked, never the string somebody pasted", async () => {
    const { guilds, rest, bot } = await botReady();
    await guilds.clearLiveLink("01RUN");
    // The URL parser throws a newline away before it reads, so a link
    // that passes every check can still carry a line of its own, and the
    // bot would be the one saying it in somebody else's server.
    const carried = `${LINK}&x=a
@everyone`;
    const out = await handleInteraction(runSub("watch", [{ name: "run", type: 3, value: carried }]), bot);
    expect(out.data?.content).toContain("<#thread_1>");
    expect((await guilds.party("01RUN", "g1"))?.link).toBe(LINK);
    expect(JSON.stringify(rest.posts)).not.toContain("@everyone");
  });

  /**
   * The address is only half of a live link. A token that is not the
   * run's own is a link nobody can watch by, so a host who pasted a stale
   * one is told what to do about it, and nothing is filed or posted.
   */
  it("refuses a pasted link whose token is not the run's, and keeps nothing", async () => {
    const { guilds, rest, bot } = await botReady();
    await guilds.clearLiveLink("01RUN");
    const stale = "https://runlog.test/r/01RUN?t=oldtok";
    const out = await handleInteraction(runSub("watch", [{ name: "run", type: 3, value: stale }]), bot);
    expect(out.data?.flags).toBe(EPHEMERAL);
    expect(out.data?.content).toBe("Share the run first: a watch party carries its live link.");
    expect(await guilds.party("01RUN", "g1")).toBeNull();
    expect(await guilds.liveLink("01RUN")).toBeNull();
    expect(rest.posts).toEqual([]);
  });

  it("passes a refusal from openParty straight through, to the person alone", async () => {
    const { bot } = await botReady();
    const out = await handleInteraction(
      runSub("watch", [{ name: "run", type: 3, value: "01RUN" }], {
        member: { user: { id: "1001", username: "mira" }, permissions: "0", roles: [] },
      }),
      bot,
    );
    expect(out.data?.flags).toBe(EPHEMERAL);
    expect(out.data?.content).toContain("takes someone who can manage the server");
  });

  it("hands the thread and the card to the function with time, where there is one", async () => {
    const { rest, bot } = await botReady();
    const deferred: Interaction[] = [];
    const withTime: InteractionDeps = { ...bot, defer: async (i) => void deferred.push(i) };
    expect(await handleInteraction(runSub("watch", [{ name: "run", type: 3, value: "01RUN" }]), withTime)).toEqual({
      type: ResponseType.DeferredChannelMessage,
    });
    expect(
      await handleInteraction(
        runSub(
          "watch",
          [
            { name: "run", type: 3, value: "01RUN" },
            { name: "private", type: 5, value: true },
          ],
          { app_permissions: String(1n << 36n) },
        ),
        withTime,
      ),
    ).toEqual({ type: ResponseType.DeferredChannelMessage, data: { flags: EPHEMERAL } });
    expect(deferred).toHaveLength(2);
    // The work itself is the job's; nothing was said to Discord in this turn.
    expect(rest.threads).toEqual([]);
  });

  it("offers the linked account's own open runs as you type", async () => {
    const { bot } = await botReady();
    const out = await handleInteraction(
      { ...runSub("watch", [{ name: "run", type: 3, value: "thurs", focused: true }]), type: InteractionType.Autocomplete },
      bot,
    );
    expect(out.type).toBe(ResponseType.AutocompleteResult);
    expect(out.data?.choices).toEqual([{ name: "Thursday · The Long Kiln", value: "01RUN" }]);
  });
});

describe("/run unwatch", () => {
  it("closes the party whose thread it was typed in", async () => {
    const { guilds, bot } = await botReady();
    await handleInteraction(runSub("watch", [{ name: "run", type: 3, value: "01RUN" }]), bot);
    const out = await handleInteraction(runSub("unwatch", [], { channel_id: "thread_1" }), bot);
    expect(out.data?.content).toContain("closed");
    expect((await guilds.party("01RUN", "g1"))?.closedFor).toBe("byHand");
  });

  it("says where to say it, outside a party's thread", async () => {
    const { bot } = await botReady();
    const out = await handleInteraction(runSub("unwatch", [], { channel_id: "chan" }), bot);
    expect(out.data?.content).toBe("Say that in a watch party's thread.");
  });
});

describe("keeping a party's card current", () => {
  /** A clock the test moves, and a wait that moves it rather than sleeping. */
  function clock(from = NOW) {
    let ms = Date.parse(from);
    return {
      now: () => new Date(ms).toISOString(),
      wait: async (by: number) => void (ms += by),
      tick: (by: number) => void (ms += by),
    };
  }

  it("edits each party's card once, and holds the next edit until the tick is up", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    c.tick(TICK_MS + 1_000);
    expect(await tickParties(deps, "01RUN")).toEqual([{ guildId: "g1", outcome: "edited" }]);
    expect(rest.edits).toHaveLength(1);
    // A second snapshot inside the window takes the tick and waits it out.
    expect(await tickParties(deps, "01RUN")).toEqual([{ guildId: "g1", outcome: "held" }]);
    expect(rest.edits).toHaveLength(2);
    // A third while that one is held changes nothing: the held edit carries the latest.
    await guilds.putParty({ ...(await guilds.party("01RUN", "g1"))!, tickAt: c.now() });
    expect(await tickParties(deps, "01RUN")).toEqual([{ guildId: "g1", outcome: "quiet" }]);
    expect(rest.edits).toHaveLength(2);
  });

  it("carries whatever the snapshot says when the held edit lands, not what it said when it was held", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    let held: Record<string, unknown> = { ...snapshot, unit: 1 };
    const store = {
      async getSession() {
        return { meta: { id: "01RUN", ownerSub: "user_1", publicTokenHash: "hash", seq: 1 }, members: [] };
      },
      async getSnapshot() {
        return { at: c.now(), snapshot: held };
      },
    } as unknown as Store;
    const deps = {
      store,
      guilds,
      rest,
      now: c.now,
      wait: async (by: number) => {
        held = { ...snapshot, unit: 7 };
        await c.wait(by);
      },
    };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    await tickParties(deps, "01RUN");
    expect(JSON.stringify(rest.edits.at(-1)!.message)).toContain("Stage 7");
  });

  it("edits an ended run's card at once, without waiting out the tick", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    const ended = { store: runStore({}, { ...snapshot, status: "ended", ending: "Cooled" }), guilds, rest, now: c.now, wait: c.wait };
    expect(await tickParties(ended, "01RUN")).toEqual([{ guildId: "g1", outcome: "closed" }]);
    expect((await guilds.party("01RUN", "g1"))?.closedFor).toBe("ended");
  });

  it("closes a party whose card Discord no longer has", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    c.tick(TICK_MS + 1_000);
    rest.lost = true;
    expect(await tickParties(deps, "01RUN")).toEqual([{ guildId: "g1", outcome: "closed" }]);
    expect((await guilds.party("01RUN", "g1"))?.closedFor).toBe("gone");
  });

  /**
   * A call that did not land is not a message that is gone. A timeout or
   * a 429 leaves the party where it was, for the next snapshot to draw.
   */
  it("leaves the party open where the edit did not land, and draws it on the next tick", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    c.tick(TICK_MS + 1_000);
    rest.down = true;
    expect(await tickParties(deps, "01RUN")).toEqual([{ guildId: "g1", outcome: "quiet" }]);
    const held = (await guilds.party("01RUN", "g1"))!;
    expect(held.closedAt).toBeUndefined();
    expect(held.tickAt).toBeUndefined();
    rest.down = false;
    expect(await tickParties(deps, "01RUN")).toEqual([{ guildId: "g1", outcome: "edited" }]);
    expect(rest.edits).toHaveLength(1);
  });

  /**
   * The thread reads the way a hosted run's does: each tick with news
   * posts the lines the run said since the last one, then a fresh card at
   * the bottom, and the old card is retired to text. A tick with nothing
   * to say edits the card in place.
   */
  it("posts the lines since the last tick, then a fresh card at the bottom, and retires the old one", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    let held: Record<string, unknown> = { ...snapshot };
    const store = {
      async getSession() {
        return { meta: { id: "01RUN", ownerSub: "user_1", publicTokenHash: "hash", seq: 1 }, members: [] };
      },
      async getSnapshot() {
        return { at: c.now(), snapshot: held };
      },
    } as unknown as Store;
    const deps = { store, guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    const opening = out.party.cardMessageId!;

    held = { ...snapshot, unit: 2, log: lines(2) };
    c.tick(TICK_MS + 1_000);
    expect(await tickParties(deps, "01RUN")).toEqual([{ guildId: "g1", outcome: "edited" }]);
    // The lines, oldest first, then the card; both in the thread.
    expect(rest.posts.map((p) => p.channel)).toEqual(["thread_1", "thread_1", "thread_1"]);
    expect(rest.posts[1]!.message.content).toBe("**Stage 1** Line 1\n**Stage 2** Line 2 → Bowl");
    expect(JSON.stringify(rest.posts[2]!.message)).toContain("Stage 2");
    // The old card is text now, and keeps the link it carried.
    expect(rest.edits).toEqual([{ channel: "thread_1", id: opening, message: { embeds: [], components: [] } }]);
    const party = (await guilds.party("01RUN", "g1"))!;
    expect(party.cardMessageId).toBe(rest.posts[2]!.id);
    expect(party.seenN).toBe(2);

    // Nothing new said: the card at the bottom is edited in place.
    held = { ...snapshot, unit: 3, log: lines(2) };
    c.tick(TICK_MS + 1_000);
    expect(await tickParties(deps, "01RUN")).toEqual([{ guildId: "g1", outcome: "edited" }]);
    expect(rest.posts).toHaveLength(3);
    expect(rest.edits.at(-1)).toMatchObject({ id: party.cardMessageId });
    expect(JSON.stringify(rest.edits.at(-1)!.message)).toContain("Stage 3");
  });

  it("keeps a pinned card in place and posts the lines under it", async () => {
    const { guilds, rest } = await ready({ cardMode: "pinned" });
    const guild = (await guilds.guild("g1"))!;
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    const later = { ...deps, store: runStore({}, { ...snapshot, log: lines(1) }) };
    c.tick(TICK_MS + 1_000);
    expect(await tickParties(later, "01RUN")).toEqual([{ guildId: "g1", outcome: "edited" }]);
    expect(rest.posts).toHaveLength(2);
    expect(rest.posts[1]!.message.content).toBe("**Stage 1** Line 1");
    expect(rest.edits).toHaveLength(1);
    expect(rest.edits[0]!.id).toBe(out.party.cardMessageId);
    expect(rest.edits[0]!.message.embeds).toHaveLength(1);
    expect((await guilds.party("01RUN", "g1"))?.cardMessageId).toBe(out.party.cardMessageId);
  });

  it("says a long stretch as the last few and how many came before", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    c.tick(TICK_MS + 1_000);
    await tickParties({ ...deps, store: runStore({}, { ...snapshot, log: lines(9) }) }, "01RUN");
    const said = rest.posts[1]!.message.content!.split("\n");
    expect(said[0]).toBe("… 4 more, then:");
    expect(said).toHaveLength(6);
    expect(said.at(-1)).toBe("**Stage 9** Line 9");
  });

  it("says the last lines before the card takes its final state, when the run ends", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    const ended = { ...deps, store: runStore({}, { ...snapshot, status: "ended", ending: "Cooled", log: lines(1) }) };
    expect(await tickParties(ended, "01RUN")).toEqual([{ guildId: "g1", outcome: "closed" }]);
    expect(rest.posts.slice(1).map((p) => p.message.content)).toEqual([
      "**Stage 1** Line 1",
      "The firing is over: Cooled. The card above is where it finished.",
    ]);
    expect(rest.edits).toHaveLength(1);
    expect((await guilds.party("01RUN", "g1"))?.seenN).toBe(1);
  });

  it("closes nothing where the bot has no token on this copy", async () => {
    const { guilds, guild, rest } = await ready();
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    c.tick(TICK_MS + 1_000);
    expect(await tickParties({ ...deps, rest: null }, "01RUN")).toEqual([{ guildId: "g1", outcome: "quiet" }]);
    expect((await guilds.party("01RUN", "g1"))?.closedAt).toBeUndefined();
  });

  /**
   * A run shared again carries a new token, and the live-link row is
   * where it is filed; a card drawn from the link the party opened on
   * would send watchers at a link that is dead.
   */
  it("draws the link the run was shared with last, not the one the party opened on", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    const again = "https://runlog.test/r/01RUN?t=newtok";
    await guilds.putLiveLink("01RUN", again, NOW);
    c.tick(TICK_MS + 1_000);
    expect(await tickParties(deps, "01RUN")).toEqual([{ guildId: "g1", outcome: "edited" }]);
    expect(JSON.stringify(rest.edits.at(-1)!.message)).toContain(again);
    expect(JSON.stringify(rest.edits.at(-1)!.message)).not.toContain("livetok");
    expect((await guilds.party("01RUN", "g1"))?.link).toBe(again);
  });

  it("waits out three parties' ticks at once, so a run watched from three servers fits in one tick", async () => {
    const { guilds, rest } = await ready();
    const c = clock();
    let waiting = 0;
    let most = 0;
    const deps = {
      store: runStore(),
      guilds,
      rest,
      now: c.now,
      // A wait that finishes on a turn of the event loop, so how many were
      // in the air together is what the count says.
      wait: async (by: number) => {
        waiting += 1;
        most = Math.max(most, waiting);
        await new Promise((done) => setTimeout(done, 0));
        waiting -= 1;
        c.tick(by);
      },
    };
    for (const guildId of ["g1", "g2", "g3"]) {
      await guilds.claimGuild({ guildId, name: "The Kiln Room", ownerSub: "user_1", claimedAt: NOW });
      const each = (await guilds.guild(guildId))!;
      const out = await openParty(deps, { guild: each, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
      if ("error" in out) throw new Error(out.error);
    }
    expect((await tickParties(deps, "01RUN")).map((p) => p.outcome)).toEqual(["held", "held", "held"]);
    expect(most).toBe(3);
    expect(rest.edits).toHaveLength(3);
  });

  it("closes a party on a run that stopped being shared, since the link on its card is dead", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    const unshared = { store: runStore({ publicTokenHash: undefined }), guilds, rest, now: c.now, wait: c.wait };
    expect(await tickParties(unshared, "01RUN")).toEqual([{ guildId: "g1", outcome: "closed" }]);
    expect((await guilds.party("01RUN", "g1"))?.closedFor).toBe("gone");
    // Nothing was drawn and nothing was said: there is no live card to
    // put a dead link on.
    expect(rest.edits).toEqual([]);
    expect(rest.posts).toHaveLength(1);
  });

  it("says nothing about a party that is closed already", async () => {
    const { guilds, rest, guild } = await ready();
    const c = clock();
    const deps = { store: runStore(), guilds, rest, now: c.now, wait: c.wait };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    await closeParty(deps, out.party, "byHand");
    expect(await tickParties(deps, "01RUN")).toEqual([]);
  });
});

describe("a handout, on a run with a watch party", () => {
  const handout = { title: "The kiln kit", id: "s1" };

  it("goes onto each open party, newest last, and is told to the job", async () => {
    const { guilds, guild, deps } = await ready();
    const first = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in first) throw new Error(first.error);
    const told: Array<{ sessionId: string }> = [];
    const noted = await notePartyHandout({ guilds, now: () => NOW, party: async (job) => void told.push(job) }, "01RUN", handout);
    expect(noted).toBe(1);
    expect(told).toEqual([{ sessionId: "01RUN" }]);
    expect((await guilds.party("01RUN", "g1"))?.handouts).toEqual([handout]);
    await notePartyHandout({ guilds, now: () => NOW }, "01RUN", { title: "The starter kit", id: "s2" });
    expect((await guilds.party("01RUN", "g1"))?.handouts).toEqual([handout, { title: "The starter kit", id: "s2" }]);
  });

  it("counts the same handout once, however often the button is pressed", async () => {
    const { guilds, guild, deps } = await ready();
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    await notePartyHandout({ guilds, now: () => NOW }, "01RUN", handout);
    await notePartyHandout({ guilds, now: () => NOW }, "01RUN", handout);
    expect((await guilds.party("01RUN", "g1"))?.handouts).toEqual([handout]);
  });

  it("takes a handout the app sent without an id, which is what a run seeded from several setups sends", async () => {
    const { guilds, guild, deps } = await ready();
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    expect(await notePartyHandout({ guilds, now: () => NOW }, "01RUN", { title: "The kiln kit and the starter kit" })).toBe(1);
    // The title is what tells it from another, so pressing it twice is
    // still the one handout.
    await notePartyHandout({ guilds, now: () => NOW }, "01RUN", { title: "The kiln kit and the starter kit" });
    expect((await guilds.party("01RUN", "g1"))?.handouts).toEqual([
      { id: "The kiln kit and the starter kit", title: "The kiln kit and the starter kit" },
    ]);
  });

  it("keeps the last few and no more", async () => {
    const { guilds, guild, deps } = await ready();
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    for (let n = 0; n < PARTY_HANDOUTS_KEPT + 2; n += 1)
      await notePartyHandout({ guilds, now: () => NOW }, "01RUN", { title: `Kit ${n}`, id: `s${n}` });
    const held = (await guilds.party("01RUN", "g1"))!.handouts!;
    expect(held).toHaveLength(PARTY_HANDOUTS_KEPT);
    expect(held[0]?.title).toBe("Kit 2");
  });

  it("says nothing about a gesture that is not a handout, or a party that is closed", async () => {
    const { guilds, guild, deps } = await ready();
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    expect(await notePartyHandout({ guilds, now: () => NOW }, "01RUN", { id: "s1" })).toBe(0);
    expect(await notePartyHandout({ guilds, now: () => NOW }, "01RUN", { title: 7, id: "s1" })).toBe(0);
    await closeParty(deps, out.party, "byHand");
    expect(await notePartyHandout({ guilds, now: () => NOW }, "01RUN", handout)).toBe(0);
  });

  it("puts the handout on the card at the next tick", async () => {
    const { guilds, rest, guild } = await ready();
    let ms = Date.parse(NOW);
    const deps = {
      store: runStore(),
      guilds,
      rest,
      now: () => new Date(ms).toISOString(),
      wait: async (by: number) => void (ms += by),
    };
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    await notePartyHandout({ guilds, now: deps.now }, "01RUN", handout);
    ms += TICK_MS + 1_000;
    await tickParties(deps, "01RUN");
    expect(JSON.stringify(rest.edits.at(-1)!.message)).toContain("The kiln kit");
  });

  it("shows nothing on a party opened after the handout, which has nothing to read it from", async () => {
    const { guilds, rest, guild, deps } = await ready();
    // Nothing is open, so the handout lands nowhere.
    expect(await notePartyHandout({ guilds, now: () => NOW }, "01RUN", handout)).toBe(0);
    const out = await openParty(deps, { guild, channelId: "chan", sessionId: "01RUN", by: mira, mayHost: true });
    if ("error" in out) throw new Error(out.error);
    expect(out.party.handouts).toBeUndefined();
    expect(JSON.stringify(rest.posts.at(-1)!.message)).not.toContain("The kiln kit");
  });
});

describe("a server that opens parties on its own", () => {
  it("opens one for every run of the owner's, where it is set to", async () => {
    const { guilds, deps } = await ready();
    await guilds.updateGuild("g1", NOW, { channelId: "runs", watchParties: "every" });
    expect(await autoOpenParties(deps, "01RUN")).toEqual(["g1"]);
    expect(await guilds.party("01RUN", "g1")).not.toBeNull();
  });

  it("opens one only for a pack it chose", async () => {
    const { guilds, deps } = await ready();
    await guilds.updateGuild("g1", NOW, { channelId: "runs", watchParties: "packs", watchPackIds: ["com.example.other"] });
    expect(await autoOpenParties(deps, "01RUN")).toEqual([]);
    await guilds.updateGuild("g1", NOW, { watchPackIds: ["com.example.kiln"] });
    expect(await autoOpenParties(deps, "01RUN")).toEqual(["g1"]);
  });

  it("opens none where the setting is off, which is the default", async () => {
    const { guilds, deps } = await ready();
    await guilds.updateGuild("g1", NOW, { channelId: "runs" });
    expect(await autoOpenParties(deps, "01RUN")).toEqual([]);
  });

  it("never opens twice in the same server, even after the first was closed", async () => {
    const { guilds, deps } = await ready();
    await guilds.updateGuild("g1", NOW, { channelId: "runs", watchParties: "every" });
    expect(await autoOpenParties(deps, "01RUN")).toEqual(["g1"]);
    expect(await autoOpenParties(deps, "01RUN")).toEqual([]);
    const held = (await guilds.party("01RUN", "g1"))!;
    await closeParty(deps, held, "byHand");
    expect(await autoOpenParties(deps, "01RUN")).toEqual([]);
  });

  /**
   * The page sends its first snapshot per mount, not per run, so opening
   * a finished run in the app again arrives here looking like a run that
   * just started. A party on it would open and close in the same breath.
   */
  it("opens none for a run that has already ended", async () => {
    const { guilds, rest } = await ready();
    await guilds.updateGuild("g1", NOW, { channelId: "runs", watchParties: "every" });
    const over = { store: runStore({}, { ...snapshot, status: "ended", ending: "Cooled" }), guilds, rest, now: () => NOW };
    expect(await autoOpenParties(over, "01RUN")).toEqual([]);
    const said = { store: runStore({ endedAt: NOW }), guilds, rest, now: () => NOW };
    expect(await autoOpenParties(said, "01RUN")).toEqual([]);
    expect(await guilds.party("01RUN", "g1")).toBeNull();
    expect(rest.threads).toEqual([]);
  });

  it("opens none for a run that was never shared", async () => {
    const { guilds } = await ready();
    await guilds.updateGuild("g1", NOW, { channelId: "runs", watchParties: "every" });
    await guilds.clearLiveLink("01RUN");
    const unshared = { store: runStore({ publicTokenHash: undefined }), guilds, rest: memoryDiscord(), now: () => NOW };
    expect(await autoOpenParties(unshared, "01RUN")).toEqual([]);
  });
});
