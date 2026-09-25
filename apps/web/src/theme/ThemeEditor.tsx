import {
  BUILTIN_PRESETS,
  COLOR_DEFINITIONS,
  FONT_DEFINITIONS,
  FONT_ROLE_DEFINITIONS,
  isFontAllowed,
  parseOpaqueColor,
  parseThemeRecord,
  resolveThemeRecord,
  type ColorTokenDefinition,
  type ColorTokenId,
  type BuiltinColorBaseId,
  type FontId,
  type FontRole,
  type HexColor,
  type PresentationSnapshotV1,
  type ThemeRecordV1,
} from "@runlog/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ulid } from "../storage/ids.ts";
import type { ContrastReport } from "./contrastWarnings.ts";
import { ThemeContrastReportView } from "./ThemeContrastReview.tsx";
import type { ThemeDraftV1 } from "./themeDraft.ts";
import { editThemeDraft, themeDraftKey, themeSaveCandidate, type ThemeEdit } from "./themeEditor.ts";
import { ThemePreview } from "./ThemePreview.tsx";
import type { SavedThemeRow, StoredThemeDraft, ThemeCasResult, ThemeFinalizeInput } from "./themeStorage.ts";
import { exportThemeJson } from "./themeTransfer.ts";

export interface ThemeEditorCommands {
  saveDraft(input: { draft: ThemeDraftV1; expectedLocalRevision: number | null }): Promise<ThemeCasResult<StoredThemeDraft>>;
  deleteDraft(input: { id: string; expectedLocalRevision: number }): Promise<ThemeCasResult<null>>;
  finalizeDraft(input: ThemeFinalizeInput): Promise<ThemeCasResult<SavedThemeRow>>;
  applySaved(row: SavedThemeRow): Promise<void>;
  reviewContrast(snapshot: PresentationSnapshotV1, widgetPreviewBackdrop: HexColor | null): Promise<boolean>;
  analyzeContrast(snapshot: PresentationSnapshotV1, widgetPreviewBackdrop: HexColor | null): ContrastReport | null;
}

export interface ThemeEditorLeaveState {
  readonly dirty: boolean;
  saveDraft(): Promise<boolean>;
  discard(): Promise<boolean>;
}

export interface ThemeEditorProps {
  readonly scopeKey: string;
  readonly initialDraft: ThemeDraftV1;
  readonly storedDraft: StoredThemeDraft | null;
  readonly initiallyDirty?: boolean;
  readonly commands: ThemeEditorCommands;
  readonly contrastReport?: ContrastReport | null;
  readonly contrastProblem?: string | null;
  readonly onClose: () => void;
  readonly onLeaveState?: (state: ThemeEditorLeaveState) => void;
}

const SIMPLE_COLOR_IDS = new Set<ColorTokenId>([
  "surface.page",
  "surface.panel",
  "surface.raised",
  "text.primary",
  "text.muted",
  "text.onAccent",
  "interaction.accent",
  "interaction.accentTint",
  "interaction.focus",
  "feedback.success",
  "feedback.warning",
  "feedback.danger",
]);

function newId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid === undefined ? `${prefix}_${ulid().toLowerCase()}` : `${prefix}_${uuid}`;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function snapshotFor(record: ThemeRecordV1): PresentationSnapshotV1 {
  const resolved = resolveThemeRecord(record);
  if (!resolved.ok) throw new TypeError(resolved.issues.map(({ path, message }) => `${path}: ${message}`).join("; "));
  return resolved.value;
}

function colorValue(snapshot: PresentationSnapshotV1, definition: ColorTokenDefinition): string {
  if (definition.kind !== "feedbackBackground") return snapshot.colors[definition.id];
  const background = snapshot.feedbackBackgrounds[definition.id];
  return background.mode === "derived" ? "Derived" : background.color;
}

function downloadJson(record: ThemeRecordV1): void {
  const blob = new Blob([exportThemeJson(record)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${record.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "theme"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

type PersistResult = StoredThemeDraft | null;

/** Registry-driven local editor. It previews the last valid record and delegates every durable write to the provider. */
export function ThemeEditor({
  scopeKey,
  initialDraft,
  storedDraft,
  initiallyDirty = false,
  commands,
  contrastReport = null,
  contrastProblem = null,
  onClose,
  onLeaveState,
}: ThemeEditorProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [dirty, setDirty] = useState(initiallyDirty);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [backdrop, setBackdrop] = useState<HexColor | null>("#ffffff" as HexColor);
  const [savedRow, setSavedRow] = useState<SavedThemeRow | null>(() =>
    initialDraft.sourceThemeId === null || initialDraft.baseLocalRevision === null
      ? null
      : { kind: "saved", id: initialDraft.sourceThemeId, localRevision: initialDraft.baseLocalRevision, record: initialDraft.record },
  );

  const latestDraft = useRef(initialDraft);
  const dirtyRef = useRef(initiallyDirty);
  const storedRef = useRef<StoredThemeDraft | null>(storedDraft);
  const persistedKeyRef = useRef(storedDraft === null ? null : themeDraftKey(storedDraft.draft));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const generationRef = useRef(0);
  const scopeRef = useRef(scopeKey);
  const mountedRef = useRef(true);

  const resolved = useMemo(() => snapshotFor(draft.record), [draft.record]);
  const baseSnapshot = useMemo(() => snapshotFor({ ...draft.record, overrides: { colors: {}, fonts: {} } }), [draft.record]);
  const candidate = useMemo(() => themeSaveCandidate(draft), [draft]);
  const issues = candidate.ok ? [] : candidate.issues;

  const cancelTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const enqueue = useCallback(
    (value: ThemeDraftV1): Promise<PersistResult> => {
      const generation = generationRef.current;
      let resolveResult: (value: PersistResult) => void = () => undefined;
      const result = new Promise<PersistResult>((resolve) => {
        resolveResult = resolve;
      });
      queueRef.current = queueRef.current
        .then(async () => {
          if (generationRef.current !== generation || scopeRef.current !== scopeKey) {
            resolveResult(null);
            return;
          }
          const expectedLocalRevision = storedRef.current?.localRevision ?? null;
          try {
            const saved = await commands.saveDraft({ draft: value, expectedLocalRevision });
            if (generationRef.current !== generation || scopeRef.current !== scopeKey || !mountedRef.current) {
              resolveResult(null);
              return;
            }
            if (!saved.ok) {
              setConflict(true);
              setProblem("A newer saved theme or draft exists. Your candidate is still here.");
              resolveResult(null);
              return;
            }
            storedRef.current = saved.value;
            persistedKeyRef.current = themeDraftKey(value);
            setProblem(null);
            resolveResult(saved.value);
          } catch (error) {
            if (generationRef.current === generation && scopeRef.current === scopeKey && mountedRef.current) {
              setProblem(`Draft was not saved: ${messageFor(error)}`);
            }
            resolveResult(null);
          }
        })
        .catch(() => undefined);
      return result;
    },
    [commands, scopeKey],
  );

  const flush = useCallback(async (): Promise<PersistResult> => {
    cancelTimer();
    await queueRef.current;
    const value = latestDraft.current;
    if (persistedKeyRef.current === themeDraftKey(value)) return storedRef.current;
    return enqueue(value);
  }, [cancelTimer, enqueue]);

  const schedule = useCallback(
    (value: ThemeDraftV1) => {
      cancelTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void enqueue(value);
      }, 500);
    },
    [cancelTimer, enqueue],
  );

  const beginNextDraft = useCallback(
    (value: ThemeDraftV1): ThemeDraftV1 => {
      if (dirtyRef.current || savedRow === null || storedRef.current !== null) return value;
      generationRef.current += 1;
      storedRef.current = null;
      persistedKeyRef.current = null;
      return { ...value, id: newId("draft"), sourceThemeId: savedRow.id, baseLocalRevision: savedRow.localRevision };
    },
    [savedRow],
  );

  const edit = useCallback(
    (change: ThemeEdit) => {
      const current = beginNextDraft(latestDraft.current);
      const next = editThemeDraft(current, change);
      latestDraft.current = next;
      dirtyRef.current = true;
      setDraft(next);
      setDirty(true);
      setNotice(null);
      setProblem(null);
      setConflict(false);
      schedule(next);
    },
    [beginNextDraft, schedule],
  );

  const adoptSaved = useCallback(
    (row: SavedThemeRow) => {
      cancelTimer();
      generationRef.current += 1;
      const clean: ThemeDraftV1 = {
        schemaVersion: 1,
        id: newId("draft"),
        sourceThemeId: row.id,
        baseLocalRevision: row.localRevision,
        record: row.record,
        rawName: row.record.name,
        rawColors: {},
      };
      latestDraft.current = clean;
      storedRef.current = null;
      persistedKeyRef.current = null;
      dirtyRef.current = false;
      setDraft(clean);
      setSavedRow(row);
      setDirty(false);
      setConflict(false);
    },
    [cancelTimer],
  );

  const finalizeValue = useCallback(
    async (saveAndApply: boolean, asCopy = false): Promise<SavedThemeRow | null> => {
      const valid = themeSaveCandidate(latestDraft.current);
      if (!valid.ok) return null;
      setBusy(true);
      setNotice(null);
      setProblem(null);
      let value = latestDraft.current;
      let record = valid.value;
      if (asCopy) {
        cancelTimer();
        await queueRef.current;
        generationRef.current += 1;
        const id = newId("theme");
        const parsed = parseThemeRecord({ ...record, id, contentRevision: 1 });
        if (!parsed.ok) {
          setProblem("The candidate could not be prepared as a new copy.");
          setBusy(false);
          return null;
        }
        record = parsed.value;
        value = {
          ...value,
          id: newId("draft"),
          sourceThemeId: null,
          baseLocalRevision: null,
          record,
        };
        latestDraft.current = value;
        storedRef.current = null;
        persistedKeyRef.current = null;
        dirtyRef.current = true;
        setDraft(value);
        setDirty(true);
      }

      try {
        const stored = await flush();
        if (stored === null) return null;
        const finalized = await commands.finalizeDraft({
          record,
          expectedLocalRevision: value.baseLocalRevision,
          draftId: stored.id,
          expectedDraftRevision: stored.localRevision,
        });
        if (!finalized.ok) {
          setConflict(true);
          setProblem("A newer saved theme or draft exists. Your candidate is still here; save it as a new copy.");
          return null;
        }
        const row = finalized.value;
        adoptSaved(row);
        setNotice("Saved on this device");
        if (!saveAndApply) return row;
        const snapshot = snapshotFor(row.record);
        if (!(await commands.reviewContrast(snapshot, backdrop))) {
          setNotice("Saved on this device. Apply was canceled.");
          return row;
        }
        try {
          await commands.applySaved(row);
          setNotice("Saved on this device and applied");
        } catch (error) {
          setNotice(`Saved on this device, but Apply failed: ${messageFor(error)}`);
        }
        return row;
      } catch (error) {
        setProblem(`Theme was not saved: ${messageFor(error)}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [adoptSaved, backdrop, cancelTimer, commands, flush],
  );

  const apply = useCallback(async () => {
    if (dirtyRef.current || savedRow === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const snapshot = snapshotFor(savedRow.record);
      if (!(await commands.reviewContrast(snapshot, backdrop))) return;
      await commands.applySaved(savedRow);
      setNotice("Applied saved theme");
    } catch (error) {
      setProblem(`Apply failed: ${messageFor(error)}`);
    } finally {
      setBusy(false);
    }
  }, [backdrop, commands, savedRow]);

  const saveForLeave = useCallback(async (): Promise<boolean> => (await flush()) !== null, [flush]);
  const discardForLeave = useCallback(async (): Promise<boolean> => {
    cancelTimer();
    await queueRef.current;
    const stored = storedRef.current;
    if (stored === null) return true;
    try {
      const result = await commands.deleteDraft({ id: stored.id, expectedLocalRevision: stored.localRevision });
      if (!result.ok) {
        setProblem("The draft changed before it could be discarded. It is still recoverable.");
        return false;
      }
      generationRef.current += 1;
      storedRef.current = null;
      persistedKeyRef.current = null;
      return true;
    } catch (error) {
      setProblem(`Draft was not discarded: ${messageFor(error)}`);
      return false;
    }
  }, [cancelTimer, commands]);

  useEffect(() => {
    onLeaveState?.({ dirty, saveDraft: saveForLeave, discard: discardForLeave });
  }, [dirty, discardForLeave, onLeaveState, saveForLeave]);

  useEffect(() => {
    commands.analyzeContrast(resolved, backdrop);
  }, [backdrop, commands, resolved]);

  useEffect(() => {
    if (scopeRef.current === scopeKey) return;
    scopeRef.current = scopeKey;
    generationRef.current += 1;
    cancelTimer();
  }, [cancelTimer, scopeKey]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      cancelTimer();
    };
  }, [cancelTimer]);

  const renderColor = (definition: ColorTokenDefinition) => {
    const raw = draft.rawColors[definition.id];
    const override = draft.record.overrides.colors[definition.id];
    const current = raw ?? override ?? (definition.kind === "feedbackBackground" ? "" : resolved.colors[definition.id]);
    const issue = issues.find(({ path }) => path === `$.rawColors.${definition.id}`);
    // The swatch shows what the field means now: its own value once it reads
    // as a color, and otherwise the color in force (inherited, or the last
    // valid one while a value is half typed). A derived feedback background
    // has no one color until one is picked, so it starts from the panel's.
    const baseValue = colorValue(baseSnapshot, definition);
    const baseHex = parseOpaqueColor(baseValue);
    const swatch = parseOpaqueColor(current) ?? parseOpaqueColor(colorValue(resolved, definition)) ?? resolved.colors["surface.panel"];
    return (
      <div className="themeTokenControl" data-color-role={definition.id} key={definition.id}>
        <div className="themeColorRow">
          <label>
            <span>{definition.label}</span>
            <code>{definition.id}</code>
            <input
              aria-label={definition.label}
              className="textInput"
              aria-invalid={issue === undefined ? undefined : true}
              aria-describedby={issue === undefined ? undefined : `theme-error-${definition.id}`}
              value={current}
              placeholder={definition.kind === "feedbackBackground" ? "Derived" : undefined}
              disabled={busy}
              onChange={(event) => edit({ type: "color", role: definition.id, value: event.target.value })}
            />
          </label>
          {/*
            The browser's own picker: a color area, RGB and hex entry, and in
            Chromium an eyedropper that samples anywhere on the screen. What
            it picks is written into the field as hex.
          */}
          <input
            type="color"
            className="themeColorSwatch"
            aria-label={`Pick ${definition.label}`}
            title={`Pick ${definition.label}`}
            value={swatch}
            disabled={busy}
            onChange={(event) => edit({ type: "color", role: definition.id, value: event.target.value })}
          />
        </div>
        <span className="muted small themeBaseColor">
          {baseHex !== null && <span className="themeBaseSwatch" style={{ backgroundColor: baseHex }} aria-hidden="true" />}
          Base or inherited: {baseValue}
        </span>
        {issue && (
          <span id={`theme-error-${definition.id}`} className="dangerText small">
            {issue.message}
          </span>
        )}
        <button type="button" className="ghost" disabled={busy} onClick={() => edit({ type: "reset-color", role: definition.id })}>
          Reset {definition.label}
        </button>
      </div>
    );
  };

  const renderFont = (role: FontRole, label: string) => (
    <div className="themeTokenControl" data-font-role={role} key={role}>
      <label>
        <span>{label}</span>
        <code>{role}</code>
        <select
          aria-label={label}
          className="textInput"
          value={resolved.fonts[role]}
          disabled={busy}
          onChange={(event) => edit({ type: "font", role, value: event.target.value as FontId })}
        >
          {FONT_DEFINITIONS.filter(({ id }) => isFontAllowed(role, id)).map(({ id, label: fontLabel }) => (
            <option value={id} key={id}>
              {fontLabel}
            </option>
          ))}
        </select>
      </label>
      <span className="muted small">Base or inherited: {baseSnapshot.fonts[role]}</span>
      <button type="button" className="ghost" disabled={busy} onClick={() => edit({ type: "reset-font", role })}>
        Reset {label}
      </button>
    </div>
  );

  const colors = COLOR_DEFINITIONS.filter(({ id }) => SIMPLE_COLOR_IDS.has(id));
  const advanced = COLOR_DEFINITIONS.filter(({ id, group }) => group !== "widgets" && !SIMPLE_COLOR_IDS.has(id));
  const widgetColors = COLOR_DEFINITIONS.filter(({ group }) => group === "widgets");
  const appFonts = FONT_ROLE_DEFINITIONS.filter(({ group }) => group === "app");
  const widgetFonts = FONT_ROLE_DEFINITIONS.filter(({ group }) => group === "widgets");
  const rawInvalid = !candidate.ok;

  return (
    <section className="themeEditor" aria-labelledby="themeEditorTitle" aria-busy={busy || undefined}>
      <header className="themeSectionHead">
        <div>
          <p className="eyebrow">Local editor</p>
          <h2 id="themeEditorTitle">Edit theme</h2>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          Back to themes
        </button>
      </header>

      <div className="themeEditorActions">
        <button type="button" className="primary" disabled={busy || rawInvalid || !dirty} onClick={() => void finalizeValue(false)}>
          Save
        </button>
        <button type="button" className="primary" disabled={busy || rawInvalid || !dirty} onClick={() => void finalizeValue(true)}>
          Save and apply
        </button>
        <button type="button" className="ghost" disabled={busy || dirty || savedRow === null} onClick={() => void apply()}>
          Apply
        </button>
        <button type="button" className="ghost" onClick={() => downloadJson(candidate.ok ? candidate.value : draft.record)}>
          Download theme JSON
        </button>
      </div>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {problem && (
        <p className="dangerText" role="alert">
          {problem}
        </p>
      )}
      {conflict && (
        <button type="button" className="primary" disabled={busy || rawInvalid} onClick={() => void finalizeValue(false, true)}>
          Save as new copy
        </button>
      )}
      {rawInvalid && (
        <p className="notice">The download exports the last valid theme; invalid raw values stay only in this recoverable draft.</p>
      )}

      <div className="themeEditorLayout">
        <div className="themeEditorControls">
          <label className="themeNameControl">
            <span>Theme name</span>
            <input
              className="textInput"
              value={draft.rawName}
              disabled={busy}
              onChange={(event) => edit({ type: "name", value: event.target.value })}
            />
          </label>
          {issues
            .filter(({ path }) => path === "$.rawName")
            .map((issue) => (
              <p className="dangerText small" key={issue.message}>
                {issue.message}
              </p>
            ))}

          <div className="themeEditorBaseActions">
            <label className="themeNameControl">
              <span>Base theme</span>
              <select
                className="textInput"
                value={draft.record.base.id}
                disabled={busy}
                onChange={(event) => edit({ type: "base", presetId: event.target.value as BuiltinColorBaseId })}
              >
                {BUILTIN_PRESETS.map(({ id, label }) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="ghost" disabled={busy} onClick={() => edit({ type: "reset-all" })}>
              Reset all overrides
            </button>
          </div>

          <section aria-labelledby="themeColorsTitle">
            <h3 id="themeColorsTitle">Colors</h3>
            <div className="themeTokenGrid">{colors.map(renderColor)}</div>
          </section>
          <section aria-labelledby="themeAdvancedTitle">
            <h3 id="themeAdvancedTitle">Advanced roles</h3>
            <div className="themeTokenGrid">{advanced.map(renderColor)}</div>
          </section>
          <section aria-labelledby="themeFontsTitle">
            <h3 id="themeFontsTitle">Fonts</h3>
            <div className="themeTokenGrid">{appFonts.map(({ id, label }) => renderFont(id, label))}</div>
          </section>
          <section aria-labelledby="themeWidgetsTitle">
            <h3 id="themeWidgetsTitle">Widgets</h3>
            <div className="themeTokenGrid">
              {widgetColors.map(renderColor)}
              {widgetFonts.map(({ id, label }) => renderFont(id, label))}
            </div>
          </section>
        </div>
        <div className="themeEditorPreview">
          <ThemePreview snapshot={resolved} onBackdropChange={setBackdrop} />
          {contrastProblem && <p className="dangerText">Contrast checks unavailable: {contrastProblem}</p>}
          <ThemeContrastReportView report={contrastReport} />
        </div>
      </div>
    </section>
  );
}
