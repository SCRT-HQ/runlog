import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { randomBytes } from "node:crypto";
import { traced } from "./xray.js";

/**
 * Races across devices.
 *
 * A race is several people playing the same seeded mode of the same pack
 * at once, each on their own device, each in an ordinary run of their own
 * — the same seed hands everyone the same dice, so the runs agree without
 * ever meeting. What the server holds is small: the race (pack, mode,
 * seed, who started it), one entry per racer naming their run, and the
 * progress each device reports as it goes. The leaderboard is that
 * progress, ranked on the device. The server never reduces a run and
 * never sees a pack.
 *
 * Joining is by a six-letter code, which is also what an emailed
 * invitation carries. Codes avoid the letters that read as digits.
 */

export interface RaceMeta {
  id: string;
  code: string;
  packId: string;
  packVersion: string;
  packTitle?: string;
  name?: string;
  mode: string;
  seed: string;
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  /** Bumped on every change, for the doorbell. */
  seq: number;
}

export interface RaceProgress {
  unit: number;
  unitsDone: number;
  status: "active" | "ended";
  ending?: string;
  elapsedMs: number;
  updatedAt: string;
}

export interface RaceEntry {
  sub: string;
  name?: string;
  /** The racer's own run, once they have started it. */
  sessionId?: string;
  joinedAt: string;
  progress?: RaceProgress;
}

export interface Race {
  meta: RaceMeta;
  entries: RaceEntry[];
}

export interface RaceStore {
  /** Null once the id is taken. The owner is the first entry. */
  createRace(meta: Omit<RaceMeta, "seq" | "createdAt" | "updatedAt">, at: string, owner: { name?: string; sessionId?: string }): Promise<Race | null>;
  getRace(id: string): Promise<Race | null>;
  /** The race a code names, or null. */
  raceByCode(code: string): Promise<string | null>;
  /** Join, or be already in: the same entry either way. */
  joinRace(id: string, sub: string, name: string | undefined, at: string): Promise<Race | null>;
  updateEntry(id: string, sub: string, at: string, patch: { sessionId?: string; name?: string; progress?: RaceProgress }): Promise<Race | null>;
  updateRace(id: string, at: string, patch: { name?: string; endedAt?: string }): Promise<Race | null>;
  /** Every race this person is in, newest first. */
  listRaces(sub: string): Promise<Race[]>;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export function newCode(random: (n: number) => Buffer = randomBytes): string {
  // A byte modulo the alphabet is an even draw only while the alphabet
  // divides 256, which 32 does and the next size might not. Bytes past the
  // last whole multiple are thrown away rather than folded, so the draw
  // stays even for any alphabet, and says so to whoever reads it.
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const byte of random(CODE_LENGTH)) {
      if (out.length === CODE_LENGTH) break;
      const limit = 256 - (256 % ALPHABET.length);
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}

/** A code as typed: upper-cased, with the lookalikes people type corrected. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/0/g, "O").replace(/1/g, "I").slice(0, CODE_LENGTH);
}

/** Days a race and its rows stay after they were last touched. */
const RACE_DAYS = 90;
const expiresAfter = (at: string) => Math.floor(new Date(at).getTime() / 1000) + RACE_DAYS * 86400;

type Row = Record<string, unknown> & { pk: string; sk: string; kind: "race" | "entry" | "code" | "racepointer" };

export function dynamoRaces({ table }: { table: string }): RaceStore {
  const ddb = DynamoDBDocumentClient.from(traced(new DynamoDBClient({})), { marshallOptions: { removeUndefinedValues: true } });
  const rpk = (id: string) => `RACE#${id}`;
  const upk = (sub: string) => `USER#${sub}`;
  const strip = (row: Row): Record<string, unknown> => {
    const { pk: _pk, sk: _sk, kind: _kind, expiresAt: _ttl, ...rest } = row;
    return rest;
  };

  async function rows(id: string): Promise<Race | null> {
    const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": rpk(id) } }));
    const all = (out.Items ?? []) as Row[];
    const meta = all.find((r) => r.sk === "META");
    if (!meta) return null;
    return {
      meta: strip(meta) as unknown as RaceMeta,
      entries: all.filter((r) => r.kind === "entry").map((r) => strip(r) as unknown as RaceEntry),
    };
  }

  async function touch(id: string, at: string, patch: Record<string, unknown> = {}): Promise<RaceMeta | null> {
    const existing = (await ddb.send(new GetCommand({ TableName: table, Key: { pk: rpk(id), sk: "META" } }))).Item as Row | undefined;
    if (!existing) return null;
    const row: Row = { ...existing, ...patch, updatedAt: at, seq: Number(existing["seq"] ?? 0) + 1, expiresAt: expiresAfter(at) };
    if (patch["name"] === "") delete row["name"];
    await ddb.send(new PutCommand({ TableName: table, Item: row }));
    return strip(row) as unknown as RaceMeta;
  }

  async function entry(id: string, sub: string, at: string, fields: Record<string, unknown>, create: boolean): Promise<void> {
    const key = { pk: rpk(id), sk: `ENTRY#${sub}` };
    const existing = (await ddb.send(new GetCommand({ TableName: table, Key: key }))).Item as Row | undefined;
    if (!existing && !create) return;
    const row: Row = { ...(existing ?? { ...key, kind: "entry", sub, joinedAt: at }), ...fields, expiresAt: expiresAfter(at) };
    await ddb.send(new PutCommand({ TableName: table, Item: row }));
    await ddb.send(new PutCommand({ TableName: table, Item: { pk: upk(sub), sk: `RACE#${id}`, kind: "racepointer", id, updatedAt: at, expiresAt: expiresAfter(at) } }));
  }

  return {
    async createRace(meta, at, owner) {
      const row: Row = { ...meta, pk: rpk(meta.id), sk: "META", kind: "race", createdAt: at, updatedAt: at, seq: 0, expiresAt: expiresAfter(at) };
      try {
        await ddb.send(new PutCommand({ TableName: table, Item: row, ConditionExpression: "attribute_not_exists(pk)" }));
      } catch (error) {
        if ((error as { name?: string }).name === "ConditionalCheckFailedException") return null;
        throw error;
      }
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `CODE#${meta.code}`, sk: "RACE", kind: "code", raceId: meta.id, expiresAt: expiresAfter(at) } }));
      await entry(meta.id, meta.ownerSub, at, { ...(owner.name ? { name: owner.name } : {}), ...(owner.sessionId ? { sessionId: owner.sessionId } : {}) }, true);
      return rows(meta.id);
    },
    getRace: rows,
    async raceByCode(code) {
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: `CODE#${code}`, sk: "RACE" } }));
      const id = out.Item?.["raceId"];
      return typeof id === "string" ? id : null;
    },
    async joinRace(id, sub, name, at) {
      const race = await rows(id);
      if (!race || race.meta.endedAt) return null;
      if (!race.entries.some((e) => e.sub === sub)) {
        await entry(id, sub, at, { ...(name ? { name } : {}) }, true);
        await touch(id, at);
      }
      return rows(id);
    },
    async updateEntry(id, sub, at, patch) {
      const race = await rows(id);
      if (!race || !race.entries.some((e) => e.sub === sub)) return null;
      await entry(id, sub, at, { ...patch }, false);
      await touch(id, at);
      return rows(id);
    },
    async updateRace(id, at, patch) {
      const meta = await touch(id, at, { ...patch });
      if (!meta) return null;
      return rows(id);
    },
    async listRaces(sub) {
      const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)", ExpressionAttributeValues: { ":pk": upk(sub), ":sk": "RACE#" } }));
      const ids = ((out.Items ?? []) as Row[]).sort((a, b) => (String(a["updatedAt"]) < String(b["updatedAt"]) ? 1 : -1)).map((r) => String(r["id"]));
      const races = await Promise.all(ids.map(rows));
      return races.filter((r): r is Race => r !== null);
    },
  };
}

