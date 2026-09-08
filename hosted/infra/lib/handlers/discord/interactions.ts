import { newCode } from "../races.js";
import type { GuildStore } from "../guilds.js";
import { isCommandName } from "./commands.js";
import { EPHEMERAL, InteractionType, ResponseType, nameOf, userOf, type CommandOption, type Interaction, type InteractionResponse } from "./types.js";

/**
 * What the bot says back.
 *
 * Discord sends each press here and waits three seconds for the answer,
 * so everything in this file answers in one turn: a row written, a
 * message returned. Nothing is fetched from Discord and nothing posted to
 * it on the way.
 *
 * Identity is Discord's word: the user in an interaction is who Discord
 * says pressed, signed by Discord, so linking and claiming need no
 * sign-in of their own on this side. `/link` mints a short code bound to
 * that Discord user, `/setup claim` one bound to the server; the person
 * opens the code's address signed in to Runlog, and the app hands the
 * code back with their account behind it. Ten minutes, once, then the
 * code is gone.
 */

export interface InteractionDeps {
  guilds: GuildStore;
  /** Where the app is, for the address a code is opened at. */
  appUrl: string;
  now: () => string;
  /** Codes are random by default; a test hands in its own. */
  code?: () => string;
  /** What a person has been granted, for `/setup status`; absent, the plan is not spoken of. */
  grants?: (sub: string) => Promise<string[]>;
  /** What Stripe calls the server plan. */
  serverFeature?: string;
  /** Whether plans gate anything on this copy. */
  gates?: boolean;
}

/** How long a link or claim code lasts. */
export const LINK_MINUTES = 10;

/** Discord's permission bits that mean "may manage this server": MANAGE_GUILD, or ADMINISTRATOR, which implies everything. */
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

const ephemeral = (content: string): InteractionResponse => ({ type: ResponseType.ChannelMessage, data: { content, flags: EPHEMERAL } });

/** Whether the member who pressed may manage the server, by the permissions Discord computed for them. */
export function canManage(i: Interaction): boolean {
  const raw = i.member?.permissions;
  if (!raw || !/^\d{1,30}$/.test(raw)) return false;
  const bits = BigInt(raw);
  return (bits & ADMINISTRATOR) !== 0n || (bits & MANAGE_GUILD) !== 0n;
}

const sub = (i: Interaction): { name: string; options: CommandOption[] } | null => {
  const first = i.data?.options?.[0];
  return first && first.type === 1 ? { name: first.name, options: first.options ?? [] } : null;
};
const optionValue = (options: CommandOption[], name: string): string | null => {
  const v = options.find((o) => o.name === name)?.value;
  return typeof v === "string" ? v : null;
};

export async function handleInteraction(i: Interaction, deps: InteractionDeps): Promise<InteractionResponse> {
  if (i.type === InteractionType.Ping) return { type: ResponseType.Pong };

  if (i.type === InteractionType.ApplicationCommand) {
    const name = i.data?.name;
    if (!isCommandName(name)) return ephemeral("That is not a command this bot knows. It may have been retired; try again later.");
    const who = userOf(i);
    if (!who) return ephemeral("Discord did not say who pressed, so there is nothing to do.");
    const home = deps.appUrl.replace(/\/$/, "");
    const at = deps.now();
    const expiresAt = new Date(Date.parse(at) + LINK_MINUTES * 60_000).toISOString();

    if (name === "link") {
      const already = await deps.guilds.userForDiscord(who.id);
      if (already) return ephemeral("This Discord account is already linked to a Runlog account. To link a different one, unlink it first from your Runlog profile, under Social.");
      const code = deps.code ? deps.code() : newCode();
      await deps.guilds.putLinkCode({ code, discordUserId: who.id, name: nameOf(who), ...(i.guild_id ? { guildId: i.guild_id } : {}), createdAt: at, expiresAt });
      return ephemeral(`Open this address signed in to Runlog, within ${LINK_MINUTES} minutes, and your accounts are linked:\n${home}/#link/discord?c=${code}\n\nOnly you can see this message. The code works once.`);
    }

    if (name === "setup") {
      if (!i.guild_id) return ephemeral("Setup is for a server; run it there.");
      if (!canManage(i)) return ephemeral("Setting up Runlog here takes someone who can manage the server.");
      const which = sub(i);
      const guild = await deps.guilds.guild(i.guild_id);

      if (which?.name === "claim") {
        const code = deps.code ? deps.code() : newCode();
        await deps.guilds.putClaimCode({ code, guildId: i.guild_id, discordUserId: who.id, createdAt: at, expiresAt });
        return ephemeral(
          `Open this address signed in to Runlog, within ${LINK_MINUTES} minutes, to claim this server for that account:\n${home}/#link/guild?c=${code}\n\n` +
            `The account that claims a server pays for its plan and chooses, from its own packs, what the bot plays here.${guild ? " This server is claimed already; claiming again moves it to the new account." : ""} Only you can see this message. The code works once.`,
        );
      }
      if (!guild) return ephemeral("This server is not claimed yet. Run /setup claim first.");

      if (which?.name === "role") {
        const roleId = optionValue(which.options, "role");
        await deps.guilds.updateGuild(i.guild_id, at, { hostRoleId: roleId });
        return ephemeral(roleId ? `Hosting runs here now takes the <@&${roleId}> role.` : "Anyone who can manage the server may host runs here now.");
      }
      if (which?.name === "channel") {
        const channelId = optionValue(which.options, "channel");
        await deps.guilds.updateGuild(i.guild_id, at, { channelId });
        return ephemeral(channelId ? `Runs open in <#${channelId}> by default now.` : "Runs open wherever /run is used now.");
      }
      if (which?.name === "status") {
        const owner = await deps.guilds.connection(guild.ownerSub);
        const packs = await deps.guilds.listGuildPacks(i.guild_id);
        const plan = !deps.gates
          ? "plans are open on this copy of Runlog"
          : deps.grants && (await deps.grants(guild.ownerSub)).includes(deps.serverFeature ?? "server")
            ? "Runlog for servers, active"
            : "no server plan yet; the account that claimed it subscribes from its Runlog profile, under Servers";
        const lines = [
          `**Runlog on ${guild.name ?? "this server"}**`,
          `Claimed by ${owner ? owner.name : "a Runlog account not linked to Discord"}.`,
          `Plan: ${plan}.`,
          `Hosts: ${guild.hostRoleId ? `<@&${guild.hostRoleId}>` : "anyone who can manage the server"}.`,
          `Runs open ${guild.channelId ? `in <#${guild.channelId}>` : "wherever /run is used"}.`,
          packs.length === 0 ? "Packs: none yet; the account that claimed the server adds them from its profile, under Servers." : `Packs: ${packs.map((p) => `${p.title} (${p.modes.map((m) => m.label).join(", ") || "one mode"})`).join("; ")}.`,
        ];
        return ephemeral(lines.join("\n"));
      }
      return ephemeral("Setup has claim, role, channel and status.");
    }

    if (name === "packs") {
      if (!i.guild_id) return ephemeral("Packs are a server's; ask in one.");
      const guild = await deps.guilds.guild(i.guild_id);
      if (!guild) return ephemeral("This server is not set up for Runlog yet. Someone who can manage it runs /setup claim.");
      const packs = await deps.guilds.listGuildPacks(i.guild_id);
      if (packs.length === 0) return ephemeral("No packs here yet. The account that claimed the server adds them from its Runlog profile, under Servers.");
      return ephemeral(packs.map((p) => `**${p.title}** — ${p.modes.map((m) => m.label).join(", ") || "one mode"}`).join("\n"));
    }
  }

  // Buttons, menus and modals arrive once the bot hosts runs; until then
  // a press on anything is answered rather than left spinning.
  return ephemeral("Nothing to do with that yet.");
}
