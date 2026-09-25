import { parsePresentationSnapshot, presentationSnapshotKey, type PresentationSnapshotV1 } from "./snapshot.ts";
import { invalid, isIsoInstant, isPositiveSafeInteger, readDataRecord, valid, type ThemeValidationResult } from "./validation.ts";

/**
 * A theme link: one device publishes the look it applies, and widgets
 * anywhere read it by a key in their address. These are the limits the
 * server enforces and the app words its states by.
 */
export const LOOK_CHANNEL_LIMITS = Object.freeze({ maxRequestBytes: 4096, publishesPerMinute: 30, maxChannels: 10 });

/** Made by the server: `lk_` and 12 random bytes. Never `public`, which is a route of its own. */
export const LOOK_CHANNEL_ID_PATTERN = /^lk_[A-Za-z0-9_-]{16}$/;
/** 24 random bytes, base64url: what a widget address carries after `#ch=`. */
export const LOOK_READ_KEY_PATTERN = /^[A-Za-z0-9_-]{32}$/;
/** 32 random bytes, base64url: what only the publishing device holds. */
export const LOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** The read key travels in this header, never in a URL. */
export const LOOK_READ_HEADER = "x-runlog-look";
/** The publisher secret travels in this header, never in a URL. */
export const LOOK_PUBLISHER_HEADER = "x-runlog-publisher";

/** What a widget may learn from a theme link: the look and its revision. No theme, no link id, no account, no time. */
export interface PublicLookV1 {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly snapshot: PresentationSnapshotV1;
}

/** What the owner sees of one of their links. The read key and the secret are never part of it. */
export interface LookChannelSummaryV1 {
  readonly id: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export type LookRejectCode =
  | "invalid-look"
  | "secret-required"
  | "precondition-required"
  | "not-publisher"
  | "stale-revision"
  | "channel-limit"
  | "rate-limited"
  | "gone"
  | "signed-in-only";

export function parsePublicLook(input: unknown): ThemeValidationResult<PublicLookV1> {
  const keys = ["schemaVersion", "revision", "snapshot"];
  const head = readDataRecord(input, "$", keys, keys);
  if (!head.ok) return head;
  if (head.value["schemaVersion"] !== 1) return invalid("$.schemaVersion", "Unsupported schema version");
  const revision = head.value["revision"];
  if (!isPositiveSafeInteger(revision)) return invalid("$.revision", "Expected a positive safe integer");
  const snapshot = parsePresentationSnapshot(head.value["snapshot"]);
  if (!snapshot.ok) return snapshot;
  return valid(Object.freeze({ schemaVersion: 1, revision, snapshot: snapshot.value }));
}

export function parseLookChannelSummary(input: unknown): ThemeValidationResult<LookChannelSummaryV1> {
  const keys = ["id", "revision", "createdAt", "updatedAt", "publishedAt"];
  const head = readDataRecord(input, "$", keys, keys);
  if (!head.ok) return head;
  const { id, revision, createdAt, updatedAt, publishedAt } = head.value;
  if (typeof id !== "string" || !LOOK_CHANNEL_ID_PATTERN.test(id)) return invalid("$.id", "Expected a theme link id");
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return invalid("$.revision", "Expected a revision");
  if (!isIsoInstant(createdAt)) return invalid("$.createdAt", "Expected a time");
  if (!isIsoInstant(updatedAt)) return invalid("$.updatedAt", "Expected a time");
  if (publishedAt !== null && !isIsoInstant(publishedAt)) return invalid("$.publishedAt", "Expected a time or null");
  return valid(Object.freeze({ id, revision: revision as number, createdAt, updatedAt, publishedAt }));
}

/** The size a snapshot is stored and served at: its canonical JSON, in UTF-8 bytes. */
export function lookSnapshotBytes(snapshot: PresentationSnapshotV1): number {
  return new TextEncoder().encode(presentationSnapshotKey(snapshot)).byteLength;
}
