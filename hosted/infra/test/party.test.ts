import { describe, expect, it } from "vitest";
import { COMMANDS } from "../lib/handlers/discord/commands";
import { handleInteraction, type InteractionDeps } from "../lib/handlers/discord/interactions";
import { closeParty, openParty, type PartyDeps } from "../lib/handlers/discord/party";
import { EPHEMERAL, InteractionType, ResponseType, type Interaction } from "../lib/handlers/discord/types";
import type { Guild } from "../lib/handlers/guilds";
import type { SessionMeta, Store } from "../lib/handlers/store";
import { memoryDiscord, memoryGuilds } from "./memory-guilds";

const NOW = "2026-09-16T10:00:00.000Z";
const LINK = "https://runlog.test/r/01RUN?t=livetok";

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
    publicTokenHash: "hash",
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
