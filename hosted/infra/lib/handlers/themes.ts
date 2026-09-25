import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  IDEMPOTENCY_KEY_PATTERN,
  parseRemoteTheme,
  THEME_ID_PATTERN,
  THEME_SYNC_LIMITS,
  type RemoteThemeV1,
  type ThemeRecordV1,
} from "@runlog/themes";
import { traced } from "./xray.js";

/**
 * Saved custom themes, one row each under the account's own partition.
 *
 * The server gives every theme its revision: 1 when made, one more for each
 * accepted change. A write names the revision it was made from and lands
 * only if the row still has it, so two devices can never overwrite each
 * other blind. Deleting leaves a tombstone that does not expire: a device
 * that was offline for a year and edits the theme meets the tombstone, not
 * an empty slot it could fill. Account deletion still takes the row, with
 * the rest of the partition.
 *
 * Beside the rows: THEMELIB, how many live themes there are and a library
 * revision that moves on every write, which is what lets a device ask "has
 * anything changed" with one read; THEMEOP#<key>, the answer to a write,
 * kept a week so a retry of the same write gets the same answer; and a
 * counter per minute for the rate.
 */

export interface ThemeHead {
  readonly libraryRevision: number;
  readonly live: number;
}
export type ThemeExpectation = { readonly kind: "absent" } | { readonly kind: "revision"; readonly revision: number };
export interface ThemeReceipt {
  readonly fingerprint: string;
  readonly status: number;
  readonly body: Record<string, unknown>;
}
export interface ThemeWriteInput {
  readonly sub: string;
  readonly id: string;
  readonly at: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly expect: ThemeExpectation;
  readonly change: { readonly kind: "put"; readonly record: ThemeRecordV1 } | { readonly kind: "delete" };
}
export type ThemeWriteResult =
  | { readonly kind: "written"; readonly theme: RemoteThemeV1 }
  | { readonly kind: "replay"; readonly receipt: ThemeReceipt }
  | { readonly kind: "conflict"; readonly current: RemoteThemeV1 | null }
  | { readonly kind: "full" };
export interface ThemeStore {
  head(sub: string): Promise<ThemeHead>;
  /** `skipped` counts the rows on the page that no longer read and were left out; absent when none were. */
  page(sub: string, after?: string): Promise<{ themes: RemoteThemeV1[]; next?: string; skipped?: number }>;
  receipt(sub: string, key: string, at: string): Promise<ThemeReceipt | null>;
  countWrite(sub: string, at: string): Promise<number>;
  write(input: ThemeWriteInput): Promise<ThemeWriteResult>;
}

export const THEME_RECEIPT_DAYS = 7;

/** The theme a row holds, without the table's own keys, or null when the row no longer reads. */
export function readThemeRow(row: Record<string, unknown>): RemoteThemeV1 | null {
  const { pk: _pk, sk: _sk, kind: _kind, ...rest } = row;
  const parsed = parseRemoteTheme(rest);
  return parsed.ok ? parsed.value : null;
}

/** The theme a row holds, without the table's own keys. A row that does not read is a fault here, not the caller's. */
export function themeOfRow(row: Record<string, unknown>): RemoteThemeV1 {
  const theme = readThemeRow(row);
  if (!theme) throw new Error(`theme row ${String(row["sk"])} does not read`);
  return theme;
}

/**
 * The themes of a page of rows. A row that no longer reads is left out, so
 * one bad row cannot fail the whole library; the log counts it and says
 * nothing of what it holds.
 */
export function themesOfRows(rows: Record<string, unknown>[]): { themes: RemoteThemeV1[]; skipped: number } {
  const themes: RemoteThemeV1[] = [];
  let skipped = 0;
  for (const row of rows) {
    const theme = readThemeRow(row);
    if (theme) themes.push(theme);
    else skipped += 1;
  }
  if (skipped > 0) console.warn("theme row skipped", { reason: "does-not-read", count: skipped });
  return { themes, skipped };
}

/** The theme a write makes, before it is written. */
export function nextTheme(input: ThemeWriteInput): RemoteThemeV1 {
  const revision = input.expect.kind === "absent" ? 1 : input.expect.revision + 1;
  return input.change.kind === "put"
    ? { state: "live", id: input.id, revision, updatedAt: input.at, record: input.change.record }
    : { state: "deleted", id: input.id, revision, updatedAt: input.at, deletedAt: input.at };
}

/** Whole seconds, the unit the table's `expiresAt` is kept in. */
export const epochSeconds = (at: string) => Math.floor(Date.parse(at) / 1000);

/**
 * The route checks ids and keys before it calls the store; this is the
 * store's own check, so a caller that forgets cannot reach another row kind
 * by putting `#` or a prefix in an id.
 */
export function assertThemeId(id: string): void {
  if (!THEME_ID_PATTERN.test(id)) throw new Error("theme id does not match the contract");
}
export function assertIdempotencyKey(key: string): void {
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error("idempotency key does not match the contract");
}

export function dynamoThemes({ table }: { table: string }): ThemeStore {
  const ddb = DynamoDBDocumentClient.from(traced(new DynamoDBClient({})), { marshallOptions: { removeUndefinedValues: true } });
  const pk = (sub: string) => `USER#${sub}`;
  const get = async (sub: string, sk: string) =>
    ((await ddb.send(new GetCommand({ TableName: table, Key: { pk: pk(sub), sk }, ConsistentRead: true }))).Item as
      Record<string, unknown> | undefined) ?? null;

  const store: ThemeStore = {
    async head(sub) {
      const row = await get(sub, "THEMELIB");
      return { libraryRevision: Number(row?.["libraryRevision"] ?? 0), live: Number(row?.["live"] ?? 0) };
    },

    async page(sub, after) {
      if (after !== undefined) assertThemeId(after);
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :theme)",
          ExpressionAttributeValues: { ":pk": pk(sub), ":theme": "THEME#" },
          Limit: THEME_SYNC_LIMITS.pageSize,
          ConsistentRead: true,
          ...(after ? { ExclusiveStartKey: { pk: pk(sub), sk: `THEME#${after}` } } : {}),
        }),
      );
      const { themes, skipped } = themesOfRows((out.Items ?? []) as Record<string, unknown>[]);
      const last = out.LastEvaluatedKey?.["sk"];
      return { themes, ...(typeof last === "string" ? { next: last.slice("THEME#".length) } : {}), ...(skipped > 0 ? { skipped } : {}) };
    },

    async receipt(sub, key, at) {
      assertIdempotencyKey(key);
      const row = await get(sub, `THEMEOP#${key}`);
      if (!row) return null;
      // TTL deletion is lazy: an expired row can still be read for a while.
      if (Number(row["expiresAt"]) < epochSeconds(at)) return null;
      return {
        fingerprint: String(row["fingerprint"]),
        status: Number(row["status"]),
        body: JSON.parse(String(row["body"])) as Record<string, unknown>,
      };
    },

    async countWrite(sub, at) {
      const out = await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { pk: pk(sub), sk: `COUNT#themes#${at.slice(0, 16)}` },
          UpdateExpression: "ADD n :one SET kind = :kind, expiresAt = :ttl",
          ExpressionAttributeValues: { ":one": 1, ":kind": "counter", ":ttl": Math.floor(Date.parse(at) / 1000) + 120 },
          ReturnValues: "UPDATED_NEW",
        }),
      );
      return Number(out.Attributes?.["n"] ?? 1);
    },

    async write(input) {
      assertThemeId(input.id);
      assertIdempotencyKey(input.key);
      const theme = nextTheme(input);
      const creating = input.expect.kind === "absent";
      const delta = creating ? 1 : input.change.kind === "delete" ? -1 : 0;
      const body = { theme };
      try {
        await ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: table,
                  Key: { pk: pk(input.sub), sk: "THEMELIB" },
                  UpdateExpression: "ADD libraryRevision :one, #live :delta SET kind = :kind",
                  ExpressionAttributeNames: { "#live": "live" },
                  ExpressionAttributeValues: {
                    ":one": 1,
                    ":delta": delta,
                    ":kind": "themelib",
                    ...(creating ? { ":max": THEME_SYNC_LIMITS.maxThemes } : {}),
                  },
                  ...(creating ? { ConditionExpression: "attribute_not_exists(#live) OR #live < :max" } : {}),
                },
              },
              {
                Put: {
                  TableName: table,
                  Item: { pk: pk(input.sub), sk: `THEME#${input.id}`, kind: "theme", ...theme },
                  ...(input.expect.kind === "absent"
                    ? { ConditionExpression: "attribute_not_exists(pk)" }
                    : {
                        ConditionExpression: "#rev = :base AND #state = :live",
                        ExpressionAttributeNames: { "#rev": "revision", "#state": "state" },
                        ExpressionAttributeValues: { ":base": input.expect.revision, ":live": "live" },
                      }),
                },
              },
              {
                Put: {
                  TableName: table,
                  Item: {
                    pk: pk(input.sub),
                    sk: `THEMEOP#${input.key}`,
                    kind: "themeop",
                    fingerprint: input.fingerprint,
                    status: 200,
                    body: JSON.stringify(body),
                    expiresAt: epochSeconds(input.at) + THEME_RECEIPT_DAYS * 86400,
                  },
                  // An expired receipt can linger until TTL removes it; it no longer answers for the key.
                  ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now",
                  ExpressionAttributeValues: { ":now": epochSeconds(input.at) },
                },
              },
            ],
          }),
        );
        return { kind: "written", theme };
      } catch (error) {
        if ((error as { name?: string }).name !== "TransactionCanceledException") throw error;
        const reasons = ((error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons ?? []).map((r) => r.Code);
        if (reasons[2] === "ConditionalCheckFailed") {
          const receipt = await store.receipt(input.sub, input.key, input.at);
          if (receipt) return { kind: "replay", receipt };
        }
        if (reasons[1] === "ConditionalCheckFailed") {
          const row = await get(input.sub, `THEME#${input.id}`);
          return { kind: "conflict", current: row ? themeOfRow(row) : null };
        }
        if (reasons[0] === "ConditionalCheckFailed") return { kind: "full" };
        throw error;
      }
    },
  };
  return store;
}
