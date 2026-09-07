/**
 * Which lights are on.
 *
 * Four looks, all the same app: the same two accents doing the same two jobs,
 * the same faces speaking in the same voices. What changes is the ground —
 * the studio with the lights down, daylight on paper, a kiln-lit room, or the
 * inside of a celadon glaze. Choosing is the player's, remembered on this
 * machine only, and "system" hands the choice back to the operating system.
 *
 * The tokens themselves live in styles.css under `[data-theme=…]`. This module
 * only knows the names and where the choice is kept.
 */

export const THEMES = [
  { id: "system", label: "Match the system" },
  { id: "lights-down", label: "Lights down" },
  { id: "daylight", label: "Daylight" },
  { id: "ember", label: "Ember" },
  { id: "glaze", label: "Glaze" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "runlog.theme";

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

/** The saved choice, or "system" when there is none or it cannot be read. */
export function savedTheme(): ThemeId {
  try {
    const value = localStorage.getItem(KEY);
    return isThemeId(value) ? value : "system";
  } catch {
    return "system";
  }
}

/**
 * Put the choice on the document.
 *
 * "system" removes the attribute rather than setting it, so the stylesheet's
 * `prefers-color-scheme` rule is what decides — the attribute is a decision,
 * and its absence is the decision not to make one.
 */
export function applyTheme(theme: ThemeId, root: HTMLElement = document.documentElement): void {
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function rememberTheme(theme: ThemeId): void {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Private windows and locked-down browsers: the choice lasts the tab.
  }
}
