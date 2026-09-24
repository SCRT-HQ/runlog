import type { ThemeRecordV1 } from "@runlog/themes";
import { SyncError } from "../../sync/client.ts";
import type { ThemeApi } from "../../sync/themeApi.ts";
import type { ThemeRepository } from "../themeStorage.ts";
import { newThemeId } from "./ids.ts";
import type { ThemeHold, ThemeMutationV1, ThemeRemoteRow } from "./outbox.ts";
import { copyRecord, decidePush, retryDelay, type PushOutcome } from "./reconcile.ts";

export type WakeReason = "start" | "local" | "focus" | "online" | "poll" | "retry" | "again";
export type ThemeSyncPhase = "idle" | "syncing" | "offline" | "sign-in" | "stopped";
export type ThemeItemStatus =
  | { readonly kind: "synced" }
  | { readonly kind: "pending" }
  | { readonly kind: "held"; readonly hold: ThemeHold; readonly detail: string | null };
export interface ThemeSyncNotice {
  readonly kind: "conflict-copy" | "recovery-copy" | "kept-server";
  readonly themeId: string;
  readonly copyId: string | null;
}
export interface ThemeSyncReport {
  readonly phase: ThemeSyncPhase;
  readonly items: ReadonlyMap<string, ThemeItemStatus>;
  readonly notices: readonly ThemeSyncNotice[];
}
export interface ThemeSyncDeps {
  readonly repository: ThemeRepository;
  readonly api: ThemeApi;
  readonly onLibraryChanged: () => void;
  readonly onReport: (report: ThemeSyncReport) => void;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly lock?: <T>(run: () => Promise<T>) => Promise<T>;
}
export interface ThemeSync {
  wake(reason: WakeReason): void;
  retry(): void;
  dismiss(index: number): void;
  stop(): void;
  idle(): Promise<void>;
}

/** One pass at a time across this browser's tabs, where the browser can say so; otherwise per tab. */
export function webLock(scopeKey: string): <T>(run: () => Promise<T>) => Promise<T> {
  return async <T>(run: () => Promise<T>): Promise<T> => {
    const locks = typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : undefined;
    if (!locks) return run();
    let started = false;
    try {
      return (await locks.request(`runlog-theme-sync:${scopeKey}`, () => {
        started = true;
        return run();
      })) as T;
    } catch (error) {
      // A frame that may not take locks refuses before running; sync still runs, one pass per tab.
      if (started) throw error;
      return run();
    }
  };
}

const STOPPED = Symbol("stopped");
const MAX_PUSHES_PER_PASS = 50;

/** The entry each theme sends next: its oldest, when that one is free to go. */
function heads(outbox: readonly ThemeMutationV1[]): ThemeMutationV1[] {
  const first = new Map<string, ThemeMutationV1>();
  for (const e of outbox) if (!first.has(e.themeId)) first.set(e.themeId, e);
  return [...first.values()];
}

export function buildReport(
  phase: ThemeSyncPhase,
  outbox: readonly ThemeMutationV1[],
  remote: readonly ThemeRemoteRow[],
  notices: readonly ThemeSyncNotice[],
  details: ReadonlyMap<string, string | null>,
): ThemeSyncReport {
  const items = new Map<string, ThemeItemStatus>();
  for (const row of remote) if (row.state === "live") items.set(row.id, { kind: "synced" });
  for (const e of outbox) {
    const now = items.get(e.themeId);
    if (now?.kind === "held") continue;
    items.set(e.themeId, e.hold === null ? { kind: "pending" } : { kind: "held", hold: e.hold, detail: details.get(e.themeId) ?? null });
  }
  return Object.freeze({ phase, items, notices: Object.freeze([...notices]) });
}

export function createThemeSync(deps: ThemeSyncDeps): ThemeSync {
  const repo = deps.repository;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? newThemeId;
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const lock = deps.lock ?? webLock(repo.scopeKey);

  let stopped = false;
  let running: Promise<void> | null = null;
  let again: WakeReason | null = null;
  let timer: unknown = null;
  let phase: ThemeSyncPhase = "idle";
  let releasedFull = false;
  const notices: ThemeSyncNotice[] = [];
  const details = new Map<string, string | null>();

  const guard = () => {
    if (stopped) throw STOPPED;
  };
  const report = async () => {
    const [outbox, remote] = await Promise.all([repo.listOutbox(), repo.listRemote()]);
    guard();
    deps.onReport(buildReport(phase, outbox, remote, notices, details));
  };
  const schedule = (ms: number) => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(
      () => {
        timer = null;
        wake("again");
      },
      Math.max(0, ms),
    );
  };
  const outcomeOfError = (error: unknown): PushOutcome =>
    error instanceof SyncError && (error.kind === "offline" || error.kind === "unauthorized") ? { kind: error.kind } : { kind: "error" };

  async function send(entry: ThemeMutationV1): Promise<PushOutcome> {
    const base = entry.base.kind === "revision" ? entry.base.revision : null;
    try {
      if (entry.op === "put") return await deps.api.putTheme({ record: entry.record as ThemeRecordV1, base, key: entry.key });
      if (base === null) return { kind: "error" };
      return await deps.api.deleteTheme({ id: entry.themeId, base, key: entry.key });
    } catch (error) {
      return outcomeOfError(error);
    }
  }

  /**
   * Sends one entry and records what the answer means. Answers whether the pass must stop, whether the library
   * changed, whether the entry must be sent again in a fresh pass, and, after a rate limit, when to try again.
   */
  async function pushOne(entry: ThemeMutationV1): Promise<{ halt: boolean; changed: boolean; resend?: boolean; limitedUntil?: number }> {
    // Marked and read back in one transaction: the key goes out with the body stored under it,
    // even when a local save folded into this entry after the outbox was listed.
    const marked = await repo.markAttempt({ seq: entry.seq, attempts: entry.attempts + 1, notBefore: entry.notBefore, hold: null });
    guard();
    if (marked === null) return { halt: false, changed: false };
    const untried = marked.attempts - 1;
    const outcome = await send(marked);
    guard();
    const local = await repo.loadTheme(marked.themeId);
    guard();
    const decision = decidePush(marked, outcome, local, now());
    switch (decision.kind) {
      case "confirm":
        await repo.confirmMutation({ seq: marked.seq, remote: decision.remote });
        details.delete(marked.themeId);
        return { halt: false, changed: false };
      case "drop":
        await repo.confirmMutation({ seq: marked.seq, remote: null });
        return { halt: false, changed: false };
      case "conflict": {
        const copy = decision.copy !== null && local?.kind === "saved" ? copyRecord(local.record, newId(), decision.copy) : null;
        const resolved = await repo.resolveConflict({
          themeId: marked.themeId,
          expectedLocalRevision: local?.localRevision ?? null,
          server: decision.server,
          copy,
          recreate: decision.recreate && local?.kind === "saved" ? local.record : null,
        });
        guard();
        if (resolved === "stale") {
          // A save landed after the answer was read: decide again on a fresh answer, not this one.
          await repo.markAttempt({ seq: marked.seq, attempts: untried, notBefore: marked.notBefore, hold: null });
          return { halt: false, changed: false, resend: true };
        }
        if (copy !== null)
          notices.push({
            kind: decision.copy === "recovery" ? "recovery-copy" : "conflict-copy",
            themeId: marked.themeId,
            copyId: copy.id,
          });
        else if (decision.keptServer) notices.push({ kind: "kept-server", themeId: marked.themeId, copyId: null });
        return { halt: false, changed: true };
      }
      case "retry":
        await repo.markAttempt({
          seq: marked.seq,
          attempts: decision.countsAsTry ? marked.attempts : untried,
          notBefore: decision.notBefore,
          hold: null,
        });
        // The server asked this account to slow down: nothing else goes out until the entry is due again.
        if (outcome.kind === "rate-limited") return { halt: false, changed: false, limitedUntil: decision.notBefore };
        return { halt: false, changed: false };
      case "hold":
        await repo.markAttempt({ seq: marked.seq, attempts: marked.attempts, notBefore: 0, hold: decision.hold });
        details.set(marked.themeId, decision.detail);
        return { halt: false, changed: false };
      case "pause-offline":
      case "stop-signed-out":
        await repo.markAttempt({ seq: marked.seq, attempts: untried, notBefore: marked.notBefore, hold: null });
        phase = decision.kind === "pause-offline" ? "offline" : "sign-in";
        return { halt: true, changed: false };
    }
  }

  async function pull(): Promise<{ changed: boolean; halt: boolean }> {
    const meta = await repo.loadSyncMeta();
    guard();
    let changed = false;
    let skipped = false;
    let first;
    try {
      first = await deps.api.listThemes(meta.libraryRevision === null ? {} : { since: meta.libraryRevision });
      guard();
      if (!first.unchanged) {
        let page = first;
        for (;;) {
          for (const theme of page.themes) {
            const applied = await repo.applyRemote(theme);
            guard();
            if (applied === "applied") changed = true;
            if (applied === "pending") skipped = true;
          }
          if (page.next === null) break;
          page = await deps.api.listThemes({ after: page.next });
          guard();
        }
        // A theme left for a pending edit is read again next time, not skipped for good.
        await repo.saveSyncMeta({ libraryRevision: skipped ? null : first.libraryRevision });
        guard();
      }
    } catch (error) {
      if (error === STOPPED) throw error;
      const outcome = outcomeOfError(error);
      phase = outcome.kind === "offline" ? "offline" : outcome.kind === "unauthorized" ? "sign-in" : "idle";
      return { changed, halt: true };
    }
    // Room again: send what the full library held back. Once per round, so a
    // create that races another device's create cannot loop.
    if (first.live < first.limit && !releasedFull) {
      if ((await repo.releaseHolds({ holds: ["library-full"], resetBackoff: false })) > 0) {
        releasedFull = true;
        again = again ?? "again";
      }
      guard();
    }
    return { changed, halt: false };
  }

  async function pass(reason: WakeReason): Promise<void> {
    guard();
    if (reason !== "again") releasedFull = false;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (reason === "focus" || reason === "online" || reason === "retry") {
      await repo.releaseHolds({ holds: ["retry-exhausted"], resetBackoff: true });
      guard();
    }
    phase = "syncing";
    await report();
    let changed = false;
    for (let i = 0; i < MAX_PUSHES_PER_PASS; i++) {
      const outbox = await repo.listOutbox();
      guard();
      const at = now();
      const ready = heads(outbox).filter((e) => e.hold === null && e.base.kind !== "previous");
      const due = ready.filter((e) => e.notBefore <= at);
      if (due.length === 0) {
        const waits = ready.map((e) => e.notBefore - at).filter((ms) => ms > 0);
        if (waits.length > 0) schedule(Math.min(...waits));
        break;
      }
      const step = await pushOne(due[0]!);
      guard();
      changed ||= step.changed;
      if (step.limitedUntil !== undefined) {
        schedule(step.limitedUntil - now());
        phase = "idle";
      }
      if (step.halt || step.limitedUntil !== undefined) {
        await report();
        if (changed) deps.onLibraryChanged();
        return;
      }
      if (step.resend) {
        again = again ?? "again";
        break;
      }
      if (i === MAX_PUSHES_PER_PASS - 1) again = again ?? "again";
    }
    const pulled = await pull();
    changed ||= pulled.changed;
    if (!pulled.halt) phase = "idle";
    await report();
    if (changed) deps.onLibraryChanged();
  }

  function wake(reason: WakeReason): void {
    if (stopped) return;
    if (running !== null) {
      again = reason === "focus" || reason === "online" || reason === "retry" ? reason : (again ?? reason);
      return;
    }
    running = lock(() => pass(reason))
      .catch((error: unknown) => {
        if (error === STOPPED || stopped) return;
        // Storage closed under us, or a fault: say the pass ended and try again later. Nothing about the theme is logged.
        phase = "idle";
        void report().catch(() => undefined);
        schedule(retryDelay(1));
      })
      .finally(() => {
        running = null;
        const next = again;
        again = null;
        if (next !== null && !stopped) wake(next);
      });
  }

  return {
    wake,
    retry: () => wake("retry"),
    dismiss(index) {
      if (index < 0 || index >= notices.length) return;
      notices.splice(index, 1);
      void report().catch(() => undefined);
    },
    stop() {
      stopped = true;
      phase = "stopped";
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    async idle() {
      while (running !== null) await running;
    },
  };
}
