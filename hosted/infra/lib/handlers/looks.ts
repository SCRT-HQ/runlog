import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  isIsoInstant,
  LOOK_CHANNEL_ID_PATTERN,
  LOOK_CHANNEL_LIMITS,
  parsePresentationSnapshot,
  presentationSnapshotKey,
  type LookChannelSummaryV1,
  type PresentationSnapshotV1,
} from "@runlog/themes";
import { traced } from "./xray.js";

/**
 * Theme links: one device's applied look, kept here so a widget on any
 * machine can read it while the device is closed.
 *
 * A link is a row under its owner's partition, LOOK#<id>, holding the
 * hash of the read key widgets carry, the hash of the secret only the
 * publishing device holds, the latest look and the revision the server
 * gave it. A widget knows only the read key, so a pointer row keyed by its
 * hash, LOOKKEY#<hash>, says which account and link it opens. LOOKLIB
 * counts an account's links so the create transaction can hold the cap.
 * Neither key nor secret is ever stored as itself, and no row expires:
 * a link lasts until it is revoked or the account is deleted.
 */

export interface LookChannelRow {
  readonly sub: string;
  readonly id: string;
  readonly readKeyHash: string;
  readonly secretHash: string;
  /** 0 until the first publish; the server adds one for each publish it takes. */
  readonly revision: number;
  readonly snapshot: PresentationSnapshotV1 | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}
export type LookPublishResult =
  | { readonly kind: "published"; readonly revision: number }
  | { readonly kind: "stale"; readonly revision: number }
  | { readonly kind: "not-publisher" }
  | { readonly kind: "gone" };
export interface LookStore {
  list(sub: string): Promise<LookChannelRow[]>;
  get(sub: string, id: string): Promise<LookChannelRow | null>;
  byReadKey(readKeyHash: string): Promise<{ sub: string; id: string } | null>;
  create(input: { sub: string; id: string; readKeyHash: string; secretHash: string; at: string }): Promise<"created" | "full">;
  countPublish(sub: string, id: string, at: string): Promise<number>;
  publish(input: {
    sub: string;
    id: string;
    secretHash: string;
    base: number;
    snapshot: PresentationSnapshotV1;
    at: string;
  }): Promise<LookPublishResult>;
  rotateSecret(input: { sub: string; id: string; secretHash: string; at: string }): Promise<boolean>;
  relink(input: { sub: string; id: string; readKeyHash: string; at: string }): Promise<{ oldReadKeyHash: string } | null>;
  remove(sub: string, id: string): Promise<boolean>;
  /** Every link of the account, gone with its pointer row; the ids, so their widgets can be rung. */
  removeAll(sub: string): Promise<string[]>;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The store's own checks, so a caller that forgets cannot reach another row kind through an id or a hash. */
export function assertLookId(id: string): void {
  if (!LOOK_CHANNEL_ID_PATTERN.test(id)) throw new Error("theme link id does not match the contract");
}
export function assertLookHash(hash: string): void {
  if (!HASH_PATTERN.test(hash)) throw new Error("theme link hash is not a SHA-256 hex digest");
}
export function assertLookTime(at: string): void {
  if (!isIsoInstant(at)) throw new Error("theme link time is not an ISO instant");
}

export function lookSummary(row: LookChannelRow): LookChannelSummaryV1 {
  return { id: row.id, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt, publishedAt: row.publishedAt };
}

/** The link a row holds. A row or stored look that does not read is a fault here, never something to serve. */
export function lookOfRow(row: Record<string, unknown>): LookChannelRow {
  const fault = () => new Error(`theme link ${String(row["id"])} does not read`);
  let snapshot: PresentationSnapshotV1 | null = null;
  if (typeof row["snapshot"] === "string") {
    let parsed;
    try {
      parsed = parsePresentationSnapshot(JSON.parse(row["snapshot"]));
    } catch {
      parsed = null;
    }
    if (!parsed?.ok) throw fault();
    snapshot = parsed.value;
  }
  const { sub, id, readKeyHash, secretHash, createdAt, updatedAt } = row;
  const revision = row["revision"] ?? 0;
  const publishedAt = row["publishedAt"] ?? null;
  if (
    typeof sub !== "string" ||
    typeof id !== "string" ||
    !LOOK_CHANNEL_ID_PATTERN.test(id) ||
    typeof readKeyHash !== "string" ||
    !HASH_PATTERN.test(readKeyHash) ||
    typeof secretHash !== "string" ||
    !HASH_PATTERN.test(secretHash) ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !isIsoInstant(createdAt) ||
    !isIsoInstant(updatedAt) ||
    (publishedAt !== null && !isIsoInstant(publishedAt))
  ) {
    throw fault();
  }
  return { sub, id, readKeyHash, secretHash, revision, snapshot, createdAt, updatedAt, publishedAt };
}

const cancelled = (error: unknown) => (error as { name?: string } | null)?.name === "TransactionCanceledException";
const checkFailed = (error: unknown) => (error as { name?: string } | null)?.name === "ConditionalCheckFailedException";

export function dynamoLooks({ table }: { table: string }): LookStore {
  const ddb = DynamoDBDocumentClient.from(traced(new DynamoDBClient({})), { marshallOptions: { removeUndefinedValues: true } });
  const pk = (sub: string) => `USER#${sub}`;
  const kpk = (hash: string) => `LOOKKEY#${hash}`;
  const get = async (key: { pk: string; sk: string }) =>
    ((await ddb.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))).Item as Record<string, unknown> | undefined) ??
    null;
  /** Every LOOK# row of the account as stored, paged past 1 MB. */
  const rowsOf = async (sub: string) => {
    const rows: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :look)",
          ExpressionAttributeValues: { ":pk": pk(sub), ":look": "LOOK#" },
          ConsistentRead: true,
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      rows.push(...((out.Items ?? []) as Record<string, unknown>[]));
      start = out.LastEvaluatedKey;
    } while (start);
    return rows;
  };

  const store: LookStore = {
    async list(sub) {
      return (await rowsOf(sub)).map(lookOfRow);
    },

    async get(sub, id) {
      assertLookId(id);
      const row = await get({ pk: pk(sub), sk: `LOOK#${id}` });
      return row ? lookOfRow(row) : null;
    },

    async byReadKey(hash) {
      assertLookHash(hash);
      const row = await get({ pk: kpk(hash), sk: "LOOKKEY" });
      return row && typeof row["sub"] === "string" && typeof row["id"] === "string" ? { sub: row["sub"], id: row["id"] } : null;
    },

    async create({ sub, id, readKeyHash, secretHash, at }) {
      assertLookId(id);
      assertLookHash(readKeyHash);
      assertLookHash(secretHash);
      assertLookTime(at);
      try {
        await ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: table,
                  Key: { pk: pk(sub), sk: "LOOKLIB" },
                  UpdateExpression: "ADD #live :one SET kind = :kind",
                  ConditionExpression: "attribute_not_exists(#live) OR #live < :max",
                  ExpressionAttributeNames: { "#live": "live" },
                  ExpressionAttributeValues: { ":one": 1, ":kind": "looklib", ":max": LOOK_CHANNEL_LIMITS.maxChannels },
                },
              },
              {
                Put: {
                  TableName: table,
                  Item: {
                    pk: pk(sub),
                    sk: `LOOK#${id}`,
                    kind: "look",
                    sub,
                    id,
                    readKeyHash,
                    secretHash,
                    revision: 0,
                    createdAt: at,
                    updatedAt: at,
                  },
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Put: {
                  TableName: table,
                  Item: { pk: kpk(readKeyHash), sk: "LOOKKEY", kind: "lookkey", sub, id },
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
            ],
          }),
        );
        return "created";
      } catch (error) {
        if (!cancelled(error)) throw error;
        const reasons = ((error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons ?? []).map((r) => r.Code);
        if (reasons[0] === "ConditionalCheckFailed") return "full";
        throw error;
      }
    },

    async countPublish(sub, id, at) {
      assertLookId(id);
      assertLookTime(at);
      const out = await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { pk: pk(sub), sk: `COUNT#look#${id}#${at.slice(0, 16)}` },
          UpdateExpression: "ADD n :one SET kind = :kind, expiresAt = :ttl",
          ExpressionAttributeValues: { ":one": 1, ":kind": "counter", ":ttl": Math.floor(Date.parse(at) / 1000) + 120 },
          ReturnValues: "UPDATED_NEW",
        }),
      );
      return Number(out.Attributes?.["n"] ?? 1);
    },

    async publish({ sub, id, secretHash, base, snapshot, at }) {
      assertLookId(id);
      assertLookHash(secretHash);
      assertLookTime(at);
      if (!Number.isSafeInteger(base) || base < 0) throw new Error("theme link base revision is not a revision");
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: pk(sub), sk: `LOOK#${id}` },
            UpdateExpression: "SET #rev = :next, #snap = :snapshot, updatedAt = :at, publishedAt = :at",
            ConditionExpression: "attribute_exists(pk) AND #secret = :secret AND #rev = :base",
            ExpressionAttributeNames: { "#rev": "revision", "#snap": "snapshot", "#secret": "secretHash" },
            ExpressionAttributeValues: {
              ":next": base + 1,
              ":snapshot": presentationSnapshotKey(snapshot),
              ":at": at,
              ":secret": secretHash,
              ":base": base,
            },
          }),
        );
        return { kind: "published", revision: base + 1 };
      } catch (error) {
        if (!checkFailed(error)) throw error;
        // One consistent read says which condition failed. The secret first:
        // a device that is no longer the publisher is told so whatever revision it names.
        const row = await get({ pk: pk(sub), sk: `LOOK#${id}` });
        if (!row) return { kind: "gone" };
        if (row["secretHash"] !== secretHash) return { kind: "not-publisher" };
        return { kind: "stale", revision: Number(row["revision"] ?? 0) };
      }
    },

    async rotateSecret({ sub, id, secretHash, at }) {
      assertLookId(id);
      assertLookHash(secretHash);
      assertLookTime(at);
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: pk(sub), sk: `LOOK#${id}` },
            UpdateExpression: "SET #secret = :secret, updatedAt = :at",
            ConditionExpression: "attribute_exists(pk)",
            ExpressionAttributeNames: { "#secret": "secretHash" },
            ExpressionAttributeValues: { ":secret": secretHash, ":at": at },
          }),
        );
        return true;
      } catch (error) {
        if (checkFailed(error)) return false;
        throw error;
      }
    },

    async relink({ sub, id, readKeyHash, at }) {
      assertLookHash(readKeyHash);
      assertLookTime(at);
      const current = await store.get(sub, id);
      if (!current) return null;
      try {
        await ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: table,
                  Key: { pk: pk(sub), sk: `LOOK#${id}` },
                  UpdateExpression: "SET #key = :new, updatedAt = :at",
                  ConditionExpression: "#key = :old",
                  ExpressionAttributeNames: { "#key": "readKeyHash" },
                  ExpressionAttributeValues: { ":new": readKeyHash, ":old": current.readKeyHash, ":at": at },
                },
              },
              { Delete: { TableName: table, Key: { pk: kpk(current.readKeyHash), sk: "LOOKKEY" } } },
              {
                Put: {
                  TableName: table,
                  Item: { pk: kpk(readKeyHash), sk: "LOOKKEY", kind: "lookkey", sub, id },
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
            ],
          }),
        );
        return { oldReadKeyHash: current.readKeyHash };
      } catch (error) {
        // Another relink or a revoke got there first: nothing changed.
        if (cancelled(error)) return null;
        throw error;
      }
    },

    async remove(sub, id) {
      assertLookId(id);
      // The stored row as it is, not parsed: a link whose look no longer reads must still be removable.
      const current = await get({ pk: pk(sub), sk: `LOOK#${id}` });
      if (!current) return false;
      const stored = current["readKeyHash"];
      const pointer = typeof stored === "string" && HASH_PATTERN.test(stored) ? stored : null;
      try {
        await ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Delete: {
                  TableName: table,
                  Key: { pk: pk(sub), sk: `LOOK#${id}` },
                  // The read key it was read with, so a relink in between cancels this rather than strand the new pointer.
                  ...(pointer
                    ? {
                        ConditionExpression: "attribute_exists(pk) AND #key = :key",
                        ExpressionAttributeNames: { "#key": "readKeyHash" },
                        ExpressionAttributeValues: { ":key": pointer },
                      }
                    : { ConditionExpression: "attribute_exists(pk)" }),
                },
              },
              ...(pointer ? [{ Delete: { TableName: table, Key: { pk: kpk(pointer), sk: "LOOKKEY" } } }] : []),
              {
                Update: {
                  TableName: table,
                  Key: { pk: pk(sub), sk: "LOOKLIB" },
                  UpdateExpression: "ADD #live :minus",
                  ExpressionAttributeNames: { "#live": "live" },
                  ExpressionAttributeValues: { ":minus": -1 },
                },
              },
            ],
          }),
        );
        return true;
      } catch (error) {
        if (cancelled(error)) return false;
        throw error;
      }
    },

    async removeAll(sub) {
      const ids: string[] = [];
      // Raw rows, so one link whose look no longer reads cannot hold up account deletion.
      for (const row of await rowsOf(sub)) {
        const id = row["id"];
        if (typeof id !== "string" || !LOOK_CHANNEL_ID_PATTERN.test(id)) continue;
        // A relink landing in between cancels the first try; the second reads the new pointer.
        if ((await store.remove(sub, id)) || (await store.remove(sub, id))) ids.push(id);
      }
      return ids;
    },
  };
  return store;
}
