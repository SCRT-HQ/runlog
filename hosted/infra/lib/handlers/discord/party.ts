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
 *
 * Closing a party that is closed already does nothing and says nothing.
 * The ending and the tick both come here, and either can be handed the
 * same row twice, which would otherwise post the closing line again.
 */
export async function closeParty(deps: PartyDeps, party: WatchParty, why: PartyClose): Promise<WatchParty> {
  if (party.closedAt) return party;
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

/**
 * How often a party's card may be edited.
 *
 * The bot's own rope on a Discord call is a timeout, not a rate limiter,
 * so this is the whole of what spaces the edits out: one per party per ten
 * seconds, however fast the run moves.
 */
export const TICK_MS = 10_000;

export interface PartyTickDeps extends PartyDeps {
  /** Sleep, for the trailing edit; a test hands in a clock it moves itself. */
  wait: (ms: number) => Promise<void>;
}

export type PartyTickOutcome = "edited" | "held" | "closed" | "quiet";

/**
 * A snapshot landed: bring each of this run's party cards up to date.
 *
 * Due, so it is edited now. Not due, so this call takes the tick, waits
 * out what is left of it and edits with whatever the snapshot says by
 * then: the latest snapshot wins, and a change nobody follows with
 * another still lands on the next tick. A tick somebody else is holding
 * is left to them.
 */
export async function tickParties(deps: PartyTickDeps, sessionId: string): Promise<Array<{ guildId: string; outcome: PartyTickOutcome }>> {
  const open = (await deps.guilds.partiesOf(sessionId)).filter((p) => !p.closedAt);
  if (open.length === 0) return [];
  const read = async () => snapshotOfRun(await deps.store.getSnapshot(sessionId));
  const found = await deps.store.getSession(sessionId);
  // A run that stopped being shared, or went: the token every card's link
  // carries is dead, so the parties close rather than go on drawing it.
  // Nothing is said in the thread, which is what "gone" already means.
  if (!found || found.meta.deletedAt || !found.meta.publicTokenHash) {
    return Promise.all(
      open.map(async (party) => {
        await closeParty(deps, party, "gone");
        return { guildId: party.guildId, outcome: "closed" as const };
      }),
    );
  }
  /**
   * One party's turn, run beside the others rather than after them: a
   * run watched from three servers holds one ten second wait between
   * them all, and the job's thirty seconds are not three waits long.
   */
  const tickOne = async (party: WatchParty): Promise<PartyTickOutcome> => {
    const first = await read();
    if (!first) return "quiet";
    // The run being over is not made to wait: it is the last thing the
    // card will ever say.
    if (first.status === "ended") {
      await closeParty(deps, party, "ended");
      return "closed";
    }
    const due = Date.parse(party.editedAt ?? party.openedAt) + TICK_MS;
    const now = Date.parse(deps.now());
    let outcome: PartyTickOutcome = "edited";
    if (now < due) {
      if (party.tickAt) return "quiet";
      if (!(await deps.guilds.claimPartyTick(sessionId, party.guildId, new Date(due).toISOString()))) return "quiet";
      await deps.wait(due - now);
      outcome = "held";
    }
    const latest = (await read()) ?? first;
    if (latest.status === "ended") {
      await closeParty(deps, { ...party, tickAt: undefined }, "ended");
      return "closed";
    }
    const at = deps.now();
    // Read again rather than reusing the row this call started with: a
    // handout may have landed on it while the tick was being waited out.
    const fresh = (await deps.guilds.party(sessionId, party.guildId)) ?? party;
    const card = partyCardFor({
      snapshot: latest,
      link: party.link,
      openedByName: party.openedByName,
      ...(fresh.handouts ? { handouts: fresh.handouts } : {}),
    });
    const edited = deps.rest && party.cardMessageId ? await deps.rest.editMessage(party.threadId, party.cardMessageId, card) : false;
    if (!edited) {
      // A card Discord will not edit is a card, or a thread, that somebody
      // deleted. The party closes itself rather than trying forever.
      await closeParty(deps, { ...party, tickAt: undefined }, "gone");
      return "closed";
    }
    // Written back over the row as it now is, not as it was when this
    // call read it, so a handout that landed during the wait is not
    // dropped.
    const next: WatchParty = { ...fresh, editedAt: at, updatedAt: at };
    delete next.tickAt;
    await deps.guilds.putParty(next);
    return outcome;
  };
  return Promise.all(open.map(async (party) => ({ guildId: party.guildId, outcome: await tickOne(party) })));
}

/** How many handouts a party's card carries: the last few, not a history. */
export const PARTY_HANDOUTS_KEPT = 5;

export interface PartyHandoutDeps {
  /** Only the two rows this needs, so the socket takes no more of the store than it uses. */
  guilds: Pick<GuildStore, "partiesOf" | "party" | "putParty">;
  now: () => string;
  /** Tell the job the card has something new to carry; absent, it rides on the next snapshot. */
  party?: (job: { sessionId: string }) => Promise<void>;
}

/**
 * The host handed the table something: write it onto every party open on
 * this run, for the next tick's card.
 *
 * The gesture is read the way every gesture is read, defensively: what
 * carries no title is nothing, rather than something repaired into a line
 * nobody meant. How many parties it landed on comes back, which is what a
 * test and a log line want.
 */
export async function notePartyHandout(deps: PartyHandoutDeps, sessionId: string, gesture: unknown): Promise<number> {
  if (typeof gesture !== "object" || gesture === null || Array.isArray(gesture)) return 0;
  const row = gesture as Record<string, unknown>;
  const title = typeof row["title"] === "string" ? row["title"].trim().slice(0, 100) : "";
  const id = typeof row["id"] === "string" ? row["id"].trim().slice(0, 100) : "";
  if (!title) return 0;
  // What tells two handouts apart. The app leaves the id out where a run
  // was seeded from more than one setup, since there is no single setup
  // to name, and the table is told about that handout like any other; the
  // title is what one is in that case.
  const key = id || title;
  const open = (await deps.guilds.partiesOf(sessionId)).filter((p) => !p.closedAt);
  if (open.length === 0) return 0;
  const at = deps.now();
  for (const party of open) {
    const had = (party.handouts ?? []).filter((h) => h.id !== key);
    await deps.guilds.putParty({ ...party, handouts: [...had, { id: key, title }].slice(-PARTY_HANDOUTS_KEPT), updatedAt: at });
  }
  await deps.party?.({ sessionId });
  return open.length;
}
