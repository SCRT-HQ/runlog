import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canManage, handleInteraction, LINK_MINUTES } from "../lib/handlers/discord/interactions";
import { COMMANDS, isCommandName } from "../lib/handlers/discord/commands";
import { EPHEMERAL, InteractionType, ResponseType, type Interaction } from "../lib/handlers/discord/types";
import { verifyInteraction } from "../lib/handlers/discord/verify";
import { memoryGuilds } from "./memory-guilds";

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
    expect(out.data?.content).toContain("https://runlog.test/#link/discord?c=ABCDEF");
    expect(out.data?.content).toContain(`${LINK_MINUTES} minutes`);
    expect(guilds.codes.get("ABCDEF")).toEqual({ code: "ABCDEF", discordUserId: "1001", name: "Mira", guildId: "g1", createdAt: NOW, expiresAt: "2026-09-08T12:10:00.000Z" });
  });

  it("uses the handle where no display name was chosen, and works from a direct message too", async () => {
    const guilds = memoryGuilds();
    await handleInteraction(press({ user: { id: "1002", username: "kiln_hand", global_name: null }, data: { name: "link" } }), { guilds, appUrl: "https://runlog.test", now: () => NOW, code: () => "GHJKLM" });
    expect(guilds.codes.get("GHJKLM")).toMatchObject({ discordUserId: "1002", name: "kiln_hand" });
    expect(guilds.codes.get("GHJKLM")).not.toHaveProperty("guildId");
  });

  it("says so, rather than minting, when the Discord account is already linked", async () => {
    const guilds = memoryGuilds();
    await guilds.connect("user_1", { discordUserId: "1001", name: "Mira", linkedAt: NOW });
    const out = await handleInteraction(press({ member: { user: mira }, data: { name: "link" } }), { guilds, appUrl: "https://runlog.test/", now: () => NOW, code: () => "ABCDEF" });
    expect(out.data?.content).toContain("already linked");
    expect(guilds.codes.size).toBe(0);
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
    expect((await handleInteraction(admin, deps)).data?.content).toContain("#link/guild?c=CLAIM1");
    expect(canManage({ ...manager, member: { user: mira, permissions: "not a number" } })).toBe(false);
    const { member: _m, ...nobody } = manager;
    expect(canManage(nobody)).toBe(false);
  });

  it("mints a claim code bound to the server, and says when the server is claimed already", async () => {
    const guilds = memoryGuilds();
    const deps = { guilds, appUrl: "https://runlog.test", now: () => NOW, code: () => "CLAIM1" };
    const out = await handleInteraction(setup("claim"), deps);
    expect(out.data?.flags).toBe(EPHEMERAL);
    expect(out.data?.content).toContain("https://runlog.test/#link/guild?c=CLAIM1");
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

  it("reports the claim, the plan, the hosts and the packs, in words a member can act on", async () => {
    const guilds = memoryGuilds();
    await guilds.claimGuild({ guildId: "g1", name: "The Kiln Room", ownerSub: "user_1", claimedAt: NOW, hostRoleId: "r1" });
    await guilds.connect("user_1", { discordUserId: "1001", name: "Mira", linkedAt: NOW });
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
    // /packs, for anyone: the same list, without the rest.
    const packs = await handleInteraction(press({ guild_id: "g1", member: { user: mira }, data: { name: "packs" } }), { guilds, appUrl: "https://runlog.test/", now: () => NOW });
    expect(packs.data?.content).toContain("**The Long Kiln** — Standard, Short");
    const none = await handleInteraction(press({ guild_id: "g2", member: { user: mira }, data: { name: "packs" } }), { guilds, appUrl: "https://runlog.test/", now: () => NOW });
    expect(none.data?.content).toContain("not set up");
  });
});
