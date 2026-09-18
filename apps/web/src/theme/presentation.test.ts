// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_APP_FONTS, getBuiltinColorBase, resolveColors, resolveFonts, type FontId, type ResolvedFonts } from "@runlog/themes";
import { describe, expect, it } from "vitest";
import { applyPresentation, clearPresentation, compilePresentation } from "./presentation.ts";

const here = dirname(fileURLToPath(import.meta.url));

function ember(overrides?: Record<string, string>) {
  const base = getBuiltinColorBase("ember")!;
  const colors = resolveColors(base.colors, overrides)!;
  const fonts = resolveFonts(DEFAULT_APP_FONTS, { widgetUi: "system-serif" })!;
  return { colors, fonts };
}

describe("browser presentation compilation", () => {
  it("maps every resolved color role to its independent browser property", () => {
    const base = getBuiltinColorBase("lights-down")!;
    const colors = resolveColors(base.colors, {
      "surface.page": "#010101",
      "surface.panel": "#020202",
      "surface.raised": "#030303",
      "text.primary": "#040404",
      "text.muted": "#050505",
      "text.onAccent": "#060606",
      "boundary.decorative": "#070707",
      "boundary.control": "#080808",
      "boundary.strong": "#090909",
      "interaction.accent": "#101010",
      "interaction.accentTint": "#111111",
      "interaction.selectedIndicator": "#121212",
      "interaction.focus": "#131313",
      "feedback.success": "#141414",
      "feedback.warning": "#151515",
      "feedback.danger": "#161616",
      "widget.ground": "#171717",
      "widget.panel": "#181818",
      "widget.text": "#191919",
      "widget.textMuted": "#202020",
      "widget.accent": "#212121",
      "feedback.successBackground": "#222222",
      "feedback.warningBackground": "#232323",
      "feedback.dangerBackground": "#242424",
    })!;
    const fonts = resolveFonts(DEFAULT_APP_FONTS)!;

    expect(compilePresentation(colors, fonts, "dark")).toMatchObject({
      "--bg": "#010101",
      "--panel": "#020202",
      "--panel-2": "#030303",
      "--text": "#040404",
      "--muted": "#050505",
      "--on-accent": "#060606",
      "--line": "#070707",
      "--control-boundary": "#080808",
      "--line-2": "#090909",
      "--accent": "#101010",
      "--accent-dim": "#111111",
      "--selected-indicator": "#121212",
      "--focus": "#131313",
      "--success": "#141414",
      "--warn": "#151515",
      "--err": "#161616",
      "--widget-ground": "#171717",
      "--widget-panel": "#181818",
      "--widget-text": "#191919",
      "--widget-text-muted": "#202020",
      "--widget-accent": "#212121",
      "--success-background": "#222222",
      "--warning-background": "#232323",
      "--danger-background": "#242424",
      "color-scheme": "dark",
    });
  });

  it("defaults to app roles and substitutes widget roles only in widget scope", () => {
    const { colors, fonts } = ember({ "widget.text": "#123456" });
    const app = document.createElement("section");
    const defaultApp = compilePresentation(colors, fonts, "dark");
    const explicitApp = compilePresentation(colors, fonts, "dark", "app");
    const widget = document.createElement("section");

    expect(defaultApp).toEqual(explicitApp);
    applyPresentation(defaultApp, app);
    applyPresentation(compilePresentation(colors, fonts, "dark", "widget"), widget);

    expect(widget.style.getPropertyValue("--text")).toBe("#123456");
    expect(app.style.getPropertyValue("--text")).toBe("#f1e4d3");
    expect(widget.style.getPropertyValue("--font-ui")).toBe('"Iowan Old Style", "Palatino Linotype", Georgia, serif');
    expect(app.style.getPropertyValue("--font-ui")).toBe('system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
  });

  it("installs active widget values on legacy aliases for a scoped preview", () => {
    const base = getBuiltinColorBase("ember")!;
    const colors = resolveColors(base.colors, {
      "widget.panel": "#112233",
      "widget.textMuted": "#223344",
    })!;
    const fonts = resolveFonts(DEFAULT_APP_FONTS, {
      numeric: "vt323",
      technical: "system-mono",
      widgetProse: "system-sans",
      widgetTechnical: "ibm-plex-mono",
    })!;
    const preview = document.createElement("section");
    preview.style.setProperty("--unrelated", "kept");

    applyPresentation(compilePresentation(colors, fonts, "dark", "widget"), preview);

    expect(preview.style.getPropertyValue("--surface")).toBe("#112233");
    expect(preview.style.getPropertyValue("--surface-raised")).toBe("#2e211c");
    expect(preview.style.getPropertyValue("--text-muted")).toBe("#223344");
    expect(preview.style.getPropertyValue("--danger")).toBe("#f08070");
    expect(preview.style.getPropertyValue("--serif")).toBe('system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
    expect(preview.style.getPropertyValue("--font-mono")).toBe('"VT323", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
    expect(preview.style.getPropertyValue("--font-technical")).toBe(
      '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    );
    expect(preview.style.getPropertyValue("--font-widget-technical")).toBe(
      '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    );
    expect(preview.style.getPropertyValue("--mono")).toBe('"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');

    clearPresentation(preview);
    for (const property of [
      "--surface",
      "--surface-raised",
      "--text-muted",
      "--danger",
      "--serif",
      "--mono",
      "--font-technical",
      "--font-widget-technical",
    ]) {
      expect(preview.style.getPropertyValue(property)).toBe("");
    }
    expect(preview.style.getPropertyValue("--unrelated")).toBe("kept");
  });

  it("keeps the app technical stack independent from its numeric stack", () => {
    const { colors } = ember();
    const fonts = resolveFonts(DEFAULT_APP_FONTS, { numeric: "vt323", technical: "system-mono" })!;
    const presentation = compilePresentation(colors, fonts, "dark");

    expect(presentation["--font-mono"]).toBe('"VT323", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
    expect(presentation["--font-technical"]).toBe("ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
    expect(presentation["--mono"]).toBe("ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
  });

  it("removes nullable feedback backgrounds and only the properties it owns", () => {
    const explicit = ember({ "feedback.successBackground": "#123456" });
    const derived = ember();
    const root = document.createElement("section");
    root.style.fontSize = "32px";
    root.style.setProperty("--unrelated", "kept");

    applyPresentation(compilePresentation(explicit.colors, explicit.fonts, "dark"), root);
    expect(root.style.getPropertyValue("--success-background")).toBe("#123456");
    applyPresentation(compilePresentation(derived.colors, derived.fonts, "dark"), root);
    expect(root.style.getPropertyValue("--success-background")).toBe("");

    clearPresentation(root);
    expect(root.style.getPropertyValue("--text")).toBe("");
    expect(root.style.getPropertyValue("color-scheme")).toBe("");
    expect(root.style.fontSize).toBe("32px");
    expect(root.style.getPropertyValue("--unrelated")).toBe("kept");
  });

  it("maps every registered font id to a fixed family with a safe fallback", () => {
    const expected: Record<FontId, string> = {
      "system-sans": 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      "system-serif": '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
      "system-mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      literata: '"Literata Variable", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
      "ibm-plex-mono": '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      "atkinson-hyperlegible-next": '"Atkinson Hyperlegible Next Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      "space-grotesk": '"Space Grotesk Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      oxanium: '"Oxanium Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      vt323: '"VT323", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      "press-start-2p": '"Press Start 2P", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    };
    const colors = ember().colors;

    for (const [id, family] of Object.entries(expected) as Array<[FontId, string]>) {
      const fonts = resolveFonts(DEFAULT_APP_FONTS, { display: id, widgetDisplay: id })!;
      const presentation = compilePresentation(colors, fonts, "dark");
      expect([id, presentation["--font-display"]]).toEqual([id, family]);
      expect([id, presentation["--font-widget-display"]]).toEqual([id, family]);
    }
  });

  it("returns a frozen record without mutating either resolved input", () => {
    const { colors, fonts } = ember();
    const colorSnapshot = JSON.stringify(colors);
    const fontSnapshot = JSON.stringify(fonts);

    const presentation = compilePresentation(colors, fonts, "dark", "widget");

    expect(Object.isFrozen(presentation)).toBe(true);
    expect(JSON.stringify(colors)).toBe(colorSnapshot);
    expect(JSON.stringify(fonts)).toBe(fontSnapshot);
  });

  it("keeps the four historical palette declarations aligned with shared bases", () => {
    const css = readFileSync(join(here, "..", "styles.css"), "utf8");
    const expected = {
      "lights-down": "dark",
      daylight: "light",
      ember: "dark",
      glaze: "dark",
    } as const;
    const legacyProperties = [
      "--bg",
      "--panel",
      "--panel-2",
      "--line",
      "--line-2",
      "--text",
      "--muted",
      "--accent",
      "--accent-dim",
      "--on-accent",
      "--warn",
      "--err",
    ] as const;

    for (const [id, scheme] of Object.entries(expected)) {
      const block = css.match(new RegExp(`:root\\[data-theme="${id}"\\] \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
      const base = getBuiltinColorBase(id)!;
      const colors = resolveColors(base.colors)!;
      const fonts = resolveFonts(DEFAULT_APP_FONTS)!;
      const presentation = compilePresentation(colors, fonts, scheme);
      for (const property of legacyProperties) {
        const literal = block.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1];
        expect([id, property, literal]).toEqual([id, property, presentation[property]]);
      }
    }
  });
});
