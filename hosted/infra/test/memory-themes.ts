import { THEME_SYNC_LIMITS, type RemoteThemeV1 } from "@runlog/themes";
import { nextTheme, THEME_RECEIPT_DAYS, type ThemeReceipt, type ThemeStore } from "../lib/handlers/themes";

/** The theme store in a Map, with the transaction's all-or-nothing rules. */
export function memoryThemes(limit: number = THEME_SYNC_LIMITS.maxThemes): ThemeStore & {
  rows: Map<string, RemoteThemeV1>;
  heads: Map<string, { libraryRevision: number; live: number }>;
  counts: Map<string, number>;
  receipts: Map<string, ThemeReceipt & { expiresAt: number }>;
} {
  const rows = new Map<string, RemoteThemeV1>();
  const heads = new Map<string, { libraryRevision: number; live: number }>();
  const counts = new Map<string, number>();
  const receipts = new Map<string, ThemeReceipt & { expiresAt: number }>();
  const headOf = (sub: string) => heads.get(sub) ?? { libraryRevision: 0, live: 0 };
  return {
    rows,
    heads,
    counts,
    receipts,
    async head(sub) {
      return { ...headOf(sub) };
    },
    async page(sub, after) {
      const mine = [...rows.entries()]
        .filter(([k]) => k.startsWith(`${sub}/`))
        .map(([, v]) => v)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .filter((t) => after === undefined || t.id > after);
      const themes = mine.slice(0, THEME_SYNC_LIMITS.pageSize);
      return { themes, ...(mine.length > themes.length ? { next: themes.at(-1)!.id } : {}) };
    },
    async receipt(sub, key, at) {
      const found = receipts.get(`${sub}/${key}`);
      if (!found || found.expiresAt * 1000 < Date.parse(at)) return null;
      return { fingerprint: found.fingerprint, status: found.status, body: found.body };
    },
    async countWrite(sub, at) {
      const k = `${sub}/${at.slice(0, 16)}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k)!;
    },
    async write(input) {
      const rowKey = `${input.sub}/${input.id}`;
      const opKey = `${input.sub}/${input.key}`;
      const prior = receipts.get(opKey);
      if (prior && prior.expiresAt * 1000 >= Date.parse(input.at))
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
        expiresAt: Math.floor(Date.parse(input.at) / 1000) + THEME_RECEIPT_DAYS * 86400,
      });
      return { kind: "written", theme };
    },
  };
}
