// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  BUILTIN_PRESETS,
  createThemeRecordFromPreset,
  getBuiltinColorBase,
  parsePresentationSnapshot,
  resolveColors,
  resolveFonts,
  resolveThemeRecord,
  snapshotToResolvedColors,
} from "@runlog/themes";
import { applyPresentation, clearPresentation, compilePresentation } from "./presentation.ts";

describe("portable snapshots at the browser presentation boundary", () => {
  it.each(BUILTIN_PRESETS)("round-trips $label without changing app or widget presentation", (preset) => {
    const record = createThemeRecordFromPreset({ id: "theme-test", name: "Portable", presetId: preset.id });
    if (!record.ok) throw new Error("Preset record did not validate");
    const resolved = resolveThemeRecord(record.value);
    if (!resolved.ok) throw new Error("Preset did not resolve");
    const restored = parsePresentationSnapshot(JSON.parse(JSON.stringify(resolved.value)));
    if (!restored.ok) throw new Error("Serialized snapshot did not validate");
    const base = getBuiltinColorBase(preset.id)!;
    for (const scope of ["app", "widget"] as const) {
      expect(
        compilePresentation(snapshotToResolvedColors(restored.value), restored.value.fonts, restored.value.colorScheme, scope),
      ).toEqual(compilePresentation(resolveColors(base.colors)!, resolveFonts(preset.fonts)!, base.colorScheme, scope));
    }
  });

  it("applies custom snapshot values only to the supplied preview and clears owned values", () => {
    const record = createThemeRecordFromPreset({ id: "theme-test", name: "Private library name", presetId: "rainbow-road" });
    if (!record.ok) throw new Error("Preset record did not validate");
    const resolved = resolveThemeRecord({
      ...record.value,
      overrides: {
        colors: {
          "interaction.moveAccent": "rgb(1 2 3)",
          "interaction.moveAccent2": "rgb(4 5 6)",
          "interaction.moveAccent3": "#789",
          "interaction.moveAccent4": "rgb(10 11 12)",
          "feedback.successBackground": "#123456",
        },
        fonts: { ui: "space-grotesk", widgetUi: "system-serif" },
      },
    });
    if (!resolved.ok) throw new Error("Custom record did not resolve");
    const restored = parsePresentationSnapshot(JSON.parse(JSON.stringify(resolved.value)));
    if (!restored.ok) throw new Error("Custom snapshot did not round-trip");
    const before = document.documentElement.getAttribute("style");
    const preview = document.createElement("section");
    preview.style.setProperty("--preview-only", "preserved");
    const presentation = compilePresentation(snapshotToResolvedColors(restored.value), restored.value.fonts, "light");
    expect(presentation).toMatchObject({
      "--move-accent": "#010203",
      "--move-accent-2": "#040506",
      "--move-accent-3": "#778899",
      "--move-accent-4": "#0a0b0c",
    });
    applyPresentation(presentation, preview);
    expect(preview.style.getPropertyValue("--move-accent")).toBe("#010203");
    expect(preview.style.getPropertyValue("--move-accent-2")).toBe("#040506");
    expect(preview.style.getPropertyValue("--move-accent-3")).toBe("#778899");
    expect(preview.style.getPropertyValue("--move-accent-4")).toBe("#0a0b0c");
    expect(preview.style.getPropertyValue("--success-background")).toBe("#123456");
    expect(preview.style.getPropertyValue("--font-ui")).toContain("Space Grotesk");
    expect(preview.style.getPropertyValue("--font-widget-ui")).toContain("Iowan Old Style");
    expect(document.documentElement.getAttribute("style")).toBe(before);
    expect(preview.style.cssText).not.toContain("Private library name");
    clearPresentation(preview);
    expect(preview.style.getPropertyValue("--move-accent")).toBe("");
    expect(preview.style.getPropertyValue("--move-accent-2")).toBe("");
    expect(preview.style.getPropertyValue("--move-accent-3")).toBe("");
    expect(preview.style.getPropertyValue("--move-accent-4")).toBe("");
    expect(preview.style.getPropertyValue("--success-background")).toBe("");
    expect(preview.style.getPropertyValue("--preview-only")).toBe("preserved");
  });
});
