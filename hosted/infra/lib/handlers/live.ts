import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Who is listening, and telling them something changed.
 *
 * A device with a run open holds a WebSocket and says which session it is
 * watching. When another device appends to that session, the API posts a
 * one-line message down every socket watching it — "changed, seq 12" —
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

export interface Watcher {
  connectionId: string;
  sub: string;
}

export interface LiveStore {
  connect(connectionId: string, sub: string, at: string): Promise<void>;
  /** Who holds this connection, or null for one that was never accepted or has expired. */
  connection(connectionId: string): Promise<{ sub: string } | null>;
  watch(connectionId: string, sessionId: string, sub: string, at: string): Promise<void>;
  watchers(sessionId: string): Promise<Watcher[]>;
  /** The connection and every watch it held, gone. */
  disconnect(connectionId: string): Promise<void>;
}

export function dynamoLive({ table }: { table: string }): LiveStore {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const cpk = (id: string) => `CONN#${id}`;
  const spk = (id: string) => `SESSION#${id}`;

  return {
    async connect(connectionId, sub, at) {
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: cpk(connectionId), sk: "CONN", kind: "conn", sub, connectedAt: at, expiresAt: expiresAfter(at) } }));
    },
    async connection(connectionId) {
      const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND sk = :sk", ExpressionAttributeValues: { ":pk": cpk(connectionId), ":sk": "CONN" } }));
      const row = out.Items?.[0];
      if (!row || typeof row["sub"] !== "string") return null;
      if (typeof row["expiresAt"] === "number" && row["expiresAt"] * 1000 < Date.now()) return null;
      return { sub: row["sub"] };
    },
    async watch(connectionId, sessionId, sub, at) {
      const expiresAt = expiresAfter(at);
      await Promise.all([
        ddb.send(new PutCommand({ TableName: table, Item: { pk: spk(sessionId), sk: `CONN#${connectionId}`, kind: "watch", sub, expiresAt } })),
        ddb.send(new PutCommand({ TableName: table, Item: { pk: cpk(connectionId), sk: `WATCH#${sessionId}`, kind: "watch", sub, expiresAt } })),
      ]);
    },
    async watchers(sessionId) {
      const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)", ExpressionAttributeValues: { ":pk": spk(sessionId), ":sk": "CONN#" } }));
      const now = Date.now() / 1000;
      return (out.Items ?? [])
        .filter((r) => typeof r["expiresAt"] !== "number" || r["expiresAt"] > now)
        .map((r) => ({ connectionId: String(r["sk"]).slice("CONN#".length), sub: String(r["sub"] ?? "") }));
    },
    async disconnect(connectionId) {
      const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": cpk(connectionId) } }));
      const rows = out.Items ?? [];
      await Promise.all(
        rows.flatMap((r) => {
          const sk = String(r["sk"]);
          const own = ddb.send(new DeleteCommand({ TableName: table, Key: { pk: cpk(connectionId), sk } }));
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
 * The notifier the HTTP handler calls after a session changes. A
 * connection that is gone — closed without a disconnect the gateway told
 * us about — is cleaned up on the spot rather than left to the TTL.
 */
export function notifier(live: LiveStore, poster: Poster): Notify {
  return async (sessionId, seq) => {
    try {
      const watchers = await live.watchers(sessionId);
      const data = JSON.stringify({ t: "changed", id: sessionId, seq } satisfies Changed);
      await Promise.all(
        watchers.map(async (w) => {
          try {
            if ((await poster.post(w.connectionId, data)) === "gone") await live.disconnect(w.connectionId);
          } catch (error) {
            console.error("live: could not reach a connection", error);
          }
        }),
      );
    } catch (error) {
      console.error("live: could not notify", error);
    }
  };
}
