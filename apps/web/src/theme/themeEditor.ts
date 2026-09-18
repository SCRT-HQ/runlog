import {
  BUILTIN_PRESETS,
  COLOR_DEFINITIONS,
  FONT_ROLE_DEFINITIONS,
  createThemeRecordFromPreset,
  isColorTokenId,
  isFontAllowed,
  parseOpaqueColor,
  parseThemeRecord,
  type BuiltinColorBaseId,
  type ColorTokenId,
  type FontId,
  type FontRole,
  type ThemeRecordV1,
  type ThemeValidationIssue,
  type ThemeValidationResult,
} from "@runlog/themes";
import { parseThemeDraft, type ThemeDraftV1 } from "./themeDraft.ts";
import type { ThemeId } from "./theme.ts";

export type ThemeEdit =
  | { readonly type: "name"; readonly value: string }
  | { readonly type: "color"; readonly role: ColorTokenId; readonly value: string }
  | { readonly type: "font"; readonly role: FontRole; readonly value: FontId }
  | { readonly type: "reset-color"; readonly role: ColorTokenId }
  | { readonly type: "reset-font"; readonly role: FontRole }
  | { readonly type: "reset-all" }
  | { readonly type: "base"; readonly presetId: Exclude<ThemeId, "system"> };

function validationError(label: string, issues: readonly ThemeValidationIssue[]): TypeError {
  const detail = issues.map(({ path, message }) => `${path}: ${message}`).join("; ");
  return new TypeError(`Invalid ${label}: ${detail}`);
}

function requireDraft(input: ThemeDraftV1): ThemeDraftV1 {
  const parsed = parseThemeDraft(input);
  if (!parsed.ok) throw validationError("theme draft", parsed.issues);
  return parsed.value;
}

function requireRecord(input: unknown): ThemeRecordV1 {
  const parsed = parseThemeRecord(input);
  if (!parsed.ok) throw validationError("theme record", parsed.issues);
  return parsed.value;
}

function finishEdit(draft: ThemeDraftV1, record: ThemeRecordV1, rawName: string, rawColors: ThemeDraftV1["rawColors"]): ThemeDraftV1 {
  const parsed = parseThemeDraft({
    schemaVersion: draft.schemaVersion,
    id: draft.id,
    sourceThemeId: draft.sourceThemeId,
    baseLocalRevision: draft.baseLocalRevision,
    record,
    rawName,
    rawColors,
  });
  if (!parsed.ok) throw validationError("theme edit", parsed.issues);
  return parsed.value;
}

function withoutKey<T extends string, V>(record: Readonly<Partial<Record<T, V>>>, key: T): Partial<Record<T, V>> {
  return Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key)) as Partial<Record<T, V>>;
}

function isFontRole(value: unknown): value is FontRole {
  return FONT_ROLE_DEFINITIONS.some(({ id }) => id === value);
}

export function editThemeDraft(input: ThemeDraftV1, edit: ThemeEdit): ThemeDraftV1 {
  const draft = requireDraft(input);
  if (typeof edit !== "object" || edit === null) throw new TypeError("Invalid theme edit");

  switch (edit.type) {
    case "name": {
      if (typeof edit.value !== "string") throw new TypeError("Invalid theme name edit");
      const candidate = parseThemeRecord({ ...draft.record, name: edit.value });
      return finishEdit(draft, candidate.ok ? candidate.value : draft.record, edit.value, draft.rawColors);
    }
    case "color": {
      if (!isColorTokenId(edit.role) || typeof edit.value !== "string") throw new TypeError("Invalid theme color edit");
      const color = parseOpaqueColor(edit.value);
      const record =
        color === null
          ? draft.record
          : requireRecord({
              ...draft.record,
              overrides: {
                ...draft.record.overrides,
                colors: { ...draft.record.overrides.colors, [edit.role]: color },
              },
            });
      return finishEdit(draft, record, draft.rawName, { ...draft.rawColors, [edit.role]: edit.value });
    }
    case "font": {
      if (!isFontRole(edit.role) || !isFontAllowed(edit.role, edit.value)) throw new TypeError("Font is not allowed for this role");
      const record = requireRecord({
        ...draft.record,
        overrides: {
          ...draft.record.overrides,
          fonts: { ...draft.record.overrides.fonts, [edit.role]: edit.value },
        },
      });
      return finishEdit(draft, record, draft.rawName, draft.rawColors);
    }
    case "reset-color": {
      if (!isColorTokenId(edit.role)) throw new TypeError("Invalid theme color role");
      const record = requireRecord({
        ...draft.record,
        overrides: {
          ...draft.record.overrides,
          colors: withoutKey(draft.record.overrides.colors, edit.role),
        },
      });
      return finishEdit(draft, record, draft.rawName, withoutKey(draft.rawColors, edit.role));
    }
    case "reset-font": {
      if (!isFontRole(edit.role)) throw new TypeError("Invalid theme font role");
      const record = requireRecord({
        ...draft.record,
        overrides: {
          ...draft.record.overrides,
          fonts: withoutKey(draft.record.overrides.fonts, edit.role),
        },
      });
      return finishEdit(draft, record, draft.rawName, draft.rawColors);
    }
    case "reset-all": {
      const record = requireRecord({ ...draft.record, overrides: { colors: {}, fonts: {} } });
      return finishEdit(draft, record, draft.rawName, {});
    }
    case "base": {
      const preset = BUILTIN_PRESETS.find(({ id }) => id === edit.presetId);
      if (preset === undefined) throw new TypeError("Unknown built-in theme base");
      const baseRecord = createThemeRecordFromPreset({
        id: draft.record.id,
        name: draft.record.name,
        presetId: preset.id as BuiltinColorBaseId,
        contentRevision: draft.record.contentRevision,
      });
      if (!baseRecord.ok) throw validationError("theme base", baseRecord.issues);
      const record = requireRecord({ ...draft.record, base: baseRecord.value.base });
      return finishEdit(draft, record, draft.rawName, draft.rawColors);
    }
    default:
      throw new TypeError("Unknown theme edit type");
  }
}

function rawIssue(path: string, issue: ThemeValidationIssue): ThemeValidationIssue {
  return Object.freeze({ path, message: issue.message });
}

function invalidCandidate(issues: readonly ThemeValidationIssue[]): ThemeValidationResult<ThemeRecordV1> {
  return Object.freeze({ ok: false, issues: Object.freeze(issues) });
}

export function themeSaveCandidate(input: ThemeDraftV1): ThemeValidationResult<ThemeRecordV1> {
  const draft = parseThemeDraft(input);
  if (!draft.ok) return invalidCandidate(draft.issues);

  const issues: ThemeValidationIssue[] = [];
  const name = parseThemeRecord({ ...draft.value.record, name: draft.value.rawName });
  if (!name.ok) {
    for (const issue of name.issues) issues.push(rawIssue("$.rawName", issue));
  }

  for (const { id } of COLOR_DEFINITIONS) {
    if (!Object.hasOwn(draft.value.rawColors, id)) continue;
    const color = parseThemeRecord({
      ...draft.value.record,
      overrides: {
        ...draft.value.record.overrides,
        colors: { ...draft.value.record.overrides.colors, [id]: draft.value.rawColors[id] },
      },
    });
    if (!color.ok) {
      for (const issue of color.issues) issues.push(rawIssue(`$.rawColors.${id}`, issue));
    }
  }

  if (issues.length > 0) return invalidCandidate(issues);

  return parseThemeRecord({
    ...draft.value.record,
    name: draft.value.rawName,
    overrides: {
      ...draft.value.record.overrides,
      colors: { ...draft.value.record.overrides.colors, ...draft.value.rawColors },
    },
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function themeDraftKey(input: ThemeDraftV1): string {
  return canonicalJson(requireDraft(input));
}
