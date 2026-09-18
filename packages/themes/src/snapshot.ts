import { parseOpaqueColor, type HexColor } from "./color.ts";
import {
  COLOR_DEFINITIONS,
  type ColorTokenDefinition,
  type CoreColorTokenId,
  type DecorationColorTokenId,
  type FeedbackBackgroundTokenId,
  type WidgetColorTokenId,
} from "./colorRegistry.ts";
import { resolveColors, type ResolvedColors } from "./colorResolver.ts";
import { FONT_ROLE_DEFINITIONS } from "./fontRoles.ts";
import { isFontAllowed, resolveFonts, type FontId, type FontRole, type ResolvedFonts } from "./fonts.ts";
import { parseThemeRecord } from "./records.ts";
import { invalid, readDataRecord, valid, type ThemeValidationResult } from "./validation.ts";

export type FeedbackBackgroundV1 = { readonly mode: "derived" } | { readonly mode: "explicit"; readonly color: HexColor };

export interface PresentationSnapshotV1 {
  readonly schemaVersion: 1;
  readonly tokenVersion: 1;
  readonly colorScheme: "light" | "dark";
  readonly colors: Readonly<Record<CoreColorTokenId | DecorationColorTokenId | WidgetColorTokenId, HexColor>>;
  readonly feedbackBackgrounds: Readonly<Record<FeedbackBackgroundTokenId, FeedbackBackgroundV1>>;
  readonly fonts: ResolvedFonts;
}

const SNAPSHOT_KEYS = ["schemaVersion", "tokenVersion", "colorScheme", "colors", "feedbackBackgrounds", "fonts"] as const;
const COLOR_DEFINITIONS_WITH_VALUES = COLOR_DEFINITIONS.filter(({ kind }) => kind !== "feedbackBackground") as readonly Exclude<
  ColorTokenDefinition,
  { readonly kind: "feedbackBackground" }
>[];
const COLOR_KEYS = COLOR_DEFINITIONS_WITH_VALUES.map(({ id }) => id);
const FEEDBACK_DEFINITIONS = COLOR_DEFINITIONS.filter(({ kind }) => kind === "feedbackBackground") as readonly Extract<
  ColorTokenDefinition,
  { readonly kind: "feedbackBackground" }
>[];
const FEEDBACK_KEYS = FEEDBACK_DEFINITIONS.map(({ id }) => id);
const FONT_KEYS = FONT_ROLE_DEFINITIONS.map(({ id }) => id);

function parseSnapshotColors(input: unknown): ThemeValidationResult<PresentationSnapshotV1["colors"]> {
  const record = readDataRecord(input, "$.colors", COLOR_KEYS, COLOR_KEYS);
  if (!record.ok) return record;
  const colors: Partial<Record<(typeof COLOR_KEYS)[number], HexColor>> = {};
  for (const definition of COLOR_DEFINITIONS_WITH_VALUES) {
    const color = parseOpaqueColor(record.value[definition.id]);
    if (color === null) return invalid(`$.colors.${definition.id}`, "Invalid opaque color");
    colors[definition.id] = color;
  }
  return valid(Object.freeze(colors) as PresentationSnapshotV1["colors"]);
}

function parseFeedbackBackground(input: unknown, id: FeedbackBackgroundTokenId): ThemeValidationResult<FeedbackBackgroundV1> {
  const path = `$.feedbackBackgrounds.${id}`;
  const record = readDataRecord(input, path, ["mode", "color"], ["mode"]);
  if (!record.ok) return record;
  if (record.value.mode === "derived") {
    if (Object.hasOwn(record.value, "color")) return invalid(`${path}.color`, "Derived backgrounds cannot contain a color");
    return valid(Object.freeze({ mode: "derived" }));
  }
  if (record.value.mode === "explicit") {
    if (!Object.hasOwn(record.value, "color")) return invalid(`${path}.color`, "Explicit backgrounds require a color");
    const color = parseOpaqueColor(record.value.color);
    return color === null ? invalid(`${path}.color`, "Invalid opaque color") : valid(Object.freeze({ mode: "explicit", color }));
  }
  return invalid(`${path}.mode`, "Expected derived or explicit");
}

function parseFeedbackBackgrounds(input: unknown): ThemeValidationResult<PresentationSnapshotV1["feedbackBackgrounds"]> {
  const record = readDataRecord(input, "$.feedbackBackgrounds", FEEDBACK_KEYS, FEEDBACK_KEYS);
  if (!record.ok) return record;
  const backgrounds: Partial<Record<FeedbackBackgroundTokenId, FeedbackBackgroundV1>> = {};
  for (const definition of FEEDBACK_DEFINITIONS) {
    const background = parseFeedbackBackground(record.value[definition.id], definition.id);
    if (!background.ok) return background;
    backgrounds[definition.id] = background.value;
  }
  return valid(Object.freeze(backgrounds) as PresentationSnapshotV1["feedbackBackgrounds"]);
}

function parseSnapshotFonts(input: unknown): ThemeValidationResult<ResolvedFonts> {
  const record = readDataRecord(input, "$.fonts", FONT_KEYS, FONT_KEYS);
  if (!record.ok) return record;
  const fonts: Partial<Record<FontRole, FontId>> = {};
  for (const definition of FONT_ROLE_DEFINITIONS) {
    const value = record.value[definition.id];
    if (!isFontAllowed(definition.id, value)) return invalid(`$.fonts.${definition.id}`, "Font is not allowed for this role");
    fonts[definition.id] = value;
  }
  return valid(Object.freeze(fonts) as ResolvedFonts);
}

export function parsePresentationSnapshot(input: unknown): ThemeValidationResult<PresentationSnapshotV1> {
  const record = readDataRecord(input, "$", SNAPSHOT_KEYS, SNAPSHOT_KEYS);
  if (!record.ok) return record;
  if (record.value.schemaVersion !== 1) return invalid("$.schemaVersion", "Unsupported schema version");
  if (record.value.tokenVersion !== 1) return invalid("$.tokenVersion", "Unsupported token version");
  if (record.value.colorScheme !== "light" && record.value.colorScheme !== "dark") {
    return invalid("$.colorScheme", "Expected light or dark");
  }
  const colors = parseSnapshotColors(record.value.colors);
  if (!colors.ok) return colors;
  const feedbackBackgrounds = parseFeedbackBackgrounds(record.value.feedbackBackgrounds);
  if (!feedbackBackgrounds.ok) return feedbackBackgrounds;
  const fonts = parseSnapshotFonts(record.value.fonts);
  if (!fonts.ok) return fonts;

  return valid(
    Object.freeze({
      schemaVersion: 1,
      tokenVersion: 1,
      colorScheme: record.value.colorScheme,
      colors: colors.value,
      feedbackBackgrounds: feedbackBackgrounds.value,
      fonts: fonts.value,
    }),
  );
}

export function resolveThemeRecord(input: unknown): ThemeValidationResult<PresentationSnapshotV1> {
  const record = parseThemeRecord(input);
  if (!record.ok) return record;
  const colors = resolveColors(record.value.base.colors, record.value.overrides.colors);
  if (colors === null) return invalid("$.colors", "Unable to resolve colors");
  const fonts = resolveFonts(record.value.base.fonts, record.value.overrides.fonts);
  if (fonts === null) return invalid("$.fonts", "Unable to resolve fonts");

  const feedbackBackgrounds: Partial<Record<FeedbackBackgroundTokenId, FeedbackBackgroundV1>> = {};
  for (const definition of FEEDBACK_DEFINITIONS) {
    const color = colors.feedbackBackgrounds[definition.id];
    feedbackBackgrounds[definition.id] = color === null ? { mode: "derived" } : { mode: "explicit", color };
  }
  return parsePresentationSnapshot({
    schemaVersion: 1,
    tokenVersion: 1,
    colorScheme: record.value.base.colorScheme,
    colors: colors.values,
    feedbackBackgrounds,
    fonts,
  });
}

function requireSnapshot(input: PresentationSnapshotV1): PresentationSnapshotV1 {
  const parsed = parsePresentationSnapshot(input);
  if (!parsed.ok) throw new TypeError(`Invalid presentation snapshot at ${parsed.issues[0]?.path ?? "$"}`);
  return parsed.value;
}

export function snapshotToResolvedColors(input: PresentationSnapshotV1): ResolvedColors {
  const snapshot = requireSnapshot(input);
  const backgrounds: Partial<Record<FeedbackBackgroundTokenId, HexColor | null>> = {};
  for (const definition of FEEDBACK_DEFINITIONS) {
    const background = snapshot.feedbackBackgrounds[definition.id];
    backgrounds[definition.id] = background.mode === "derived" ? null : background.color;
  }
  return Object.freeze({
    values: Object.freeze({ ...snapshot.colors }),
    feedbackBackgrounds: Object.freeze(backgrounds) as ResolvedColors["feedbackBackgrounds"],
  });
}

export function presentationSnapshotKey(input: PresentationSnapshotV1): string {
  return JSON.stringify(requireSnapshot(input));
}
