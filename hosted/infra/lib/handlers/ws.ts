import { hashToken, verify as verifyToken, type Caller } from "./auth.js";
import { apiGatewayPoster, type Poster } from "./live.js";
import { dynamoLive, type LiveStore } from "./live.js";
import { dynamoStore, type Store } from "./store.js";
import { dynamoRaces, type RaceStore } from "./races.js";
import { annotate } from "./xray.js";

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
  store: Pick<Store, "getSession" | "streamKeyOwner" | "manifest">;
  races: Pick<RaceStore, "getRace">;
  verify: (authorization: string | undefined) => Promise<Caller>;
  now?: () => string;
}

interface WsResult {
  statusCode: number;
  body?: string;
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
      await deps.live.connect(connectionId, who, now());
      await deps.live.watch(connectionId, run, who, now());
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
      await deps.live.connect(connectionId, who, now());
      await deps.live.watch(connectionId, watching, who, now());
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

  if (routeKey === "$disconnect") {
    await deps.live.disconnect(connectionId);
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
    if (poster) {
      const watchers = await deps.live.watchers(id);
      await Promise.all(
        watchers
          .filter((w) => w.connectionId !== connectionId)
          .map(async (w) => {
            try {
              if ((await poster.post(w.connectionId, line)) === "gone") await deps.live.disconnect(w.connectionId);
            } catch (error) {
              console.error("live: could not pass a gesture on", error);
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
