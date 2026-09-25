// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodePresentationPin,
  encodePresentationPin,
  presentationSnapshotKey,
  PRESENTATION_PIN_MAX_LENGTH,
  snapshotToResolvedColors,
} from "@runlog/themes";
import { afterEach, describe, expect, it } from "vitest";
import { applyBootAppearance, snapshotForBuiltin, type BootAppearanceV1 } from "../theme/appearance.ts";
import { compilePresentation } from "../theme/presentation.ts";
import { applyWidgetLook, pinFromAppearance, WIDGET_PIN_FALLBACK, widgetLook } from "./look.ts";

const here = dirname(fileURLToPath(import.meta.url));
const device = (id: Parameters<typeof snapshotForBuiltin>[0]): BootAppearanceV1 => ({
  schemaVersion: 1,
  mode: "snapshot",
  snapshot: snapshotForBuiltin(id),
});
const SYSTEM: BootAppearanceV1 = { schemaVersion: 1, mode: "system" };
const key = (look: ReturnType<typeof widgetLook>) =>
  look.source === "pin" || look.source === "fallback" || look.source === "channel" ? presentationSnapshotKey(look.snapshot) : null;

afterEach(() => {
  const root = document.documentElement;
  delete root.dataset.theme;
  for (const property of [...root.style]) root.style.removeProperty(property);
});

describe("which look a widget page takes", () => {
  it("takes a pin that reads, whatever the device or a legacy theme says", () => {
    const pin = encodePresentationPin(snapshotForBuiltin("glaze"));
    const look = widgetLook({ pin, theme: "ember" }, device("daylight"));
    expect(look.source).toBe("pin");
    expect(key(look)).toBe(presentationSnapshotKey(snapshotForBuiltin("glaze")));
  });

  it.each(["", "1.d.zz", "2.d.abc", "1.d.;background:url(x)", "1.d.".padEnd(PRESENTATION_PIN_MAX_LENGTH + 1, "a")])(
    "falls back to the fixed built-in for the unreadable pin %j, never to the device's stored look",
    (pin) => {
      const look = widgetLook({ pin }, device("rainbow-road"));
      expect(look.source).toBe("fallback");
      expect(key(look)).toBe(presentationSnapshotKey(snapshotForBuiltin(WIDGET_PIN_FALLBACK)));
    },
  );

  it("keeps a legacy theme beside an unreadable pin", () => {
    expect(widgetLook({ pin: "junk", theme: "ember" }, device("daylight"))).toEqual({ source: "builtin", theme: "ember" });
  });

  it("keeps the historical meaning of an address with no pin", () => {
    expect(widgetLook({ theme: "ember" }, device("daylight"))).toEqual({ source: "builtin", theme: "ember" });
    expect(widgetLook({}, device("daylight"))).toEqual({ source: "device", appearance: device("daylight") });
    expect(widgetLook({}, SYSTEM)).toEqual({ source: "device", appearance: SYSTEM });
  });
});

describe("putting the look on the page", () => {
  it("installs a pin in widget scope as values, with no theme name on the root", () => {
    const root = document.documentElement;
    const snapshot = snapshotForBuiltin("ember");
    applyWidgetLook({ source: "pin", snapshot }, root);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.style.getPropertyValue("--bg")).toBe(snapshot.colors["widget.ground"]);
    expect(root.style.getPropertyValue("--widget-text")).toBe(snapshot.colors["widget.text"]);
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
  });

  it("writes nothing from an unreadable pin but the fallback's own values", () => {
    const root = document.documentElement;
    applyWidgetLook(widgetLook({ pin: "1.d.;background:url(https://example.invalid/x)" }, device("daylight")), root);
    expect(root.getAttribute("style") ?? "").not.toMatch(/url\(|example\.invalid|expression/i);
    expect(root.style.getPropertyValue("--bg")).toBe(snapshotForBuiltin("lights-down").colors["widget.ground"]);
  });

  it("keeps the legacy path for a built-in named in the address", () => {
    const root = document.documentElement;
    applyWidgetLook({ source: "builtin", theme: "ember" }, root);
    expect(root.dataset.theme).toBe("ember");
  });
});

describe("pinning what this device shows", () => {
  it("pins the applied snapshot itself", () => {
    const pin = pinFromAppearance(device("stardust"), true);
    const decoded = decodePresentationPin(pin);
    expect(decoded.ok && presentationSnapshotKey(decoded.value)).toBe(presentationSnapshotKey(snapshotForBuiltin("stardust")));
  });

  it("resolves System at pin time to the look the stylesheet gives it then", () => {
    expect(pinFromAppearance(SYSTEM, true)).toBe(encodePresentationPin(snapshotForBuiltin("daylight")));
    expect(pinFromAppearance(SYSTEM, false)).toBe(encodePresentationPin(snapshotForBuiltin("lights-down")));
  });

  it("matches the stylesheet's System palettes, so a System pin looks like what was on screen", () => {
    const css = readFileSync(join(here, "..", "styles.css"), "utf8");
    const dark = css.match(/\n:root \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const light = css.match(/:root:not\(\[data-theme\]\) \{([\s\S]*?)\n {2}\}/)?.[1] ?? "";
    const properties = [
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
    for (const [block, id] of [
      [dark, "lights-down"],
      [light, "daylight"],
    ] as const) {
      const snapshot = snapshotForBuiltin(id);
      const presentation = compilePresentation(snapshotToResolvedColors(snapshot), snapshot.fonts, snapshot.colorScheme);
      for (const property of properties) {
        const literal = block.match(new RegExp(`\\n\\s*${property}:\\s*([^;]+);`))?.[1];
        expect([id, property, literal]).toEqual([id, property, presentation[property]]);
      }
    }
  });

  it("carries no stored appearance of the device into a pinned root", () => {
    const root = document.documentElement;
    applyBootAppearance(device("rainbow-road"), root, "widget");
    applyWidgetLook(widgetLook({ pin: encodePresentationPin(snapshotForBuiltin("glaze")) }, device("rainbow-road")), root);
    expect(root.style.getPropertyValue("--bg")).toBe(snapshotForBuiltin("glaze").colors["widget.ground"]);
  });
});

describe("a widget following a theme link", () => {
  const ch = "r".repeat(32);
  const followed = (id: Parameters<typeof snapshotForBuiltin>[0]) =>
    ({ kind: "look", snapshot: snapshotForBuiltin(id), revision: 2, from: "server" }) as const;

  it("takes the link's look below a pin and a named built-in, above the device", () => {
    const look = widgetLook({ ch }, device("daylight"), followed("glaze"));
    expect(look.source).toBe("channel");
    expect(key(look)).toBe(presentationSnapshotKey(snapshotForBuiltin("glaze")));
    expect(widgetLook({ ch, pin: encodePresentationPin(snapshotForBuiltin("ember")) }, device("daylight"), followed("glaze")).source).toBe(
      "pin",
    );
    expect(widgetLook({ ch, theme: "ember" }, device("daylight"), followed("glaze"))).toEqual({ source: "builtin", theme: "ember" });
  });

  it("wears the fixed built-in while it waits, and says so only when the link is gone", () => {
    for (const [channel, note] of [
      [{ kind: "waiting" }, null],
      [undefined, null],
      [{ kind: "gone" }, "channel"],
    ] as const) {
      const look = widgetLook({ ch }, device("rainbow-road"), channel);
      expect(look).toMatchObject({ source: "fallback", note });
      expect(key(look)).toBe(presentationSnapshotKey(snapshotForBuiltin(WIDGET_PIN_FALLBACK)));
    }
  });

  it("keeps the pin's own note for an unreadable pin", () => {
    expect(widgetLook({ pin: "junk" }, device("daylight"))).toMatchObject({ source: "fallback", note: "pin" });
  });

  it("installs a link's look in widget scope as values, with no theme name on the root", () => {
    const root = document.documentElement;
    const snapshot = snapshotForBuiltin("glaze");
    applyWidgetLook({ source: "channel", snapshot }, root);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.style.getPropertyValue("--bg")).toBe(snapshot.colors["widget.ground"]);
  });
});
