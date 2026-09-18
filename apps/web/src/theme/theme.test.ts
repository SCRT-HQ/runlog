// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, isThemeId, savedTheme, THEMES, type ThemeId } from "./theme.ts";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.theme;
});

describe("the lights", () => {
  it("offers the system's choice first, then every shared preset", () => {
    expect(THEMES[0].id).toBe("system");
    expect(THEMES.map((t) => t.id)).toEqual([
      "system",
      "lights-down",
      "daylight",
      "ember",
      "glaze",
      "high-contrast-dark",
      "high-contrast-light",
      "retro-arcade",
      "cyberpunk",
      "cyberpunk-neon",
    ]);
    expect(THEMES.filter(({ id }) => ["retro-arcade", "cyberpunk", "cyberpunk-neon"].includes(id))).toEqual([
      expect.objectContaining({ id: "retro-arcade", label: "Linked" }),
      expect.objectContaining({ id: "cyberpunk", label: "Spacewalk" }),
      expect.objectContaining({ id: "cyberpunk-neon", label: "Samurai" }),
    ]);
  });

  it("puts a chosen look on the document, and takes it off for system", () => {
    const el = document.createElement("section");
    applyTheme("ember", el);
    expect(el.dataset.theme).toBe("ember");
    expect(el.style.getPropertyValue("--bg")).toBe("#1a1210");
    // Absence is the decision to let prefers-color-scheme decide, so it must
    // be absent and not "system": a stylesheet cannot match on a rumor.
    applyTheme("system", el);
    expect("theme" in el.dataset).toBe(false);
    expect(el.style.getPropertyValue("--bg")).toBe("");
    expect(el.style.getPropertyValue("--font-ui")).toBe("");
    expect(el.style.getPropertyValue("color-scheme")).toBe("");
  });

  it("applies a preview without touching the document or saved preference", () => {
    localStorage.setItem("runlog.theme", "daylight");
    const preview = document.createElement("section");

    applyTheme("glaze", preview);

    expect(preview.dataset.theme).toBe("glaze");
    expect(preview.style.getPropertyValue("--bg")).toBe("#101a17");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");
    expect(localStorage.getItem("runlog.theme")).toBe("daylight");
  });

  it("clears stale owned styles when an impossible internal theme cannot resolve", () => {
    const el = document.createElement("section");
    el.style.setProperty("--unrelated", "kept");
    applyTheme("ember", el);

    applyTheme("missing" as ThemeId, el);

    expect(el.dataset.theme).toBeUndefined();
    expect(el.style.getPropertyValue("--bg")).toBe("");
    expect(el.style.getPropertyValue("--unrelated")).toBe("kept");
  });

  it("refuses a name it does not know, so a stale saved value is harmless", () => {
    expect(isThemeId("daylight")).toBe(true);
    expect(isThemeId("midnight")).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });

  it.each([
    [
      "high-contrast-dark",
      "#080808",
      "#ffdb66",
      '"Atkinson Hyperlegible Next Variable"',
      '"Atkinson Hyperlegible Next Variable"',
      '"IBM Plex Mono"',
      '"IBM Plex Mono"',
    ],
    [
      "high-contrast-light",
      "#ffffff",
      "#164a6e",
      '"Atkinson Hyperlegible Next Variable"',
      '"Atkinson Hyperlegible Next Variable"',
      '"IBM Plex Mono"',
      '"IBM Plex Mono"',
    ],
    ["retro-arcade", "#101810", "#a8ed70", '"Atkinson Hyperlegible Next Variable"', '"Press Start 2P"', '"VT323"', '"IBM Plex Mono"'],
    ["cyberpunk", "#11151e", "#f1ed69", '"Space Grotesk Variable"', '"Oxanium Variable"', '"IBM Plex Mono"', '"IBM Plex Mono"'],
    ["cyberpunk-neon", "#160d24", "#ff64d8", '"Space Grotesk Variable"', '"Oxanium Variable"', '"IBM Plex Mono"', '"IBM Plex Mono"'],
  ] as const)("installs the exact palette and font roles for %s", (id, page, accent, ui, display, numeric, technical) => {
    const el = document.createElement("section");

    applyTheme(id, el);

    expect(el.dataset.theme).toBe(id);
    expect(el.style.getPropertyValue("--bg")).toBe(page);
    expect(el.style.getPropertyValue("--accent")).toBe(accent);
    expect(el.style.getPropertyValue("--font-ui")).toContain(ui);
    expect(el.style.getPropertyValue("--font-display")).toContain(display);
    expect(el.style.getPropertyValue("--font-mono")).toContain(numeric);
    expect(el.style.getPropertyValue("--font-technical")).toContain(technical);
  });

  it("applies a saved Samurai choice through its legacy ID with the latest blue roles", () => {
    localStorage.setItem("runlog.theme", "cyberpunk-neon");

    const saved = savedTheme();
    applyTheme(saved);

    expect(saved).toBe("cyberpunk-neon");
    expect(document.documentElement.dataset.theme).toBe("cyberpunk-neon");
    expect(document.documentElement.style.getPropertyValue("--muted")).toBe("#b9dfff");
    expect(document.documentElement.style.getPropertyValue("--control-boundary")).toBe("#62cfff");
    expect(document.documentElement.style.getPropertyValue("--selected-indicator")).toBe("#62cfff");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#ff64d8");
    expect(isThemeId("retro-arcade")).toBe(true);
  });
});
