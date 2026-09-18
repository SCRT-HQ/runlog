import { getBuiltinColorBase, type BuiltinColorBaseId } from "./colorBases.ts";
import { parseOpaqueColor, type HexColor } from "./color.ts";
import { COLOR_DEFINITIONS, type ColorTokenId, type CoreColorTokenId } from "./colorRegistry.ts";
import { FONT_ROLE_DEFINITIONS } from "./fontRoles.ts";
import { isFontAllowed, type AppFontRole, type FontId, type FontRole } from "./fonts.ts";
import { BUILTIN_PRESETS } from "./presets.ts";
import { invalid, isPositiveSafeInteger, readDataRecord, valid, type ThemeValidationResult } from "./validation.ts";

export interface ThemeBaseV1 {
  readonly id: string;
  readonly revision: number;
  readonly colorScheme: "light" | "dark";
  readonly colors: Readonly<Record<CoreColorTokenId, HexColor> & Partial<Record<Exclude<ColorTokenId, CoreColorTokenId>, HexColor>>>;
  readonly fonts: Readonly<Record<AppFontRole, FontId> & Partial<Record<Exclude<FontRole, AppFontRole>, FontId>>>;
}

export interface ThemeRecordV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly base: ThemeBaseV1;
  readonly overrides: {
    readonly colors: Readonly<Partial<Record<ColorTokenId, HexColor>>>;
    readonly fonts: Readonly<Partial<Record<FontRole, FontId>>>;
  };
  readonly contentRevision: number;
}

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const RECORD_KEYS = ["schemaVersion", "id", "name", "base", "overrides", "contentRevision"] as const;
const BASE_KEYS = ["id", "revision", "colorScheme", "colors", "fonts"] as const;
const OVERRIDE_KEYS = ["colors", "fonts"] as const;
const COLOR_KEYS = COLOR_DEFINITIONS.map(({ id }) => id);
const CORE_COLOR_KEYS = COLOR_DEFINITIONS.filter(({ kind }) => kind === "core").map(({ id }) => id);
const FONT_KEYS = FONT_ROLE_DEFINITIONS.map(({ id }) => id);
const APP_FONT_KEYS = FONT_ROLE_DEFINITIONS.filter(({ group }) => group === "app").map(({ id }) => id);

function parseIdentifier(input: unknown, path: string): ThemeValidationResult<string> {
  return typeof input === "string" && IDENTIFIER.test(input) ? valid(input) : invalid(path, "Invalid identifier");
}

function parseName(input: unknown, path: string): ThemeValidationResult<string> {
  if (typeof input !== "string") return invalid(path, "Expected a string");
  const value = input.trim();
  const length = Array.from(value).length;
  return length >= 1 && length <= 80 ? valid(value) : invalid(path, "Name must contain 1 to 80 Unicode code points");
}

function parseColors(
  input: unknown,
  path: string,
  requiredKeys: readonly string[],
): ThemeValidationResult<Readonly<Partial<Record<ColorTokenId, HexColor>>>> {
  const record = readDataRecord(input, path, COLOR_KEYS, requiredKeys);
  if (!record.ok) return record;

  const colors: Partial<Record<ColorTokenId, HexColor>> = {};
  for (const definition of COLOR_DEFINITIONS) {
    if (!Object.hasOwn(record.value, definition.id)) continue;
    const color = parseOpaqueColor(record.value[definition.id]);
    if (color === null) return invalid(`${path}.${definition.id}`, "Invalid opaque color");
    colors[definition.id] = color;
  }
  return valid(Object.freeze(colors));
}

function parseFonts(
  input: unknown,
  path: string,
  requiredKeys: readonly string[],
): ThemeValidationResult<Readonly<Partial<Record<FontRole, FontId>>>> {
  const record = readDataRecord(input, path, FONT_KEYS, requiredKeys);
  if (!record.ok) return record;

  const fonts: Partial<Record<FontRole, FontId>> = {};
  for (const definition of FONT_ROLE_DEFINITIONS) {
    if (!Object.hasOwn(record.value, definition.id)) continue;
    const value = record.value[definition.id];
    if (!isFontAllowed(definition.id, value)) return invalid(`${path}.${definition.id}`, "Font is not allowed for this role");
    fonts[definition.id] = value;
  }
  return valid(Object.freeze(fonts));
}

function parseBase(input: unknown): ThemeValidationResult<ThemeBaseV1> {
  const record = readDataRecord(input, "$.base", BASE_KEYS, BASE_KEYS);
  if (!record.ok) return record;
  const id = parseIdentifier(record.value.id, "$.base.id");
  if (!id.ok) return id;
  if (!isPositiveSafeInteger(record.value.revision)) return invalid("$.base.revision", "Expected a positive safe integer");
  if (record.value.colorScheme !== "light" && record.value.colorScheme !== "dark") {
    return invalid("$.base.colorScheme", "Expected light or dark");
  }
  const colors = parseColors(record.value.colors, "$.base.colors", CORE_COLOR_KEYS);
  if (!colors.ok) return colors;
  const fonts = parseFonts(record.value.fonts, "$.base.fonts", APP_FONT_KEYS);
  if (!fonts.ok) return fonts;

  return valid(
    Object.freeze({
      id: id.value,
      revision: record.value.revision,
      colorScheme: record.value.colorScheme,
      colors: colors.value as ThemeBaseV1["colors"],
      fonts: fonts.value as ThemeBaseV1["fonts"],
    }),
  );
}

function parseOverrides(input: unknown): ThemeValidationResult<ThemeRecordV1["overrides"]> {
  const record = readDataRecord(input, "$.overrides", OVERRIDE_KEYS, OVERRIDE_KEYS);
  if (!record.ok) return record;
  const colors = parseColors(record.value.colors, "$.overrides.colors", []);
  if (!colors.ok) return colors;
  const fonts = parseFonts(record.value.fonts, "$.overrides.fonts", []);
  if (!fonts.ok) return fonts;
  return valid(Object.freeze({ colors: colors.value, fonts: fonts.value }));
}

export function parseThemeRecord(input: unknown): ThemeValidationResult<ThemeRecordV1> {
  const record = readDataRecord(input, "$", RECORD_KEYS, RECORD_KEYS);
  if (!record.ok) return record;
  if (record.value.schemaVersion !== 1) return invalid("$.schemaVersion", "Unsupported schema version");
  const id = parseIdentifier(record.value.id, "$.id");
  if (!id.ok) return id;
  const name = parseName(record.value.name, "$.name");
  if (!name.ok) return name;
  const base = parseBase(record.value.base);
  if (!base.ok) return base;
  const overrides = parseOverrides(record.value.overrides);
  if (!overrides.ok) return overrides;
  if (!isPositiveSafeInteger(record.value.contentRevision)) {
    return invalid("$.contentRevision", "Expected a positive safe integer");
  }

  return valid(
    Object.freeze({
      schemaVersion: 1,
      id: id.value,
      name: name.value,
      base: base.value,
      overrides: overrides.value,
      contentRevision: record.value.contentRevision,
    }),
  );
}

export function createThemeRecordFromPreset(input: {
  id: string;
  name: string;
  presetId: BuiltinColorBaseId;
  baseRevision?: number;
  contentRevision?: number;
}): ThemeValidationResult<ThemeRecordV1> {
  const record = readDataRecord(input, "$", ["id", "name", "presetId", "baseRevision", "contentRevision"], ["id", "name", "presetId"]);
  if (!record.ok) return record;

  const preset = BUILTIN_PRESETS.find(({ id }) => id === record.value.presetId);
  if (preset === undefined) return invalid("$.presetId", "Unknown built-in preset");
  if (record.value.baseRevision !== undefined && !isPositiveSafeInteger(record.value.baseRevision)) {
    return invalid("$.baseRevision", "Expected a positive safe integer");
  }
  if (record.value.contentRevision !== undefined && !isPositiveSafeInteger(record.value.contentRevision)) {
    return invalid("$.contentRevision", "Expected a positive safe integer");
  }

  const base = getBuiltinColorBase(preset.id, record.value.baseRevision);
  if (base === null) return invalid("$.baseRevision", "Built-in preset revision is unavailable");

  return parseThemeRecord({
    schemaVersion: 1,
    id: record.value.id,
    name: record.value.name,
    base: {
      id: base.id,
      revision: base.revision,
      colorScheme: base.colorScheme,
      colors: base.colors,
      fonts: preset.fonts,
    },
    overrides: { colors: {}, fonts: {} },
    contentRevision: record.value.contentRevision ?? 1,
  });
}
