import {
  BUILTIN_PRESETS,
  createThemeRecordFromPreset,
  parseThemeRecord,
  presentationSnapshotKey,
  resolveThemeRecord,
  type BuiltinColorBaseId,
  type ThemeRecordV1,
} from "@runlog/themes";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ulid } from "../storage/ids.ts";
import { applyBootAppearance, snapshotForBuiltin } from "./appearance.ts";
import { useThemeContrastReview } from "./ThemeContrastReview.tsx";
import { ThemeEditor, type ThemeEditorCommands, type ThemeEditorLeaveState } from "./ThemeEditor.tsx";
import { useThemeLeaveDialog } from "./ThemeLeaveDialog.tsx";
import { ThemeLibrary, type ThemeLibraryActions } from "./ThemeLibrary.tsx";
import { clearPresentation } from "./presentation.ts";
import { useThemes } from "./ThemeProvider.tsx";
import type { SavedThemeRow, StoredThemeDraft } from "./themeStorage.ts";
import { exportThemeJson, importThemeJson } from "./themeTransfer.ts";
import { Pick } from "../ui/Pick.tsx";

export interface ThemeStudioProps {
  readonly onBack: () => void;
  readonly registerLeaveGuard: (guard: (() => Promise<boolean>) | null) => void;
}

interface EditorSession {
  readonly scopeKey: string;
  readonly draft: StoredThemeDraft["draft"];
  readonly stored: StoredThemeDraft | null;
  readonly initiallyDirty: boolean;
}

function newId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid === undefined ? `${prefix}_${ulid().toLowerCase()}` : `${prefix}_${uuid}`;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requirePresetRecord(id: string, name: string, presetId: BuiltinColorBaseId): ThemeRecordV1 {
  const record = createThemeRecordFromPreset({ id, name, presetId });
  if (!record.ok) throw new TypeError(record.issues.map(({ path, message }) => `${path}: ${message}`).join("; "));
  return record.value;
}

function draftFor(record: ThemeRecordV1, source: SavedThemeRow | null = null): StoredThemeDraft["draft"] {
  return {
    schemaVersion: 1,
    id: newId("draft"),
    sourceThemeId: source?.id ?? null,
    baseLocalRevision: source?.localRevision ?? null,
    record,
    rawName: record.name,
    rawColors: {},
  };
}

function downloadRecord(record: ThemeRecordV1): void {
  const blob = new Blob([exportThemeJson(record)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${record.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "theme"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Routed local theme library and editor, isolated from the currently applied root appearance. */
export function ThemeStudio({ onBack, registerLeaveGuard }: ThemeStudioProps) {
  const themes = useThemes();
  const scopeKey = themes.scopeKey;
  const contrast = useThemeContrastReview(scopeKey);
  const leaveDialog = useThemeLeaveDialog(scopeKey ?? "unavailable:themes");
  const requestLeave = leaveDialog.request;
  const controlRoot = useRef<HTMLElement>(null);
  const leaveStateRef = useRef<ThemeEditorLeaveState | null>(null);
  const [session, setSession] = useState<EditorSession | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [safeColors, setSafeColors] = useState(false);

  const visibleSession = session?.scopeKey === scopeKey ? session : null;

  const syncRef = useRef(themes.sync);
  syncRef.current = themes.sync;
  useEffect(() => {
    if (visibleSession !== null) return undefined;
    return syncRef.current.watchLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSession === null, themes.sync.mode]);

  useLayoutEffect(() => {
    const root = controlRoot.current;
    if (root === null) return;
    if (safeColors) {
      applyBootAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("high-contrast-dark") }, root, "app");
    } else {
      clearPresentation(root);
    }
    return () => clearPresentation(root);
  }, [safeColors]);

  useEffect(() => {
    if (session === null || session.scopeKey === scopeKey) return;
    leaveStateRef.current = null;
    setEditorDirty(false);
    setSession(null);
    setProblem(null);
  }, [scopeKey, session]);

  const openEditor = useCallback((next: EditorSession) => {
    leaveStateRef.current = null;
    setEditorDirty(next.initiallyDirty);
    setProblem(null);
    setSession(next);
  }, []);

  const handleLeaveState = useCallback((state: ThemeEditorLeaveState) => {
    leaveStateRef.current = state;
    setEditorDirty(state.dirty);
  }, []);

  const finishEditor = useCallback(() => {
    leaveStateRef.current = null;
    setEditorDirty(false);
    setSession(null);
  }, []);

  const guard = useCallback(async (): Promise<boolean> => {
    const state = leaveStateRef.current;
    if (state === null || !state.dirty) return true;
    const accepted = await requestLeave(state);
    if (accepted) finishEditor();
    return accepted;
  }, [finishEditor, requestLeave]);

  useEffect(() => {
    registerLeaveGuard(visibleSession !== null && editorDirty ? guard : null);
    return () => registerLeaveGuard(null);
  }, [editorDirty, guard, registerLeaveGuard, visibleSession]);

  const closeEditor = useCallback(async () => {
    const current = leaveStateRef.current;
    if (current !== null && current.dirty && !(await requestLeave(current))) return;
    finishEditor();
  }, [finishEditor, requestLeave]);

  const preserveCandidate = useCallback(
    (record: ThemeRecordV1, source: SavedThemeRow | null, detail: string) => {
      if (scopeKey === null) return;
      openEditor({ scopeKey, draft: draftFor(record, source), stored: null, initiallyDirty: true });
      setProblem(detail);
    },
    [openEditor, scopeKey],
  );

  const actions = useMemo<ThemeLibraryActions>(
    () => ({
      create(base) {
        if (scopeKey === null) return;
        const record = requirePresetRecord(newId("theme"), "Untitled theme", base);
        openEditor({ scopeKey, draft: draftFor(record), stored: null, initiallyDirty: true });
      },
      editBuiltin(base) {
        if (scopeKey === null) return;
        const label = BUILTIN_PRESETS.find(({ id }) => id === base)?.label ?? "Built-in theme";
        const record = requirePresetRecord(newId("theme"), `${label} copy`, base);
        openEditor({ scopeKey, draft: draftFor(record), stored: null, initiallyDirty: true });
      },
      async applyBuiltin(base) {
        await themes.applyBuiltin(base);
      },
      editSaved(row) {
        if (scopeKey === null) return;
        openEditor({ scopeKey, draft: draftFor(row.record, row), stored: null, initiallyDirty: false });
      },
      duplicate(row) {
        if (scopeKey === null) return;
        const parsed = parseThemeRecord({ ...row.record, id: newId("theme"), name: `${row.record.name} copy`, contentRevision: 1 });
        if (!parsed.ok) {
          setProblem("The theme copy could not be prepared.");
          return;
        }
        openEditor({ scopeKey, draft: draftFor(parsed.value), stored: null, initiallyDirty: true });
      },
      async rename(row, name) {
        const parsed = parseThemeRecord({ ...row.record, name });
        if (!parsed.ok) {
          setProblem(parsed.issues.map(({ message }) => message).join(" "));
          return false;
        }
        try {
          const saved = await themes.saveTheme({ record: parsed.value, expectedLocalRevision: row.localRevision });
          if (saved.ok) return true;
          preserveCandidate(
            parsed.value,
            row,
            "A newer saved theme exists. Your renamed candidate is open and can be saved as a new copy.",
          );
          return false;
        } catch (error) {
          preserveCandidate(parsed.value, row, `The renamed candidate was not saved: ${messageFor(error)}`);
          return false;
        }
      },
      async delete(row) {
        try {
          return (await themes.deleteTheme({ id: row.id, expectedLocalRevision: row.localRevision })).ok;
        } catch (error) {
          setProblem(`The theme was not deleted: ${messageFor(error)}`);
          return false;
        }
      },
      async applySaved(row) {
        const resolved = resolveThemeRecord(row.record);
        if (!resolved.ok) throw new TypeError("That saved theme cannot be applied.");
        if (!(await contrast.review(resolved.value, null))) return;
        await themes.applySaved(row.id, row.localRevision);
      },
      async importText(text) {
        const imported = importThemeJson(text, newId("theme"));
        if (!imported.ok) {
          setProblem(imported.issues.map(({ path, message }) => `${path}: ${message}`).join("; "));
          return false;
        }
        try {
          const saved = await themes.saveTheme({ record: imported.value, expectedLocalRevision: null });
          if (saved.ok) return true;
          preserveCandidate(imported.value, null, "The imported candidate conflicted with local storage and is open as a new copy.");
          return false;
        } catch (error) {
          preserveCandidate(imported.value, null, `The imported candidate was not saved: ${messageFor(error)}`);
          return false;
        }
      },
      exportSaved(row) {
        downloadRecord(row.record);
      },
      recover(stored) {
        if (scopeKey === null) return;
        openEditor({ scopeKey, draft: stored.draft, stored, initiallyDirty: true });
      },
    }),
    [
      contrast.review,
      openEditor,
      preserveCandidate,
      scopeKey,
      themes.applyBuiltin,
      themes.applySaved,
      themes.deleteTheme,
      themes.saveTheme,
    ],
  );

  const editorCommands = useMemo<ThemeEditorCommands>(
    () => ({
      saveDraft: themes.saveDraft,
      deleteDraft: themes.deleteDraft,
      finalizeDraft: themes.finalizeDraft,
      applySaved: (row) => themes.applySaved(row.id, row.localRevision),
      reviewContrast: contrast.review,
      analyzeContrast: contrast.analyze,
    }),
    [contrast.analyze, contrast.review, themes.applySaved, themes.deleteDraft, themes.finalizeDraft, themes.saveDraft],
  );

  const appliedBuiltinId = useMemo(() => {
    if (themes.applied.mode !== "snapshot" || themes.appliedSource !== null) return null;
    const key = presentationSnapshotKey(themes.applied.snapshot);
    return BUILTIN_PRESETS.find(({ id }) => presentationSnapshotKey(snapshotForBuiltin(id)) === key)?.id ?? null;
  }, [themes.applied, themes.appliedSource]);
  const retainedAppearance = useMemo(
    () =>
      themes.sourceRemoved ||
      (themes.appliedSource !== null &&
        !themes.library.some(
          ({ id, localRevision }) => id === themes.appliedSource?.id && localRevision === themes.appliedSource.localRevision,
        )),
    [themes.appliedSource, themes.library, themes.sourceRemoved],
  );

  return (
    <main ref={controlRoot} className={`themeStudio${safeColors ? " themeStudioControl" : ""}`}>
      <header className="themeStudioHeader">
        <div>
          <p className="eyebrow">Appearance</p>
          <h1>Theme studio</h1>
        </div>
        <Pick kind="many" on={safeColors} className="ghost themeStudioSafetyControl" onClick={() => setSafeColors((before) => !before)}>
          Use safe editor colors
        </Pick>
        <button type="button" className="ghost" onClick={onBack}>
          Back
        </button>
      </header>

      {themes.status === "checking" || themes.status === "loading" ? (
        <p role="status">Loading themes…</p>
      ) : themes.status === "unavailable" || scopeKey === null ? (
        <section className="panel themeStudioUnavailable">
          <h2>Theme library unavailable</h2>
          <p className="dangerText">{themes.problem ?? "Local theme storage is unavailable."}</p>
          <button type="button" className="ghost" onClick={() => void themes.reload().catch(() => undefined)}>
            Try again
          </button>
        </section>
      ) : (
        <>
          {(problem ?? themes.problem) && (
            <p className="dangerText" role="alert">
              {problem ?? themes.problem}
            </p>
          )}
          {visibleSession === null ? (
            <ThemeLibrary
              library={themes.library}
              drafts={themes.drafts}
              appliedSource={themes.appliedSource}
              appliedBuiltinId={appliedBuiltinId}
              retainedAppearance={retainedAppearance}
              actions={actions}
              sync={themes.sync}
            />
          ) : (
            <ThemeEditor
              key={`${visibleSession.scopeKey}:${visibleSession.draft.id}`}
              scopeKey={visibleSession.scopeKey}
              initialDraft={visibleSession.draft}
              storedDraft={visibleSession.stored}
              initiallyDirty={visibleSession.initiallyDirty}
              commands={editorCommands}
              contrastReport={contrast.report}
              contrastProblem={contrast.problem}
              onClose={() => void closeEditor()}
              onLeaveState={handleLeaveState}
            />
          )}
        </>
      )}
      {contrast.dialog}
      {leaveDialog.dialog}
    </main>
  );
}
