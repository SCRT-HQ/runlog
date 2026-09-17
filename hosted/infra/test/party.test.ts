import { describe, expect, it } from "vitest";
import { openParty, type PartyDeps } from "../lib/handlers/discord/party";
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

  it("opens in the server's default channel when the caller names none", async () => {
    const { guilds, rest, deps } = await ready();
    await guilds.updateGuild("g1", NOW, { channelId: "runs" });
    const guild = (await guilds.guild("g1"))!;
    await openParty(deps, { guild, sessionId: "01RUN", by: mira, mayHost: true });
    expect(rest.posts[0]?.channel).toBe("thread_1");
    expect(rest.threads).toHaveLength(1);
  });
});
