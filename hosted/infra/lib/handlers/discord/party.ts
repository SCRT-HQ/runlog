import type { LiveSnapshot } from "@runlog/engine";
import type { Guild, GuildStore, PartyClose, WatchParty } from "../guilds.js";
import type { Store } from "../store.js";
import { partyCardFor, partyClosingLine } from "./card.js";
import type { DiscordRest } from "./rest.js";

/**
 * A watch party: a thread in a claimed server that follows a run the app
 * hosts.
 *
 * Nothing here touches a log. The page that plays the run is its one
 * writer; this reads the snapshot that page publishes and edits one
 * Discord message with it. The card carries no presses, and what it says
 * is what the snapshot already says to any watcher, which is why the
 * server needs no copy of the pack.
 */

export interface PartyDeps {
  store: Pick<Store, "getSession" | "getSnapshot">;
  guilds: GuildStore;
  /** Discord itself; null where the bot has no token on this copy. */
  rest: DiscordRest | null;
  now: () => string;
}

export interface PartyOpen {
  guild: Guild;
  /** Where to open the thread; the server's default channel where this is left out. */
  channelId?: string;
  sessionId: string;
  by: { discordId: string; name: string; sub: string };
  /** Whether this person may host on this server, decided by the caller who knows how they asked. */
  mayHost: boolean;
  /** The run's live link, where the caller holds one fresher than the server's. */
  link?: string;
  private?: boolean;
}

/** The snapshot as the engine wrote it, or null where the row holds something else. */
export function snapshotOfRun(held: { snapshot: unknown } | null): LiveSnapshot | null {
  const s = held?.snapshot;
  if (typeof s !== "object" || s === null || Array.isArray(s)) return null;
  const row = s as Record<string, unknown>;
  return typeof row["packTitle"] === "string" && typeof row["unit"] === "number" ? (s as LiveSnapshot) : null;
}

export async function openParty(deps: PartyDeps, input: PartyOpen): Promise<{ party: WatchParty } | { error: string }> {
  const { guild, sessionId, by } = input;
  if (!deps.rest) return { error: "The bot cannot post to Discord yet: its token is not filled in on this copy of Runlog." };
  if (!input.mayHost)
    return {
      error: guild.hostRoleId
        ? `Opening a watch party here takes the <@&${guild.hostRoleId}> role.`
        : "Opening a watch party here takes someone who can manage the server, until /setup role names a role.",
    };
  const found = await deps.store.getSession(sessionId);
  if (!found || found.meta.deletedAt) return { error: "There is no run by that name." };
  // A host opens a party for their own run and nobody else's.
  if (found.meta.ownerSub !== by.sub) return { error: "A watch party is for a run of your own." };
  const already = await deps.guilds.party(sessionId, guild.guildId);
  if (already && !already.closedAt) return { error: `This server already has a watch party on that run: <#${already.threadId}>.` };
  if (input.link) await deps.guilds.putLiveLink(sessionId, input.link, deps.now());
  const link = input.link ?? (await deps.guilds.liveLink(sessionId));
  if (!link || !found.meta.publicTokenHash) return { error: "Share the run first: a watch party carries its live link." };
  const snapshot = snapshotOfRun(await deps.store.getSnapshot(sessionId));
  if (!snapshot) return { error: "That run has not said anything yet; open it in the app and try again." };
  const channelId = input.channelId ?? guild.channelId;
  if (!channelId) return { error: "Nowhere to open the party: say where, or set a channel with /setup channel." };

  const at = deps.now();
  const name = [snapshot.runName, snapshot.packTitle, snapshot.mode].filter((p): p is string => Boolean(p)).join(" · ");
  const threadId = await deps.rest.createThread(channelId, name, input.private);
  if (!threadId)
    return {
      error: `Discord would not open a thread here. The bot needs permission to create ${input.private ? "private" : "public"} threads in this channel.`,
    };
  if (input.private) await deps.rest.addThreadMember(threadId, by.discordId);
  // One message: the link and the card together, the way a run's opening
  // message carries both, so opening is one post and at most one pin.
  const card = partyCardFor({ snapshot, link, openedByName: by.name });
  const cardMessageId = await deps.rest.postMessage(threadId, { content: `Watch it live, no account needed: ${link}`, ...card });
  if (cardMessageId && guild.cardMode === "pinned") await deps.rest.pinMessage(threadId, cardMessageId);

  const party: WatchParty = {
    sessionId,
    guildId: guild.guildId,
    channelId,
    threadId,
    ...(cardMessageId ? { cardMessageId } : {}),
    link,
    openedBy: by.discordId,
    openedByName: by.name,
    openedAt: at,
    ...(guild.cardMode ? { cardMode: guild.cardMode } : {}),
    editedAt: at,
    updatedAt: at,
  };
  await deps.guilds.putParty(party);
  return { party };
}

/**
 * Close a party.
 *
 * The run ending is the one case that speaks: the card takes its final
 * state and the thread gets one line. A party closed early says so on the
 * card alone, and the thread is left as it is; a party whose message
 * Discord lost says nothing at all, since there is nowhere to say it.
 */
export async function closeParty(deps: PartyDeps, party: WatchParty, why: PartyClose): Promise<WatchParty> {
  const at = deps.now();
  const closed: WatchParty = { ...party, closedAt: at, closedFor: why, updatedAt: at };
  delete closed.tickAt;
  if (deps.rest && party.cardMessageId && why !== "gone") {
    const snapshot = snapshotOfRun(await deps.store.getSnapshot(party.sessionId));
    if (snapshot) {
      const card = partyCardFor({
        snapshot,
        link: party.link,
        openedByName: party.openedByName,
        ...(party.handouts ? { handouts: party.handouts } : {}),
        closed: why,
      });
      const edited = await deps.rest.editMessage(party.threadId, party.cardMessageId, card);
      if (edited && why === "ended") await deps.rest.postMessage(party.threadId, { content: partyClosingLine(snapshot) });
    }
  }
  await deps.guilds.putParty(closed);
  return closed;
}
