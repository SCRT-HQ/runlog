import { hashToken, verify as verifyToken, type Caller } from "./auth.js";
import { deckTeller, writes } from "./decks.js";
import { askFor, commandFor, fits, framesForGesture, loadoutFor, profileOf, setupFor, type ControlOp } from "./control.js";
import { askAllowed } from "./asking.js";
import { apiGatewayPoster, type Poster } from "./live.js";
import { dynamoLive, type LiveStore, type Watcher } from "./live.js";
import { dynamoStore, type Store } from "./store.js";
import { dynamoRaces, type RaceStore } from "./races.js";
import { dynamoGuilds } from "./guilds.js";
import { notePartyHandout, type PartyHandoutDeps } from "./discord/party.js";
import { dynamoBilling, featuresFromEnv, grantsOf } from "./billing.js";
import { annotate } from "./xray.js";
import { randomBytes } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

/**
 * The socket's three moments.
 *
 * Connect: the token rides in the query string, because a browser's
 * WebSocket cannot set a header. It is checked the same way the HTTP API
 * checks a bearer, and a bad one is refused before the socket opens.
 * Message: the one thing a device says is which session it is watching;
 * it must be a member, and a session it may not see is ignored without
 * saying whether it exists. Disconnect: the rows go.
 *
 * A run shared by link admits a socket with no account: `?t=<token>&run=<id>`
 * opens a connection that watches that run and nothing else, and says
 * nothing it is told.
 *
 * Nothing else. Moves still travel over HTTP; the socket is a doorbell.
 */

export interface WsEvent {
  requestContext: { routeKey: string; connectionId: string };
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

export interface WsDeps {
  live: LiveStore;
  /** A way to post to connections; absent in a test that only checks routing. */
  poster?: Poster;
  store: Pick<Store, "getSession" | "streamKeyOwner" | "manifest" | "getSnapshot" | "updateSession">;
  races: Pick<RaceStore, "getRace">;
  verify: (authorization: string | undefined) => Promise<Caller>;
  now?: () => string;
  /**
   * Whether this account may drive a run from outside it. Absent where
   * plans are off, which is the same answer as yes.
   */
  entitled?: (sub: string) => Promise<boolean>;
  /**
   * The Discord rows a watch party is kept in. Only the party's own rows:
   * the socket writes no more of Discord than the handout it heard.
   * Absent where this copy has no bot.
   */
  guilds?: PartyHandoutDeps["guilds"];
  /** Tell the Discord job a watch party's card has something new to carry. */
  party?: (job: { sessionId: string }) => Promise<void>;
}

interface WsResult {
  statusCode: number;
  body?: string;
}

/**
 * A socket opened by something that drives a game rather than draws a
 * scoreboard.
 *
 * It arrives on the same addresses as every other watcher, with the same
 * keys, because what it is allowed to see is exactly what a watcher is
 * allowed to see. What it asks for in addition is to be told in
 * operations, and to say which player it is sitting in front of.
 */
function attachedOf(event: WsEvent, run: string): { control: true; seat?: string; run: string } | undefined {
  if (event.queryStringParameters?.["as"] !== "control") return undefined;
  const raw = (event.queryStringParameters?.["seat"] ?? "").trim().slice(0, 40);
  return { control: true, ...(raw ? { seat: raw } : {}), run };
}

/**
 * A socket that presses rather than draws.
 *
 * It signs in as the account, the way the app's own devices do, because
 * what it may do is what the owner may do. It names no run at connect: it
 * is told which runs are being held, and picks. A link's token and a
 * stream key are refused here, which is why this is read only on the
 * signed-in branch below.
 */
function deckOf(event: WsEvent): { deck: true } | undefined {
  return event.queryStringParameters?.["as"] === "deck" ? { deck: true } : undefined;
}

/**
 * A socket that presses a run it does not hold.
 *
 * A member's page, signed in as the account, with no copy of the pack. It
 * names no run at connect and asks to watch one the way any page does; what
 * it asks for in addition is to press, which is checked against the run's
 * members every time.
 */
function seatedOf(event: WsEvent): { seated: true } | undefined {
  return event.queryStringParameters?.["as"] === "seat" ? { seated: true } : undefined;
}

/**
 * Whether this watcher is a device that could take a press.
 *
 * A link's socket and a scene's are not; an attached tool is told in
 * operations and writes nothing; a deck is the thing asking, and so is a
 * seat. What is left is a signed-in device with the run open, which is
 * the page.
 */
/**
 * The one device that takes a press on a run.
 *
 * A press is an ordinary move by the owner's own hand, and a move
 * happens once. Posted to every writing watcher it happened as many
 * times as the account had the run open: a second device of the
 * owner's appended the same event again, and another member's browser
 * appended it under their name, whose verdict is then dropped on the
 * way back and never reaches the presser at all.
 *
 * So: the account's own devices only, and of those the one that opened
 * the run last, which is the one in front of whoever is playing. Ties by
 * connection id, so two watches in the same millisecond still settle on
 * the same device every time.
 */
async function holderOf(live: LiveStore, run: string, sub: string): Promise<Watcher | null> {
  const writers = (await live.watchers(run))
    .filter((w) => writes(w) && w.sub === sub)
    .sort((a, b) => (a.watchedAt === b.watchedAt ? (a.connectionId < b.connectionId ? -1 : 1) : a.watchedAt > b.watchedAt ? -1 : 1));
  return writers[0] ?? null;
}

/**
 * A command's own operations, read out of the gesture defensively.
 *
 * Everything else a tool is told comes from the run's profile, which the
 * owner's own device wrote. This comes off a key press, so it is read the
 * way the profile is read: anything that is not what it claims to be
 * makes the whole command nothing, rather than being repaired into
 * something nobody asked for. A press that says a hundred operations is
 * not a press somebody meant.
 */
function commandOf(data: Record<string, unknown>): { id: string; title: string; ops: ControlOp[] } | null {
  const id = data["id"];
  const title = data["title"];
  const raw = data["ops"];
  if (typeof id !== "string" || id.length === 0 || id.length > 200) return null;
  if (typeof title !== "string" || title.length > 80) return null;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) return null;
  const ops: ControlOp[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const op = row["op"];
    const args = row["args"];
    if (typeof op !== "string" || op.length === 0 || op.length > 64) return null;
    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) return null;
    ops.push({ op, ...(args ? { args: args as Record<string, unknown> } : {}) });
  }
  return { id, title, ops };
}

export async function route(event: WsEvent, deps: WsDeps): Promise<WsResult> {
  const { routeKey, connectionId } = event.requestContext;
  const now = deps.now ?? (() => new Date().toISOString());
  // The socket has no method, only which of its three moments this is.
  annotate({ method: "WS", route: routeKey });

  /**
   * Said to an account's decks whenever the held set changes, and once on
   * connect, which is the same message: a deck comes up before anything is
   * running, so a list fetched once would stay empty all evening.
   *
   * The sending itself is `decks.ts`, because the socket is not the only
   * place a run changes: ending one is an HTTP route, and it tells the
   * decks through the same function.
   */
  const tellDecks = deckTeller(deps.live, deps.poster, deps.store);

  if (routeKey === "$connect") {
    const t = event.queryStringParameters?.["t"];
    const run = event.queryStringParameters?.["run"];
    if (t && run) {
      const session = await deps.store.getSession(run);
      if (!session || session.meta.deletedAt || !session.meta.publicTokenHash || hashToken(t) !== session.meta.publicTokenHash)
        return { statusCode: 401, body: "not shared" };
      const who = `public:${run}`;
      const attached = attachedOf(event, run);
      await deps.live.connect(connectionId, who, now(), attached);
      await deps.live.watch(connectionId, run, who, now(), attached);
      return { statusCode: 200 };
    }
    /**
     * A scene's socket, opened on the account's watch key.
     *
     * The address in a browser source or a bot's client is set up once and
     * lives for months, so it cannot name a run: it names the account, and
     * this finds the run. Of the runs open to watchers, the one moved most
     * recently, which is the one being played.
     *
     * Which run it watches is settled when it connects. A socket open
     * across the start of a new run goes on watching the old one until it
     * is opened again; the bot hears `run-ended` on the old one, which is
     * the moment to reconnect.
     */
    const k = event.queryStringParameters?.["k"];
    if (k) {
      const owner = await deps.store.streamKeyOwner(hashToken(k));
      // A press key belongs in a bot's settings, never in a scene.
      if (!owner || owner.kind !== "watch") return { statusCode: 401, body: "not a key for watching" };
      const named = (event.queryStringParameters?.["run"] ?? "").trim();
      const { sessions } = await deps.store.manifest(owner.sub);
      const live = sessions
        .filter((p) => p.role === "owner" && !p.deletedAt && !p.endedAt && (!named || p.id === named))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      let watching: string | null = null;
      for (const p of live)
        if ((await deps.store.getSession(p.id))?.meta.publicTokenHash) {
          watching = p.id;
          break;
        }
      if (!watching) return { statusCode: 401, body: "no run is open to watch" };
      const who = `stream:${owner.sub}`;
      const attached = attachedOf(event, watching);
      await deps.live.connect(connectionId, who, now(), attached);
      await deps.live.watch(connectionId, watching, who, now(), attached);
      return { statusCode: 200 };
    }
    const token = event.queryStringParameters?.["token"];
    let caller: Caller;
    try {
      caller = await deps.verify(token ? `Bearer ${token}` : undefined);
    } catch {
      return { statusCode: 401, body: "sign in first" };
    }
    // A deck is answered once it speaks, below: the gateway refuses a post
    // to a connection whose $connect has not yet returned, and a refusal
    // here would read as the deck having gone.
    await deps.live.connect(connectionId, caller.sub, now(), deckOf(event) ?? seatedOf(event));
    return { statusCode: 200 };
  }

  /**
   * Who has a tool on the game right now, said to everyone watching.
   *
   * The whole set every time rather than a joining and a leaving. A table
   * that missed one message would otherwise show a tool that went home an
   * hour ago, or miss one that is about to be sent a curse, and there is
   * no cheap way to notice you missed it. A list is idempotent; a delta is
   * a thing to keep in step.
   *
   * Whose, as well as what. The page draws a row per person, so it needs
   * to tell a deck on one account from a deck on another, and a tool on
   * somebody's game from one on the table. `tools`, `count` and `decks`
   * stay exactly as they were, for pages built before this.
   *
   * The watchers it read are handed back, so a caller that needs the same
   * set straight after does not ask for it twice.
   */
  const tellWhoIsAttached = async (run: string): Promise<Watcher[]> => {
    const poster = deps.poster;
    if (!poster) return [];
    const watching = await deps.live.watchers(run);
    const tools = watching
      .filter((w) => w.control)
      .map((w) => ({ ...(w.seat ? { seat: w.seat } : {}), ...(w.app ? { app: w.app } : {}), ...(w.sub ? { sub: w.sub } : {}) }));
    const decks = watching.filter((w) => w.deck).length;
    // One account with two decks is one name in the list, not two.
    const deckSubs = [...new Set(watching.filter((w) => w.deck && w.sub).map((w) => w.sub))];
    const line = JSON.stringify({ t: "gesture", id: run, kind: "tools", data: { tools, count: tools.length, decks, deckSubs }, at: now() });
    for (const w of watching) {
      // A tool is told in operations, never in words about itself.
      if (w.control) continue;
      try {
        if ((await poster.post(w.connectionId, line)) === "gone") await deps.live.disconnect(w.connectionId);
      } catch (error) {
        console.error("live: could not say who is attached", error);
      }
    }
    return watching;
  };

  /**
   * Whether a device is holding the run, said to the seats on it.
   *
   * A seat presses through the run's own page, so a run nobody has open
   * takes no press at all. The strip goes quiet on this rather than
   * refusing one press at a time. Said when a seat asks and when a device
   * takes the run up; a seat also asks again on a timer, because a page
   * closing is not news this end can address to it.
   *
   * `known` is the watcher list where the caller has just read it, so the
   * watch that pushes this costs one query rather than two.
   */
  const tellSeats = async (run: string, only?: string, known?: Watcher[]): Promise<void> => {
    const poster = deps.poster;
    if (!poster) return;
    try {
      const watching = known ?? (await deps.live.watchers(run));
      const seats = watching.filter((w) => w.seated && (!only || w.connectionId === only));
      if (seats.length === 0) return;
      const session = await deps.store.getSession(run);
      const owner = session?.meta.ownerSub;
      const held = Boolean(owner) && watching.some((w) => writes(w) && w.sub === owner);
      const line = JSON.stringify({ t: "held", id: run, held });
      for (const w of seats) if ((await poster.post(w.connectionId, line)) === "gone") await deps.live.disconnect(w.connectionId);
    } catch (error) {
      console.error("live: could not say whether a run is held", error);
    }
  };

  if (routeKey === "$disconnect") {
    // Read before it goes: a tool leaving is news, and afterwards there is
    // nothing left to say which run it was on.
    const leaving = await deps.live.connection(connectionId);
    await deps.live.disconnect(connectionId);
    if (leaving?.control && leaving.run) await tellWhoIsAttached(leaving.run);
    // A deck leaving its run is news the same way a tool leaving is: the
    // page is told, as it was told the deck came on.
    if (leaving?.deck && leaving.run) await tellWhoIsAttached(leaving.run);
    // A page closing may have been the last thing holding a run, and a deck
    // whose keys still look live is worse than one that says so.
    if (leaving && !leaving.deck && writes(leaving)) await tellDecks(leaving.sub);
    return { statusCode: 200 };
  }

  // $default: a message.
  const conn = await deps.live.connection(connectionId);
  if (!conn) return { statusCode: 401, body: "unknown connection" };
  let message: unknown;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    message = JSON.parse(raw);
  } catch {
    return { statusCode: 400, body: "JSON, please" };
  }
  if (!message || typeof message !== "object") return { statusCode: 400, body: "an object" };
  const m = message as Record<string, unknown>;

  /**
   * A keepalive from either kind of connection.
   *
   * API Gateway drops a socket that sits ten minutes without a frame in
   * either direction, well inside the length of a quiet Play step. A ping
   * gets a pong back, to the sender alone, before any other branch and
   * with no watch or store write: a heartbeat is not news to anyone but
   * the connection that sent it. The two-hour cap on a connection is not
   * worked around here; that is what the reconnect on the other end is
   * for.
   */
  if (m["t"] === "ping") {
    const poster = deps.poster;
    if (poster) await poster.post(connectionId, JSON.stringify({ t: "pong" }));
    return { statusCode: 200 };
  }
  if (m["t"] === "pong") return { statusCode: 200 };

  /**
   * A deck saying it is here.
   *
   * The one thing a deck asks for. It cannot be told at connect, since the
   * gateway takes no post for a connection until $connect has answered, so
   * the list it needs to pick a run comes the moment it speaks, and again
   * whenever the set of held runs changes.
   */
  if (conn.deck && m["t"] === "hello") {
    await tellDecks(conn.sub, connectionId);
    return { statusCode: 200 };
  }

  /**
   * A seat asking whether the run's page is open. Answered to the asker
   * alone; nothing is stored and nobody else is told.
   */
  if (conn.seated && m["t"] === "held" && typeof m["id"] === "string") {
    await tellSeats(m["id"], connectionId);
    return { statusCode: 200 };
  }

  /**
   * A tool saying what it is and what it can do.
   *
   * The one message an attached tool sends, and the only one any of them
   * may: what comes back is the run's own terms, the settings it wants in
   * force before anything is rolled. Everything else it hears is sent
   * because the table moved, never because it asked.
   *
   * What the tool can do is not read here. A source that only ever sends
   * what a profile names cannot send an operation an old build lacks, and
   * a build that receives one refuses it by name, which is the answer in
   * both directions.
   */
  if (conn.control && m["t"] === "hello" && conn.run) {
    // What it calls itself is remembered, because a profile written for
    // one program must not drive another that happens to share an
    // operation name.
    const app = typeof m["app"] === "string" ? m["app"].trim().slice(0, 64) : "";
    await deps.live.watch(connectionId, conn.run, conn.sub, now(), {
      control: true,
      ...(conn.seat ? { seat: conn.seat } : {}),
      ...(app ? { app } : {}),
      run: conn.run,
    });

    // The table hears that somebody's game is on the other end of this.
    // Said here rather than at connect, because until the hello arrives
    // there is no seat and no name to say, and a row with neither is not
    // worth drawing.
    await tellWhoIsAttached(conn.run);

    const poster = deps.poster;
    if (!poster) return { statusCode: 200 };
    const snapshot = await deps.store.getSnapshot(conn.run);
    const profile = snapshot ? profileOf(snapshot.snapshot) : null;
    // Told rather than left silent: a tool sitting there doing nothing
    // is the most confusing thing this could do. Which is what it did
    // until now in the one case that matters most, the run it found
    // having no rules at all: an address names an account and the
    // server picks the run, so a tool can attach perfectly to a run
    // nobody is playing and report itself connected for ever.
    const session = await deps.store.getSession(conn.run);
    const which = session?.meta.packTitle ?? "a run";
    /**
     * Who has already had the parts of the terms that are given once.
     *
     * A seat, or the table where a tool named none. The terms go out on
     * every attach, because a tool that restarted is holding none of
     * them and a setting applied twice is the same setting. A gift is
     * not: a run whose terms hand over runes or an item handed them over
     * again on every reconnect, and by the third one it is a different
     * game. So the run remembers, and those parts are left out.
     */
    const whose = conn.seat || "the table";
    const given = session?.meta.termsGiven ?? [];
    const gotLoadout = session?.meta.loadoutGiven ?? [];
    /*
     * Two effects, not one. The pack's terms and the loadout chosen for
     * this run are one list in the profile and go out as two applies,
     * because the loadout has a button that re-sends it and a tool
     * re-applying an id takes the old one off first.
     */
    let terms: { frame: string; gave: boolean } | null = null;
    let loadout: { frame: string; gave: boolean } | null = null;
    const lines: string[] = [];
    if (!profile) {
      lines.push(
        JSON.stringify({
          t: "note",
          text: `Attached to ${which}, which has no rules for a tool. An address finds the most recently played run that is open to watchers; if that is not the one you are playing, open that one to watchers and connect again.`,
        }),
      );
    } else if (!fits(profile, app || undefined)) {
      lines.push(
        JSON.stringify({
          t: "note",
          text: `${which} is set up for ${profile.tool}, so nothing here will reach ${app || "a tool that did not say what it is"}.`,
        }),
      );
    } else {
      terms = setupFor(profile, given.includes(whose));
      loadout = loadoutFor(profile, gotLoadout.includes(whose));
      if (terms) lines.push(terms.frame);
      if (loadout) lines.push(loadout.frame);
    }
    for (const line of lines) {
      if ((await poster.post(connectionId, line)) === "gone") {
        await deps.live.disconnect(connectionId);
        return { statusCode: 200 };
      }
    }
    // Remembered only once it has actually gone out. A post that failed
    // is a tool that never got its terms, and marking it given would
    // leave the next attach short of them for the rest of the run.
    const patch: { termsGiven?: string[]; loadoutGiven?: string[] } = {};
    if (terms?.gave && !given.includes(whose)) patch.termsGiven = [...given, whose];
    if (loadout?.gave && !gotLoadout.includes(whose)) patch.loadoutGiven = [...gotLoadout, whose];
    if (patch.termsGiven || patch.loadoutGiven) await deps.store.updateSession(conn.run, now(), patch);
    return { statusCode: 200 };
  }

  /**
   * A tool saying what happened in the game.
   *
   * The one thing that travels the other way, and it is a press, not an
   * ask. The host pasted their own key into a tool on their own machine
   * and switched "Say when I die" on; a death the game reports is that
   * player's own word about their own game, and it lands the way a press
   * of the same move from a seat lands: on the device holding the run,
   * checked against what that device is offering. No chat key, no tray,
   * and nobody to press Accept, because the person who would press it is
   * the one who died.
   */
  if (conn.control && m["t"] === "event" && conn.run) {
    /**
     * Something the game said. Dropped for several good reasons, and it
     * used to be dropped in silence: every one of these answered 200, the
     * tool logged that it had said so, and a death counted nowhere. The
     * tool is told now, because "it went nowhere and here is why" is the
     * one thing it cannot work out from its end.
     */
    const drop = async (why: string): Promise<WsResult> => {
      const poster = deps.poster;
      if (poster) {
        try {
          await poster.post(connectionId, JSON.stringify({ t: "note", text: why }));
        } catch (error) {
          console.error("live: could not say why an event went nowhere", error);
        }
      }
      return { statusCode: 200 };
    };
    const meant = askFor(String(m["kind"] ?? ""));
    if (!meant) return drop(`This run has nothing it calls "${String(m["kind"] ?? "")}", so nothing was counted.`);
    const session = await deps.store.getSession(conn.run);
    if (!session || session.meta.deletedAt || session.meta.endedAt) return drop("That run has ended, so nothing was counted.");
    const who = conn.seat || "the game";
    const at = now();
    if (!askAllowed(conn.run, who, Date.parse(at)).ok) return drop("Too many, too quickly: this one was not counted.");
    /**
     * The one device that takes it: the owner's, the one that opened the
     * run last. The same choice a deck's press makes, for the same reason;
     * see `holderOf`. A run nobody has open has nothing to count a death
     * against, and the tool is told so rather than left to read silence
     * as a tally moving.
     */
    const holder = await holderOf(deps.live, conn.run, session.meta.ownerSub);
    if (!holder) return drop("Nothing is holding that run: open it in the app, and the game's word counts from then on.");
    const poster = deps.poster;
    if (!poster) return { statusCode: 200 };
    /**
     * No `seq`: a deck presses what the page last offered and names that
     * offer, so a press made while the unit was closing cannot roll into
     * the next one. The game names nothing, because a death happened when
     * it happened; the page checks the move against what it is offering
     * now and refuses in words where it is not. The seat is the address's
     * word for which player this game is, where the address named one;
     * on a table with one player it is the owner's own hand.
     */
    const line = JSON.stringify({
      t: "drive",
      from: connectionId,
      run: conn.run,
      ref: randomBytes(6).toString("hex"),
      press: "move",
      move: meant.move,
      via: "the game",
      ...(conn.seat ? { seat: conn.seat } : {}),
    });
    try {
      if ((await poster.post(holder.connectionId, line)) === "gone") {
        await deps.live.disconnect(holder.connectionId);
        return drop("Nothing is holding that run: open it in the app, and the game's word counts from then on.");
      }
    } catch (error) {
      console.error("live: could not pass the game's word on", error);
    }
    return { statusCode: 200 };
  }

  /**
   * A deck pressing something.
   *
   * The server checks who is asking and finds the devices that could take
   * it; it does not read the press. What may be pressed is the run's
   * business, and the run is the only thing holding the pack and the log.
   *
   * Nothing is stored. A press is worth exactly as much as the moment it
   * was made in: `seq` names the offer it was drawn from, and the writing
   * device refuses one it has already moved past. Durability would buy a
   * press that lands after the reason for it has gone.
   */
  if ((conn.deck || conn.seated) && m["t"] === "drive") {
    const poster = deps.poster;
    const ref = typeof m["ref"] === "string" ? m["ref"].slice(0, 64) : "";
    const run = typeof m["run"] === "string" ? m["run"] : "";
    const refuse = async (say: string): Promise<WsResult> => {
      if (poster) {
        try {
          await poster.post(connectionId, JSON.stringify({ t: "drove", ref, ok: false, say }));
        } catch (error) {
          console.error("live: could not refuse a press", error);
        }
      }
      return { statusCode: 200 };
    };
    if (!ref || !run) return { statusCode: 400, body: "a press has a run and a ref" };
    /**
     * Two reads over the network before a press goes anywhere, and either
     * can fail on its own. A rejection used to throw past this branch to
     * the handler's 500, which posts nothing at all: the deck was left
     * holding a press with no verdict, and no way to tell that from one
     * still in flight. It is told, in words that say to try again.
     */
    let session: Awaited<ReturnType<typeof deps.store.getSession>>;
    try {
      session = await deps.store.getSession(run);
    } catch (error) {
      console.error("live: could not read the run behind a press", error);
      return refuse("Could not check that right now.");
    }
    if (!session || session.meta.deletedAt) return refuse("That run is not yours to press.");
    /**
     * Who may press, and through whom.
     *
     * A deck is the owner's own hand: the run must be theirs, and the press
     * goes to one of their devices. A seat is somebody else at the table:
     * the run must be one they play, and the press goes to the owner's
     * page, which is the only device holding the pack and the log. Their
     * name comes off the session rather than off the press, so a seat
     * cannot press under somebody else's.
     */
    const me = session.members.find((x) => x.sub === conn.sub);
    if (conn.seated) {
      if (!me || me.role !== "player") return refuse("That run is not yours to press.");
      // A seat is on one run, the last one it asked to watch, and presses
      // that one. A press naming another is not one the seat could have
      // been offered a moment ago.
      if (conn.run !== run) return refuse("That run is not the one this seat is on.");
    } else if (session.meta.ownerSub !== conn.sub) return refuse("That run is not yours to press.");
    if (session.meta.endedAt) return refuse("That run has ended.");
    // Driving from a deck is part of Plus. A seat is not: inviting somebody
    // to the table already asked the owner for it.
    if (deps.entitled && !conn.seated) {
      let allowed: boolean;
      try {
        allowed = await deps.entitled(conn.sub);
      } catch (error) {
        console.error("live: could not read the plan behind a press", error);
        return refuse("Could not check that right now.");
      }
      if (!allowed) return refuse("Driving a run from a deck is part of Plus.");
    }

    /**
     * The one device that takes it.
     *
     * A press is an ordinary move by the owner's own hand, and a move
     * happens once. Posted to every writing watcher it happened as many
     * times as the account had the run open: a second device of the
     * owner's appended the same event again, and another member's browser
     * appended it under their name, whose verdict is then dropped on the
     * way back and never reaches the deck at all.
     *
     * So: the account's own devices only, and of those the one that
     * opened the run last, which is the one in front of whoever is
     * playing. Ties by connection id, so two watches in the same
     * millisecond still settle on the same device every time.
     */
    const holder = await holderOf(deps.live, run, conn.seated ? session.meta.ownerSub : conn.sub);
    if (!holder) return refuse("Nothing is holding that run.");
    const writers = [holder];
    if (!poster) return { statusCode: 200 };

    const line = JSON.stringify({
      t: "drive",
      from: connectionId,
      run,
      seq: typeof m["seq"] === "number" ? m["seq"] : 0,
      ref,
      press: String(m["press"] ?? ""),
      ...(typeof m["move"] === "string" ? { move: m["move"] } : {}),
      ...(m["answer"] && typeof m["answer"] === "object" ? { answer: m["answer"] } : {}),
      // Whose press it is, where it is not the owner's own hand. The page
      // keys the seat by account and draws the name; both come off this
      // connection and the session, never off the message, so a seat
      // cannot press under somebody else's. A deck's press carries
      // neither and is the owner pressing.
      ...(conn.seated ? { seat: me?.name || "Someone", who: conn.sub } : {}),
    });
    for (const w of writers) {
      try {
        if ((await poster.post(w.connectionId, line)) === "gone") await deps.live.disconnect(w.connectionId);
      } catch (error) {
        console.error("live: could not pass a press on", error);
      }
    }
    return { statusCode: 200 };
  }

  /**
   * The verdict, on its way back to the one deck or seat that asked.
   *
   * The asking connection's id came out with the press and goes back with
   * the answer, so the server keeps no record of who asked for what. Who
   * may be answered is checked before anything is posted.
   */
  if (m["t"] === "drove" && typeof m["to"] === "string") {
    // A link's socket and a scene's have no account of their own to share
    // with a deck, so no `sub` of theirs can ever match one; said outright
    // rather than left to fall out of the comparison below.
    if (conn.sub.startsWith("public:") || conn.sub.startsWith("stream:")) return { statusCode: 200 };
    const poster = deps.poster;
    if (!poster) return { statusCode: 200 };
    const target = await deps.live.connection(m["to"]);
    if (!target) return { statusCode: 200 };
    if (target.deck) {
      // A member may only answer a deck of their own account.
      if (target.sub !== conn.sub) return { statusCode: 200 };
    } else if (target.seated || target.control) {
      // And only a seat, or a game, on a run this account owns: the page
      // answering is the one that took the press.
      const held = target.run ? await deps.store.getSession(target.run) : null;
      if (!held || held.meta.ownerSub !== conn.sub) return { statusCode: 200 };
    } else return { statusCode: 200 };
    /**
     * A tool speaks the control protocol, which has no verdict frame: it
     * hears notes. So the verdict on the game's word goes back as one,
     * in the words the page used, because "Counted." and "That is not on
     * offer." are what its log is for.
     */
    if (target.control) {
      const said = m["ok"] === true ? "Counted." : typeof m["say"] === "string" && m["say"] ? `Not counted: ${m["say"]}` : "Not counted.";
      try {
        if ((await poster.post(m["to"], JSON.stringify({ t: "note", text: said }))) === "gone") await deps.live.disconnect(m["to"]);
      } catch (error) {
        console.error("live: could not pass a verdict back to the game", error);
      }
      return { statusCode: 200 };
    }
    const line = JSON.stringify({
      t: "drove",
      ref: typeof m["ref"] === "string" ? m["ref"] : "",
      ok: m["ok"] === true,
      ...(typeof m["say"] === "string" ? { say: m["say"] } : {}),
      // What the run reads at now that the press has landed, where the
      // page said: the doorbell that would otherwise carry it is a sync
      // away, and a deck pressing twice inside that window named a seq
      // the page had already moved past.
      ...(typeof m["seq"] === "number" ? { seq: m["seq"] } : {}),
    });
    try {
      if ((await poster.post(m["to"], line)) === "gone") await deps.live.disconnect(m["to"]);
    } catch (error) {
      console.error("live: could not pass a verdict back", error);
    }
    return { statusCode: 200 };
  }

  // A link's socket, and a scene's, watch the one run they were opened for
  // and take no requests.
  if (conn.sub.startsWith("public:") || conn.sub.startsWith("stream:")) return { statusCode: 200 };
  // A gesture: something happening at the table that is not a move, dice
  // in the air, a step opened, a card turned, passed straight on to
  // everyone watching the run and kept nowhere. Only a member sends one,
  // it is small, and its kind is a short word the app gives meaning to.
  if (m["t"] === "gesture" && typeof m["id"] === "string" && typeof m["kind"] === "string") {
    const id = m["id"];
    const kind = m["kind"];
    if (id.length > 200 || !/^[a-z][a-z0-9-]{0,31}$/.test(kind)) return { statusCode: 400, body: "a gesture has an id and a kind" };
    const data = m["data"] !== undefined && typeof m["data"] === "object" && m["data"] !== null ? m["data"] : {};
    if (JSON.stringify(data).length > 2000) return { statusCode: 400, body: "a gesture is small" };
    const session = await deps.store.getSession(id);
    const member = session && !session.meta.deletedAt ? session.members.find((x) => x.sub === conn.sub) : undefined;
    if (!member) return { statusCode: 200 };
    const line = JSON.stringify({ t: "gesture", id, kind, data, ...(member.name ? { from: member.name } : {}), at: now() });
    const poster = deps.poster;

    /**
     * The loadout, handed out again on purpose.
     *
     * Every other gesture is passed on. This one means something to the
     * server, because the thing standing in the way of handing a loadout
     * out twice is a record the server keeps.
     *
     * `loadoutGiven` exists so that a tool which dropped and reconnected
     * is not given the runes again, and it has to go on doing that. But
     * a run whose host has picked a different loadout and pressed the
     * button is not a reconnect; it is somebody deciding that this table
     * is playing with different gear from now on. So the record is
     * cleared here and rebuilt from what actually goes out, and a
     * reconnect a second later is short of the gifts exactly as before.
     *
     * The loadout only. The pack's terms are a separate effect and are
     * not re-sent: the button is under a list of loadouts and says it
     * hands out the loadout, and sending the terms with it handed over
     * the pack's own gifts a second time as well.
     *
     * The owner only. Every member can send a gesture, and that is right
     * for dice in the air and a step opening; handing somebody a hundred
     * and twenty thousand runes is not something one player at the table
     * should be able to do to the others.
     *
     * Asked of the run rather than of the member row. Both say the same
     * thing today, and the run is the one that says it first: a member
     * row carries whatever was written into it when somebody joined.
     */
    if (kind === "setup") {
      if (session?.meta.ownerSub !== conn.sub) return { statusCode: 200 };
      if (!poster) return { statusCode: 200 };
      const watchers = await deps.live.watchers(id);
      const attached = watchers.filter((w) => w.control);
      const profile = attached.length > 0 ? profileOf((await deps.store.getSnapshot(id))?.snapshot) : null;
      const gave: string[] = [];
      await Promise.all(
        watchers.map(async (w) => {
          // The table is told in words that it happened; a tool is told
          // in operations, which is the same split as everywhere else.
          let out = w.connectionId === connectionId ? null : line;
          if (w.control) {
            if (!profile || !fits(profile, w.app)) return;
            // `false`, because being handed one is the whole point: the
            // record that would hold the gifts back has just been dropped.
            const loadout = loadoutFor(profile, false);
            if (!loadout) return;
            out = loadout.frame;
            if (loadout.gave) gave.push(w.seat || "the table");
          }
          if (!out) return;
          try {
            if ((await poster.post(w.connectionId, out)) === "gone") await deps.live.disconnect(w.connectionId);
          } catch (error) {
            console.error("live: could not hand out the setup", error);
          }
        }),
      );
      // Written after the fact, from what went out rather than from what
      // was meant to: a tool that was not reachable did not get its
      // loadout, and saying it did would leave it short on the next
      // attach. `termsGiven` is left alone, because the terms did not
      // move.
      await deps.store.updateSession(id, now(), { loadoutGiven: [...new Set(gave)] });
      /**
       * A watch party following this run says so on its next card.
       *
       * A handout never touches the log and never reaches a snapshot, so
       * this is the one place a party can hear about it. Written after
       * the loadout went out, like the record above it, and never on the
       * way in: a gesture that went nowhere handed nothing to anybody.
       */
      if (deps.guilds) {
        try {
          await notePartyHandout(
            { guilds: deps.guilds, now, ...(deps.party ? { party: deps.party } : {}) },
            id,
            data as Record<string, unknown>,
          );
        } catch (error) {
          // The handout itself went out and was written down; a party
          // that could not be told is one card short, not a failed press.
          console.error("live: could not tell the watch party about the handout", error);
        }
      }
      return { statusCode: 200 };
    }

    /**
     * A command: one setup file's operations, handed over and no more.
     *
     * The setup above rebuilds what the run is played under and writes
     * down who got what. This is the other thing a press can mean: do
     * this now. A warp to the next boss, a handful of runes, a rule
     * switched on for a minute. The operations travel in the gesture
     * because the whole point is that the run is unchanged by them: the
     * terms it was started under and the loadout it is played under are
     * still the ones a tool reconnecting in a minute will be handed, and
     * nothing here is written to the session.
     *
     * The owner's alone, and for the same reason the setup is. Handing
     * one player the keys to warp the other three is not something an
     * ordinary gesture should be able to do.
     */
    if (kind === "command") {
      if (session?.meta.ownerSub !== conn.sub) return { statusCode: 200 };
      const command = commandOf(data as Record<string, unknown>);
      if (!command || !poster) return { statusCode: 200 };
      const watchers = await deps.live.watchers(id);
      const attached = watchers.filter((w) => w.control);
      const profile = attached.length > 0 ? profileOf((await deps.store.getSnapshot(id))?.snapshot) : null;
      // One frame for all of them: the operations came in the gesture, so
      // unlike a loadout there is nothing about a particular tool that
      // could change what it is handed.
      const frame = commandFor(command.ops, command.id, command.title);
      await Promise.all(
        watchers.map(async (w) => {
          // The table hears it in words and a tool hears it in
          // operations, which is the same split the run's own effects
          // travel under. A tool the profile is not written for hears
          // nothing at all: the words would be no use to it and the
          // operations are not its vocabulary.
          let out = w.connectionId === connectionId ? null : line;
          if (w.control) {
            if (!frame || !profile || !fits(profile, w.app)) return;
            out = frame.frame;
          }
          if (!out) return;
          try {
            if ((await poster.post(w.connectionId, out)) === "gone") await deps.live.disconnect(w.connectionId);
          } catch (error) {
            console.error("live: could not hand over a command", error);
          }
        }),
      );
      return { statusCode: 200 };
    }

    if (poster) {
      const watchers = (await deps.live.watchers(id)).filter((w) => w.connectionId !== connectionId);
      // A tool attached to somebody's game is told in operations rather
      // than in words, and the profile that decides which is read only
      // when one of them is listening.
      const attached = watchers.filter((w) => w.control);
      const profile = attached.length > 0 ? profileOf((await deps.store.getSnapshot(id))?.snapshot) : null;
      await Promise.all(
        watchers.map(async (w) => {
          const lines = !w.control ? [line] : profile && fits(profile, w.app) ? framesForGesture(profile, kind, data, w.seat) : [];
          for (const out of lines) {
            try {
              if ((await poster.post(w.connectionId, out)) === "gone") {
                await deps.live.disconnect(w.connectionId);
                return;
              }
            } catch (error) {
              console.error("live: could not pass a gesture on", error);
            }
          }
        }),
      );
    }
    return { statusCode: 200 };
  }
  if (m["t"] === "watch" && typeof m["id"] === "string" && m["id"].length > 0 && m["id"].length <= 200) {
    // A session or a race that is not theirs to see looks exactly like one
    // that is not there: the socket confirms nothing.
    const session = await deps.store.getSession(m["id"]);
    const inSession = Boolean(session && !session.meta.deletedAt && session.members.some((x) => x.sub === conn.sub));
    const race = inSession ? null : await deps.races.getRace(m["id"]);
    const inRace = Boolean(race && race.entries.some((e) => e.sub === conn.sub));
    if (!inSession && !inRace) return { statusCode: 200 };
    await deps.live.watch(
      connectionId,
      m["id"],
      conn.sub,
      now(),
      conn.deck ? { deck: true, run: m["id"] } : conn.seated ? { seated: true, run: m["id"] } : undefined,
    );
    // A seat holds a run the way a deck does: the row remembers which one,
    // so a verdict coming back can be checked against it.
    if (conn.seated) await deps.live.connect(connectionId, conn.sub, now(), { seated: true, run: m["id"] });
    if (conn.deck) {
      // Which run it was on before this one, read before the row is
      // rewritten: a deck that switches runs leaves the page it left
      // showing a deck that is no longer there, and publishing for it.
      const left = conn.run;
      // A deck is told a run is on it the same way a page is told a tool
      // is: the row says so, and the table hears it.
      await deps.live.connect(connectionId, conn.sub, now(), { deck: true, run: m["id"] });
      if (left && left !== m["id"]) {
        // A deck holds one run at a time: the watch it came from goes, or
        // the run it left goes on counting a deck that has moved house.
        await deps.live.unwatch(connectionId, left);
        await tellWhoIsAttached(left);
      }
    }
    // Everyone watching, not only the run a deck just picked. A page that
    // opened the run after the deck attached, or came back from a reload,
    // otherwise never hears that a deck is on it: the gesture fires when a
    // tool says hello and when a deck picks, and a page arriving late
    // missed both. It is also what puts the Attached panel back after a
    // refresh.
    const watching = await tellWhoIsAttached(m["id"]);
    // A page taking the run up is what a seat has been waiting for. It is
    // told from the list that gesture just read.
    await tellSeats(m["id"], undefined, watching);
    // A run just came under a device. A deck that has been sitting on "No
    // run open" all evening is the one thing waiting to hear it.
    await tellDecks(conn.sub);
    return { statusCode: 200 };
  }
  return { statusCode: 400, body: "unknown message" };
}

/* ---- the Lambda ---------------------------------------------------------- */

let deps: WsDeps | undefined;
let lambdaClient: LambdaClient | undefined;

export async function handler(event: WsEvent): Promise<WsResult> {
  if (!deps) {
    const clientId = process.env["WORKOS_CLIENT_ID"] ?? "";
    const cliClientId = process.env["WORKOS_CLI_CLIENT_ID"] ?? "";
    const deckClientId = process.env["WORKOS_DECK_CLIENT_ID"] ?? "";
    const table = process.env["TABLE_NAME"] ?? "";
    const gates = process.env["RUNLOG_GATES"] === "on";
    const plusFeature = featuresFromEnv(process.env["STRIPE_FEATURES"]).plus;
    const billing = dynamoBilling({ table });
    deps = {
      live: dynamoLive({ table }),
      store: dynamoStore({ table, bucket: process.env["BUCKET_NAME"] ?? "" }),
      races: dynamoRaces({ table }),
      verify: (authorization) => verifyToken(authorization, [clientId, cliClientId, deckClientId]),
      ...(process.env["WS_ENDPOINT"] ? { poster: apiGatewayPoster(process.env["WS_ENDPOINT"]) } : {}),
      // No token flags are in hand at drive time, only `conn.sub`: the
      // kept flags `billing.flags(sub)` do the work a token flag would on
      // the API side, and `/api/me` refreshes those on every call the app
      // makes, so a comped account is comped here too.
      ...(gates ? { entitled: async (sub: string) => (await grantsOf(billing, sub)).includes(plusFeature) } : {}),
      // A handout is heard here and nowhere else, so this is where a
      // watch party's card is told about one.
      ...(process.env["DISCORD_JOB_FUNCTION"]
        ? {
            guilds: dynamoGuilds({ table, bucket: process.env["BUCKET_NAME"] ?? "" }),
            party: async (job: { sessionId: string }) => {
              await (lambdaClient ??= new LambdaClient({})).send(
                new InvokeCommand({
                  FunctionName: process.env["DISCORD_JOB_FUNCTION"],
                  InvocationType: "Event",
                  Payload: Buffer.from(JSON.stringify({ kind: "party", ...job })),
                }),
              );
            },
          }
        : {}),
    };
  }
  try {
    return await route(event, deps);
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: "something went wrong on this side" };
  }
}
