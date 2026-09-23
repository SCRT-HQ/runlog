import { describe, expect, it } from "vitest";

import { BUILTIN_PRESETS, DEFAULT_APP_FONTS, getBuiltinColorBase, isFontAllowed, resolveFonts, type AppFontRole } from "./index.ts";

const expectedPresets = [
  ["lights-down", "Lights down", DEFAULT_APP_FONTS],
  ["daylight", "Daylight", DEFAULT_APP_FONTS],
  ["ember", "Ember", DEFAULT_APP_FONTS],
  ["glaze", "Glaze", DEFAULT_APP_FONTS],
  [
    "high-contrast-dark",
    "High contrast dark",
    {
      ui: "atkinson-hyperlegible-next",
      prose: "atkinson-hyperlegible-next",
      numeric: "ibm-plex-mono",
      technical: "ibm-plex-mono",
      display: "atkinson-hyperlegible-next",
    },
  ],
  [
    "high-contrast-light",
    "High contrast light",
    {
      ui: "atkinson-hyperlegible-next",
      prose: "atkinson-hyperlegible-next",
      numeric: "ibm-plex-mono",
      technical: "ibm-plex-mono",
      display: "atkinson-hyperlegible-next",
    },
  ],
  [
    "retro-arcade",
    "Linked",
    {
      ui: "atkinson-hyperlegible-next",
      prose: "atkinson-hyperlegible-next",
      numeric: "vt323",
      technical: "ibm-plex-mono",
      display: "press-start-2p",
    },
  ],
  [
    "cyberpunk",
    "Spacewalk",
    {
      ui: "space-grotesk",
      prose: "space-grotesk",
      numeric: "ibm-plex-mono",
      technical: "ibm-plex-mono",
      display: "oxanium",
    },
  ],
  [
    "cyberpunk-neon",
    "Samurai",
    {
      ui: "space-grotesk",
      prose: "space-grotesk",
      numeric: "ibm-plex-mono",
      technical: "ibm-plex-mono",
      display: "oxanium",
    },
  ],
  [
    "superstar",
    "Superstar",
    {
      ui: "atkinson-hyperlegible-next",
      prose: "atkinson-hyperlegible-next",
      numeric: "vt323",
      technical: "ibm-plex-mono",
      display: "press-start-2p",
    },
  ],
  [
    "rainbow-road",
    "Rainbow Road",
    {
      ui: "atkinson-hyperlegible-next",
      prose: "atkinson-hyperlegible-next",
      numeric: "vt323",
      technical: "ibm-plex-mono",
      display: "press-start-2p",
    },
  ],
  ["red-green-dark", "Cobalt dark", DEFAULT_APP_FONTS],
  ["red-green-light", "Cobalt light", DEFAULT_APP_FONTS],
  ["blue-yellow-dark", "Oxblood dark", DEFAULT_APP_FONTS],
  ["blue-yellow-light", "Oxblood light", DEFAULT_APP_FONTS],
] as const;

describe("built-in theme preset catalog", () => {
  it("preserves existing preset identities with legal, inherited widget fonts", () => {
    expect(BUILTIN_PRESETS).toBeDefined();
    if (!BUILTIN_PRESETS) return;
    expect(BUILTIN_PRESETS).toHaveLength(expectedPresets.length + 1);

    expectedPresets.forEach(([id, label, fonts]) => {
      const preset = BUILTIN_PRESETS.find((preset) => preset.id === id);
      expect(preset).toBeDefined();
      if (!preset) return;
      expect(preset).toEqual({ id, label, fonts });
      expect(Object.isFrozen(preset)).toBe(true);
      expect(Object.isFrozen(preset.fonts)).toBe(true);
      for (const [role, font] of Object.entries(preset.fonts)) expect(isFontAllowed(role as AppFontRole, font)).toBe(true);
      expect(resolveFonts(preset.fonts)).toMatchObject({
        widgetUi: fonts.ui,
        widgetProse: fonts.prose,
        widgetNumeric: fonts.numeric,
        widgetTechnical: fonts.technical,
        widgetDisplay: fonts.display,
      });
    });

    expect(BUILTIN_PRESETS.slice(0, 4).every(({ fonts }) => fonts === DEFAULT_APP_FONTS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_PRESETS)).toBe(true);
  });

  it("gives every built-in a palette of its own, so the applied one can be recognized", () => {
    const palettes = BUILTIN_PRESETS.map(({ id }) => JSON.stringify(getBuiltinColorBase(id)?.colors ?? null));
    expect(palettes).not.toContain("null");
    expect(new Set(palettes).size).toBe(palettes.length);
  });

  it("cannot be mutated to poison later consumers", () => {
    expect(BUILTIN_PRESETS).toBeDefined();
    if (!BUILTIN_PRESETS) return;
    const retro = BUILTIN_PRESETS.find(({ id }) => id === "retro-arcade")!;

    expect(() => {
      (retro.fonts as Record<string, string>).technical = "system-mono";
    }).toThrow(TypeError);
    expect(resolveFonts(retro.fonts)?.technical).toBe("ibm-plex-mono");
  });
});
