import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { traced } from "./xray.js";

/**
 * Where a player's things are kept.
 *
 * DynamoDB holds what is *about* each item, enough to answer "what have you
 * got, and when did it change" in one query, and S3 holds the item itself.
 * A run's event log grows all session and a pack's source can be a whole
 * rulebook; neither belongs inside a 400 KB table item, and an object that is
 * written whole matches how the app writes them.
 *
 * Deleting leaves a tombstone. Another device has to be told, and it only
 * hears through the manifest, so the row stays for thirty days with a TTL
 * and the object goes at once.
 *
 * Licenses are the exception to the split: a license key is a few dozen
 * characters, so the row is the whole record. The manifest still leaves the
 * key out, it lists what the player has, not what opens it.
 *
 * A session, a run with people in it, has a partition of its own, so its
 * members can share it: a META row, a MEMBER row per person, and one EVENT
 * row per event in the order the server received them. Each member also
 * keeps a pointer row under their own partition, which is what the manifest
 * lists. The log is append-only: nothing here ever rewrites an event, and
 * a sequence number is handed out by an atomic add on the META row, so two
 * people appending at once get disjoint ranges and the same replay.
 *
 * The profile is one more row under the same partition: when the account
 * was first seen here, when it was last seen, and the name and email the
 * app reported at sign-in. WorkOS remains the truth about who the person
 * is; this is the snapshot a support reply or a receipt needs without a
 * second call. Deleting the account is deleting the partition.
 */

/** What the manifest says about one item. */
export interface Entry {
  id: string;
  updatedAt: string;
  /** The client's fingerprint of the body. For diffing, not integrity. */
  hash: string;
  deletedAt?: string;
}

export interface PackMeta extends Entry {
  title: string;
  version: string;
  format: "yaml" | "json";
  filename: string;
  importedAt: string;
  bytes: number;
  /**
   * Where the app got it, a file of the player's, the catalog, a sealed
   * copy, a listing, and for a catalog pack which entry at which version,
   * so a device that pulls it can still offer the newer one. Carried, not
   * read: the server decides nothing on these.
   */
  origin?: PackOrigin;
  catalog?: { id: string; version: string };
  /**
   * Whether the pack's text may be handed to people who are not this
   * person: the license's own word, carried by the app. A run shared by
   * link shows a stranger the pack only when this is true.
   */
  shareable?: boolean;
}

export type PackOrigin = "file" | "catalog" | "sealed" | "listing";
export const PACK_ORIGINS: readonly PackOrigin[] = ["file", "catalog", "sealed", "listing"];

/** A session's own row: what it is, and how far its log has got. */
export interface SessionMeta {
  id: string;
  packId: string;
  packVersion: string;
  /** The pack's title as the app knew it: for mail and lists, where an id reads badly. */
  packTitle?: string;
  name?: string;
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
  /** The highest sequence number handed out. */
  seq: number;
  endedAt?: string;
  deletedAt?: string;
  /** Set while the run is open to anyone with the link: the link's token, hashed. */
  publicTokenHash?: string;
  publicAt?: string;
  /**
   * Set while the run takes asks from outside: the ask key, hashed. Not the
   * live link's token: that one is on every widget address and in a
   * streaming scene, and a leaked address must let strangers watch, never
   * press. Revoked on its own.
   */
  askKeyHash?: string;
  /** What the table does with an ask: waits for the host to press, or takes it as it lands. */
  askPolicy?: AskPolicy;
  askAt?: string;
}

export type AskPolicy = "ask" | "auto";

/**
 * Something from outside the table, a chat command, a channel-point redeem,
 * a button on a stream deck, asking the run to take a move the pack offers
 * or to roll the table that is waiting. The host's device answers it, since
 * only that device appends to an app-hosted run; the answer is kept beside
 * the ask so a listener can say what became of it.
 */
export interface Ask {
  id: string;
  kind: "move" | "roll";
  /** The move's id in the pack, for `kind: "move"`. */
  move?: string;
  /** Who asked, as they gave it. */
  name?: string;
  /** How: `channel-points`, `bits`, `gift`, `command`, whatever the caller says. */
  via?: string;
  /**
   * The caller's own name for this press, where it has one: a redemption
   * id, a message id. What makes a retry after a lost reply the same press
   * rather than a second one.
   */
  ref?: string;
  at: string;
  answer?: "accepted" | "declined";
  answeredAt?: string;
  /** Why it was declined, in a few words: no such move right now, nothing to roll. */
  reason?: string;
}

/** How many asks a run keeps: enough to see what chat did this stream, not a history. */
export const ASKS_KEPT = 50;

export type Role = "owner" | "player" | "viewer";

export interface SessionMember {
  sub: string;
  role: Role;
  joinedAt: string;
  name?: string;
}

/** What a member's own partition says about a session: enough to list it. */
export interface SessionPointer {
  id: string;
  role: Role;
  packId: string;
  packVersion: string;
  packTitle?: string;
  name?: string;
  ownerSub: string;
  updatedAt: string;
  seq: number;
  endedAt?: string;
  deletedAt?: string;
}

/** An invitation to a session, keyed by its token. */
export interface Invite {
  token: string;
  sessionId: string;
  email: string;
  role: Role;
  invitedBy: string;
  invitedByName?: string;
  createdAt: string;
  expiresAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
}

/** Somebody the account has shared a session with, for the picker. */
export interface Person {
  sub: string;
  name?: string;
  email?: string;
  lastPlayedAt: string;
}

/**
 * How a person is shown to others: the name they chose, else their first
 * name as WorkOS holds it, else nothing. Never the full name: a table and
 * a live page are seen by strangers, and the app's own badge shows the
 * first name where no handle is set, so the two agree.
 */
export function shownName(profile: Pick<Profile, "name" | "handle">): string | undefined {
  const handle = profile.handle?.trim();
  if (handle) return handle;
  const first = profile.name?.trim().split(/\s+/)[0];
  return first || undefined;
}

/** A reaction from a watcher: one of a few emoji, a name if they gave one, and when. */
export interface Reaction {
  emoji: string;
  name?: string;
  at: string;
}

/** How many reactions a run keeps: a chat's last screenful, not a history. */
export const REACTIONS_KEPT = 30;

/** A command-line key, as the profile lists it: never the secret, only its hash's owner row. */
export interface ApiKey {
  id: string;
  name: string;
  /** The first few characters, so a person can tell keys apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  /**
   * What the key may do. `full` is the person on every route; `release`
   * reaches only what checking, signing, publishing and releasing a pack
   * need, so a key left in a build server's secrets cannot revoke sales,
   * remove people, or read what the person plays. Missing means full, for
   * keys from before scopes.
   */
  scope?: KeyScope;
}

export type KeyScope = "full" | "release";

/** A signing key an account has proved it holds. The public half is what the badge checks. */
export interface Claim {
  fingerprint: string;
  publicKey: string;
  sub: string;
  /** The account's name at claim time, refreshed when the profile changes. */
  name?: string;
  claimedAt: string;
}

/** An event as stored: the client's object, plus where it landed and who made it. */
export type StoredEvent = Record<string, unknown> & { id: string; seq: number; author: string };

/** Thrown by `appendEvents` when the log's tail is not where the caller expected it. */
export class SeqConflict extends Error {
  constructor(readonly expected: number) {
    super(`the log moved past ${expected}`);
    this.name = "SeqConflict";
  }
}

/**
 * Which of an account's two stream keys this is.
 *
 * They are kept apart on purpose. A watch key is in every widget address
 * and so in a streaming scene, where an address that gets out should let
 * strangers watch and never press; a press key is only ever in a bot's
 * settings. One leaking must not become the other.
 */
export type StreamKeyKind = "watch" | "press";

/** What an account's stream keys look like to their owner: that they exist, and since when. */
export interface StreamKeys {
  watch?: { madeAt: string };
  press?: { madeAt: string };
}

/** A license key's row, less the key. `id` is the pack the key opens. */
export interface LicenseMeta extends Entry {
  /** The seller's reference from the sealed file's header, if it had one. */
  ref?: string;
  title?: string;
}

/** What the API knows about the person, apart from what they keep. */
export interface Profile {
  createdAt: string;
  lastSeenAt: string;
  /** The name WorkOS holds, as the app last saw it. */
  name?: string;
  /**
   * The name this person chose to be shown as, everywhere someone else
   * sees them: at a table, in a race, on a reaction, on a claim. Wins over
   * `name`; an address is never shown to anyone but its owner.
   */
  handle?: string;
  /**
   * When this person last set `handle` themselves, blank or not. Absent,
   * nobody has asked them yet, and the app asks once before showing a
   * name of its own choosing to anyone.
   */
  handleSetAt?: string;
  email?: string;
  /** The version of the hosted terms this person accepted, and when; the app asks again when the version changes. */
  termsVersion?: string;
  termsAcceptedAt?: string;
}

export interface Store {
  manifest(sub: string): Promise<{ packs: PackMeta[]; sessions: SessionPointer[]; licenses: LicenseMeta[] }>;
  /** Null once the id is taken: a session is created once, by its owner. */
  createSession(meta: Omit<SessionMeta, "seq" | "createdAt" | "updatedAt">, at: string, ownerName: string | undefined, events: Record<string, unknown>[]): Promise<{ meta: SessionMeta; events: StoredEvent[] } | null>;
  getSession(id: string): Promise<{ meta: SessionMeta; members: SessionMember[] } | null>;
  eventsAfter(id: string, after: number): Promise<StoredEvent[]>;
  /**
   * Append in the server's order. Events whose ids are already in the log
   * are dropped, so a retry after a lost reply appends nothing twice. The
   * returned list is what was actually added, with their sequence numbers.
   */
  /**
   * Append a move. With `expectSeq`, only onto a log whose tail is that
   * number: a caller that folded the log at one moment and writes at
   * another (the bot, between two presses) must not write over a move
   * that landed in between. Throws `SeqConflict` when the tail has moved.
   */
  appendEvents(id: string, author: string, at: string, events: Record<string, unknown>[], opts?: { expectSeq?: number }): Promise<{ appended: StoredEvent[]; seq: number }>;
  updateSession(id: string, at: string, patch: { name?: string; endedAt?: string; publicTokenHash?: string | null; askKeyHash?: string | null; askPolicy?: AskPolicy }): Promise<SessionMeta | null>;
  /** What a stranger with the link sees of a run whose pack they may not hold: the owner's device writes it, redacted, after each move. */
  putSnapshot(id: string, at: string, snapshot: unknown): Promise<void>;
  getSnapshot(id: string): Promise<{ at: string; snapshot: unknown } | null>;
  /**
   * Someone with the live link takes a seat as a watcher on their own
   * account, so the run follows them like an invited one would. A member
   * already keeps the role they have. Null when the session is gone.
   */
  joinAsViewer(id: string, sub: string, name: string | undefined, at: string): Promise<{ role: Role } | null>;
  /** Seat a person as a player or a viewer; someone already at the table keeps the role they have. */
  joinAs(id: string, sub: string, role: "player" | "viewer", name: string | undefined, at: string): Promise<{ role: Role } | null>;
  /** The name a seat shows, brought up to date when its holder changes theirs; a seat that is not there is left alone. */
  setMemberName(sessionId: string, sub: string, name: string | undefined): Promise<void>;
  /** A reaction from whoever is watching; the last few are kept, newest last. */
  addReaction(id: string, reaction: Reaction): Promise<Reaction[]>;
  listReactions(id: string): Promise<Reaction[]>;
  /** An ask from outside; the last few are kept, newest last. */
  addAsk(id: string, ask: Ask): Promise<Ask[]>;
  listAsks(id: string): Promise<Ask[]>;
  /** The host's answer to one ask; the list as it stands, or null when there is no such ask. */
  answerAsk(id: string, askId: string, answer: "accepted" | "declined", at: string, reason?: string): Promise<Ask[] | null>;
  /** The owner ends it for everyone (a tombstone on every pointer); a member leaves. */
  deleteSession(id: string, sub: string, at: string): Promise<{ deletedAt: string } | { left: true } | null>;
  createInvite(invite: Invite): Promise<void>;
  getInvite(token: string): Promise<Invite | null>;
  listInvites(sessionId: string): Promise<Invite[]>;
  /** The invitations sent to an address, in every state; the caller filters. */
  invitesFor(email: string): Promise<Invite[]>;
  revokeInvite(sessionId: string, token: string): Promise<void>;
  /** Join: a member row, a pointer, and the people rows both ways. Idempotent for the same person. */
  acceptInvite(token: string, sub: string, name: string | undefined, email: string | undefined, at: string): Promise<{ sessionId: string } | null>;
  /** The owner removes a member; their pointer becomes a tombstone so their device drops the copy. */
  removeMember(sessionId: string, sub: string, at: string): Promise<boolean>;
  listPeople(sub: string): Promise<Person[]>;
  /** How many invitations this person sent in the current hour, after counting this one. */
  countInvite(sub: string, at: string): Promise<number>;
  /**
   * Put one of an account's stream keys in place, replacing whatever it
   * had. The old one stops working the moment this returns: a key is
   * regenerated exactly when its holder wants the old one dead.
   */
  setStreamKey(sub: string, kind: StreamKeyKind, hash: string, at: string): Promise<void>;
  /** Whose key this is, and which of the two; null for a key that is not one. */
  streamKeyOwner(hash: string): Promise<{ sub: string; kind: StreamKeyKind } | null>;
  /** What this account has, never the keys themselves: the server keeps only hashes. */
  streamKeys(sub: string): Promise<StreamKeys>;
  /** Kill one key. False when there was none to kill. */
  clearStreamKey(sub: string, kind: StreamKeyKind): Promise<boolean>;
  createApiKey(sub: string, key: ApiKey, hash: string): Promise<void>;
  listApiKeys(sub: string): Promise<ApiKey[]>;
  revokeApiKey(sub: string, id: string): Promise<boolean>;
  /** Who a presented key belongs to, by its hash; null for none or revoked. Stamps last use. */
  callerForApiKey(hash: string, at: string): Promise<{ sub: string; id: string; scope?: KeyScope } | null>;
  /** A nonce the CLI must sign to prove a signing key; ten minutes, one use. */
  issueNonce(sub: string, nonce: string, at: string): Promise<void>;
  takeNonce(sub: string, nonce: string): Promise<boolean>;
  claim(claim: Claim): Promise<void>;
  getClaim(fingerprint: string): Promise<Claim | null>;
  listClaims(sub: string): Promise<Claim[]>;
  unclaim(sub: string, fingerprint: string): Promise<boolean>;
  /** Read the profile, creating it on first sight; `lastSeenAt` is stamped either way. */
  touchProfile(sub: string, at: string, snapshot?: { name?: string; handle?: string; email?: string; termsVersion?: string }): Promise<Profile>;
  /** Read a profile without touching it: somebody else's, for the name they are shown as. */
  getProfile(sub: string): Promise<Profile | null>;
  /** The features Stripe says this person has; none until billing exists. */
  entitlements(sub: string): Promise<string[]>;
  /** Everything under the person: rows and objects. Returns how many rows went. */
  deleteUser(sub: string): Promise<number>;
  /**
   * A file of everything the account holds, written under the person and
   * handed back as a link that works for a quarter of an hour. Tagged so
   * the bucket throws it away the next day; deleting the account sweeps it
   * with the rest.
   */
  saveExport(sub: string, body: string, at: string): Promise<{ url: string; expiresAt: string }>;
  /** Null means never seen; a tombstone comes back with `deletedAt` and no body. */
  getPack(sub: string, id: string): Promise<{ meta: PackMeta; source: string } | null>;
  putPack(sub: string, meta: PackMeta, source: string): Promise<void>;
  deletePack(sub: string, id: string, at: string): Promise<PackMeta>;
  getLicense(sub: string, packId: string): Promise<{ meta: LicenseMeta; key: string } | null>;
  putLicense(sub: string, meta: LicenseMeta, key: string): Promise<void>;
  deleteLicense(sub: string, packId: string, at: string): Promise<LicenseMeta>;
}

const TOMBSTONE_DAYS = 30;

/** Seconds since the epoch, which is what DynamoDB's TTL reads. */
const expiresAfter = (at: string) => Math.floor(new Date(at).getTime() / 1000) + TOMBSTONE_DAYS * 86400;

const packKey = (sub: string, id: string, format: string) => `users/${sub}/packs/${id}.${format}`;

/** Ten digits: a billion events per session, sorted as text. */
const seqKey = (seq: number) => `EVENT#${String(seq).padStart(10, "0")}`;
/** Half of DynamoDB's hundred-item transaction limit: each event is two items. */
const APPEND_CHUNK = 50;

type Row = Record<string, unknown> & {
  pk: string;
  sk: string;
  kind:
    | "pack" | "run" | "license" | "profile" | "entitlements" | "session" | "member" | "event" | "seen" | "pointer"
    | "invite" | "person" | "counter" | "apikey" | "apikeyhash" | "nonce" | "signkey" | "claim";
  /** Where the body is in S3, for the kinds that have one. */
  key?: string;
  /** The license key itself, for a license row. Never in a manifest. */
  licenseKey?: string;
};

export function dynamoStore({ table, bucket }: { table: string; bucket: string }): Store {
  const ddb = DynamoDBDocumentClient.from(traced(new DynamoDBClient({})), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const s3 = traced(new S3Client({}));

  const pk = (sub: string) => `USER#${sub}`;

  const strip = (row: Row): Record<string, unknown> => {
    const { pk: _pk, sk: _sk, kind: _kind, key: _key, licenseKey: _license, expiresAt: _ttl, ...rest } = row;
    return rest;
  };

  async function get_(pkValue: string, sk: string): Promise<Row | null> {
    const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: pkValue, sk } }));
    return (out.Item as Row | undefined) ?? null;
  }
  const get = (sub: string, sk: string) => get_(pk(sub), sk);

  async function body(key: string): Promise<string> {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return (await out.Body?.transformToString()) ?? "";
  }

  async function tombstone(sub: string, sk: string, at: string, seed: Row): Promise<Row> {
    const existing = await get(sub, sk);
    const row: Row = {
      ...(existing ?? seed),
      pk: pk(sub),
      sk,
      updatedAt: at,
      deletedAt: existing?.["deletedAt"] ?? at,
      expiresAt: expiresAfter(at),
      bytes: 0,
    };
    // Idempotent: deleting what is already gone rewrites the same tombstone
    // and finds no object, and both of those are fine.
    delete row.key;
    delete row.licenseKey;
    await ddb.send(new PutCommand({ TableName: table, Item: row }));
    if (existing?.key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: existing.key }));
    }
    return row;
  }

  const store: Store & { getSessionRows(id: string): Promise<{ meta: SessionMeta; members: SessionMember[] } | null>; touchPointers(id: string, author: string, at: string, seq: number): Promise<void> } = {
    async getProfile(sub) {
      const row = await get(sub, "PROFILE");
      return row ? (strip(row) as unknown as Profile) : null;
    },

    async touchProfile(sub, at, snapshot = {}) {
      const existing = await get(sub, "PROFILE");
      const row: Row = {
        ...(existing ?? { createdAt: at }),
        pk: pk(sub),
        sk: "PROFILE",
        kind: "profile",
        lastSeenAt: at,
        ...(snapshot.name !== undefined ? { name: snapshot.name } : {}),
        ...(snapshot.handle !== undefined ? { handle: snapshot.handle, handleSetAt: at } : {}),
        ...(snapshot.email !== undefined ? { email: snapshot.email } : {}),
        ...(snapshot.termsVersion !== undefined ? { termsVersion: snapshot.termsVersion, termsAcceptedAt: at } : {}),
      };
      await ddb.send(new PutCommand({ TableName: table, Item: row }));
      return strip(row) as unknown as Profile;
    },

    async entitlements(sub) {
      const row = await get(sub, "ENTITLEMENTS");
      const features = row?.["features"];
      return Array.isArray(features) ? features.filter((f): f is string => typeof f === "string") : [];
    },

    async deleteUser(sub) {
      // What lives outside the partition but belongs to the person: the
      // hash rows of their keys, and the public claims on their signing
      // keys. Both go, or a deleted account could still act.
      for (const key of await store.listApiKeys(sub)) await store.revokeApiKey(sub, key.id);
      for (const c of await store.listClaims(sub)) await store.unclaim(sub, c.fingerprint);
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": pk(sub) },
          ProjectionExpression: "pk, sk",
        }),
      );
      const keys = (out.Items ?? []) as Array<{ pk: string; sk: string }>;
      // Twenty-five is the batch limit. A person has tens of rows, not
      // thousands, so this is a loop of one or two turns.
      for (let i = 0; i < keys.length; i += 25) {
        await ddb.send(
          new BatchWriteCommand({
            RequestItems: { [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) },
          }),
        );
      }
      // Objects are listed by prefix rather than from the rows, so an object
      // whose row was already a tombstone still goes.
      let token: string | undefined;
      do {
        const listed = await s3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: `users/${sub}/`, ContinuationToken: token }),
        );
        const objects = (listed.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (objects.length > 0) {
          await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
        }
        token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (token);
      return keys.length;
    },

    async saveExport(sub, body, at) {
      const key = `users/${sub}/exports/${at.replace(/[:.]/g, "-")}.json`;
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/json; charset=utf-8", Tagging: "runlog=export" }),
      );
      const seconds = 15 * 60;
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: `attachment; filename="runlog-export-${at.slice(0, 10)}.json"` }),
        { expiresIn: seconds },
      );
      return { url, expiresAt: new Date(Date.parse(at) + seconds * 1000).toISOString() };
    },

    async manifest(sub) {
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": pk(sub) },
        }),
      );
      const rows = (out.Items ?? []) as Row[];
      return {
        packs: rows.filter((r) => r.kind === "pack").map((r) => strip(r) as unknown as PackMeta),
        sessions: rows.filter((r) => r.kind === "pointer").map((r) => strip(r) as unknown as SessionPointer),
        licenses: rows.filter((r) => r.kind === "license").map((r) => strip(r) as unknown as LicenseMeta),
      };
    },

    async getPack(sub, id) {
      const row = await get(sub, `PACK#${id}`);
      if (!row) return null;
      const meta = strip(row) as unknown as PackMeta;
      if (meta.deletedAt || !row.key) return { meta, source: "" };
      return { meta, source: await body(row.key) };
    },

    async putPack(sub, meta, source) {
      const key = packKey(sub, meta.id, meta.format);
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: source, ContentType: "text/plain; charset=utf-8" }));
      await ddb.send(
        new PutCommand({
          TableName: table,
          Item: { ...meta, deletedAt: undefined, pk: pk(sub), sk: `PACK#${meta.id}`, kind: "pack", key },
        }),
      );
    },

    async deletePack(sub, id, at) {
      const row = await tombstone(sub, `PACK#${id}`, at, {
        pk: pk(sub), sk: `PACK#${id}`, kind: "pack", id, title: "", version: "", format: "yaml", filename: "", importedAt: at, hash: "",
      });
      return strip(row) as unknown as PackMeta;
    },


    async createSession(meta, at, ownerName, events) {
      const spk = `SESSION#${meta.id}`;
      const row: Row = { ...meta, pk: spk, sk: "META", kind: "session", createdAt: at, updatedAt: at, seq: 0 };
      try {
        await ddb.send(new PutCommand({ TableName: table, Item: row, ConditionExpression: "attribute_not_exists(pk)" }));
      } catch (error) {
        if ((error as { name?: string }).name === "ConditionalCheckFailedException") return null;
        throw error;
      }
      await ddb.send(
        new PutCommand({
          TableName: table,
          Item: { pk: spk, sk: `MEMBER#${meta.ownerSub}`, kind: "member", sub: meta.ownerSub, role: "owner", joinedAt: at, ...(ownerName ? { name: ownerName } : {}) },
        }),
      );
      const { appended, seq } = await store.appendEvents(meta.id, meta.ownerSub, at, events);
      const full = strip({ ...row, seq, updatedAt: at }) as unknown as SessionMeta;
      return { meta: full, events: appended };
    },

    async getSession(id) {
      return store.getSessionRows(id);
    },

    async getSessionRows(id: string) {
      // META and MEMBER# are the only keys under a session that begin with
      // "M"; EVENT#, SEEN# and INVITE# do not. (Not `sk < "EVENT#"`: both
      // sort after it, and that read returned nothing at all.)
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :m)",
          ExpressionAttributeValues: { ":pk": `SESSION#${id}`, ":m": "M" },
        }),
      );
      const rows = (out.Items ?? []) as Row[];
      const meta = rows.find((r) => r.sk === "META");
      if (!meta) return null;
      return {
        meta: strip(meta) as unknown as SessionMeta,
        members: rows.filter((r) => r.kind === "member").map((r) => strip(r) as unknown as SessionMember),
      };
    },

    async eventsAfter(id, after) {
      const out: StoredEvent[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        // Bounded on both sides, so the read stops at the last event rather
        // than walking on through the member, meta and seen rows.
        const page = await ddb.send(
          new QueryCommand({
            TableName: table,
            KeyConditionExpression: "pk = :pk AND sk BETWEEN :from AND :to",
            ExpressionAttributeValues: { ":pk": `SESSION#${id}`, ":from": seqKey(after + 1), ":to": seqKey(9_999_999_999) },
            ExclusiveStartKey: start,
          }),
        );
        for (const r of (page.Items ?? []) as Row[]) {
          if (r.kind === "event") out.push(r["e"] as StoredEvent);
        }
        start = page.LastEvaluatedKey;
      } while (start);
      return out;
    },

    async appendEvents(id, author, at, events, opts = {}) {
      const spk = `SESSION#${id}`;
      const appended: StoredEvent[] = [];
      let seq = 0;
      for (let i = 0; i < events.length; i += APPEND_CHUNK) {
        let chunk = events.slice(i, i + APPEND_CHUNK).filter((e) => typeof e["id"] === "string");
        // Two attempts: the first assumes nothing is a repeat; if the
        // transaction refuses because a SEEN row already exists, ask which
        // and go again with the rest. A retry after a lost reply is the
        // common case here, and it costs one failed transaction.
        for (let attempt = 0; attempt < 2 && chunk.length > 0; attempt++) {
          // The tail is reserved on the row itself, so where the caller
          // says where the tail should be, the reservation is refused when
          // it is not: nothing is written, and the caller reads again.
          const expected = opts.expectSeq;
          let reserved;
          try {
            reserved = await ddb.send(
              new UpdateCommand({
                TableName: table,
                Key: { pk: spk, sk: "META" },
                UpdateExpression: "ADD seq :n SET updatedAt = :at",
                ExpressionAttributeValues: { ":n": chunk.length, ":at": at, ...(expected !== undefined ? { ":expected": expected } : {}) },
                ...(expected !== undefined ? { ConditionExpression: expected === 0 ? "attribute_not_exists(seq) OR seq = :expected" : "seq = :expected" } : {}),
                ReturnValues: "UPDATED_NEW",
              }),
            );
          } catch (error) {
            if ((error as { name?: string }).name === "ConditionalCheckFailedException" && expected !== undefined) throw new SeqConflict(expected);
            throw error;
          }
          // Only the first chunk can be held to the caller's expectation; the rest follow it.
          opts = {};
          const tail = Number(reserved.Attributes?.["seq"] ?? 0);
          const base = tail - chunk.length;
          const stored: StoredEvent[] = chunk.map((e, k) => ({ ...e, id: String(e["id"]), seq: base + k + 1, author }));
          try {
            await ddb.send(
              new TransactWriteCommand({
                TransactItems: stored.flatMap((e) => [
                  {
                    Put: {
                      TableName: table,
                      Item: { pk: spk, sk: `SEEN#${e.id}`, kind: "seen", seq: e.seq },
                      ConditionExpression: "attribute_not_exists(pk)",
                    },
                  },
                  { Put: { TableName: table, Item: { pk: spk, sk: seqKey(e.seq), kind: "event", e } } },
                ]),
              }),
            );
            appended.push(...stored);
            seq = tail;
            chunk = [];
          } catch (error) {
            if ((error as { name?: string }).name !== "TransactionCanceledException") throw error;
            // Which were repeats? The SEEN rows say.
            const keep: Record<string, unknown>[] = [];
            for (const e of chunk) {
              const seen = await get_(spk, `SEEN#${String(e["id"])}`);
              if (!seen) keep.push(e);
            }
            chunk = keep;
            seq = tail;
          }
        }
      }
      if (appended.length > 0 || seq > 0) await store.touchPointers(id, author, at, seq);
      if (seq === 0) {
        const meta = await get_(spk, "META");
        seq = Number(meta?.["seq"] ?? 0);
      }
      return { appended, seq };
    },

    /** Every member's pointer row moves with the log, so their manifests notice. */
    async touchPointers(id: string, author: string, at: string, seq: number) {
      const found = await store.getSessionRows(id);
      if (!found) return;
      const { meta, members } = found;
      const pointer = (m: SessionMember): Row => ({
        pk: pk(m.sub), sk: `SESSION#${id}`, kind: "pointer",
        id, role: m.role, packId: meta.packId, packVersion: meta.packVersion, ownerSub: meta.ownerSub,
        ...(meta.packTitle ? { packTitle: meta.packTitle } : {}),
        ...(meta.name ? { name: meta.name } : {}), ...(meta.endedAt ? { endedAt: meta.endedAt } : {}),
        updatedAt: at, seq,
      });
      for (const m of members) await ddb.send(new PutCommand({ TableName: table, Item: pointer(m) }));
      // The one to open on a device with nothing active: whatever the author touched last.
      await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { pk: pk(author), sk: "PROFILE" },
          UpdateExpression: "SET currentSessionId = :id",
          ExpressionAttributeValues: { ":id": id },
        }),
      );
    },

    async updateSession(id, at, patch) {
      const spk = `SESSION#${id}`;
      const existing = await get_(spk, "META");
      if (!existing) return null;
      const row: Row = { ...existing, updatedAt: at, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.endedAt ? { endedAt: patch.endedAt } : {}) };
      if (patch.name === "") delete row["name"];
      if (patch.publicTokenHash === null) {
        delete row["publicTokenHash"];
        delete row["publicAt"];
      } else if (patch.publicTokenHash) {
        row["publicTokenHash"] = patch.publicTokenHash;
        row["publicAt"] = at;
      }
      if (patch.askKeyHash === null) {
        delete row["askKeyHash"];
        delete row["askPolicy"];
        delete row["askAt"];
      } else if (patch.askKeyHash) {
        row["askKeyHash"] = patch.askKeyHash;
        row["askAt"] = at;
      }
      if (patch.askPolicy && row["askKeyHash"]) row["askPolicy"] = patch.askPolicy;
      await ddb.send(new PutCommand({ TableName: table, Item: row }));
      const meta = strip(row) as unknown as SessionMeta;
      await store.touchPointers(id, meta.ownerSub, at, meta.seq);
      return meta;
    },

    async putSnapshot(id, at, snapshot) {
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `SESSION#${id}`, sk: "SNAPSHOT", kind: "snapshot", at, snapshot: JSON.stringify(snapshot) } }));
    },
    async getSnapshot(id) {
      const row = await get_(`SESSION#${id}`, "SNAPSHOT");
      if (!row || typeof row["snapshot"] !== "string") return null;
      try {
        return { at: String(row["at"] ?? ""), snapshot: JSON.parse(row["snapshot"]) as unknown };
      } catch {
        return null;
      }
    },

    async joinAsViewer(id, sub, name, at) {
      return store.joinAs(id, sub, "viewer", name, at);
    },

    async joinAs(id, sub, role, name, at) {
      const found = await store.getSessionRows(id);
      if (!found || found.meta.deletedAt) return null;
      const already = found.members.find((m) => m.sub === sub);
      if (already) return { role: already.role };
      await ddb.send(new PutCommand({ TableName: table, Item: {
        pk: `SESSION#${id}`, sk: `MEMBER#${sub}`, kind: "member", sub, role, joinedAt: at, ...(name ? { name } : {}),
      } }));
      await store.touchPointers(id, sub, at, found.meta.seq);
      return { role };
    },

    async setMemberName(sessionId, sub, name) {
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: `SESSION#${sessionId}`, sk: `MEMBER#${sub}` },
            ConditionExpression: "attribute_exists(pk)",
            ...(name
              ? { UpdateExpression: "SET #n = :n", ExpressionAttributeNames: { "#n": "name" }, ExpressionAttributeValues: { ":n": name } }
              : { UpdateExpression: "REMOVE #n", ExpressionAttributeNames: { "#n": "name" } }),
          }),
        );
      } catch (error) {
        if ((error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
      }
    },

    async addReaction(id, reaction) {
      const kept = [...(await store.listReactions(id)), reaction].slice(-REACTIONS_KEPT);
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `SESSION#${id}`, sk: "REACTIONS", kind: "reactions", reactions: JSON.stringify(kept), expiresAt: expiresAfter(reaction.at) } }));
      return kept;
    },
    async listReactions(id) {
      const row = await get_(`SESSION#${id}`, "REACTIONS");
      if (!row || typeof row["reactions"] !== "string") return [];
      try {
        const parsed = JSON.parse(row["reactions"]) as unknown;
        return Array.isArray(parsed) ? (parsed as Reaction[]) : [];
      } catch {
        return [];
      }
    },
    async addAsk(id, ask) {
      const kept = [...(await store.listAsks(id)), ask].slice(-ASKS_KEPT);
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `SESSION#${id}`, sk: "ASKS", kind: "asks", asks: JSON.stringify(kept), expiresAt: expiresAfter(ask.at) } }));
      return kept;
    },
    async listAsks(id) {
      const row = await get_(`SESSION#${id}`, "ASKS");
      if (!row || typeof row["asks"] !== "string") return [];
      try {
        const parsed = JSON.parse(row["asks"]) as unknown;
        return Array.isArray(parsed) ? (parsed as Ask[]) : [];
      } catch {
        return [];
      }
    },
    async answerAsk(id, askId, answer, at, reason) {
      const asks = await store.listAsks(id);
      const found = asks.find((a) => a.id === askId);
      if (!found) return null;
      const kept = asks.map((a) => (a.id === askId ? { ...a, answer, answeredAt: at, ...(reason ? { reason } : {}) } : a));
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `SESSION#${id}`, sk: "ASKS", kind: "asks", asks: JSON.stringify(kept), expiresAt: expiresAfter(at) } }));
      return kept;
    },

    async deleteSession(id, sub, at) {
      const found = await store.getSessionRows(id);
      if (!found) return null;
      const me = found.members.find((m) => m.sub === sub);
      if (!me) return null;
      const spk = `SESSION#${id}`;
      if (me.role !== "owner") {
        await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: [
          { DeleteRequest: { Key: { pk: spk, sk: `MEMBER#${sub}` } } },
          { DeleteRequest: { Key: { pk: pk(sub), sk: `SESSION#${id}` } } },
        ] } }));
        return { left: true };
      }
      // The owner: META and every pointer become tombstones, so each
      // member's next manifest carries the deletion; the events stay
      // until the tombstones expire, then a sweep can take them.
      await ddb.send(new PutCommand({ TableName: table, Item: { ...(await get_(spk, "META")), deletedAt: at, updatedAt: at, expiresAt: expiresAfter(at) } }));
      for (const m of found.members) {
        await ddb.send(new PutCommand({ TableName: table, Item: {
          pk: pk(m.sub), sk: `SESSION#${id}`, kind: "pointer", id, role: m.role, packId: found.meta.packId, packVersion: found.meta.packVersion,
          ownerSub: found.meta.ownerSub, updatedAt: at, seq: found.meta.seq, deletedAt: at, expiresAt: expiresAfter(at),
        } }));
      }
      return { deletedAt: at };
    },

    async createInvite(invite) {
      const ttl = Math.floor(new Date(invite.expiresAt).getTime() / 1000);
      // Three times: under its own token for the link, under the session
      // for the owner's list, and under the address for the invitee's own
      // list in the app. All expire with the invite.
      const item = { ...invite, expiresAtIso: invite.expiresAt, expiresAt: ttl, kind: "invite" as const };
      await ddb.send(new PutCommand({ TableName: table, Item: { ...item, pk: `INVITE#${invite.token}`, sk: "INVITE" } }));
      await ddb.send(new PutCommand({ TableName: table, Item: { ...item, pk: `SESSION#${invite.sessionId}`, sk: `INVITE#${invite.token}` } }));
      await ddb.send(new PutCommand({ TableName: table, Item: { ...item, pk: `EMAIL#${invite.email.toLowerCase()}`, sk: `INVITE#${invite.token}` } }));
    },

    async getInvite(token) {
      const row = await get_(`INVITE#${token}`, "INVITE");
      if (!row) return null;
      const { expiresAt: _ttl, expiresAtIso, ...rest } = strip(row);
      return { ...rest, expiresAt: String(expiresAtIso ?? "") } as unknown as Invite;
    },

    async listInvites(sessionId) {
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :invite)",
          ExpressionAttributeValues: { ":pk": `SESSION#${sessionId}`, ":invite": "INVITE#" },
        }),
      );
      return ((out.Items ?? []) as Row[]).map((r) => {
        const { expiresAt: _ttl, expiresAtIso, ...rest } = strip(r);
        return { ...rest, expiresAt: String(expiresAtIso ?? "") } as unknown as Invite;
      });
    },

    async invitesFor(email) {
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :invite)",
          ExpressionAttributeValues: { ":pk": `EMAIL#${email.toLowerCase()}`, ":invite": "INVITE#" },
        }),
      );
      return ((out.Items ?? []) as Row[]).map((r) => {
        const { expiresAt: _ttl, expiresAtIso, ...rest } = strip(r);
        return { ...rest, expiresAt: String(expiresAtIso ?? "") } as unknown as Invite;
      });
    },

    async revokeInvite(sessionId, token) {
      const invite = await store.getInvite(token);
      await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: [
        { DeleteRequest: { Key: { pk: `INVITE#${token}`, sk: "INVITE" } } },
        { DeleteRequest: { Key: { pk: `SESSION#${sessionId}`, sk: `INVITE#${token}` } } },
        // An invitation from before the address row existed has none to delete; a delete of a missing key is nothing.
        ...(invite ? [{ DeleteRequest: { Key: { pk: `EMAIL#${invite.email.toLowerCase()}`, sk: `INVITE#${token}` } } }] : []),
      ] } }));
    },

    async acceptInvite(token, sub, name, email, at) {
      const invite = await store.getInvite(token);
      if (!invite || invite.acceptedBy && invite.acceptedBy !== sub) return null;
      const found = await store.getSessionRows(invite.sessionId);
      if (!found || found.meta.deletedAt) return null;
      const spk = `SESSION#${invite.sessionId}`;
      if (!found.members.some((m) => m.sub === sub)) {
        await ddb.send(new PutCommand({ TableName: table, Item: {
          pk: spk, sk: `MEMBER#${sub}`, kind: "member", sub, role: invite.role, joinedAt: at, ...(name ? { name } : {}),
        } }));
      }
      // The invite is spent, but stays readable so a second open of the
      // same link by the same person lands them in the session again.
      for (const key of [{ pk: `INVITE#${token}`, sk: "INVITE" }, { pk: spk, sk: `INVITE#${token}` }, { pk: `EMAIL#${invite.email.toLowerCase()}`, sk: `INVITE#${token}` }]) {
        await ddb.send(new UpdateCommand({
          TableName: table, Key: key,
          UpdateExpression: "SET acceptedBy = :sub, acceptedAt = :at",
          ExpressionAttributeValues: { ":sub": sub, ":at": at },
        }));
      }
      // People rows both ways: everyone already here has now played with
      // the newcomer, and the newcomer with each of them.
      const me: Person = { sub, lastPlayedAt: at, ...(name ? { name } : {}), ...(email ? { email } : {}) };
      for (const m of found.members) {
        if (m.sub === sub) continue;
        await ddb.send(new PutCommand({ TableName: table, Item: { ...me, pk: pk(m.sub), sk: `PERSON#${sub}`, kind: "person" } }));
        await ddb.send(new PutCommand({ TableName: table, Item: {
          sub: m.sub, lastPlayedAt: at, ...(m.name ? { name: m.name } : {}), pk: pk(sub), sk: `PERSON#${m.sub}`, kind: "person",
        } }));
      }
      await store.touchPointers(invite.sessionId, sub, at, found.meta.seq);
      return { sessionId: invite.sessionId };
    },

    async removeMember(sessionId, sub, at) {
      const found = await store.getSessionRows(sessionId);
      const member = found?.members.find((m) => m.sub === sub);
      if (!found || !member || member.role === "owner") return false;
      await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: `SESSION#${sessionId}`, sk: `MEMBER#${sub}` } }));
      await ddb.send(new PutCommand({ TableName: table, Item: {
        pk: pk(sub), sk: `SESSION#${sessionId}`, kind: "pointer", id: sessionId, role: member.role, packId: found.meta.packId,
        packVersion: found.meta.packVersion, ownerSub: found.meta.ownerSub, updatedAt: at, seq: found.meta.seq, deletedAt: at, expiresAt: expiresAfter(at),
      } }));
      return true;
    },

    async listPeople(sub) {
      const out = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :person)",
          ExpressionAttributeValues: { ":pk": pk(sub), ":person": "PERSON#" },
        }),
      );
      return ((out.Items ?? []) as Row[]).map((r) => strip(r) as unknown as Person);
    },

    async countInvite(sub, at) {
      const hour = at.slice(0, 13);
      const out = await ddb.send(new UpdateCommand({
        TableName: table,
        Key: { pk: pk(sub), sk: `COUNT#invites#${hour}` },
        UpdateExpression: "ADD n :one SET kind = :kind, expiresAt = :ttl",
        ExpressionAttributeValues: { ":one": 1, ":kind": "counter", ":ttl": Math.floor(new Date(at).getTime() / 1000) + 2 * 3600 },
        ReturnValues: "UPDATED_NEW",
      }));
      return Number(out.Attributes?.["n"] ?? 1);
    },

    async setStreamKey(sub, kind, hash, at) {
      const had = await get(sub, `STREAMKEY#${kind}`);
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: pk(sub), sk: `STREAMKEY#${kind}`, kind: "streamkey", which: kind, hash, madeAt: at } }));
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `STREAMKEY#${hash}`, sk: "KEY", kind: "streamkeyhash", sub, which: kind } }));
      // The one it replaced stops opening anything, rather than lingering as a second way in.
      if (had && String(had["hash"]) !== hash) await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: `STREAMKEY#${String(had["hash"])}`, sk: "KEY" } }));
    },

    async streamKeyOwner(hash) {
      const row = await get_(`STREAMKEY#${hash}`, "KEY");
      if (!row) return null;
      const which = row["which"];
      if (which !== "watch" && which !== "press") return null;
      return { sub: String(row["sub"]), kind: which };
    },

    async streamKeys(sub) {
      const out = await ddb.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :k)",
        ExpressionAttributeValues: { ":pk": pk(sub), ":k": "STREAMKEY#" },
      }));
      const keys: StreamKeys = {};
      for (const row of (out.Items ?? []) as Row[]) {
        const which = row["which"];
        if (which === "watch" || which === "press") keys[which] = { madeAt: String(row["madeAt"] ?? "") };
      }
      return keys;
    },

    async clearStreamKey(sub, kind) {
      const row = await get(sub, `STREAMKEY#${kind}`);
      if (!row) return false;
      await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: [
        { DeleteRequest: { Key: { pk: pk(sub), sk: `STREAMKEY#${kind}` } } },
        { DeleteRequest: { Key: { pk: `STREAMKEY#${String(row["hash"])}`, sk: "KEY" } } },
      ] } }));
      return true;
    },

    async createApiKey(sub, key, hash) {
      await ddb.send(new PutCommand({ TableName: table, Item: { ...key, pk: pk(sub), sk: `APIKEY#${key.id}`, kind: "apikey", hash } }));
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `APIKEY#${hash}`, sk: "KEY", kind: "apikeyhash", sub, id: key.id } }));
    },

    async listApiKeys(sub) {
      const out = await ddb.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :k)",
        ExpressionAttributeValues: { ":pk": pk(sub), ":k": "APIKEY#" },
      }));
      return ((out.Items ?? []) as Row[]).map((r) => {
        const { hash: _h, ...rest } = strip(r);
        return rest as unknown as ApiKey;
      });
    },

    async revokeApiKey(sub, id) {
      const row = await get(sub, `APIKEY#${id}`);
      if (!row) return false;
      await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: [
        { DeleteRequest: { Key: { pk: pk(sub), sk: `APIKEY#${id}` } } },
        { DeleteRequest: { Key: { pk: `APIKEY#${String(row["hash"])}`, sk: "KEY" } } },
      ] } }));
      return true;
    },

    async callerForApiKey(hash, at) {
      const row = await get_(`APIKEY#${hash}`, "KEY");
      if (!row) return null;
      const sub = String(row["sub"]);
      const id = String(row["id"]);
      // Last use, at most once a minute: a CLI in a loop should not write a row per call.
      const owner = await get(sub, `APIKEY#${id}`);
      if (!owner) return null;
      const last = typeof owner["lastUsedAt"] === "string" ? owner["lastUsedAt"] : "";
      if (at.slice(0, 16) !== last.slice(0, 16)) {
        await ddb.send(new UpdateCommand({
          TableName: table, Key: { pk: pk(sub), sk: `APIKEY#${id}` },
          UpdateExpression: "SET lastUsedAt = :at", ExpressionAttributeValues: { ":at": at },
        }));
      }
      const scope = owner["scope"] === "release" ? "release" : undefined;
      return { sub, id, ...(scope ? { scope } : {}) };
    },

    async issueNonce(sub, nonce, at) {
      await ddb.send(new PutCommand({ TableName: table, Item: {
        pk: pk(sub), sk: `NONCE#${nonce}`, kind: "nonce", createdAt: at, expiresAt: Math.floor(new Date(at).getTime() / 1000) + 600,
      } }));
    },

    async takeNonce(sub, nonce) {
      try {
        await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: pk(sub), sk: `NONCE#${nonce}` }, ConditionExpression: "attribute_exists(pk)" }));
        return true;
      } catch (error) {
        if ((error as { name?: string }).name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },

    async claim(c) {
      await ddb.send(new PutCommand({ TableName: table, Item: { ...c, pk: pk(c.sub), sk: `SIGNKEY#${c.fingerprint}`, kind: "signkey" } }));
      await ddb.send(new PutCommand({ TableName: table, Item: { ...c, pk: `AUTHOR#${c.fingerprint}`, sk: "CLAIM", kind: "claim" } }));
    },

    async getClaim(fingerprint) {
      const row = await get_(`AUTHOR#${fingerprint}`, "CLAIM");
      return row ? (strip(row) as unknown as Claim) : null;
    },

    async listClaims(sub) {
      const out = await ddb.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :k)",
        ExpressionAttributeValues: { ":pk": pk(sub), ":k": "SIGNKEY#" },
      }));
      return ((out.Items ?? []) as Row[]).map((r) => strip(r) as unknown as Claim);
    },

    async unclaim(sub, fingerprint) {
      const row = await get(sub, `SIGNKEY#${fingerprint}`);
      if (!row) return false;
      await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: [
        { DeleteRequest: { Key: { pk: pk(sub), sk: `SIGNKEY#${fingerprint}` } } },
        { DeleteRequest: { Key: { pk: `AUTHOR#${fingerprint}`, sk: "CLAIM" } } },
      ] } }));
      return true;
    },

    async getLicense(sub, packId) {
      const row = await get(sub, `LICENSE#${packId}`);
      if (!row) return null;
      const meta = strip(row) as unknown as LicenseMeta;
      return { meta, key: meta.deletedAt ? "" : (row.licenseKey ?? "") };
    },

    async putLicense(sub, meta, key) {
      await ddb.send(
        new PutCommand({
          TableName: table,
          Item: { ...meta, deletedAt: undefined, pk: pk(sub), sk: `LICENSE#${meta.id}`, kind: "license", licenseKey: key },
        }),
      );
    },

    async deleteLicense(sub, packId, at) {
      const row = await tombstone(sub, `LICENSE#${packId}`, at, {
        pk: pk(sub), sk: `LICENSE#${packId}`, kind: "license", id: packId, hash: "",
      });
      const { bytes: _bytes, ...meta } = strip(row);
      return meta as unknown as LicenseMeta;
    },
  };
  return store;
}
