import { canonicalJson, sameThemeContent, THEME_SYNC_LIMITS, type RemoteThemeV1, type ThemeRecordV1 } from "@runlog/themes";
import { SyncError } from "../../../sync/client.ts";
import type { ThemeApi, ThemeWriteOutcome } from "../../../sync/themeApi.ts";

export type ScriptedFailure =
  | "offline"
  | "unauthorized"
  | "error"
  | "lose-response"
  | { readonly rateLimitedMs: number }
  /** Waits for the promise, then answers `answer` when given (without writing), or writes as usual. */
  | { readonly hold: Promise<void>; readonly answer?: ThemeWriteOutcome };

/** One account-holding server shared by every device in a test. */
export interface MemoryThemeServer {
  readonly rows: Map<string, RemoteThemeV1>;
  /** Receipts of written changes by account and key, with the change's fingerprint, as the real routes keep them. */
  readonly receipts: Map<string, { readonly fingerprint: string; readonly theme: RemoteThemeV1 }>;
  readonly heads: Map<string, { libraryRevision: number; live: number }>;
  /** Failures for the next writes, in order, shared by every device. */
  readonly script: ScriptedFailure[];
  limit: number;
  /** Themes a list page holds at most; a test may lower it to read a library over several pages. */
  pageSize: number;
  /** Ids whose rows a list page answers as not readable: left out and counted, as the real client does. */
  readonly unreadable: Set<string>;
  writes: number;
  lists: number;
}

export function memoryThemeServer(limit: number = THEME_SYNC_LIMITS.maxThemes): MemoryThemeServer {
  return {
    rows: new Map(),
    receipts: new Map(),
    heads: new Map(),
    script: [],
    limit,
    pageSize: THEME_SYNC_LIMITS.pageSize,
    unreadable: new Set(),
    writes: 0,
    lists: 0,
  };
}

let clock = Date.parse("2026-09-23T10:00:00.000Z");
const at = () => new Date((clock += 1000)).toISOString();

export function memoryThemeApi(server: MemoryThemeServer, sub = "user_1"): ThemeApi {
  const head = () => server.heads.get(sub) ?? { libraryRevision: 0, live: 0 };
  async function write(
    method: "PUT" | "DELETE",
    id: string,
    key: string,
    base: number | null,
    record: ThemeRecordV1 | null,
  ): Promise<ThemeWriteOutcome> {
    const failure = server.script.shift();
    if (failure === "offline") throw new SyncError("offline");
    if (failure === "unauthorized") throw new SyncError("unauthorized");
    if (failure === "error") throw new SyncError("error");
    if (typeof failure === "object" && "rateLimitedMs" in failure) return { kind: "rate-limited", retryAfterMs: failure.rateLimitedMs };
    if (typeof failure === "object" && "hold" in failure) {
      await failure.hold;
      if (failure.answer !== undefined) return failure.answer;
    }
    // The same fields the real route fingerprints: the method, the id, the precondition and the record.
    const expect = base === null ? { kind: "absent" } : { kind: "revision", revision: base };
    const fingerprint = canonicalJson({ method, id, expect, record });
    const prior = server.receipts.get(`${sub}/${key}`);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return { kind: "key-reused" };
      return { kind: "ok", theme: prior.theme, replayed: true };
    }
    const current = server.rows.get(`${sub}/${id}`) ?? null;
    const fits = base === null ? current === null : current !== null && current.state === "live" && current.revision === base;
    if (!fits) return { kind: "conflict", current };
    const h = head();
    if (base === null && h.live >= server.limit) return { kind: "library-full", limit: server.limit };
    const revision = base === null ? 1 : base + 1;
    const time = at();
    const theme: RemoteThemeV1 =
      record !== null
        ? { state: "live", id, revision, updatedAt: time, record }
        : { state: "deleted", id, revision, updatedAt: time, deletedAt: time };
    server.rows.set(`${sub}/${id}`, theme);
    server.heads.set(sub, {
      libraryRevision: h.libraryRevision + 1,
      live: h.live + (base === null ? 1 : record === null ? -1 : 0),
    });
    server.receipts.set(`${sub}/${key}`, { fingerprint, theme });
    server.writes += 1;
    if (failure === "lose-response") throw new SyncError("offline");
    return { kind: "ok", theme, replayed: false };
  }
  return {
    async listThemes({ since, after }) {
      server.lists += 1;
      const h = head();
      const shape = { libraryRevision: h.libraryRevision, live: h.live, limit: server.limit };
      if (since === h.libraryRevision && after === undefined) return { ...shape, unchanged: true, themes: [], skipped: 0, next: null };
      const mine = [...server.rows.entries()]
        .filter(([k]) => k.startsWith(`${sub}/`))
        .map(([, v]) => v)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .filter((t) => after === undefined || t.id > after);
      const page = mine.slice(0, server.pageSize);
      const themes = page.filter((t) => !server.unreadable.has(t.id));
      return {
        ...shape,
        unchanged: false,
        themes,
        skipped: page.length - themes.length,
        next: mine.length > page.length ? page.at(-1)!.id : null,
      };
    },
    putTheme: ({ record, base, key }) => write("PUT", record.id, key, base, record),
    deleteTheme: ({ id, base, key }) => write("DELETE", id, key, base, null),
  };
}

/** For a test that wants to assert the server kept one version: the live record of an id, if any. */
export function serverRecord(server: MemoryThemeServer, id: string, sub = "user_1"): ThemeRecordV1 | null {
  const row = server.rows.get(`${sub}/${id}`);
  return row?.state === "live" ? row.record : null;
}
export { sameThemeContent };
