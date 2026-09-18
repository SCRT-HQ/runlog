import { parseOpaqueColor, type HexColor } from "./color.ts";
import {
  COLOR_DEFINITIONS,
  isColorTokenId,
  type ColorTokenId,
  type CoreColorTokenId,
  type DecorationColorTokenId,
  type FeedbackBackgroundTokenId,
  type WidgetColorTokenId,
} from "./colorRegistry.ts";

export interface ResolvedColors {
  readonly values: Readonly<Record<CoreColorTokenId | DecorationColorTokenId | WidgetColorTokenId, HexColor>>;
  readonly feedbackBackgrounds: Readonly<Record<FeedbackBackgroundTokenId, HexColor | null>>;
}

type ValidatedColors = Partial<Record<ColorTokenId, HexColor>>;

function validateColorRecord(input: unknown, requireCore: boolean): ValidatedColors | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;

  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return null;

  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);

  for (const key of keys) {
    if (typeof key !== "string" || !isColorTokenId(key)) return null;
  }

  const validated: ValidatedColors = {};
  for (const key of keys) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor || !("value" in descriptor)) return null;

    const color = parseOpaqueColor(descriptor.value);
    if (color === null) return null;
    validated[key as ColorTokenId] = color;
  }

  if (requireCore && COLOR_DEFINITIONS.some((definition) => definition.kind === "core" && validated[definition.id] === undefined)) {
    return null;
  }

  return validated;
}

export function resolveColors(base: unknown, overrides?: unknown): ResolvedColors | null {
  const validBase = validateColorRecord(base, true);
  if (validBase === null) return null;

  const validOverrides = overrides === undefined ? ({} satisfies ValidatedColors) : validateColorRecord(overrides, false);
  if (validOverrides === null) return null;

  const values: Partial<Record<CoreColorTokenId | DecorationColorTokenId | WidgetColorTokenId, HexColor>> = {};
  const feedbackBackgrounds: Partial<Record<FeedbackBackgroundTokenId, HexColor | null>> = {};

  for (const definition of COLOR_DEFINITIONS) {
    if (definition.kind !== "core") continue;
    values[definition.id] = validOverrides[definition.id] ?? validBase[definition.id]!;
  }

  for (const definition of COLOR_DEFINITIONS) {
    if (definition.kind !== "decoration") continue;
    values[definition.id] = validOverrides[definition.id] ?? validBase[definition.id] ?? values[definition.inherits]!;
  }

  for (const definition of COLOR_DEFINITIONS) {
    if (definition.kind !== "widget") continue;
    values[definition.id] = validOverrides[definition.id] ?? validBase[definition.id] ?? values[definition.inherits]!;
  }

  for (const definition of COLOR_DEFINITIONS) {
    if (definition.kind !== "feedbackBackground") continue;
    feedbackBackgrounds[definition.id] = validOverrides[definition.id] ?? validBase[definition.id] ?? null;
  }

  return Object.freeze({
    values: Object.freeze(values as Record<CoreColorTokenId | DecorationColorTokenId | WidgetColorTokenId, HexColor>),
    feedbackBackgrounds: Object.freeze(feedbackBackgrounds as Record<FeedbackBackgroundTokenId, HexColor | null>),
  });
}
