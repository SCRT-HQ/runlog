import type { BuiltinColorBaseId } from "./colorBases.ts";
import { DEFAULT_APP_FONTS, type AppFontRole, type FontId } from "./fonts.ts";

export interface BuiltinPreset {
  readonly id: BuiltinColorBaseId;
  readonly label: string;
  readonly fonts: Readonly<Record<AppFontRole, FontId>>;
  /** One plain line on the palette and the fonts, or for a color vision preset the checks performed. */
  readonly description?: string;
}

function createPreset(
  id: BuiltinColorBaseId,
  label: string,
  fonts: Readonly<Record<AppFontRole, FontId>>,
  description?: string,
): Readonly<BuiltinPreset> {
  return Object.freeze({ id, label, fonts: Object.freeze(fonts), ...(description === undefined ? {} : { description }) });
}

export const BUILTIN_PRESETS: readonly Readonly<BuiltinPreset>[] = Object.freeze([
  createPreset(
    "lights-down",
    "Lights down",
    DEFAULT_APP_FONTS,
    "Warm charcoal, cream text and a soft sage accent; system sans, with Literata for longer text",
  ),
  createPreset(
    "daylight",
    "Daylight",
    DEFAULT_APP_FONTS,
    "Warm paper, near-black ink and a deep green accent; system sans, with Literata for longer text",
  ),
  createPreset(
    "ember",
    "Ember",
    DEFAULT_APP_FONTS,
    "Dark ember brown, warm cream text and a pale sage accent; system sans, with Literata for longer text",
  ),
  createPreset(
    "glaze",
    "Glaze",
    DEFAULT_APP_FONTS,
    "Deep green-black, pale mint text and a mint accent; system sans, with Literata for longer text",
  ),
  createPreset(
    "retro-arcade",
    "Linked",
    {
      ui: "atkinson-hyperlegible-next",
      prose: "atkinson-hyperlegible-next",
      numeric: "vt323",
      technical: "ibm-plex-mono",
      display: "press-start-2p",
    },
    "Dark green, lime accent and pale yellow-green text; pixel headings, terminal-style numbers, Atkinson Hyperlegible Next for text",
  ),
  createPreset(
    "cyberpunk",
    "Spacewalk",
    {
      ui: "space-grotesk",
      prose: "space-grotesk",
      numeric: "ibm-plex-mono",
      technical: "ibm-plex-mono",
      display: "oxanium",
    },
    "Deep navy, cool white text and a bright yellow accent; Space Grotesk, with Oxanium headings",
  ),
  createPreset(
    "stardust",
    "Stardust",
    {
      ui: "space-grotesk",
      prose: "space-grotesk",
      numeric: "ibm-plex-mono",
      technical: "ibm-plex-mono",
      display: "oxanium",
    },
    "Off-white, navy text and a rust accent; Space Grotesk, with Oxanium headings",
  ),
  createPreset(
    "cyberpunk-neon",
    "Samurai",
    {
      ui: "space-grotesk",
      prose: "space-grotesk",
      numeric: "ibm-plex-mono",
      technical: "ibm-plex-mono",
      display: "oxanium",
    },
    "Deep violet, hot pink accent and pale cyan details; Space Grotesk, with Oxanium headings",
  ),
  createPreset(
    "superstar",
    "Superstar",
    {
      ui: "atkinson-hyperlegible-next",
      prose: "atkinson-hyperlegible-next",
      numeric: "vt323",
      technical: "ibm-plex-mono",
      display: "press-start-2p",
    },
    "Pale lavender, deep indigo text and a purple accent; pixel headings, terminal-style numbers, Atkinson Hyperlegible Next for text",
  ),
  createPreset(
    "rainbow-road",
    "Rainbow Road",
    {
      ui: "atkinson-hyperlegible-next",
      prose: "atkinson-hyperlegible-next",
      numeric: "vt323",
      technical: "ibm-plex-mono",
      display: "press-start-2p",
    },
    "Light gray, charcoal text and a crimson accent; pixel headings, terminal-style numbers, Atkinson Hyperlegible Next for text",
  ),
  createPreset(
    "red-green-dark",
    "Cobalt dark",
    DEFAULT_APP_FONTS,
    "Blue, amber and coral status colors; checked with protan and deutan simulation",
  ),
  createPreset(
    "red-green-light",
    "Cobalt light",
    DEFAULT_APP_FONTS,
    "Blue, bronze and terracotta status colors; checked with protan and deutan simulation",
  ),
  createPreset(
    "blue-yellow-dark",
    "Oxblood dark",
    DEFAULT_APP_FONTS,
    "Teal, amber and coral red status colors; checked with tritan simulation",
  ),
  createPreset(
    "blue-yellow-light",
    "Oxblood light",
    DEFAULT_APP_FONTS,
    "Teal, bronze and deep red status colors; checked with tritan simulation",
  ),
  createPreset(
    "high-contrast-dark",
    "High contrast dark",
    {
      ui: "atkinson-hyperlegible-next",
      prose: "atkinson-hyperlegible-next",
      numeric: "ibm-plex-mono",
      technical: "ibm-plex-mono",
      display: "atkinson-hyperlegible-next",
    },
    "Black, white text and a gold accent; Atkinson Hyperlegible Next throughout, IBM Plex Mono for numbers",
  ),
  createPreset(
    "high-contrast-light",
    "High contrast light",
    {
      ui: "atkinson-hyperlegible-next",
      prose: "atkinson-hyperlegible-next",
      numeric: "ibm-plex-mono",
      technical: "ibm-plex-mono",
      display: "atkinson-hyperlegible-next",
    },
    "White, near-black text and a deep blue accent; Atkinson Hyperlegible Next throughout, IBM Plex Mono for numbers",
  ),
]);
