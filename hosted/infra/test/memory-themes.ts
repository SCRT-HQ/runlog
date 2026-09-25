import { THEME_SYNC_LIMITS, type RemoteThemeV1 } from "@runlog/themes";
import {
  assertIdempotencyKey,
  assertThemeId,
  epochSeconds,
  nextTheme,
  THEME_RECEIPT_DAYS,
  type ThemeReceipt,
  type ThemeStore,
} from "../lib/handlers/themes";

/** The theme store in a Map, with the transaction's all-or-nothing rules. */
export function memoryThemes(limit: number = THEME_SYNC_LIMITS.maxThemes): ThemeStore & {
  rows: Map<string, RemoteThemeV1>;
  heads: Map<string, { libraryRevision: number; live: number }>;
  counts: Map<string, number>;
  receipts: Map<string, ThemeReceipt & { expiresAt: number }>;
  /** Rows, as `sub/id`, that a page leaves out and counts as no longer reading, as the table's store does. */
  unreadable: Set<string>;
} {
  const rows = new Map<string, RemoteThemeV1>();
  const heads = new Map<string, { libraryRevision: number; live: number }>();
  const counts = new Map<string, number>();
  const receipts = new Map<string, ThemeReceipt & { expiresAt: number }>();
  const unreadable = new Set<string>();
  const headOf = (sub: string) => heads.get(sub) ?? { libraryRevision: 0, live: 0 };
  return {
    rows,
    heads,
    counts,
    receipts,
    unreadable,
    async head(sub) {
      return { ...headOf(sub) };
    },
    async page(sub, after) {
      if (after !== undefined) assertThemeId(after);
      const mine = [...rows.entries()]
        .filter(([k]) => k.startsWith(`${sub}/`))
        .map(([, v]) => v)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .filter((t) => after === undefined || t.id > after);
      const page = mine.slice(0, THEME_SYNC_LIMITS.pageSize);
      const themes = page.filter((t) => !unreadable.has(`${sub}/${t.id}`));
      const skipped = page.length - themes.length;
      return { themes, ...(mine.length > page.length ? { next: page.at(-1)!.id } : {}), ...(skipped > 0 ? { skipped } : {}) };
    },
    async receipt(sub, key, at) {
      assertIdempotencyKey(key);
      const found = receipts.get(`${sub}/${key}`);
      if (!found || found.expiresAt < epochSeconds(at)) return null;
      return { fingerprint: found.fingerprint, status: found.status, body: found.body };
    },
    async countWrite(sub, at) {
      const k = `${sub}/${at.slice(0, 16)}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k)!;
    },
    async write(input) {
      assertThemeId(input.id);
      assertIdempotencyKey(input.key);
      const rowKey = `${input.sub}/${input.id}`;
      const opKey = `${input.sub}/${input.key}`;
      const prior = receipts.get(opKey);
      if (prior && prior.expiresAt >= epochSeconds(input.at))
        return { kind: "replay", receipt: { fingerprint: prior.fingerprint, status: prior.status, body: prior.body } };
      const current = rows.get(rowKey) ?? null;
      const fits =
        input.expect.kind === "absent"
          ? current === null
          : current !== null && current.state === "live" && current.revision === input.expect.revision;
      if (!fits) return { kind: "conflict", current };
      const head = headOf(input.sub);
      if (input.expect.kind === "absent" && head.live >= limit) return { kind: "full" };
      const theme = nextTheme(input);
      rows.set(rowKey, theme);
      heads.set(input.sub, {
        libraryRevision: head.libraryRevision + 1,
        live: head.live + (input.expect.kind === "absent" ? 1 : input.change.kind === "delete" ? -1 : 0),
      });
      receipts.set(opKey, {
        fingerprint: input.fingerprint,
        status: 200,
        body: { theme },
        expiresAt: epochSeconds(input.at) + THEME_RECEIPT_DAYS * 86400,
      });
      return { kind: "written", theme };
    },
  };
}
