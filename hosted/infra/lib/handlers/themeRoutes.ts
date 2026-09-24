import { createHash } from "node:crypto";
import {
  canonicalJson,
  IDEMPOTENCY_KEY_PATTERN,
  parseThemeRecord,
  THEME_ID_PATTERN,
  THEME_SYNC_LIMITS,
  themeRecordBytes,
  type ThemeRecordV1,
} from "@runlog/themes";
import type { ThemeExpectation, ThemeStore } from "./themes.js";

/** One request to the theme routes, already past sign-in: `sub` is the caller and nothing else names an owner. */
export interface ThemeRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string | undefined>>;
  header(name: string): string | undefined;
  readonly body: unknown;
  /** The request body's size before parsing. */
  readonly bytes: number;
  readonly sub: string;
  readonly at: string;
}
export interface ThemeAnswer {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}
/** What a metric may say about a write: its category and the revision, never the theme. */
export interface ThemeOutcome {
  readonly outcome: "written" | "replayed" | "conflict" | "library-full" | "rate-limited" | "invalid" | "busy";
  readonly revision?: number;
}

const answer = (status: number, body: Record<string, unknown>, headers?: Record<string, string>): ThemeAnswer => ({
  status,
  body,
  ...(headers ? { headers } : {}),
});
const GONE = answer(410, { error: "no such route" });
const MAX = THEME_SYNC_LIMITS.maxRecordBytes;
/** Seconds a caller waits after two writes to one account met in the same instant. */
export const BUSY_RETRY_SECONDS = 1;

export const encodeCursor = (id: string) => Buffer.from(id, "utf8").toString("base64url");
export function decodeCursor(text: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(text)) return null;
  const id = Buffer.from(text, "base64url").toString("utf8");
  return THEME_ID_PATTERN.test(id) ? id : null;
}

function expectationOf(method: string, ifMatch: string | undefined, ifNoneMatch: string | undefined): ThemeExpectation | null {
  if (ifMatch !== undefined && ifNoneMatch !== undefined) return null;
  if (ifNoneMatch !== undefined) return method === "PUT" && ifNoneMatch.trim() === "*" ? { kind: "absent" } : null;
  if (ifMatch === undefined) return null;
  const text = ifMatch.trim().replace(/^"|"$/g, "");
  if (!/^\d{1,15}$/.test(text)) return null;
  const revision = Number(text);
  return Number.isSafeInteger(revision) && revision > 0 ? { kind: "revision", revision } : null;
}

/**
 * Two writes to one account in the same instant: DynamoDB cancels one
 * transaction with a TransactionConflict. Nothing was written, and the same
 * request sent again a moment later lands or meets the other write's revision.
 */
export function isWriteConflict(error: unknown): boolean {
  if ((error as { name?: string } | null)?.name !== "TransactionCanceledException") return false;
  const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons ?? [];
  return reasons.some((r) => r.Code === "TransactionConflict");
}

const revisionOf = (body: Record<string, unknown>): number | undefined => {
  const revision = (body["theme"] as { revision?: unknown } | null | undefined)?.revision;
  return typeof revision === "number" ? revision : undefined;
};

export async function themeRoute(
  req: ThemeRequest,
  store: ThemeStore,
  seen: (outcome: ThemeOutcome) => void = () => {},
): Promise<ThemeAnswer> {
  if (req.path === "/api/themes") {
    if (req.method !== "GET") return GONE;
    const since = req.query["since"];
    const after = req.query["after"];
    const cursor = after === undefined ? undefined : decodeCursor(after);
    if (cursor === null) return answer(422, { error: "after: the cursor a page gave", code: "invalid-query" });
    let sinceRevision: number | undefined;
    if (since !== undefined) {
      sinceRevision = Number(since);
      if (!/^\d{1,15}$/.test(since) || !Number.isSafeInteger(sinceRevision))
        return answer(422, { error: "since: a library revision", code: "invalid-query" });
    }
    // The head first: anything written between the head and the pages makes
    // the next ask list again, never skip.
    const head = await store.head(req.sub);
    const shape = { libraryRevision: head.libraryRevision, live: head.live, limit: THEME_SYNC_LIMITS.maxThemes };
    if (sinceRevision === head.libraryRevision && cursor === undefined) return answer(200, { ...shape, unchanged: true });
    const page = await store.page(req.sub, cursor);
    return answer(200, { ...shape, unchanged: false, themes: page.themes, ...(page.next ? { next: encodeCursor(page.next) } : {}) });
  }

  const match = /^\/api\/themes\/([^/]+)$/.exec(req.path);
  if (!match || (req.method !== "PUT" && req.method !== "DELETE")) return GONE;
  let id: string;
  try {
    id = decodeURIComponent(match[1]!);
  } catch {
    return answer(422, { error: "that is not a theme id", code: "invalid-theme" });
  }
  if (!THEME_ID_PATTERN.test(id)) return answer(422, { error: "that is not a theme id", code: "invalid-theme" });

  const expected = expectationOf(req.method, req.header("if-match"), req.header("if-none-match"));
  if (!expected)
    return answer(428, {
      error: 'send If-Match: "<revision>" with the revision you changed, or If-None-Match: * for a new theme',
      code: "precondition-required",
    });
  const key = req.header("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key))
    return answer(422, { error: "Idempotency-Key: 16 to 64 letters, digits, dashes or underscores", code: "key-required" });

  let change: { kind: "put"; record: ThemeRecordV1 } | { kind: "delete" };
  if (req.method === "PUT") {
    if (req.bytes > MAX + 1024) return answer(413, { error: "a theme is at most 64 KiB" });
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).some((k) => k !== "record")) {
      seen({ outcome: "invalid" });
      return answer(422, { error: "a theme, as { record }", code: "invalid-theme" });
    }
    const parsed = parseThemeRecord((body as { record?: unknown }).record);
    if (!parsed.ok) {
      seen({ outcome: "invalid" });
      return answer(422, {
        error: "this theme does not read",
        code: "invalid-theme",
        issues: parsed.issues.map(({ path, message }) => ({ path, message })),
      });
    }
    if (parsed.value.id !== id) {
      seen({ outcome: "invalid" });
      return answer(422, { error: "the record's id is not the address's", code: "id-mismatch" });
    }
    if (themeRecordBytes(parsed.value) > MAX) return answer(413, { error: "a theme is at most 64 KiB" });
    change = { kind: "put", record: parsed.value };
  } else {
    change = { kind: "delete" };
  }

  const fingerprint = createHash("sha256")
    .update(canonicalJson({ method: req.method, id, expect: expected, record: change.kind === "put" ? change.record : null }))
    .digest("hex");
  const reused = () => answer(422, { error: "that Idempotency-Key was used for a different change", code: "key-reused" });
  // The store answers a key with its receipt whatever was asked; only a
  // receipt for this same change may answer this request.
  const prior = await store.receipt(req.sub, key, req.at);
  if (prior) {
    if (prior.fingerprint !== fingerprint) return reused();
    const revision = revisionOf(prior.body);
    seen({ outcome: "replayed", ...(revision !== undefined ? { revision } : {}) });
    return answer(prior.status, { ...prior.body, replayed: true });
  }

  const count = await store.countWrite(req.sub, req.at);
  if (count > THEME_SYNC_LIMITS.writesPerMinute) {
    const retryAfter = 60 - new Date(req.at).getUTCSeconds();
    seen({ outcome: "rate-limited" });
    return answer(
      429,
      { error: "too many theme changes in a minute; they are sent again shortly", code: "rate-limited", retryAfter },
      { "retry-after": String(retryAfter) },
    );
  }

  let result;
  try {
    result = await store.write({ sub: req.sub, id, at: req.at, key, fingerprint, expect: expected, change });
  } catch (error) {
    if (!isWriteConflict(error)) throw error;
    seen({ outcome: "busy" });
    return answer(
      503,
      {
        error: "another change to this library landed at the same moment; send this one again",
        code: "busy",
        retryAfter: BUSY_RETRY_SECONDS,
      },
      { "retry-after": String(BUSY_RETRY_SECONDS) },
    );
  }
  switch (result.kind) {
    case "written":
      seen({ outcome: "written", revision: result.theme.revision });
      return answer(200, { theme: result.theme });
    case "replay": {
      if (result.receipt.fingerprint !== fingerprint) return reused();
      const revision = revisionOf(result.receipt.body);
      seen({ outcome: "replayed", ...(revision !== undefined ? { revision } : {}) });
      return answer(result.receipt.status, { ...result.receipt.body, replayed: true });
    }
    case "conflict":
      seen({ outcome: "conflict", ...(result.current ? { revision: result.current.revision } : {}) });
      return answer(409, { theme: result.current });
    case "full":
      seen({ outcome: "library-full" });
      return answer(422, {
        error: `this account holds ${THEME_SYNC_LIMITS.maxThemes} saved themes; delete one to sync another`,
        code: "library-full",
        limit: THEME_SYNC_LIMITS.maxThemes,
      });
  }
}
