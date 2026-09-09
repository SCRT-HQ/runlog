import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canManage, handleInteraction, LINK_MINUTES, type InteractionDeps } from "../lib/handlers/discord/interactions";
import { COMMANDS, isCommandName } from "../lib/handlers/discord/commands";
import { EPHEMERAL, InteractionType, ResponseType, type Interaction } from "../lib/handlers/discord/types";
import { verifyInteraction } from "../lib/handlers/discord/verify";
import type { SessionMeta, Store } from "../lib/handlers/store";
import { memoryDiscord, memoryGuilds } from "./memory-guilds";

/**
 * The bot, apart from the API around it.
 *
 * Two things matter here and nowhere else: that only a body Discord
 * signed is believed, since the endpoint takes no bearer; and that
 * linking is one press and one code, bound to the Discord account that
 * pressed, spent once.
 */

/** A keypair of the kind Discord holds: the public half as Discord shows it, 32 bytes in hex. */
function discordKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const signed = (timestamp: string, body: string) => sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), privateKey).toString("hex");
  return { publicHex, signed };
}


describe("the command list", () => {
  it("keeps every description within Discord's hundred characters, since registration refuses a longer one", () => {
    const seen: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (typeof node !== "object" || node === null) return;
      const rec = node as Record<string, unknown>;
      if (typeof rec["description"] === "string" && rec["description"].length > 100) seen.push(`${path}: ${rec["description"].length}`);
      for (const [k, v] of Object.entries(rec)) walk(v, `${path}.${k}`);
    };
    walk(COMMANDS, "commands");
    expect(seen).toEqual([]);
  });
});

describe("a Discord signature", () => {
  const keys = discordKeys();
  const body = JSON.stringify({ type: 1 });

  it("is believed over the timestamp and the body as they arrived", () => {
    expect(verifyInteraction(keys.publicHex, keys.signed("1700000000", body), "1700000000", Buffer.from(body))).toBe(true);
  });

  it("is not believed over a different body, timestamp or key, or with anything missing", () => {
    const good = keys.signed("1700000000", body);
    expect(verifyInteraction(keys.publicHex, good, "1700000001", Buffer.from(body))).toBe(false);
    expect(verifyInteraction(keys.publicHex, good, "1700000000", Buffer.from(body + " "))).toBe(false);
    expect(verifyInteraction(discordKeys().publicHex, good, "1700000000", Buffer.from(body))).toBe(false);
    expect(verifyInteraction(keys.publicHex, undefined, "1700000000", Buffer.from(body))).toBe(false);
    expect(verifyInteraction(keys.publicHex, good, undefined, Buffer.from(body))).toBe(false);
    expect(verifyInteraction("not a key", good, "1700000000", Buffer.from(body))).toBe(false);
    expect(verifyInteraction(keys.publicHex, "zz", "1700000000", Buffer.from(body))).toBe(false);
  });
});

const NOW = "2026-09-08T12:00:00.000Z";
const press = (over: Partial<Interaction>): Interaction => ({ id: "i1", application_id: "app", type: InteractionType.ApplicationCommand, token: "t", ...over });
const mira = { id: "1001", username: "mira", global_name: "Mira" };

describe("the bot", () => {
  it("answers Discord's ping with a pong, which is how the endpoint is accepted", async () => {
    const out = await handleInteraction(press({ type: InteractionType.Ping }), { guilds: memoryGuilds(), appUrl: "https://runlog.test/", now: () => NOW });
    expect(out).toEqual({ type: ResponseType.Pong });
  });

  it("registers only commands it answers", () => {
    for (const c of COMMANDS) expect(isCommandName(c.name)).toBe(true);
    expect(isCommandName("ban")).toBe(false);
  });

  it("mints a link code for whoever pressed /link, bound to their Discord account, and shows it to them alone", async () => {
    const guilds = memoryGuilds();
    const out = await handleInteraction(press({ guild_id: "g1", member: { user: mira }, data: { name: "link" } }), { guilds, appUrl: "https://runlog.test/", now: () => NOW, code: () => "ABCDEF" });
    expect(out.type).toBe(ResponseType.ChannelMessage);
    expect(out.data?.flags).toBe(EPHEMERAL);
    expect(out.data?.content).toContain("https://runlog.test/play/link/discord?c=ABCDEF");
    expect(out.data?.content).toContain(`${LINK_MINUTES} minutes`);
    expect(guilds.codes.get("ABCDEF")).toEqual({ code: "ABCDEF", discordUserId: "1001", name: "Mira", guildId: "g1", createdAt: NOW, expiresAt: "2026-09-08T12:10:00.000Z" });
  });

  it("uses the handle where no display name was chosen, and works from a direct message too", async () => {
    const guilds = memoryGuilds();
    await handleInteraction(press({ user: { id: "1002", username: "kiln_hand", global_name: null }, data: { name: "link" } }), { guilds, appUrl: "https://runlog.test", now: () => NOW, code: () => "GHJKLM" });
    expect(guilds.codes.get("GHJKLM")).toMatchObject({ discordUserId: "1002", name: "kiln_hand" });
    expect(guilds.codes.get("GHJKLM")).not.toHaveProperty("guildId");
  });

  it("mints again for a Discord account already linked, saying the link would move, and unlinks on request", async () => {
    const guilds = memoryGuilds();
    const deps = { guilds, appUrl: "https://runlog.test/", now: () => NOW, code: () => "ABCDEF" };
    expect((await handleInteraction(press({ member: { user: mira }, data: { name: "unlink" } }), deps)).data?.content).toContain("not linked");
    await guilds.connect("user_1", { service: "discord", accountId: "1001", name: "Mira", linkedAt: NOW });
    const out = await handleInteraction(press({ member: { user: mira }, data: { name: "link" } }), deps);
    expect(out.data?.content).toContain("already linked");
    expect(out.data?.content).toContain("moves the link there");
    expect(out.data?.content).toContain("play/link/discord?c=ABCDEF");
    expect(guilds.codes.size).toBe(1);
    const gone = await handleInteraction(press({ member: { user: mira }, data: { name: "unlink" } }), deps);
    expect(gone.data?.content).toContain("Unlinked");
    expect(gone.data?.flags).toBe(EPHEMERAL);
    expect(await guilds.userForDiscord("1001")).toBeNull();
    expect(await (await guilds.connections("user_1"))[0] ?? null).toBeNull();
  });

  it("answers a command it does not know, and a press on nothing, rather than leaving Discord waiting", async () => {
    const deps = { guilds: memoryGuilds(), appUrl: "https://runlog.test/", now: () => NOW };
    expect((await handleInteraction(press({ member: { user: mira }, data: { name: "ban" } }), deps)).data?.content).toContain("not a command");
    expect((await handleInteraction(press({ type: InteractionType.MessageComponent, data: { custom_id: "x" } }), deps)).data?.flags).toBe(EPHEMERAL);
  });
});

const manager: Interaction = { ...press({}), guild_id: "g1", member: { user: mira, permissions: String(1 << 5) } };
const setup = (name: string, options: Array<{ name: string; type: number; value: string }> = [], over: Partial<Interaction> = {}): Interaction => ({ ...manager, ...over, data: { name: "setup", options: [{ name, type: 1, options }] } });

describe("setting up a server", () => {
  it("takes someone who can manage the server, by the permissions Discord computed for them", async () => {
    const guilds = memoryGuilds();
    const deps = { guilds, appUrl: "https://runlog.test/", now: () => NOW, code: () => "CLAIM1" };
    const member = setup("claim", [], { member: { user: mira, permissions: "0" } });
    expect((await handleInteraction(member, deps)).data?.content).toContain("takes someone who can manage");
    // An administrator may do anything, whatever else the field says.
    const admin = setup("claim", [], { member: { user: mira, permissions: String(1 << 3) } });
    expect((await handleInteraction(admin, deps)).data?.content).toContain("play/link/guild?c=CLAIM1");
    expect(canManage({ ...manager, member: { user: mira, permissions: "not a number" } })).toBe(false);
    const { member: _m, ...nobody } = manager;
    expect(canManage(nobody)).toBe(false);
  });

  it("mints a claim code bound to the server, and says when the server is claimed already", async () => {
    const guilds = memoryGuilds();
    const deps = { guilds, appUrl: "https://runlog.test", now: () => NOW, code: () => "CLAIM1" };
    const out = await handleInteraction(setup("claim"), deps);
    expect(out.data?.flags).toBe(EPHEMERAL);
    expect(out.data?.content).toContain("https://runlog.test/play/link/guild?c=CLAIM1");
    expect(guilds.claims.get("CLAIM1")).toEqual({ code: "CLAIM1", guildId: "g1", discordUserId: "1001", createdAt: NOW, expiresAt: "2026-09-08T12:10:00.000Z" });
    await guilds.claimGuild({ guildId: "g1", ownerSub: "user_9", claimedAt: NOW });
    expect((await handleInteraction(setup("claim"), deps)).data?.content).toContain("claimed already");
  });

  it("sets who hosts and where runs open only once the server is claimed, and clears either when the option is left out", async () => {
    const guilds = memoryGuilds();
    const deps = { guilds, appUrl: "https://runlog.test/", now: () => NOW };
    expect((await handleInteraction(setup("role", [{ name: "role", type: 8, value: "r1" }]), deps)).data?.content).toContain("not claimed yet");
    await guilds.claimGuild({ guildId: "g1", ownerSub: "user_1", claimedAt: NOW });
    expect((await handleInteraction(setup("role", [{ name: "role", type: 8, value: "r1" }]), deps)).data?.content).toContain("<@&r1>");
    expect(guilds.guilds.get("g1")?.hostRoleId).toBe("r1");
    expect((await handleInteraction(setup("channel", [{ name: "channel", type: 7, value: "c1" }]), deps)).data?.content).toContain("<#c1>");
    expect((await handleInteraction(setup("role"), deps)).data?.content).toContain("Anyone who can manage");
    expect(guilds.guilds.get("g1")).not.toHaveProperty("hostRoleId");
    expect(guilds.guilds.get("g1")?.channelId).toBe("c1");
  });

  it("makes a host role and a channel for runs where it may, finds them where they exist, and asks for the permission where it may not", async () => {
    const guilds = memoryGuilds();
    const rest = memoryDiscord();
    await guilds.claimGuild({ guildId: "g1", ownerSub: "user_1", claimedAt: NOW });
    const deps = { guilds, appUrl: "https://runlog.test/", now: () => NOW, rest };
    // Installed with the seven permissions and no more: the answer is the link that adds the one needed.
    const seven = String((1n << 10n) | (1n << 11n) | (1n << 13n) | (1n << 14n) | (1n << 16n) | (1n << 35n) | (1n << 38n));
    const asked = (await handleInteraction(setup("make-role", [], { app_permissions: seven }), deps)).data?.content ?? "";
    expect(asked).toContain("installed without Manage Roles");
    expect(asked).toContain(`permissions=${String(BigInt(seven) | (1n << 28n))}`);
    expect(rest.roles).toHaveLength(0);
    // With it: a role in the accent, with no permissions of its own, set as the host role.
    const may = String(BigInt(seven) | (1n << 28n) | (1n << 4n));
    const made = (await handleInteraction(setup("make-role", [], { app_permissions: may }), deps)).data?.content ?? "";
    expect(made).toContain("Made <@&role_1>");
    expect(rest.roles).toEqual([{ id: "role_1", name: "Runlog Host", color: 0x4f8a78 }]);
    expect(guilds.guilds.get("g1")?.hostRoleId).toBe("role_1");
    // A role by that name already there is found, not made twice; the name is the person's to choose.
    rest.roles.push({ id: "role_9", name: "Hosts" });
    const found = (await handleInteraction(setup("make-role", [{ name: "name", type: 3, value: "hosts" }], { app_permissions: may }), deps)).data?.content ?? "";
    expect(found).toContain("Found <@&role_9>");
    expect(rest.roles).toHaveLength(2);
    expect(guilds.guilds.get("g1")?.hostRoleId).toBe("role_9");
    // The same for a channel, which needs Manage Channels rather than Manage Roles.
    expect((await handleInteraction(setup("make-channel", [], { app_permissions: String(BigInt(seven) | (1n << 28n)) }), deps)).data?.content).toContain("installed without Manage Channels");
    expect((await handleInteraction(setup("make-channel", [], { app_permissions: may }), deps)).data?.content).toContain("Made <#chan_2>");
    expect(rest.channels).toEqual([{ id: "chan_2", name: "runs" }]);
    expect(guilds.guilds.get("g1")?.channelId).toBe("chan_2");
    // An administrator bot may do anything, whatever else the field says; a bot Discord will not answer for says so.
    rest.down = true;
    expect((await handleInteraction(setup("make-channel", [], { app_permissions: String(1n << 3n) }), deps)).data?.content).toContain("Discord would not");
  });

  it("reports the claim, the plan, the hosts and the packs, in words a member can act on", async () => {
    const guilds = memoryGuilds();
    await guilds.claimGuild({ guildId: "g1", name: "The Kiln Room", ownerSub: "user_1", claimedAt: NOW, hostRoleId: "r1" });
    await guilds.connect("user_1", { service: "discord", accountId: "1001", name: "Mira", linkedAt: NOW });
    await guilds.putGuildPack("g1", { id: "com.scrthq.runlog.long-kiln", title: "The Long Kiln", version: "1.0.0", format: "yaml", hash: "h", bytes: 10, modes: [{ id: "standard", label: "Standard" }, { id: "short", label: "Short" }], updatedAt: NOW, delegatedBy: "user_1" }, "id: x");
    const open = await handleInteraction(setup("status"), { guilds, appUrl: "https://runlog.test/", now: () => NOW, gates: false });
    expect(open.data?.content).toContain("Runlog on The Kiln Room");
    expect(open.data?.content).toContain("Claimed by Mira");
    expect(open.data?.content).toContain("plans are open");
    expect(open.data?.content).toContain("<@&r1>");
    expect(open.data?.content).toContain("The Long Kiln (Standard, Short)");
    const gated = await handleInteraction(setup("status"), { guilds, appUrl: "https://runlog.test/", now: () => NOW, gates: true, serverFeature: "server", grants: async () => [] });
    expect(gated.data?.content).toContain("no server plan yet");
    const paid = await handleInteraction(setup("status"), { guilds, appUrl: "https://runlog.test/", now: () => NOW, gates: true, serverFeature: "server", grants: async () => ["server"] });
    expect(paid.data?.content).toContain("Runlog for servers, active");
    // Bought through Discord's store instead: held all the same, and said so; a server that did not is pointed both ways.
    const store = await handleInteraction(setup("status"), { guilds, appUrl: "https://runlog.test/", now: () => NOW, gates: true, serverFeature: "server", grants: async () => [], guildEntitled: async (g) => g === "g1" });
    expect(store.data?.content).toContain("active through Discord's store");
    const neither = await handleInteraction(setup("status"), { guilds, appUrl: "https://runlog.test/", now: () => NOW, gates: true, serverFeature: "server", grants: async () => [], guildEntitled: async () => false });
    expect(neither.data?.content).toContain("or the server subscribes through Discord's store");
    // /packs, for anyone: the same list, without the rest.
    const packs = await handleInteraction(press({ guild_id: "g1", member: { user: mira }, data: { name: "packs" } }), { guilds, appUrl: "https://runlog.test/", now: () => NOW });
    expect(packs.data?.content).toContain("**The Long Kiln** - Standard, Short");
    const none = await handleInteraction(press({ guild_id: "g2", member: { user: mira }, data: { name: "packs" } }), { guilds, appUrl: "https://runlog.test/", now: () => NOW });
    expect(none.data?.content).toContain("not set up");
  });

  it("sets what kind of thread a run opens in, and clears the choice back to public", async () => {
    const guilds = memoryGuilds();
    await guilds.claimGuild({ guildId: "g1", ownerSub: "user_1", claimedAt: NOW });
    const deps = { guilds, appUrl: "https://runlog.test/", now: () => NOW };
    expect((await handleInteraction(setup("threads", [{ name: "kind", type: 3, value: "private" }]), deps)).data?.content).toContain("private thread");
    expect(guilds.guilds.get("g1")?.threadMode).toBe("private");
    expect((await handleInteraction(setup("threads", [{ name: "kind", type: 3, value: "public" }]), deps)).data?.content).toContain("public thread");
    expect(guilds.guilds.get("g1")).not.toHaveProperty("threadMode");
    expect((await handleInteraction(setup("threads", [{ name: "kind", type: 3, value: "secret" }]), deps)).data?.content).toContain("public thread or a private one");
  });
});

/**
 * A run nobody else in the server needs to see.
 *
 * The thread is the run, so the kind of thread decides who can watch:
 * a private one holds the host and whoever they add, which makes the
 * public announcement a start would post pointless, and the permission
 * to open one is not in the install link.
 */
describe("a run in a private thread", () => {
  const demo = readFileSync(join(__dirname, "..", "..", "..", "packs", "demo", "pack.yaml"), "utf8");
  const PACK = "com.scrthq.runlog.long-kiln";
  /** The permissions the bot is installed with, and no more; and those with Create Private Threads added. */
  const INSTALLED = String((1n << 10n) | (1n << 11n) | (1n << 13n) | (1n << 14n) | (1n << 16n) | (1n << 35n) | (1n << 38n));
  const MAY = String(BigInt(INSTALLED) | (1n << 36n));

  /** The little of the store a start touches: the session it writes, the live link's hash, and the snapshot after. */
  function startStore(): Store {
    const sessions = new Map<string, SessionMeta>();
    return {
      async createSession(meta: Omit<SessionMeta, "seq" | "createdAt" | "updatedAt">, at: string) {
        const made = { ...meta, seq: 1, createdAt: at, updatedAt: at } as SessionMeta;
        sessions.set(made.id, made);
        return { meta: made, events: [] };
      },
      async updateSession(id: string) {
        return sessions.get(id) ?? null;
      },
      async putSnapshot() {},
    } as unknown as Store;
  }

  /** A server claimed by Mira, with the demo pack in its vault and a bot that answers. */
  async function server(threadMode?: "private") {
    const guilds = memoryGuilds();
    const rest = memoryDiscord();
    let ids = 0;
    await guilds.claimGuild({ guildId: "g1", name: "The Kiln Room", ownerSub: "user_1", claimedAt: NOW });
    await guilds.connect("user_1", { service: "discord", accountId: "1001", name: "Mira", linkedAt: NOW });
    await guilds.putGuildPack("g1", { id: PACK, title: "The Long Kiln", version: "1", format: "yaml", hash: "h", bytes: demo.length, modes: [{ id: "standard", label: "Standard" }], updatedAt: NOW, delegatedBy: "user_1" }, demo);
    if (threadMode) await guilds.updateGuild("g1", NOW, { threadMode });
    const deps: InteractionDeps = { guilds, appUrl: "https://runlog.test/", now: () => NOW, store: startStore(), rest, mintId: () => `01${String((ids += 1)).padStart(24, "0")}`, token: () => "livetok" };
    return { guilds, rest, deps };
  }

  const start = (options: Array<{ name: string; type: number; value: string | number | boolean }> = [], over: Partial<Interaction> = {}): Interaction => ({
    ...press({}),
    guild_id: "g1",
    channel_id: "chan",
    member: { user: mira, permissions: String(1 << 5), roles: [] },
    app_permissions: MAY,
    ...over,
    data: { name: "run", options: [{ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }, ...options] }] },
  });

  it("opens a private thread on request, puts the host in it, and answers the host alone", async () => {
    const { guilds, rest, deps } = await server();
    const out = await handleInteraction(start([{ name: "private", type: 5, value: true }]), deps);
    expect(out.type).toBe(ResponseType.ChannelMessage);
    expect(out.data?.flags).toBe(EPHEMERAL);
    expect(out.data?.content).toContain("Started **The Long Kiln · Standard Firing** in <#thread_1>");
    expect(out.data?.content).toContain("https://runlog.test/r/01000000000000000000000001?t=livetok");
    // Nobody else is told, since nobody else can open the thread.
    expect(out.data?.content).not.toContain("**Mira** started");
    expect(rest.privateThreads).toEqual(["thread_1"]);
    // A private thread starts with only the bot in it, so the host is put in it.
    expect(rest.threadMembers).toEqual([{ thread: "thread_1", user: "1001" }]);
    expect(await guilds.guildRun("01000000000000000000000001")).toMatchObject({ threadId: "thread_1", private: true });
  });

  it("opens a public thread and tells the channel where nothing asks otherwise", async () => {
    const { rest, deps } = await server();
    const out = await handleInteraction(start(), deps);
    expect(out.data?.flags).toBeUndefined();
    expect(out.data?.content).toContain("**Mira** started **The Long Kiln · Standard Firing** in <#thread_1>");
    expect(rest.privateThreads).toEqual([]);
    expect(rest.threadMembers).toEqual([]);
  });

  it("takes the server's default where the command leaves the option out, and the command's word where it does not", async () => {
    const { rest, deps } = await server("private");
    const said = await handleInteraction(setup("status"), { ...deps, gates: false });
    expect(said.data?.content).toContain("private thread the host and whoever they add can see");
    const byDefault = await handleInteraction(start(), deps);
    expect(byDefault.data?.flags).toBe(EPHEMERAL);
    expect(rest.privateThreads).toEqual(["thread_1"]);
    // The option, said either way, decides the run it is said on.
    const asked = await handleInteraction(start([{ name: "private", type: 5, value: false }]), deps);
    expect(asked.data?.flags).toBeUndefined();
    expect(asked.data?.content).toContain("in <#thread_3>");
    expect(rest.privateThreads).toEqual(["thread_1"]);
  });

  it("asks for the permission rather than opening the run in the open, where the bot has not been granted it", async () => {
    const { guilds, rest, deps } = await server();
    const out = await handleInteraction(start([{ name: "private", type: 5, value: true }], { app_permissions: INSTALLED }), deps);
    expect(out.data?.flags).toBe(EPHEMERAL);
    expect(out.data?.content).toContain("installed without Create Private Threads");
    expect(out.data?.content).toContain(`permissions=${String(BigInt(INSTALLED) | (1n << 36n))}`);
    // Nothing was made: no thread, no post, no run.
    expect(rest.threads).toEqual([]);
    expect(rest.posts).toEqual([]);
    expect(await guilds.guildRun("01000000000000000000000001")).toBeNull();
  });

  it("keeps the deferred placeholder to the host for a private run, so the reply filled into it is theirs alone", async () => {
    const { rest, deps } = await server();
    const deferred: Interaction[] = [];
    const withTime: InteractionDeps = {
      ...deps,
      defer: async (i) => {
        deferred.push(i);
      },
    };
    expect(await handleInteraction(start([{ name: "private", type: 5, value: true }]), withTime)).toEqual({ type: ResponseType.DeferredChannelMessage, data: { flags: EPHEMERAL } });
    expect(await handleInteraction(start(), withTime)).toEqual({ type: ResponseType.DeferredChannelMessage });
    expect(deferred).toHaveLength(2);
    // The work itself is the job's; nothing was said to Discord in this turn.
    expect(rest.threads).toEqual([]);
  });
});
