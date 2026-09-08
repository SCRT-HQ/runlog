import { newCode } from "../races.js";
import type { GuildStore } from "../guilds.js";
import { isCommandName } from "./commands.js";
import { EPHEMERAL, InteractionType, ResponseType, nameOf, userOf, type Interaction, type InteractionResponse } from "./types.js";

/**
 * What the bot says back.
 *
 * Discord sends each press here and waits three seconds for the answer,
 * so everything in this file answers in one turn: a row written, a
 * message returned. Nothing is fetched from Discord and nothing posted to
 * it on the way.
 *
 * Identity is Discord's word: the user in an interaction is who Discord
 * says pressed, signed by Discord, so linking needs no sign-in of its
 * own on this side. `/link` mints a short code bound to that Discord
 * user; the person opens the code's address signed in to Runlog, and the
 * app hands the code back with their account behind it. Ten minutes,
 * once, then the code is gone.
 */

export interface InteractionDeps {
  guilds: GuildStore;
  /** Where the app is, for the address a code is opened at. */
  appUrl: string;
  now: () => string;
  /** Codes are random by default; a test hands in its own. */
  code?: () => string;
}

/** How long a link code lasts. */
export const LINK_MINUTES = 10;

const ephemeral = (content: string): InteractionResponse => ({ type: ResponseType.ChannelMessage, data: { content, flags: EPHEMERAL } });

export async function handleInteraction(i: Interaction, deps: InteractionDeps): Promise<InteractionResponse> {
  if (i.type === InteractionType.Ping) return { type: ResponseType.Pong };

  if (i.type === InteractionType.ApplicationCommand) {
    const name = i.data?.name;
    if (!isCommandName(name)) return ephemeral("That is not a command this bot knows. It may have been retired; try again later.");
    const who = userOf(i);
    if (!who) return ephemeral("Discord did not say who pressed, so there is nothing to link.");

    if (name === "link") {
      const already = await deps.guilds.userForDiscord(who.id);
      if (already) return ephemeral("This Discord account is already linked to a Runlog account. To link a different one, unlink it first from your Runlog profile, under Social.");
      const at = deps.now();
      const code = deps.code ? deps.code() : newCode();
      const expiresAt = new Date(Date.parse(at) + LINK_MINUTES * 60_000).toISOString();
      await deps.guilds.putLinkCode({ code, discordUserId: who.id, name: nameOf(who), ...(i.guild_id ? { guildId: i.guild_id } : {}), createdAt: at, expiresAt });
      const home = deps.appUrl.replace(/\/$/, "");
      return ephemeral(
        `Open this address signed in to Runlog, within ${LINK_MINUTES} minutes, and your accounts are linked:\n${home}/#link/discord?c=${code}\n\nOnly you can see this message. The code works once.`,
      );
    }
  }

  // Buttons, menus and modals arrive once the bot hosts runs; until then
  // a press on anything is answered rather than left spinning.
  return ephemeral("Nothing to do with that yet.");
}
