import { decodePresentationPin, encodePresentationPin, type PresentationSnapshotV1 } from "@runlog/themes";
import { applyBootAppearance, snapshotForBuiltin, type BootAppearanceV1 } from "../theme/appearance.ts";
import { applyTheme, type ThemeId } from "../theme/theme.ts";
import type { WidgetRoute } from "./route.ts";

/**
 * What a widget page looks like, decided once for the boot and the page alike.
 *
 * A pin that reads is the look. A legacy `theme=` keeps its old meaning. A
 * pin that does not read falls back to one fixed built-in, never to what
 * this browser has stored, which may be somebody else's. With neither, the
 * widget follows this device, as an unpinned address always has.
 */
export type WidgetLook =
  | { readonly source: "pin"; readonly snapshot: PresentationSnapshotV1 }
  | { readonly source: "builtin"; readonly theme: Exclude<ThemeId, "system"> }
  | { readonly source: "fallback"; readonly snapshot: PresentationSnapshotV1 }
  | { readonly source: "device"; readonly appearance: BootAppearanceV1 };

/** The look an unreadable pin gets: the stylesheet's own default, the studio with the lights down. */
export const WIDGET_PIN_FALLBACK = "lights-down" satisfies Exclude<ThemeId, "system">;

export function widgetLook(route: Pick<WidgetRoute, "theme" | "pin">, device: BootAppearanceV1): WidgetLook {
  if (route.pin !== undefined) {
    const decoded = decodePresentationPin(route.pin);
    if (decoded.ok) return Object.freeze({ source: "pin", snapshot: decoded.value });
    if (route.theme) return Object.freeze({ source: "builtin", theme: route.theme });
    return Object.freeze({ source: "fallback", snapshot: snapshotForBuiltin(WIDGET_PIN_FALLBACK) });
  }
  if (route.theme) return Object.freeze({ source: "builtin", theme: route.theme });
  return Object.freeze({ source: "device", appearance: device });
}

/** Put the look on the page's root in widget scope. A pin sets no `data-theme`: it is values, not a name. */
export function applyWidgetLook(look: WidgetLook, root: HTMLElement): void {
  switch (look.source) {
    case "pin":
    case "fallback":
      applyBootAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: look.snapshot }, root, "widget");
      return;
    case "builtin":
      applyTheme(look.theme, root, "widget");
      return;
    case "device":
      applyBootAppearance(look.appearance, root, "widget");
  }
}

/** Whether the operating system asks for light right now; false where it cannot be asked. */
export function systemPrefersLight(): boolean {
  try {
    return globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
  } catch {
    return false;
  }
}

/**
 * The pin for what this device shows now. A System choice is resolved to
 * the look the stylesheet gives it at this moment, so a later change of
 * the operating system's light does not reach the pin.
 */
export function pinFromAppearance(appearance: BootAppearanceV1, prefersLight: boolean = systemPrefersLight()): string {
  const snapshot = appearance.mode === "snapshot" ? appearance.snapshot : snapshotForBuiltin(prefersLight ? "daylight" : "lights-down");
  return encodePresentationPin(snapshot);
}
