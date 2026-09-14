import { hashToken, verify as verifyToken, type Caller } from "./auth.js";
import { askFor, fits, framesForGesture, profileOf, setupFor } from "./control.js";
import { askAllowed } from "./asking.js";
import { apiGatewayPoster, type Poster } from "./live.js";
import { dynamoLive, type LiveStore } from "./live.js";
import { dynamoStore, type Ask, type Store } from "./store.js";
import { dynamoRaces, type RaceStore } from "./races.js";
import { annotate } from "./xray.js";
import { randomBytes } from "node:crypto";

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
  store: Pick<Store, "getSession" | "streamKeyOwner" | "manifest" | "getSnapshot" | "addAsk" | "updateSession">;
  races: Pick<RaceStore, "getRace">;
  verify: (authorization: string | undefined) => Promise<Caller>;
  now?: () => string;
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

export async function route(event: WsEvent, deps: WsDeps): Promise<WsResult> {
  const { routeKey, connectionId } = event.requestContext;
  const now = deps.now ?? (() => new Date().toISOString());
  // The socket has no method, only which of its three moments this is.
  annotate({ method: "WS", route: routeKey });

  if (routeKey === "$connect") {
    const t = event.queryStringParameters?.["t"];
    const run = event.queryStringParameters?.["run"];
    if (t && run) {
      const session = await deps.store.getSession(run);
      if (!session || session.meta.deletedAt || !session.meta.publicTokenHash || hashToken(t) !== session.meta.publicTokenHash) return { statusCode: 401, body: "not shared" };
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
      for (const p of live) if ((await deps.store.getSession(p.id))?.meta.publicTokenHash) { watching = p.id; break; }
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
    await deps.live.connect(connectionId, caller.sub, now());
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
   */
  const tellWhoIsAttached = async (run: string): Promise<void> => {
    const poster = deps.poster;
    if (!poster) return;
    const watching = await deps.live.watchers(run);
    const tools = watching
      .filter((w) => w.control)
      .map((w) => ({ ...(w.seat ? { seat: w.seat } : {}), ...(w.app ? { app: w.app } : {}) }));
    const line = JSON.stringify({ t: "gesture", id: run, kind: "tools", data: { tools, count: tools.length }, at: now() });
    for (const w of watching) {
      // A tool is told in operations, never in words about itself.
      if (w.control) continue;
      try {
        if ((await poster.post(w.connectionId, line)) === "gone") await deps.live.disconnect(w.connectionId);
      } catch (error) {
        console.error("live: could not say who is attached", error);
      }
    }
  };

  if (routeKey === "$disconnect") {
    // Read before it goes: a tool leaving is news, and afterwards there is
    // nothing left to say which run it was on.
    const leaving = await deps.live.connection(connectionId);
    await deps.live.disconnect(connectionId);
    if (leaving?.control && leaving.run) await tellWhoIsAttached(leaving.run);
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
    let setup: { frame: string; gave: boolean } | null = null;
    const line = !profile
      ? JSON.stringify({
          t: "note",
          text: `Attached to ${which}, which has no rules for a tool. An address finds the most recently played run that is open to watchers; if that is not the one you are playing, open that one to watchers and connect again.`,
        })
      : fits(profile, app || undefined)
        ? ((setup = setupFor(profile, given.includes(whose))), setup?.frame ?? null)
        : JSON.stringify({ t: "note", text: `${which} is set up for ${profile.tool}, so nothing here will reach ${app || "a tool that did not say what it is"}.` });
    if (line && (await poster.post(connectionId, line)) === "gone") await deps.live.disconnect(connectionId);
    // Remembered only once it has actually gone out. A post that failed
    // is a tool that never got its terms, and marking it given would
    // leave the next attach short of them for the rest of the run.
    if (setup?.gave && !given.includes(whose)) await deps.store.updateSession(conn.run, now(), { termsGiven: [...given, whose] });
    return { statusCode: 200 };
  }

  /**
   * A tool saying what happened in the game.
   *
   * The one thing that travels the other way. It is a mention rather than
   * a command: it becomes an ask, exactly as a viewer pressing a button
   * does, and the table still decides. Which is why this needs the host
   * to have switched asks on, and is refused as politely as anything else
   * when they have not.
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
    // Taking asks stays the host's word, per run, the same as it is for
    // chat. A tool cannot switch it on by being attached.
    if (!session.meta.askPolicy)
      return drop("This run is not taking asks, so nothing was counted. Switch it on under Settings, Stream, Chat, and the game's word counts from then on.");
    const who = conn.seat || "the game";
    const at = now();
    if (!askAllowed(conn.run, who, Date.parse(at)).ok) return drop("Too many, too quickly: this one was not counted.");
    const ask: Ask = { id: randomBytes(6).toString("hex"), kind: "move", move: meant.move, name: who, via: "the game", at };
    await deps.store.addAsk(conn.run, ask);
    const poster = deps.poster;
    // And when it did land, which of the two landings it was: taken, or
    // put in front of somebody. A tool that cannot tell those apart from
    // having been ignored is a tool nobody believes.
    if (poster) {
      const heard =
        session.meta.askPolicy === "auto"
          ? "Counted."
          : "Said. It is in the run's asks, waiting for whoever is at the table to take it.";
      try {
        await poster.post(connectionId, JSON.stringify({ t: "note", text: heard }));
      } catch (error) {
        console.error("live: could not say an event landed", error);
      }
    }
    if (poster) {
      const line = JSON.stringify({ t: "gesture", id: conn.run, kind: "ask", data: { ask: ask.id, kind: ask.kind, move: ask.move, name: who, via: ask.via, policy: session.meta.askPolicy }, at });
      for (const w of await deps.live.watchers(conn.run)) {
        if (w.control) continue;
        try {
          if ((await poster.post(w.connectionId, line)) === "gone") await deps.live.disconnect(w.connectionId);
        } catch (error) {
          console.error("live: could not pass an ask on", error);
        }
      }
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
     * The setup, handed out again on purpose.
     *
     * Every other gesture is passed on. This one means something to the
     * server, because the thing standing in the way of handing a setup
     * out twice is a record the server keeps.
     *
     * `termsGiven` exists so that a tool which dropped and reconnected is
     * not given the runes again, and it has to go on doing that. But a
     * run whose host has picked a different setup and pressed the button
     * is not a reconnect; it is somebody deciding that this table is
     * playing with different gear from now on. So the record is cleared
     * here and rebuilt from what actually goes out, and a reconnect a
     * second later is short of the gifts exactly as before.
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
            const setup = setupFor(profile, false);
            if (!setup) return;
            out = setup.frame;
            if (setup.gave) gave.push(w.seat || "the table");
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
      // setup, and saying it did would leave it short on the next attach.
      await deps.store.updateSession(id, now(), { termsGiven: [...new Set(gave)] });
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
    await deps.live.watch(connectionId, m["id"], conn.sub, now());
    return { statusCode: 200 };
  }
  return { statusCode: 400, body: "unknown message" };
}

/* ---- the Lambda ---------------------------------------------------------- */

let deps: WsDeps | undefined;

export async function handler(event: WsEvent): Promise<WsResult> {
  if (!deps) {
    const clientId = process.env["WORKOS_CLIENT_ID"] ?? "";
    const cliClientId = process.env["WORKOS_CLI_CLIENT_ID"] ?? "";
    const table = process.env["TABLE_NAME"] ?? "";
    deps = {
      live: dynamoLive({ table }),
      store: dynamoStore({ table, bucket: process.env["BUCKET_NAME"] ?? "" }),
      races: dynamoRaces({ table }),
      verify: (authorization) => verifyToken(authorization, [clientId, cliClientId]),
      ...(process.env["WS_ENDPOINT"] ? { poster: apiGatewayPoster(process.env["WS_ENDPOINT"]) } : {}),
    };
  }
  try {
    return await route(event, deps);
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: "something went wrong on this side" };
  }
}
