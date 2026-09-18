// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, isThemeId, THEMES, type ThemeId } from "./theme.ts";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.theme;
});

describe("the lights", () => {
  it("offers the system's choice first, then the four looks", () => {
    expect(THEMES[0].id).toBe("system");
    expect(THEMES.map((t) => t.id)).toEqual(["system", "lights-down", "daylight", "ember", "glaze"]);
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
});
