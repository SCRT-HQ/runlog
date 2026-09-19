import { useMemo, useState } from "react";
import { BUILTIN_PRESETS, getBuiltinColorBase, presentationSnapshotKey, resolveThemeRecord } from "@runlog/themes";
import { snapshotForBuiltin } from "./appearance.ts";
import { useThemeContrastReview } from "./ThemeContrastReview.tsx";
import { useThemes } from "./ThemeProvider.tsx";
import type { SavedThemeRow } from "./themeStorage.ts";

const HIGH_CONTRAST = new Set(["high-contrast-dark", "high-contrast-light"]);

interface PickerOption {
  readonly value: string;
  readonly label: string;
}

function builtinOptions(scheme: "light" | "dark"): PickerOption[] {
  return BUILTIN_PRESETS.filter((preset) => !HIGH_CONTRAST.has(preset.id) && getBuiltinColorBase(preset.id)?.colorScheme === scheme).map(
    (preset) => ({ value: `builtin:${preset.id}`, label: preset.label }),
  );
}

function savedOptions(library: readonly SavedThemeRow[], scheme: "light" | "dark"): PickerOption[] {
  return library
    .filter(({ record }) => record.base.colorScheme === scheme)
    .map(({ id, record }) => ({ value: `saved:${id}`, label: `${record.name} · Custom` }));
}

function currentSelection(themes: ReturnType<typeof useThemes>): string {
  if (themes.applied.mode === "system") return "system";

  if (themes.appliedSource !== null) {
    const source = themes.library.find(
      ({ id, localRevision }) => id === themes.appliedSource?.id && localRevision === themes.appliedSource.localRevision,
    );
    return source === undefined || themes.sourceRemoved ? "retained" : `saved:${source.id}`;
  }

  const key = presentationSnapshotKey(themes.applied.snapshot);
  const builtin = BUILTIN_PRESETS.find((preset) => presentationSnapshotKey(snapshotForBuiltin(preset.id)) === key);
  return builtin === undefined ? "retained" : `builtin:${builtin.id}`;
}

/** A keyboard-native quick picker backed by the guarded theme provider commands. */
export function ThemeMenu({ onOpenThemes }: { readonly onOpenThemes?: () => void } = {}) {
  const themes = useThemes();
  const contrast = useThemeContrastReview(themes.scopeKey);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const groups = useMemo(
    () => ({
      light: [...builtinOptions("light"), ...savedOptions(themes.library, "light")],
      dark: [...builtinOptions("dark"), ...savedOptions(themes.library, "dark")],
      high: BUILTIN_PRESETS.filter((preset) => HIGH_CONTRAST.has(preset.id)).map((preset) => ({
        value: `builtin:${preset.id}`,
        label: preset.label,
      })),
    }),
    [themes.library],
  );
  const selected = currentSelection(themes);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await operation();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The appearance could not be changed");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (value: string) => {
    if (value === "retained") return;
    if (value === "system") {
      await run(themes.applySystem);
      return;
    }
    if (value.startsWith("builtin:")) {
      const id = value.slice("builtin:".length);
      const preset = BUILTIN_PRESETS.find((candidate) => candidate.id === id);
      if (preset !== undefined) await run(() => themes.applyBuiltin(preset.id));
      return;
    }
    if (!value.startsWith("saved:")) return;
    const id = value.slice("saved:".length);
    const row = themes.library.find((candidate) => candidate.id === id);
    if (row === undefined) return;
    const resolved = resolveThemeRecord(row.record);
    if (!resolved.ok) {
      setProblem("That saved theme cannot be applied.");
      return;
    }
    if (!(await contrast.review(resolved.value, null))) return;
    await run(() => themes.applySaved(row.id, row.localRevision));
  };

  const renderOptions = (options: readonly PickerOption[]) =>
    options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ));

  return (
    <div className="themeMenu">
      <label>
        <span>Theme</span>
        <select value={selected} aria-label="Theme" disabled={busy} onChange={(event) => void choose(event.target.value)}>
          <option value="system">Match the system</option>
          {selected === "retained" && <option value="retained">Current appearance (retained)</option>}
          <optgroup label="Light themes">{renderOptions(groups.light)}</optgroup>
          <optgroup label="Dark themes">{renderOptions(groups.dark)}</optgroup>
          <optgroup label="High-contrast themes">{renderOptions(groups.high)}</optgroup>
        </select>
      </label>
      <div className="themeMenuActions">
        {onOpenThemes && (
          <button type="button" className="ghost" onClick={onOpenThemes}>
            Manage themes
          </button>
        )}
        <button type="button" className="ghost" disabled={busy} onClick={() => void run(themes.applySystem)}>
          Restore default
        </button>
      </div>
      {problem && (
        <p className="dangerText small" role="alert">
          {problem}
        </p>
      )}
      {contrast.dialog}
    </div>
  );
}
