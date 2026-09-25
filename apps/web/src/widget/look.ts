import { decodePresentationPin, encodePresentationPin, type PresentationSnapshotV1 } from "@runlog/themes";
import { applyBootAppearance, resolvedSnapshot, snapshotForBuiltin, type BootAppearanceV1 } from "../theme/appearance.ts";
import { applyTheme, type ThemeId } from "../theme/theme.ts";
import type { FollowedLook } from "./channel.ts";
import type { WidgetRoute } from "./route.ts";

/**
 * What a widget page looks like, decided once for the boot and the page alike.
 *
 * A pin that reads is the look. A legacy `theme=` keeps its old meaning. A
 * pin that does not read falls back to one fixed built-in, never to what
 * this browser has stored, which may be somebody else's. A theme link's
 * look comes after a legacy `theme=`. With none of these, the widget
 * follows this device, as an unpinned address always has.
 */
export type WidgetLook =
  | { readonly source: "pin"; readonly snapshot: PresentationSnapshotV1 }
  | { readonly source: "builtin"; readonly theme: Exclude<ThemeId, "system"> }
  | { readonly source: "channel"; readonly snapshot: PresentationSnapshotV1 }
  | { readonly source: "fallback"; readonly snapshot: PresentationSnapshotV1; readonly note: "pin" | "channel" | null }
  | { readonly source: "device"; readonly appearance: BootAppearanceV1 };

/** The look an unreadable pin or a link with nothing to show gets: the stylesheet's own default, the studio with the lights down. */
export const WIDGET_PIN_FALLBACK = "lights-down" satisfies Exclude<ThemeId, "system">;

/**
 * Pin, then a named built-in, then a theme link, then the device. A link
 * with nothing to show yet wears the fixed built-in, never what this
 * browser has stored; one that is gone says so.
 */
export function widgetLook(route: Pick<WidgetRoute, "theme" | "pin" | "ch">, device: BootAppearanceV1, channel?: FollowedLook): WidgetLook {
  if (route.pin !== undefined) {
    const decoded = decodePresentationPin(route.pin);
    if (decoded.ok) return Object.freeze({ source: "pin", snapshot: decoded.value });
    if (route.theme) return Object.freeze({ source: "builtin", theme: route.theme });
    return Object.freeze({ source: "fallback", snapshot: snapshotForBuiltin(WIDGET_PIN_FALLBACK), note: "pin" });
  }
  if (route.theme) return Object.freeze({ source: "builtin", theme: route.theme });
  if (route.ch !== undefined) {
    if (channel?.kind === "look") return Object.freeze({ source: "channel", snapshot: channel.snapshot });
    return Object.freeze({
      source: "fallback",
      snapshot: snapshotForBuiltin(WIDGET_PIN_FALLBACK),
      note: channel?.kind === "gone" ? "channel" : null,
    });
  }
  return Object.freeze({ source: "device", appearance: device });
}

/** Put the look on the page's root in widget scope. A pin sets no `data-theme`: it is values, not a name. */
export function applyWidgetLook(look: WidgetLook, root: HTMLElement): void {
  switch (look.source) {
    case "pin":
    case "channel":
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
  return encodePresentationPin(resolvedSnapshot(appearance, prefersLight));
}
