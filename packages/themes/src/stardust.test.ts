import { describe, expect, it } from "vitest";
import { BUILTIN_PRESETS, assessContrast, createThemeRecordFromPreset, getBuiltinColorBase, resolveThemeRecord } from "./index.ts";

describe("Stardust light companion", () => {
  it("resolves a portable light appearance with four Constellation-inspired accents and Spacewalk typography", () => {
    const record = createThemeRecordFromPreset({ id: "stardust-copy", name: "My Stardust", presetId: "stardust" });
    expect(record.ok).toBe(true);
    if (!record.ok) throw new Error("Stardust must be available");
    const snapshot = resolveThemeRecord(JSON.parse(JSON.stringify(record.value)));
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) throw new Error("Stardust must resolve");
    expect(snapshot.value.colorScheme).toBe("light");
    expect(snapshot.value.colors).toMatchObject({
      "surface.page": "#f2f1ea",
      "surface.panel": "#fcfbf6",
      "surface.raised": "#e4e5df",
      "text.primary": "#243449",
      "text.muted": "#505c68",
      "interaction.moveAccent": "#a2393d",
      "interaction.moveAccent2": "#315881",
      "interaction.moveAccent3": "#c49a50",
      "interaction.moveAccent4": "#9b411f",
    });
    expect(snapshot.value.fonts).toMatchObject({
      ui: "space-grotesk",
      prose: "space-grotesk",
      display: "oxanium",
      numeric: "ibm-plex-mono",
      technical: "ibm-plex-mono",
    });
    expect(getBuiltinColorBase("stardust", 1)).toMatchObject({ revision: 1, colorScheme: "light" });
    expect(getBuiltinColorBase("stardust", 2)).toBeNull();
    expect(BUILTIN_PRESETS.map((preset) => preset.id)).toEqual([
      "lights-down",
      "daylight",
      "ember",
      "glaze",
      "retro-arcade",
      "cyberpunk",
      "stardust",
      "cyberpunk-neon",
      "superstar",
      "rainbow-road",
      "red-green-dark",
      "red-green-light",
      "blue-yellow-dark",
      "blue-yellow-light",
      "high-contrast-dark",
      "high-contrast-light",
    ]);
  });

  it("keeps text and meaningful boundaries readable on its light surfaces and selected fill", () => {
    const base = getBuiltinColorBase("stardust");
    expect(base).not.toBeNull();
    if (!base) throw new Error("Missing Stardust");
    const colors = base.colors;
    for (const surface of ["surface.page", "surface.panel", "surface.raised"] as const) {
      for (const role of [
        "text.primary",
        "text.muted",
        "interaction.accent",
        "feedback.success",
        "feedback.warning",
        "feedback.danger",
      ] as const) {
        expect(assessContrast(colors[role], colors[surface], 4.5).passes, `${role}/${surface}`).toBe(true);
      }
      for (const role of ["boundary.control", "interaction.focus"] as const) {
        expect(assessContrast(colors[role], colors[surface], 3).passes, `${role}/${surface}`).toBe(true);
      }
    }
    for (const fill of ["interaction.accent", "feedback.warning"] as const) {
      expect(assessContrast(colors["text.onAccent"], colors[fill], 4.5).passes).toBe(true);
    }
    for (const role of ["text.primary", "text.muted"] as const) {
      expect(assessContrast(colors[role], colors["interaction.accentTint"], 4.5).passes).toBe(true);
    }
    expect(assessContrast(colors["interaction.selectedIndicator"], colors["interaction.accentTint"], 3).passes).toBe(true);
  });
});
