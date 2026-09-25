import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { traced } from "./xray.js";

/**
 * Who is listening, and telling them something changed.
 *
 * A device with a run open holds a WebSocket and says which session it is
 * watching. When another device appends to that session, the API posts a
 * one-line message down every socket watching it, "changed, seq 12",
 * and the device syncs at once instead of at the next poll. The socket
 * carries no data of its own: what changed still comes through the same
 * authenticated HTTP fetch as before, so a socket that lies can only
 * cause a fetch that finds nothing new.
 *
 * Three kinds of row, all short-lived. A connection, so a message from it
 * can be tied to a person; a watch under the connection, so a disconnect
 * can clean up; and a watch under the session, so a change can find its
 * listeners in one query. Every row expires in two hours by TTL, because
 * a disconnect that never arrives is a fact of life with sockets.
 */

const CONN_HOURS = 2;
const expiresAfter = (at: string) => Math.floor(new Date(at).getTime() / 1000) + CONN_HOURS * 3600;

/**
 * A socket that is driving something rather than drawing something.
 *
 * A tool attached to a player's game is a watcher like any other, and is
 * told what happened the same way; what differs is that it is sent
 * operations rather than words, and that it may name which player it is
 * so an effect meant for one of them reaches only that one.
 */
export interface Attached {
  control?: boolean;
  seat?: string;
  /** What the tool called itself when it said hello. */
  app?: string;
  /** The run it was opened for, settled at connect.  */
  run?: string;
  /**
   * A socket that presses rather than draws: a deck, signed in as the
   * account, holding no run of its own. Marked so a press is never
   * forwarded to one: two decks on one account must not look to each
   * other like somewhere a press could land.
   */
  deck?: boolean;
  /**
   * A socket that presses on somebody else's run: a member's page with no
   * pack of their own, playing through the page that has one. Marked so it
   * is never taken for a device holding the run.
   */
  seated?: boolean;
}

export interface Watcher extends Attached {
  connectionId: string;
  sub: string;
  /**
   * When this connection said it was watching. Carried because an account
   * with the same run open on two devices has two watchers that are
   * otherwise alike, and something that may happen on only one of them --
   * a press from a deck -- has to pick. The last one opened is the one in
   * front of whoever is playing.
   */
  watchedAt: string;
}

export interface LiveStore {
  connect(connectionId: string, sub: string, at: string, attached?: Attached): Promise<void>;
  /** Who holds this connection, or null for one that was never accepted or has expired. */
  connection(connectionId: string): Promise<({ sub: string } & Attached) | null>;
  watch(connectionId: string, sessionId: string, sub: string, at: string, attached?: Attached): Promise<void>;
  watchers(sessionId: string): Promise<Watcher[]>;
  /**
   * One connection's watch on one session, gone, with the connection
   * itself left open. For a deck moving from one run to another: it holds
   * one run at a time, and a watch it left behind would go on counting
   * against that run and drawing its doorbells.
   */
  unwatch(connectionId: string, sessionId: string): Promise<void>;
  /** An account's deck connections, for news that is not about one run. */
  decksOf(sub: string): Promise<Array<{ connectionId: string } & Attached>>;
  /**
   * A socket following a theme link. It is told the link's revision when a
   * look is published, and nothing else; the look itself is fetched over
   * HTTP by the read key, like everything else the socket rings for.
   */
  follow(connectionId: string, channelId: string, at: string): Promise<void>;
  /** The connections following a theme link, for its ring. */
  followers(channelId: string): Promise<string[]>;
  /** The connection and every watch it held, gone. */
  disconnect(connectionId: string): Promise<void>;
}

/** Only what was actually said, since a row of undefined is a row of nulls. */
function marks(attached: Attached): Record<string, unknown> {
  return {
    ...(attached.control ? { control: true } : {}),
    ...(attached.seat ? { seat: attached.seat } : {}),
    ...(attached.app ? { app: attached.app } : {}),
    ...(attached.run ? { run: attached.run } : {}),
    ...(attached.deck ? { deck: true } : {}),
    ...(attached.seated ? { seated: true } : {}),
  };
}

function read(row: Record<string, unknown>): Attached {
  return {
    ...(row["control"] === true ? { control: true as const } : {}),
    ...(typeof row["seat"] === "string" ? { seat: row["seat"] } : {}),
    ...(typeof row["app"] === "string" ? { app: row["app"] } : {}),
    ...(typeof row["run"] === "string" ? { run: row["run"] } : {}),
    ...(row["deck"] === true ? { deck: true as const } : {}),
    ...(row["seated"] === true ? { seated: true as const } : {}),
  };
}

export function dynamoLive({ table }: { table: string }): LiveStore {
  const ddb = DynamoDBDocumentClient.from(traced(new DynamoDBClient({})), { marshallOptions: { removeUndefinedValues: true } });
  const cpk = (id: string) => `CONN#${id}`;
  const spk = (id: string) => `SESSION#${id}`;
  const upk = (sub: string) => `USER#${sub}`;
  const fpk = (id: string) => `FOLLOW#${id}`;

  return {
    async connect(connectionId, sub, at, attached = {}) {
      const expiresAt = expiresAfter(at);
      const writes = [
        ddb.send(
          new PutCommand({
            TableName: table,
            Item: { pk: cpk(connectionId), sk: "CONN", kind: "conn", sub, connectedAt: at, expiresAt, ...marks(attached) },
          }),
        ),
      ];
      // An account's decks, found in one query. A watch writes a row under
      // the session for the same reason; a deck holds no session yet.
      if (attached.deck)
        writes.push(
          ddb.send(
            new PutCommand({
              TableName: table,
              Item: { pk: upk(sub), sk: `DECK#${connectionId}`, kind: "deck", sub, expiresAt, ...marks(attached) },
            }),
          ),
        );
      await Promise.all(writes);
    },
    async connection(connectionId) {
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND sk = :sk",
          ExpressionAttributeValues: { ":pk": cpk(connectionId), ":sk": "CONN" },
        }),
      );
      const row = out.Items?.[0];
      if (!row || typeof row["sub"] !== "string") return null;
      if (typeof row["expiresAt"] === "number" && row["expiresAt"] * 1000 < Date.now()) return null;
      return { sub: row["sub"], ...read(row) };
    },
    async watch(connectionId, sessionId, sub, at, attached = {}) {
      const expiresAt = expiresAfter(at);
      await Promise.all([
        ddb.send(
          new PutCommand({
            TableName: table,
            Item: { pk: spk(sessionId), sk: `CONN#${connectionId}`, kind: "watch", sub, watchedAt: at, expiresAt, ...marks(attached) },
          }),
        ),
        ddb.send(
          new PutCommand({
            TableName: table,
            Item: { pk: cpk(connectionId), sk: `WATCH#${sessionId}`, kind: "watch", sub, watchedAt: at, expiresAt, ...marks(attached) },
          }),
        ),
      ]);
    },
    async watchers(sessionId) {
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: { ":pk": spk(sessionId), ":sk": "CONN#" },
        }),
      );
      const now = Date.now() / 1000;
      return (out.Items ?? [])
        .filter((r) => typeof r["expiresAt"] !== "number" || r["expiresAt"] > now)
        .map((r) => ({
          connectionId: String(r["sk"]).slice("CONN#".length),
          sub: String(r["sub"] ?? ""),
          // A row written before watches were dated has none; empty sorts
          // oldest, which is what a watch nobody can date should be.
          watchedAt: typeof r["watchedAt"] === "string" ? r["watchedAt"] : "",
          ...read(r),
        }));
    },
    async unwatch(connectionId, sessionId) {
      await Promise.all([
        ddb.send(new DeleteCommand({ TableName: table, Key: { pk: spk(sessionId), sk: `CONN#${connectionId}` } })),
        ddb.send(new DeleteCommand({ TableName: table, Key: { pk: cpk(connectionId), sk: `WATCH#${sessionId}` } })),
      ]);
    },
    async decksOf(sub) {
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: { ":pk": upk(sub), ":sk": "DECK#" },
        }),
      );
      const now = Date.now() / 1000;
      return (out.Items ?? [])
        .filter((r) => typeof r["expiresAt"] !== "number" || r["expiresAt"] > now)
        .map((r) => ({ connectionId: String(r["sk"]).slice("DECK#".length), ...read(r) }));
    },
    async follow(connectionId, channelId, at) {
      const expiresAt = expiresAfter(at);
      await Promise.all([
        ddb.send(
          new PutCommand({
            TableName: table,
            Item: { pk: fpk(channelId), sk: `CONN#${connectionId}`, kind: "follow", followedAt: at, expiresAt },
          }),
        ),
        ddb.send(
          new PutCommand({
            TableName: table,
            Item: { pk: cpk(connectionId), sk: `FOLLOW#${channelId}`, kind: "follow", followedAt: at, expiresAt },
          }),
        ),
      ]);
    },
    async followers(channelId) {
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: { ":pk": fpk(channelId), ":sk": "CONN#" },
        }),
      );
      const now = Date.now() / 1000;
      return (out.Items ?? [])
        .filter((r) => typeof r["expiresAt"] !== "number" || r["expiresAt"] > now)
        .map((r) => String(r["sk"]).slice("CONN#".length));
    },
    async disconnect(connectionId) {
      const out = await ddb.send(
        new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": cpk(connectionId) } }),
      );
      const rows = out.Items ?? [];
      await Promise.all(
        rows.flatMap((r) => {
          const sk = String(r["sk"]);
          const own = ddb.send(new DeleteCommand({ TableName: table, Key: { pk: cpk(connectionId), sk } }));
          if (sk === "CONN" && r["deck"] === true && typeof r["sub"] === "string")
            return [own, ddb.send(new DeleteCommand({ TableName: table, Key: { pk: upk(r["sub"]), sk: `DECK#${connectionId}` } }))];
          if (sk.startsWith("FOLLOW#"))
            return [
              own,
              ddb.send(new DeleteCommand({ TableName: table, Key: { pk: fpk(sk.slice("FOLLOW#".length)), sk: `CONN#${connectionId}` } })),
            ];
          if (!sk.startsWith("WATCH#")) return [own];
          const sessionId = sk.slice("WATCH#".length);
          return [own, ddb.send(new DeleteCommand({ TableName: table, Key: { pk: spk(sessionId), sk: `CONN#${connectionId}` } }))];
        }),
      );
    },
  };
}

/** What goes down a socket. One shape, so the app has one thing to parse. */
export interface Changed {
  t: "changed";
  id: string;
  seq: number;
}

/** Something to tell the listeners of a session. Never throws: a failed nudge costs a poll, not a move. */
export type Notify = (sessionId: string, seq: number) => Promise<void>;

/**
 * A gesture from the server rather than from a device: an ask arriving, an
 * ask answered. The same line a table's gesture takes down the socket, so
 * a listener has one shape to parse. Never throws, like a notify.
 */
export type Tell = (sessionId: string, kind: string, data: Record<string, unknown>, at: string) => Promise<void>;

/** A way to post to one connection; the management API, or a test's list. */
export interface Poster {
  post(connectionId: string, data: string): Promise<"sent" | "gone">;
}

export function apiGatewayPoster(endpoint: string): Poster {
  const client = new ApiGatewayManagementApiClient({ endpoint });
  return {
    async post(connectionId, data) {
      try {
        await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
        return "sent";
      } catch (error) {
        const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e.name === "GoneException" || e.$metadata?.httpStatusCode === 410) return "gone";
        throw error;
      }
    },
  };
}

/**
 * One line down each of these connections, at once. A connection that is
 * gone, closed without a disconnect the gateway told us about, is cleaned
 * up on the spot rather than left to the TTL; any other failure is the
 * caller's to report, and never stops the rest.
 */
async function postEach(
  live: LiveStore,
  poster: Poster,
  connectionIds: string[],
  line: string,
  failed: (error: unknown) => void,
): Promise<void> {
  await Promise.all(
    connectionIds.map(async (connectionId) => {
      try {
        if ((await poster.post(connectionId, line)) === "gone") await live.disconnect(connectionId);
      } catch (error) {
        failed(error);
      }
    }),
  );
}

/**
 * The notifier the HTTP handler calls after a session changes. A
 * connection that is gone, closed without a disconnect the gateway told
 * us about, is cleaned up on the spot rather than left to the TTL.
 */
export function teller(live: LiveStore, poster: Poster): Tell {
  return async (sessionId, kind, data, at) => {
    try {
      const watchers = await live.watchers(sessionId);
      const line = JSON.stringify({ t: "gesture", id: sessionId, kind, data, at });
      await postEach(
        live,
        poster,
        watchers.map((w) => w.connectionId),
        line,
        (error) => console.error("live: could not pass a line on", error),
      );
    } catch (error) {
      console.error("live: could not tell", error);
    }
  };
}

export function notifier(live: LiveStore, poster: Poster): Notify {
  return async (sessionId, seq) => {
    try {
      const watchers = await live.watchers(sessionId);
      const data = JSON.stringify({ t: "changed", id: sessionId, seq } satisfies Changed);
      await postEach(
        live,
        poster,
        watchers.map((w) => w.connectionId),
        data,
        (error) => console.error("live: could not reach a connection", error),
      );
    } catch (error) {
      console.error("live: could not notify", error);
    }
  };
}

/** Tell the widgets following a theme link that it moved. Never throws, like a notify. */
export type RingLook = (channelId: string, revision: number) => Promise<void>;

export function lookRinger(live: LiveStore, poster: Poster): RingLook {
  return async (channelId, revision) => {
    try {
      const followers = await live.followers(channelId);
      const line = JSON.stringify({ t: "look", revision });
      // The error's name only: a message could carry the connection or the endpoint.
      await postEach(live, poster, followers, line, (error) =>
        console.error("live: could not ring a theme link's widget", error instanceof Error ? error.name : "error"),
      );
    } catch (error) {
      console.error("live: could not ring a theme link", error instanceof Error ? error.name : "error");
    }
  };
}
