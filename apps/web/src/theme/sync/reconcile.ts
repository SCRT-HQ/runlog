import { parseThemeRecord, sameThemeContent, type RemoteThemeV1, type ThemeRecordV1 } from "@runlog/themes";
import type { ThemeWriteOutcome } from "../../sync/themeApi.ts";
import type { ThemeLibraryRow } from "../themeStorage.ts";
import type { ThemeHold, ThemeMutationV1, ThemeRemoteRow } from "./outbox.ts";

/** Eight tries a round; the waits between them double from 20 seconds and stop growing at 5 minutes. */
export const THEME_RETRY = Object.freeze({ tries: 8, firstDelayMs: 20_000, maxDelayMs: 300_000 } as const);

export function retryDelay(failedTries: number): number {
  return Math.min(THEME_RETRY.firstDelayMs * 2 ** Math.max(0, failedTries - 1), THEME_RETRY.maxDelayMs);
}

export type PushOutcome = ThemeWriteOutcome | { readonly kind: "offline" } | { readonly kind: "unauthorized" } | { readonly kind: "error" };
export type PushDecision =
  | { readonly kind: "confirm"; readonly remote: ThemeRemoteRow }
  | { readonly kind: "drop" }
  | {
      readonly kind: "conflict";
      readonly server: RemoteThemeV1 | null;
      readonly copy: "conflict" | "recovery" | null;
      readonly recreate: boolean;
      readonly keptServer: boolean;
    }
  | { readonly kind: "retry"; readonly notBefore: number; readonly countsAsTry: boolean }
  | { readonly kind: "hold"; readonly hold: ThemeHold; readonly detail: string | null }
  | { readonly kind: "pause-offline" }
  | { readonly kind: "stop-signed-out" };

const rowOf = (theme: RemoteThemeV1): ThemeRemoteRow => ({ id: theme.id, revision: theme.revision, state: theme.state });

export function decidePush(entry: ThemeMutationV1, outcome: PushOutcome, local: ThemeLibraryRow | null, now: number): PushDecision {
  switch (outcome.kind) {
    case "ok":
      return { kind: "confirm", remote: rowOf(outcome.theme) };
    case "conflict": {
      const server = outcome.current;
      if (entry.op === "delete") {
        if (server === null) return { kind: "drop" };
        if (server.state === "deleted") return { kind: "confirm", remote: rowOf(server) };
        return { kind: "conflict", server, copy: null, recreate: false, keptServer: true };
      }
      if (server === null) return { kind: "conflict", server: null, copy: null, recreate: local?.kind === "saved", keptServer: false };
      if (server.state === "live" && entry.record !== null && sameThemeContent(server.record, entry.record))
        return { kind: "confirm", remote: rowOf(server) };
      if (local?.kind !== "saved") return { kind: "conflict", server, copy: null, recreate: false, keptServer: server.state === "live" };
      return { kind: "conflict", server, copy: server.state === "deleted" ? "recovery" : "conflict", recreate: false, keptServer: false };
    }
    case "library-full":
      return { kind: "hold", hold: "library-full", detail: null };
    case "rejected":
      return {
        kind: "hold",
        hold: "invalid",
        detail: outcome.issues.length > 0 ? outcome.issues.map((i) => `${i.path}: ${i.message}`).join("; ") : outcome.message,
      };
    case "too-large":
      return { kind: "hold", hold: "invalid", detail: "larger than 64 KiB" };
    case "rate-limited":
      return { kind: "retry", notBefore: now + outcome.retryAfterMs, countsAsTry: false };
    case "offline":
      return { kind: "pause-offline" };
    case "unauthorized":
      return { kind: "stop-signed-out" };
    case "error":
      return entry.attempts >= THEME_RETRY.tries
        ? { kind: "hold", hold: "retry-exhausted", detail: null }
        : { kind: "retry", notBefore: now + retryDelay(entry.attempts), countsAsTry: true };
  }
}

const SUFFIX = { conflict: " (conflict copy)", recovery: " (recovered)" } as const;
const MAX_NAME = 80;

export function copyName(name: string, kind: "conflict" | "recovery"): string {
  const suffix = SUFFIX[kind];
  const room = MAX_NAME - [...suffix].length;
  return `${[...name].slice(0, room).join("").trimEnd()}${suffix}`;
}

export function copyRecord(record: ThemeRecordV1, newId: string, kind: "conflict" | "recovery"): ThemeRecordV1 {
  const parsed = parseThemeRecord({ ...record, id: newId, name: copyName(record.name, kind), contentRevision: 1 });
  if (!parsed.ok) throw new TypeError(`The ${kind} copy does not read: ${parsed.issues.map((i) => i.path).join(", ")}`);
  return parsed.value;
}
