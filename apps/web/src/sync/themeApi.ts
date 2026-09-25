import { parseRemoteTheme, type RemoteThemeV1, type ThemeRecordV1, type ThemeRejectCode, type ThemeValidationIssue } from "@runlog/themes";
import { SyncError, type Transport } from "./client.ts";

export interface ThemeListPage {
  readonly libraryRevision: number;
  readonly live: number;
  readonly limit: number;
  readonly unchanged: boolean;
  readonly themes: readonly RemoteThemeV1[];
  /** Themes on this page that did not read and were left out; the page must be read again later. */
  readonly skipped: number;
  readonly next: string | null;
}
export type ThemeWriteOutcome =
  | { readonly kind: "ok"; readonly theme: RemoteThemeV1; readonly replayed: boolean }
  | { readonly kind: "conflict"; readonly current: RemoteThemeV1 | null }
  | {
      readonly kind: "rejected";
      readonly code: ThemeRejectCode;
      readonly message: string;
      readonly issues: readonly ThemeValidationIssue[];
    }
  | { readonly kind: "library-full"; readonly limit: number }
  /** The server already applied a different change under this Idempotency-Key, so it did not apply this one. */
  | { readonly kind: "key-reused" }
  | { readonly kind: "rate-limited"; readonly retryAfterMs: number }
  | { readonly kind: "too-large" };
export interface ThemeApi {
  listThemes(input: { readonly since?: number; readonly after?: string }): Promise<ThemeListPage>;
  putTheme(input: { readonly record: ThemeRecordV1; readonly base: number | null; readonly key: string }): Promise<ThemeWriteOutcome>;
  deleteTheme(input: { readonly id: string; readonly base: number; readonly key: string }): Promise<ThemeWriteOutcome>;
}

type Body = Record<string, unknown>;
const REJECT_CODES: ReadonlySet<string> = new Set([
  "invalid-theme",
  "id-mismatch",
  "key-required",
  "invalid-query",
  "precondition-required",
]);

function themeOf(value: unknown): RemoteThemeV1 {
  const parsed = parseRemoteTheme(value);
  if (!parsed.ok) throw new SyncError("error", undefined, "the server's theme does not read");
  return parsed.value;
}
const count = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new SyncError("error", undefined, "the server's list does not read");
  return value as number;
};

/**
 * How long to wait before sending the same request again. Read off the
 * status and the Retry-After header, not the body's code: a 503 with
 * `code: "busy"` and a plain 429 both land here the same way.
 */
function retryAfterMsOf(body: Body, headers: Headers): number {
  const seconds = Number(body["retryAfter"] ?? headers.get("retry-after") ?? 60);
  return Math.max(1, Number.isFinite(seconds) ? seconds : 60) * 1000;
}

function outcomeOf(status: number, body: Body, headers: Headers): ThemeWriteOutcome {
  if (status === 200) return { kind: "ok", theme: themeOf(body["theme"]), replayed: body["replayed"] === true };
  if (status === 409)
    return { kind: "conflict", current: body["theme"] === null || body["theme"] === undefined ? null : themeOf(body["theme"]) };
  if (status === 413) return { kind: "too-large" };
  // A plain rate limit and a write that collided with another write to the
  // same account (busy) are both transient: the caller sends the same
  // request again after the delay the server gave. Same outcome kind for
  // both keeps the reconcile loop that reads this from having to learn a
  // second transient shape.
  if (status === 429 || status === 503) return { kind: "rate-limited", retryAfterMs: retryAfterMsOf(body, headers) };
  if (status === 422 && body["code"] === "library-full") return { kind: "library-full", limit: count(body["limit"]) };
  if (status === 422 && body["code"] === "key-reused") return { kind: "key-reused" };
  if (status === 422 || status === 428) {
    const code = typeof body["code"] === "string" && REJECT_CODES.has(body["code"]) ? (body["code"] as ThemeRejectCode) : "invalid-theme";
    const issues = Array.isArray(body["issues"])
      ? (body["issues"] as unknown[]).flatMap((i) =>
          typeof i === "object" && i !== null && typeof (i as Body)["path"] === "string" && typeof (i as Body)["message"] === "string"
            ? [{ path: (i as Body)["path"] as string, message: (i as Body)["message"] as string }]
            : [],
        )
      : [];
    return { kind: "rejected", code, message: typeof body["error"] === "string" ? body["error"] : code, issues };
  }
  throw new SyncError("error", undefined, `the server said ${status}`);
}

export function createThemeApi(send: Transport): ThemeApi {
  return {
    async listThemes({ since, after }) {
      const query = after !== undefined ? `?after=${encodeURIComponent(after)}` : since !== undefined ? `?since=${since}` : "";
      const { status, body } = await send<Body>("GET", `/themes${query}`);
      if (status !== 200) throw new SyncError("error", undefined, `the server said ${status}`);
      const unchanged = body["unchanged"] === true;
      // One theme that does not read is left out, not the whole library; the caller counts it.
      const themes: RemoteThemeV1[] = [];
      let skipped = 0;
      for (const value of unchanged || !Array.isArray(body["themes"]) ? [] : (body["themes"] as unknown[])) {
        const parsed = parseRemoteTheme(value);
        if (parsed.ok) themes.push(parsed.value);
        else skipped += 1;
      }
      return {
        libraryRevision: count(body["libraryRevision"]),
        live: count(body["live"]),
        limit: count(body["limit"]),
        unchanged,
        themes,
        skipped,
        next: typeof body["next"] === "string" ? body["next"] : null,
      };
    },
    async putTheme({ record, base, key }) {
      const precondition: Record<string, string> = base === null ? { "if-none-match": "*" } : { "if-match": `"${base}"` };
      const { status, body, headers } = await send<Body>(
        "PUT",
        `/themes/${encodeURIComponent(record.id)}`,
        { record },
        { ...precondition, "idempotency-key": key },
      );
      return outcomeOf(status, body, headers);
    },
    async deleteTheme({ id, base, key }) {
      const { status, body, headers } = await send<Body>("DELETE", `/themes/${encodeURIComponent(id)}`, undefined, {
        "if-match": `"${base}"`,
        "idempotency-key": key,
      });
      return outcomeOf(status, body, headers);
    },
  };
}
