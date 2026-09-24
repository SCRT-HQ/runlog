import { parseThemeRecord, type ThemeRecordV1 } from "./records.ts";
import { invalid, isPositiveSafeInteger, readDataRecord, valid, type ThemeValidationResult } from "./validation.ts";

/** What one account may keep and how fast it may change it. The server enforces these; the app words its states by them. */
export const THEME_SYNC_LIMITS = Object.freeze({ maxThemes: 200, writesPerMinute: 30, maxRecordBytes: 65_536, pageSize: 50 });

export const THEME_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export interface RemoteLiveThemeV1 {
  readonly state: "live";
  readonly id: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly record: ThemeRecordV1;
}

export interface RemoteDeletedThemeV1 {
  readonly state: "deleted";
  readonly id: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly deletedAt: string;
}

/** A saved theme as the account holds it: the portable record plus the revision only the server assigns. */
export type RemoteThemeV1 = RemoteLiveThemeV1 | RemoteDeletedThemeV1;

export type ThemeRejectCode =
  "invalid-theme" | "id-mismatch" | "key-required" | "key-reused" | "library-full" | "invalid-query" | "precondition-required";

const isTime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

export function parseRemoteTheme(input: unknown): ThemeValidationResult<RemoteThemeV1> {
  const head = readDataRecord(
    input,
    "$",
    ["state", "id", "revision", "updatedAt", "deletedAt", "record"],
    ["state", "id", "revision", "updatedAt"],
  );
  if (!head.ok) return head;
  const { state, id, revision, updatedAt } = head.value;
  if (typeof id !== "string" || !THEME_ID_PATTERN.test(id)) return invalid("$.id", "Expected a theme id");
  if (!isPositiveSafeInteger(revision)) return invalid("$.revision", "Expected a positive safe integer");
  if (!isTime(updatedAt)) return invalid("$.updatedAt", "Expected a time");
  if (state === "deleted") {
    if (Object.hasOwn(head.value, "record")) return invalid("$.record", "A deleted theme has no record");
    const deletedAt = head.value["deletedAt"];
    if (!isTime(deletedAt)) return invalid("$.deletedAt", "Expected a time");
    return valid(Object.freeze({ state: "deleted", id, revision, updatedAt, deletedAt }));
  }
  if (state !== "live") return invalid("$.state", "Expected live or deleted");
  if (Object.hasOwn(head.value, "deletedAt")) return invalid("$.deletedAt", "A live theme has no deletedAt");
  const record = parseThemeRecord(head.value["record"]);
  if (!record.ok) return record;
  if (record.value.id !== id) return invalid("$.record.id", "Expected the record id to match the theme id");
  return valid(Object.freeze({ state: "live", id, revision, updatedAt, record: record.value }));
}

export function themeRecordBytes(record: ThemeRecordV1): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

/** JSON with object keys sorted at every depth, so equal data always has equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** What a person sees of a theme: its name, base and overrides. Not its id, not this device's content revision. */
export function themeContentKey(record: ThemeRecordV1): string {
  return canonicalJson({ name: record.name, base: record.base, overrides: record.overrides });
}

export function sameThemeContent(a: ThemeRecordV1, b: ThemeRecordV1): boolean {
  return themeContentKey(a) === themeContentKey(b);
}
