import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleInteraction, LINK_MINUTES } from "../lib/handlers/discord/interactions";
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
