import { presentationSnapshotKey, resolveThemeRecord } from "@runlog/themes";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { tokenSubject, useAccount } from "../auth/Account.tsx";
import { nameFor, type Who } from "../storage/who.ts";
import { createTransport } from "../sync/client.ts";
import { apiBase } from "../sync/config.ts";
import { createThemeApi } from "../sync/themeApi.ts";
import { useSyncEnabled } from "../sync/useSyncEnabled.ts";
import { applyBootAppearance, snapshotForBuiltin, type BootAppearanceV1 } from "./appearance.ts";
import { type ThemeId } from "./theme.ts";
import {
  openThemeRepository,
  ThemeStorageError,
  type AppliedThemeSourceV1,
  type SavedThemeRow,
  type StoredThemeDraft,
  type ThemeCasResult,
  type ThemeRepository,
} from "./themeStorage.ts";
import { setDeviceAppearance, useAppearance } from "./useAppearance.ts";
import { DEVICE_ONLY_SYNC, type ThemeSyncView } from "./sync/view.ts";
import { createThemeSync, type ThemeSync, type ThemeSyncReport } from "./sync/worker.ts";
import { LookChannelProvider } from "./follow/LookChannelProvider.tsx";

export interface ThemeContextValue {
  readonly scopeKey: string | null;
  readonly status: "checking" | "loading" | "ready" | "unavailable";
  readonly library: readonly SavedThemeRow[];
  readonly drafts: readonly StoredThemeDraft[];
  readonly problem: string | null;
  readonly applied: BootAppearanceV1;
  readonly appliedSource: AppliedThemeSourceV1 | null;
  readonly sourceRemoved: boolean;
  reload(): Promise<void>;
  saveTheme: ThemeRepository["saveTheme"];
  deleteTheme: ThemeRepository["deleteTheme"];
  saveDraft: ThemeRepository["saveDraft"];
  deleteDraft: ThemeRepository["deleteDraft"];
  finalizeDraft: ThemeRepository["finalizeDraft"];
  applySystem(): Promise<void>;
  applyBuiltin(id: Exclude<ThemeId, "system">): Promise<void>;
  applySaved(id: string, expectedLocalRevision: number): Promise<void>;
  readonly sync: ThemeSyncView;
}

interface ScopeIdentity {
  readonly scopeKey: string | null;
  readonly generation: number;
}

interface ProviderState extends ScopeIdentity {
  readonly status: ThemeContextValue["status"];
  readonly library: readonly SavedThemeRow[];
  readonly drafts: readonly StoredThemeDraft[];
  readonly problem: string | null;
  readonly appliedSource: AppliedThemeSourceV1 | null;
  readonly sourceRemoved: boolean;
  readonly sync: ThemeSyncReport | null;
}

interface RepositoryHandle extends ScopeIdentity {
  readonly repository: ThemeRepository;
}

interface RepositoryReopening extends ScopeIdentity {
  readonly promise: Promise<void>;
}

const EMPTY_LIBRARY: readonly SavedThemeRow[] = Object.freeze([]);
const EMPTY_DRAFTS: readonly StoredThemeDraft[] = Object.freeze([]);
const SYSTEM_APPEARANCE: BootAppearanceV1 = Object.freeze({ schemaVersion: 1, mode: "system" });
const THEME_SETTLE_MS = 2000;
export const THEME_POLL_MS = 30_000;

function unavailableError(message = "Theme library is unavailable"): ThemeStorageError {
  return new ThemeStorageError("unavailable", message);
}

function staleError(): ThemeStorageError {
  return new ThemeStorageError("closed", "Theme library scope changed");
}

const rejectUnavailable = () => Promise.reject(unavailableError());
const DEFAULT_CONTEXT: ThemeContextValue = Object.freeze({
  scopeKey: null,
  status: "unavailable",
  library: EMPTY_LIBRARY,
  drafts: EMPTY_DRAFTS,
  problem: "Theme library provider is unavailable",
  applied: SYSTEM_APPEARANCE,
  appliedSource: null,
  sourceRemoved: false,
  reload: rejectUnavailable,
  saveTheme: rejectUnavailable,
  deleteTheme: rejectUnavailable,
  saveDraft: rejectUnavailable,
  deleteDraft: rejectUnavailable,
  finalizeDraft: rejectUnavailable,
  applySystem: rejectUnavailable,
  applyBuiltin: rejectUnavailable,
  applySaved: rejectUnavailable,
  sync: DEVICE_ONLY_SYNC,
});

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_CONTEXT);

function whoForAccount(account: ReturnType<typeof useAccount>): Who | null {
  if (account.status === "checking") return null;
  if (account.status === "signed-in") return { kind: "account", id: account.user.id };
  if (account.status === "local") return { kind: "local" };
  return { kind: "anon" };
}

function scopeFor(who: Who | null): string | null {
  return who === null ? null : `${nameFor(who)}:themes`;
}

function appearanceSnapshotKey(appearance: BootAppearanceV1): string | null {
  return appearance.mode === "snapshot" ? presentationSnapshotKey(appearance.snapshot) : null;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function upsert<T extends { readonly id: string }>(values: readonly T[], value: T): readonly T[] {
  return Object.freeze([...values.filter(({ id }) => id !== value.id), value].sort((a, b) => a.id.localeCompare(b.id)));
}

/** `publishLook` false on a widget or a dock page, so it never publishes this device's look. */
export function ThemeProvider({ children, publishLook = true }: { children: ReactNode; publishLook?: boolean }): ReactNode {
  const account = useAccount();
  const appearance = useAppearance();
  const latestAppearance = useRef(appearance);
  latestAppearance.current = appearance;
  const who = whoForAccount(account);
  const whoRef = useRef(who);
  whoRef.current = who;
  const expectedScopeKey = scopeFor(who);
  const identityRef = useRef<ScopeIdentity>({ scopeKey: expectedScopeKey, generation: 0 });
  if (identityRef.current.scopeKey !== expectedScopeKey) {
    identityRef.current = { scopeKey: expectedScopeKey, generation: identityRef.current.generation + 1 };
  }
  const identity = identityRef.current;
  const repositoryRef = useRef<RepositoryHandle | null>(null);
  const reopeningRef = useRef<RepositoryReopening | null>(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState<ProviderState>(() => ({
    ...identity,
    status: identity.scopeKey === null ? "checking" : "loading",
    library: EMPTY_LIBRARY,
    drafts: EMPTY_DRAFTS,
    problem: null,
    appliedSource: null,
    sourceRemoved: false,
    sync: null,
  }));

  const isCurrent = (candidate: ScopeIdentity): boolean =>
    identityRef.current.scopeKey === candidate.scopeKey && identityRef.current.generation === candidate.generation;

  const assertCurrent = (candidate: RepositoryHandle): ThemeRepository => {
    if (!isCurrent(candidate) || repositoryRef.current !== candidate) throw staleError();
    return candidate.repository;
  };

  const updateCurrent = (candidate: ScopeIdentity, update: (value: ProviderState) => ProviderState): void => {
    if (!isCurrent(candidate)) return;
    setState((value) => (value.scopeKey === candidate.scopeKey && value.generation === candidate.generation ? update(value) : value));
  };

  const captureRepository = (candidate: ScopeIdentity): RepositoryHandle => {
    if (!isCurrent(candidate)) throw staleError();
    const handle = repositoryRef.current;
    if (handle === null || handle.scopeKey !== candidate.scopeKey || handle.generation !== candidate.generation) {
      throw unavailableError();
    }
    return handle;
  };

  const refreshHandle = async (handle: RepositoryHandle): Promise<void> => {
    const repository = assertCurrent(handle);
    const [library, drafts, storedSource] = await Promise.all([
      repository.listLibrary(),
      repository.listDrafts(),
      repository.loadAppliedSource(),
    ]);
    assertCurrent(handle);
    const key = appearanceSnapshotKey(latestAppearance.current);
    const appliedSource = storedSource !== null && key !== null && storedSource.snapshotKey === key ? storedSource : null;
    updateCurrent(handle, (before) => ({
      ...before,
      status: "ready",
      library,
      drafts,
      problem: null,
      appliedSource,
      sourceRemoved: appliedSource !== null && !library.some(({ id }) => id === appliedSource.id),
    }));
  };

  const syncRef = useRef<{ handle: RepositoryHandle; sync: ThemeSync } | null>(null);
  /** Set while the worker runs: a local save, delete or finalize of this theme id. */
  const localChangeRef = useRef<((id: string) => void) | null>(null);
  const watchersRef = useRef(0);
  const base = apiBase();
  const accountId = account.status === "signed-in" ? account.user.id : null;
  // Only an account syncs, so nothing else reads the stored switch (the recovery page reads no storage).
  const syncSwitch = useSyncEnabled(accountId !== null);
  // Whose tokens the account currently hands out. Set on commit, never during render; a worker
  // compares its own account against it before and after asking for each token.
  const tokenRef = useRef<{ readonly id: string; readonly get: () => Promise<string> } | null>(null);
  const tokenGetter = account.status === "signed-in" ? account.getAccessToken : null;
  useLayoutEffect(() => {
    tokenRef.current = accountId !== null && tokenGetter !== null ? { id: accountId, get: tokenGetter } : null;
  }, [accountId, tokenGetter]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Declared before the effect that opens the repository, so a scope change stops the worker first.
  const ready = state.status === "ready" && state.scopeKey === identity.scopeKey && state.generation === identity.generation;
  useEffect(() => {
    if (accountId === null || base === undefined || !syncSwitch || !ready) return;
    const handle = repositoryRef.current;
    if (handle === null || !isCurrent(handle) || !handle.repository.tracksSync) return;
    // The worker belongs to this account alone. Once another account (or none) holds the token source,
    // or the scope moved on, every request answers signed out, and the worker stops at sign-in rather
    // than retrying.
    const owner = accountId;
    const ownsToken = () => tokenRef.current?.id === owner && isCurrent(handle);
    const api = createThemeApi(
      createTransport(base, async () => {
        const bound = tokenRef.current;
        if (bound === null || !ownsToken()) throw new Error("signed out");
        const token = await bound.get();
        // The session is shared across tabs: another tab's sign-in can make this refresh return
        // someone else's token while this tab still names the owner. The token must say it is the owner's.
        if (!ownsToken() || tokenSubject(token) !== owner) throw new Error("signed out");
        return token;
      }),
    );
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`${handle.scopeKey}:sync`);
    // Other tabs of this account hear only that something changed, never what.
    const tellOtherTabs = () => {
      if (isCurrent(handle)) channel?.postMessage({ t: "themes-changed" });
    };
    const sync = createThemeSync({
      repository: handle.repository,
      api,
      onLibraryChanged: () => {
        if (!isCurrent(handle)) return;
        tellOtherTabs();
        void refreshHandle(handle).catch(() => undefined);
      },
      onSettled: tellOtherTabs,
      onReport: (report) => updateCurrent(handle, (before) => ({ ...before, sync: report })),
    });
    syncRef.current = { handle, sync };
    if (channel !== null) {
      // Read again from storage and say nothing back, so two tabs cannot keep each other talking.
      channel.onmessage = (event: MessageEvent) => {
        if ((event.data as { t?: unknown } | null)?.t !== "themes-changed" || !isCurrent(handle)) return;
        void refreshHandle(handle).catch(() => undefined);
        sync.refresh();
      };
    }
    let settle: ReturnType<typeof setTimeout> | undefined;
    localChangeRef.current = (id) => {
      // The change is not on the server yet: stop showing it synced before the worker's next report.
      updateCurrent(handle, (before) => {
        if (before.sync === null) return before;
        const items = new Map(before.sync.items);
        items.set(id, { kind: "pending" });
        return { ...before, sync: { ...before.sync, items } };
      });
      tellOtherTabs();
      clearTimeout(settle);
      settle = setTimeout(() => sync.wake("local"), THEME_SETTLE_MS);
    };
    const onFocus = () => sync.wake("focus");
    const onOnline = () => sync.wake("online");
    const onVisible = () => {
      if (document.visibilityState === "visible") sync.wake("focus");
    };
    // The recurring pull runs only while the library is on screen and the tab is visible.
    const poll = setInterval(() => {
      if (watchersRef.current > 0 && document.visibilityState === "visible") sync.wake("poll");
    }, THEME_POLL_MS);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    sync.wake("start");
    return () => {
      sync.stop();
      if (syncRef.current?.sync === sync) syncRef.current = null;
      localChangeRef.current = null;
      clearTimeout(settle);
      clearInterval(poll);
      channel?.close();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // The scope identity stands for the account; the repository handle is read from its ref.
  }, [accountId, base, syncSwitch, ready, identity.generation, identity.scopeKey]);

  useEffect(() => {
    if (who === null || identity.scopeKey === null) {
      setState({
        ...identity,
        status: "checking",
        library: EMPTY_LIBRARY,
        drafts: EMPTY_DRAFTS,
        problem: null,
        appliedSource: null,
        sourceRemoved: false,
        sync: null,
      });
      return;
    }

    let cancelled = false;
    let opened: RepositoryHandle | null = null;
    setState({
      ...identity,
      status: "loading",
      library: EMPTY_LIBRARY,
      drafts: EMPTY_DRAFTS,
      problem: null,
      appliedSource: null,
      sourceRemoved: false,
      sync: null,
    });

    void openThemeRepository(who)
      .then(async (repository) => {
        const handle: RepositoryHandle = { ...identity, repository };
        if (cancelled || !isCurrent(handle)) {
          repository.close();
          return;
        }
        opened = handle;
        repositoryRef.current = handle;
        const [library, drafts, storedSource] = await Promise.all([
          repository.listLibrary(),
          repository.listDrafts(),
          repository.loadAppliedSource(),
        ]);
        assertCurrent(handle);
        const key = appearanceSnapshotKey(latestAppearance.current);
        const appliedSource = storedSource !== null && key !== null && storedSource.snapshotKey === key ? storedSource : null;
        updateCurrent(handle, (value) => ({
          ...value,
          status: "ready",
          library,
          drafts,
          problem: null,
          appliedSource,
          sourceRemoved: appliedSource !== null && !library.some(({ id }) => id === appliedSource.id),
        }));
      })
      .catch((error: unknown) => {
        if (cancelled || !isCurrent(identity)) return;
        if (opened !== null) opened.repository.close();
        if (repositoryRef.current === opened) repositoryRef.current = null;
        opened = null;
        setState({
          ...identity,
          status: "unavailable",
          library: EMPTY_LIBRARY,
          drafts: EMPTY_DRAFTS,
          problem: messageFor(error),
          appliedSource: null,
          sourceRemoved: false,
          sync: null,
        });
      });

    return () => {
      cancelled = true;
      const current = repositoryRef.current;
      if (current !== null && current.scopeKey === identity.scopeKey && current.generation === identity.generation) {
        current.repository.close();
        repositoryRef.current = null;
      } else if (opened !== null) {
        opened.repository.close();
      }
    };
  }, [identity.generation, identity.scopeKey]); // who is represented by the synchronous scope identity.

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute("data-widget")) applyBootAppearance(appearance, root, "app");
  }, [appearance]);

  const value = useMemo<ThemeContextValue>(() => {
    const visible =
      state.scopeKey === identity.scopeKey && state.generation === identity.generation
        ? state
        : {
            ...identity,
            status: identity.scopeKey === null ? ("checking" as const) : ("loading" as const),
            library: EMPTY_LIBRARY,
            drafts: EMPTY_DRAFTS,
            problem: null,
            appliedSource: null,
            sourceRemoved: false,
            sync: null,
          };

    const withRepository = async <T,>(operation: (repository: ThemeRepository, handle: RepositoryHandle) => Promise<T>): Promise<T> => {
      const handle = captureRepository(identity);
      const result = await operation(handle.repository, handle);
      assertCurrent(handle);
      return result;
    };

    const reload = async (): Promise<void> => {
      const available = repositoryRef.current;
      if (
        available !== null &&
        available.scopeKey === identity.scopeKey &&
        available.generation === identity.generation &&
        isCurrent(available)
      ) {
        await refreshHandle(available).catch((error: unknown) => {
          updateCurrent(identity, (before) => ({ ...before, problem: messageFor(error) }));
          throw error;
        });
        return;
      }

      const currentWho = whoRef.current;
      if (currentWho === null || identity.scopeKey === null || !isCurrent(identity)) throw unavailableError();
      const reopening = reopeningRef.current;
      if (reopening !== null && reopening.scopeKey === identity.scopeKey && reopening.generation === identity.generation) {
        return reopening.promise;
      }

      updateCurrent(identity, (before) => ({ ...before, status: "loading", problem: null }));
      const promise = (async () => {
        let repository: ThemeRepository | null = null;
        try {
          repository = await openThemeRepository(currentWho);
          const handle: RepositoryHandle = { ...identity, repository };
          if (!mountedRef.current || !isCurrent(handle)) throw staleError();
          repositoryRef.current = handle;
          await refreshHandle(handle);
          repository = null;
        } catch (error) {
          const handle = repositoryRef.current;
          if (handle !== null && handle.repository === repository) repositoryRef.current = null;
          repository?.close();
          updateCurrent(identity, (before) => ({
            ...before,
            status: "unavailable",
            library: EMPTY_LIBRARY,
            drafts: EMPTY_DRAFTS,
            problem: messageFor(error),
            appliedSource: null,
            sourceRemoved: false,
            sync: null,
          }));
          throw error;
        }
      })();
      const attempt: RepositoryReopening = { ...identity, promise };
      reopeningRef.current = attempt;
      try {
        await promise;
      } finally {
        if (reopeningRef.current === attempt) reopeningRef.current = null;
      }
    };

    const saveTheme: ThemeRepository["saveTheme"] = async (input) =>
      withRepository(async (repository, handle) => {
        if (input.expectedLocalRevision !== null) {
          const current = await repository.loadTheme(input.record.id);
          assertCurrent(handle);
          if (current?.kind !== "saved" || current.localRevision !== input.expectedLocalRevision) {
            return Object.freeze({ ok: false, reason: "conflict", current }) as ThemeCasResult<SavedThemeRow>;
          }
          if (current.record.contentRevision === Number.MAX_SAFE_INTEGER) {
            throw new ThemeStorageError("invalid-data", "Content revision cannot be incremented safely");
          }
        }
        const result = await repository.saveTheme(input);
        assertCurrent(handle);
        if (result.ok) {
          updateCurrent(handle, (before) => ({ ...before, library: upsert(before.library, result.value), problem: null }));
          localChangeRef.current?.(result.value.id);
        }
        return result;
      });

    const deleteTheme: ThemeRepository["deleteTheme"] = async (input) =>
      withRepository(async (repository, handle) => {
        const result = await repository.deleteTheme(input);
        assertCurrent(handle);
        if (result.ok) {
          updateCurrent(handle, (before) => ({
            ...before,
            library: Object.freeze(before.library.filter(({ id }) => id !== input.id)),
            problem: null,
            sourceRemoved: before.appliedSource?.id === input.id ? true : before.sourceRemoved,
          }));
          localChangeRef.current?.(input.id);
        }
        return result;
      });

    const saveDraft: ThemeRepository["saveDraft"] = async (input) =>
      withRepository(async (repository, handle) => {
        const result = await repository.saveDraft(input);
        assertCurrent(handle);
        if (result.ok) updateCurrent(handle, (before) => ({ ...before, drafts: upsert(before.drafts, result.value), problem: null }));
        return result;
      });

    const deleteDraft: ThemeRepository["deleteDraft"] = async (input) =>
      withRepository(async (repository, handle) => {
        const result = await repository.deleteDraft(input);
        assertCurrent(handle);
        if (result.ok) {
          updateCurrent(handle, (before) => ({
            ...before,
            drafts: Object.freeze(before.drafts.filter(({ id }) => id !== input.id)),
            problem: null,
          }));
        }
        return result;
      });

    const finalizeDraft: ThemeRepository["finalizeDraft"] = async (input) =>
      withRepository(async (repository, handle) => {
        const result = await repository.finalizeDraft(input);
        assertCurrent(handle);
        if (result.ok) {
          updateCurrent(handle, (before) => ({
            ...before,
            library: upsert(before.library, result.value),
            drafts: Object.freeze(before.drafts.filter(({ id }) => id !== input.draftId)),
            problem: null,
          }));
          localChangeRef.current?.(result.value.id);
        }
        return result;
      });

    const applyAppearance = async (next: BootAppearanceV1, source: AppliedThemeSourceV1 | null): Promise<void> => {
      if (!isCurrent(identity)) throw staleError();
      setDeviceAppearance(next);
      const handle = repositoryRef.current;
      if (handle === null || handle.scopeKey !== identity.scopeKey || handle.generation !== identity.generation || !isCurrent(handle)) {
        updateCurrent(identity, (before) => ({
          ...before,
          problem: "Appearance applied, but its library source could not be saved: Theme library is unavailable",
          appliedSource: null,
          sourceRemoved: false,
        }));
        return;
      }
      try {
        await handle.repository.saveAppliedSource(source);
        assertCurrent(handle);
        updateCurrent(handle, (before) => ({ ...before, problem: null, appliedSource: source, sourceRemoved: false }));
      } catch (error) {
        assertCurrent(handle);
        updateCurrent(handle, (before) => ({
          ...before,
          problem: `Appearance applied, but its library source could not be saved: ${messageFor(error)}`,
          appliedSource: null,
          sourceRemoved: false,
        }));
      }
    };

    const currentSnapshotKey = appearanceSnapshotKey(appearance);
    const visibleSource =
      visible.appliedSource !== null && currentSnapshotKey !== null && visible.appliedSource.snapshotKey === currentSnapshotKey
        ? visible.appliedSource
        : null;

    return {
      scopeKey: visible.scopeKey,
      status: visible.status,
      library: visible.library,
      drafts: visible.drafts,
      problem: visible.problem,
      applied: appearance,
      appliedSource: visibleSource,
      sourceRemoved: visibleSource !== null && visible.sourceRemoved,
      reload,
      saveTheme,
      deleteTheme,
      saveDraft,
      deleteDraft,
      finalizeDraft,
      applySystem: () => applyAppearance(SYSTEM_APPEARANCE, null),
      applyBuiltin: (id) => applyAppearance(Object.freeze({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin(id) }), null),
      applySaved: async (id, expectedLocalRevision) => {
        const handle = captureRepository(identity);
        const loaded = await handle.repository.loadTheme(id);
        assertCurrent(handle);
        if (loaded?.kind !== "saved" || loaded.localRevision !== expectedLocalRevision) {
          throw new ThemeStorageError("invalid-data", "The saved theme revision is no longer available");
        }
        const resolved = resolveThemeRecord(loaded.record);
        if (!resolved.ok) throw new ThemeStorageError("invalid-data", "The saved theme cannot be resolved", resolved.issues);
        const snapshotKey = presentationSnapshotKey(resolved.value);
        await applyAppearance(
          Object.freeze({ schemaVersion: 1, mode: "snapshot", snapshot: resolved.value }),
          Object.freeze({
            schemaVersion: 1,
            id: loaded.id,
            localRevision: loaded.localRevision,
            snapshotKey,
          }),
        );
      },
      sync:
        who === null || who.kind !== "account" || base === undefined
          ? DEVICE_ONLY_SYNC
          : {
              mode: syncSwitch ? "on" : "off",
              // With the switch off the last report is stale: show nothing synced, pending or noticed.
              phase: (syncSwitch ? visible.sync?.phase : undefined) ?? DEVICE_ONLY_SYNC.phase,
              items: (syncSwitch ? visible.sync?.items : undefined) ?? DEVICE_ONLY_SYNC.items,
              notices: (syncSwitch ? visible.sync?.notices : undefined) ?? DEVICE_ONLY_SYNC.notices,
              retry: () => syncRef.current?.sync.retry(),
              dismissNotice: (index) => syncRef.current?.sync.dismiss(index),
              watchLibrary: () => {
                watchersRef.current += 1;
                if (document.visibilityState === "visible") syncRef.current?.sync.wake("poll");
                return () => {
                  watchersRef.current = Math.max(0, watchersRef.current - 1);
                };
              },
            },
    };
  }, [appearance, identity, state, base, syncSwitch, who?.kind]);

  return (
    <ThemeContext.Provider value={value}>
      <LookChannelProvider inert={!publishLook}>{children}</LookChannelProvider>
    </ThemeContext.Provider>
  );
}

export function useThemes(): ThemeContextValue {
  return useContext(ThemeContext);
}
