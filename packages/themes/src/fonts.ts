export type AppFontRole = "ui" | "prose" | "numeric" | "technical" | "display";

export type FontRole = AppFontRole | "widgetUi" | "widgetProse" | "widgetNumeric" | "widgetTechnical" | "widgetDisplay";

export type FontId =
  | "system-sans"
  | "system-serif"
  | "literata"
  | "ibm-plex-mono"
  | "system-mono"
  | "atkinson-hyperlegible-next"
  | "space-grotesk"
  | "oxanium"
  | "vt323"
  | "press-start-2p";

export interface FontDefinition {
  readonly id: FontId;
  readonly label: string;
  readonly roles: readonly AppFontRole[];
}

function fontDefinition(id: FontId, label: string, roles: readonly AppFontRole[]): Readonly<FontDefinition> {
  return Object.freeze({ id, label, roles: Object.freeze(roles) });
}

export const FONT_DEFINITIONS: readonly FontDefinition[] = Object.freeze([
  fontDefinition("system-sans", "System sans", ["ui", "prose", "display"]),
  fontDefinition("system-serif", "System serif", ["ui", "prose", "display"]),
  fontDefinition("literata", "Literata", ["ui", "prose", "display"]),
  fontDefinition("ibm-plex-mono", "IBM Plex Mono", ["ui", "prose", "numeric", "technical", "display"]),
  fontDefinition("system-mono", "System monospace", ["numeric", "technical", "display"]),
  fontDefinition("atkinson-hyperlegible-next", "Atkinson Hyperlegible Next", ["ui", "prose", "display"]),
  fontDefinition("space-grotesk", "Space Grotesk", ["ui", "prose", "display"]),
  fontDefinition("oxanium", "Oxanium", ["ui", "prose", "display"]),
  fontDefinition("vt323", "VT323", ["numeric", "display"]),
  fontDefinition("press-start-2p", "Press Start 2P", ["display"]),
]);

export const DEFAULT_APP_FONTS: Readonly<Record<AppFontRole, FontId>> = Object.freeze({
  ui: "system-sans",
  prose: "literata",
  numeric: "ibm-plex-mono",
  technical: "ibm-plex-mono",
  display: "system-sans",
});

export type ResolvedFonts = Readonly<Record<FontRole, FontId>>;

const APP_ROLES: readonly AppFontRole[] = ["ui", "prose", "numeric", "technical", "display"];

const FONT_ROLES: readonly FontRole[] = [...APP_ROLES, "widgetUi", "widgetProse", "widgetNumeric", "widgetTechnical", "widgetDisplay"];

const WIDGET_APP_ROLES: Readonly<Record<Exclude<FontRole, AppFontRole>, AppFontRole>> = Object.freeze({
  widgetUi: "ui",
  widgetProse: "prose",
  widgetNumeric: "numeric",
  widgetTechnical: "technical",
  widgetDisplay: "display",
});

type ValidatedFontRecord = Partial<Record<FontRole, FontId>>;

export function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && FONT_DEFINITIONS.some((definition) => definition.id === value);
}

export function isFontAllowed(role: FontRole, value: unknown): value is FontId {
  if (!isFontId(value)) return false;

  const appRole: AppFontRole = role in WIDGET_APP_ROLES ? WIDGET_APP_ROLES[role as keyof typeof WIDGET_APP_ROLES] : (role as AppFontRole);
  return FONT_DEFINITIONS.some((definition) => definition.id === value && definition.roles.includes(appRole));
}

function validateRecord(value: unknown, requireAppRoles: boolean): ValidatedFontRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;

  const validated: ValidatedFontRecord = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !FONT_ROLES.includes(key as FontRole)) return null;

    const role = key as FontRole;
    const descriptor = Object.getOwnPropertyDescriptor(value, role);
    if (descriptor === undefined || !("value" in descriptor) || !isFontAllowed(role, descriptor.value)) return null;
    validated[role] = descriptor.value;
  }

  if (requireAppRoles && APP_ROLES.some((role) => !Object.hasOwn(validated, role))) return null;
  return validated;
}

export function resolveFonts(base: unknown, overrides: unknown = {}): ResolvedFonts | null {
  const validBase = validateRecord(base, true);
  const validOverrides = validateRecord(overrides, false);
  if (validBase === null || validOverrides === null) return null;

  const ui = validOverrides.ui ?? validBase.ui!;
  const prose = validOverrides.prose ?? validBase.prose!;
  const numeric = validOverrides.numeric ?? validBase.numeric!;
  const technical = validOverrides.technical ?? validBase.technical!;
  const display = validOverrides.display ?? validBase.display!;

  return Object.freeze({
    ui,
    prose,
    numeric,
    technical,
    display,
    widgetUi: validOverrides.widgetUi ?? validBase.widgetUi ?? ui,
    widgetProse: validOverrides.widgetProse ?? validBase.widgetProse ?? prose,
    widgetNumeric: validOverrides.widgetNumeric ?? validBase.widgetNumeric ?? numeric,
    widgetTechnical: validOverrides.widgetTechnical ?? validBase.widgetTechnical ?? technical,
    widgetDisplay: validOverrides.widgetDisplay ?? validBase.widgetDisplay ?? display,
  });
}
