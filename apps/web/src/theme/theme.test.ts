import { describe, expect, it } from "vitest";
import { applyTheme, isThemeId, THEMES } from "./theme.ts";

/** A stand-in for the document element: only the dataset matters here. */
function root(): HTMLElement {
  return { dataset: {} as DOMStringMap } as HTMLElement;
}

describe("the lights", () => {
  it("offers the system's choice first, then the four looks", () => {
    expect(THEMES[0].id).toBe("system");
    expect(THEMES.map((t) => t.id)).toEqual(["system", "lights-down", "daylight", "ember", "glaze"]);
  });

  it("puts a chosen look on the document, and takes it off for system", () => {
    const el = root();
    applyTheme("ember", el);
    expect(el.dataset.theme).toBe("ember");
    // Absence is the decision to let prefers-color-scheme decide, so it must
    // be absent and not "system" — a stylesheet cannot match on a rumor.
    applyTheme("system", el);
    expect("theme" in el.dataset).toBe(false);
  });

  it("refuses a name it does not know, so a stale saved value is harmless", () => {
    expect(isThemeId("daylight")).toBe(true);
    expect(isThemeId("midnight")).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });
});
