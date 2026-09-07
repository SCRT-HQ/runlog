import { useState } from "react";
import { applyTheme, rememberTheme, savedTheme, THEMES, isThemeId } from "./theme.ts";

/**
 * The switch for the lights. A native select: it is five options, it has to
 * work from the keyboard, and it should not be interesting.
 */
export function ThemeMenu() {
  const [theme, setTheme] = useState(() => savedTheme());
  return (
    <label className="themeMenu">
      <span>Theme</span>
      <select
        value={theme}
        aria-label="Theme"
        onChange={(e) => {
          const next = e.target.value;
          if (!isThemeId(next)) return;
          setTheme(next);
          applyTheme(next);
          rememberTheme(next);
        }}
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
