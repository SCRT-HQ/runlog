import type { BuiltinColorBaseId } from "./colorBases.ts";
import { DEFAULT_APP_FONTS, type AppFontRole, type FontId } from "./fonts.ts";

export interface BuiltinPreset {
  readonly id: BuiltinColorBaseId;
  readonly label: string;
  readonly fonts: Readonly<Record<AppFontRole, FontId>>;
}

function createPreset(id: BuiltinColorBaseId, label: string, fonts: Readonly<Record<AppFontRole, FontId>>): Readonly<BuiltinPreset> {
  return Object.freeze({ id, label, fonts: Object.freeze(fonts) });
}

export const BUILTIN_PRESETS: readonly Readonly<BuiltinPreset>[] = Object.freeze([
  createPreset("lights-down", "Lights down", DEFAULT_APP_FONTS),
  createPreset("daylight", "Daylight", DEFAULT_APP_FONTS),
  createPreset("ember", "Ember", DEFAULT_APP_FONTS),
  createPreset("glaze", "Glaze", DEFAULT_APP_FONTS),
  createPreset("high-contrast-dark", "High contrast dark", {
    ui: "atkinson-hyperlegible-next",
    prose: "atkinson-hyperlegible-next",
    numeric: "ibm-plex-mono",
    technical: "ibm-plex-mono",
    display: "atkinson-hyperlegible-next",
  }),
  createPreset("high-contrast-light", "High contrast light", {
    ui: "atkinson-hyperlegible-next",
    prose: "atkinson-hyperlegible-next",
    numeric: "ibm-plex-mono",
    technical: "ibm-plex-mono",
    display: "atkinson-hyperlegible-next",
  }),
  createPreset("retro-arcade", "Linked", {
    ui: "atkinson-hyperlegible-next",
    prose: "atkinson-hyperlegible-next",
    numeric: "vt323",
    technical: "ibm-plex-mono",
    display: "press-start-2p",
  }),
  createPreset("cyberpunk", "Spacewalk", {
    ui: "space-grotesk",
    prose: "space-grotesk",
    numeric: "ibm-plex-mono",
    technical: "ibm-plex-mono",
    display: "oxanium",
  }),
  createPreset("cyberpunk-neon", "Samurai", {
    ui: "space-grotesk",
    prose: "space-grotesk",
    numeric: "ibm-plex-mono",
    technical: "ibm-plex-mono",
    display: "oxanium",
  }),
]);
