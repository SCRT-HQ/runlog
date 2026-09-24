import { IDEMPOTENCY_KEY_PATTERN, parseThemeRecord, THEME_ID_PATTERN, type ThemeRecordV1 } from "@runlog/themes";

export type ThemeHold = "library-full" | "invalid" | "retry-exhausted";
export type ThemeMutationBase =
  { readonly kind: "none" } | { readonly kind: "revision"; readonly revision: number } | { readonly kind: "previous" };
export interface ThemeMutationV1 {
  readonly seq: number;
  readonly themeId: string;
  readonly op: "put" | "delete";
  readonly record: ThemeRecordV1 | null;
  readonly base: ThemeMutationBase;
  readonly key: string;
  /** Set the first time the entry is handed to the server, and never cleared: it may have been applied. */
  readonly sent: boolean;
  readonly attempts: number;
  readonly notBefore: number;
  readonly hold: ThemeHold | null;
}
export interface ThemeRemoteRow {
  readonly id: string;
  readonly revision: number;
  readonly state: "live" | "deleted";
}
export type LocalThemeChange = { readonly op: "put"; readonly record: ThemeRecordV1 } | { readonly op: "delete"; readonly id: string };
export type OutboxPlan =
  | { readonly kind: "append"; readonly entry: Omit<ThemeMutationV1, "seq"> }
  | { readonly kind: "replace"; readonly seq: number; readonly entry: Omit<ThemeMutationV1, "seq"> }
  | { readonly kind: "drop"; readonly seqs: readonly number[] }
  | { readonly kind: "none" };

const HOLDS: ReadonlySet<string> = new Set(["library-full", "invalid", "retry-exhausted"]);
const REFUSED: ReadonlySet<ThemeHold | null> = new Set<ThemeHold | null>(["library-full", "invalid"]);

/** Never handed to the server and not held: nothing outside this device knows of it. */
const unsent = (e: ThemeMutationV1) => !e.sent && e.hold === null;
/** Unsent, or refused: the server did not apply it under its key, so a delete may take its place. */
const notReached = (e: ThemeMutationV1) => unsent(e) || REFUSED.has(e.hold);

function fresh(
  themeId: string,
  op: "put" | "delete",
  record: ThemeRecordV1 | null,
  base: ThemeMutationBase,
  key: string,
): Omit<ThemeMutationV1, "seq"> {
  return { themeId, op, record, base, key, sent: false, attempts: 0, notBefore: 0, hold: null };
}

export function planLocalChange({
  queued,
  remote,
  change,
  newKey,
}: {
  queued: readonly ThemeMutationV1[];
  remote: ThemeRemoteRow | null;
  change: LocalThemeChange;
  newKey: () => string;
}): OutboxPlan {
  const themeId = change.op === "put" ? change.record.id : change.id;
  const mine = [...queued].filter((e) => e.themeId === themeId).sort((a, b) => a.seq - b.seq);
  const last = mine.at(-1);
  const fromRemote: ThemeMutationBase =
    remote !== null && remote.state === "live" ? { kind: "revision", revision: remote.revision } : { kind: "none" };

  if (change.op === "put") {
    if (last !== undefined && last.op === "put" && (unsent(last) || REFUSED.has(last.hold))) {
      const key = unsent(last) ? last.key : newKey();
      return { kind: "replace", seq: last.seq, entry: fresh(themeId, "put", change.record, last.base, key) };
    }
    if (last !== undefined) return { kind: "append", entry: fresh(themeId, "put", change.record, { kind: "previous" }, newKey()) };
    return { kind: "append", entry: fresh(themeId, "put", change.record, fromRemote, newKey()) };
  }

  if (last === undefined) {
    return fromRemote.kind === "revision"
      ? { kind: "append", entry: fresh(themeId, "delete", null, fromRemote, newKey()) }
      : { kind: "none" };
  }
  const noneReached = mine.every(notReached);
  if (noneReached && mine[0]!.base.kind === "none") return { kind: "drop", seqs: mine.map((e) => e.seq) };
  if (mine.length === 1 && noneReached && last.base.kind === "revision") {
    return { kind: "replace", seq: last.seq, entry: fresh(themeId, "delete", null, last.base, newKey()) };
  }
  return { kind: "append", entry: fresh(themeId, "delete", null, { kind: "previous" }, newKey()) };
}

function fail(message: string): never {
  throw new TypeError(`Invalid theme outbox entry: ${message}`);
}
const whole = (v: unknown, min: number) => Number.isSafeInteger(v) && (v as number) >= min;

function parseBase(input: unknown): ThemeMutationBase {
  if (typeof input !== "object" || input === null) return fail("base");
  const base = input as Record<string, unknown>;
  if (base["kind"] === "none" || base["kind"] === "previous") return { kind: base["kind"] };
  if (base["kind"] === "revision" && whole(base["revision"], 1)) return { kind: "revision", revision: base["revision"] as number };
  return fail("base");
}

export function parseMutation(input: unknown): ThemeMutationV1 {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("shape");
  const row = input as Record<string, unknown>;
  const allowed = new Set(["seq", "themeId", "op", "record", "base", "key", "sent", "attempts", "notBefore", "hold"]);
  if (Object.keys(row).some((k) => !allowed.has(k))) return fail("field");
  if (!whole(row["seq"], 1)) return fail("seq");
  if (typeof row["themeId"] !== "string" || !THEME_ID_PATTERN.test(row["themeId"])) return fail("themeId");
  if (row["op"] !== "put" && row["op"] !== "delete") return fail("op");
  if (typeof row["key"] !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(row["key"])) return fail("key");
  if (typeof row["sent"] !== "boolean") return fail("sent");
  if (!whole(row["attempts"], 0) || !whole(row["notBefore"], 0)) return fail("attempts");
  if (row["hold"] !== null && !(typeof row["hold"] === "string" && HOLDS.has(row["hold"]))) return fail("hold");
  let record: ThemeRecordV1 | null = null;
  if (row["op"] === "put") {
    const parsed = parseThemeRecord(row["record"]);
    if (!parsed.ok || parsed.value.id !== row["themeId"]) return fail("record");
    record = parsed.value;
  } else if (row["record"] !== null) return fail("record");
  const base = parseBase(row["base"]);
  if (row["op"] === "delete" && base.kind === "none") return fail("a delete needs a base");
  return Object.freeze({
    seq: row["seq"] as number,
    themeId: row["themeId"],
    op: row["op"],
    record,
    base,
    key: row["key"],
    sent: row["sent"],
    attempts: row["attempts"] as number,
    notBefore: row["notBefore"] as number,
    hold: row["hold"] as ThemeHold | null,
  });
}

export function parseRemoteRow(input: unknown): ThemeRemoteRow {
  if (typeof input !== "object" || input === null) return fail("remote row");
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some((k) => k !== "id" && k !== "revision" && k !== "state")) return fail("remote row field");
  if (typeof row["id"] !== "string" || !THEME_ID_PATTERN.test(row["id"])) return fail("remote id");
  if (!whole(row["revision"], 1)) return fail("remote revision");
  if (row["state"] !== "live" && row["state"] !== "deleted") return fail("remote state");
  return Object.freeze({ id: row["id"], revision: row["revision"] as number, state: row["state"] });
}
