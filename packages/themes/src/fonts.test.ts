import { describe, expect, it } from "vitest";

import { DEFAULT_APP_FONTS, FONT_DEFINITIONS, isFontAllowed, isFontId, resolveFonts, type AppFontRole, type FontId } from "./index.ts";

const base = {
  ui: "system-sans",
  prose: "literata",
  numeric: "ibm-plex-mono",
  display: "system-sans",
};

describe("curated theme fonts", () => {
  it("exposes the approved frozen definitions and defaults", () => {
    expect(FONT_DEFINITIONS).toEqual([
      { id: "system-sans", label: "System sans", roles: ["ui", "prose", "display"] },
      { id: "system-serif", label: "System serif", roles: ["ui", "prose", "display"] },
      { id: "literata", label: "Literata", roles: ["ui", "prose", "display"] },
      { id: "ibm-plex-mono", label: "IBM Plex Mono", roles: ["ui", "prose", "numeric", "display"] },
      { id: "system-mono", label: "System monospace", roles: ["numeric", "display"] },
      {
        id: "atkinson-hyperlegible-next",
        label: "Atkinson Hyperlegible Next",
        roles: ["ui", "prose", "display"],
      },
      { id: "space-grotesk", label: "Space Grotesk", roles: ["ui", "prose", "display"] },
      { id: "oxanium", label: "Oxanium", roles: ["ui", "prose", "display"] },
      { id: "vt323", label: "VT323", roles: ["numeric", "display"] },
      { id: "press-start-2p", label: "Press Start 2P", roles: ["display"] },
    ]);
    expect(DEFAULT_APP_FONTS).toEqual({
      ui: "system-sans",
      prose: "literata",
      numeric: "ibm-plex-mono",
      display: "system-sans",
    });
    expect(Object.isFrozen(FONT_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_APP_FONTS)).toBe(true);
    for (const definition of FONT_DEFINITIONS) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.roles)).toBe(true);
    }
  });

  it.each<[FontId, readonly AppFontRole[], readonly AppFontRole[]]>([
    ["system-sans", ["ui", "prose", "display"], ["numeric"]],
    ["system-serif", ["ui", "prose", "display"], ["numeric"]],
    ["literata", ["ui", "prose", "display"], ["numeric"]],
    ["ibm-plex-mono", ["ui", "prose", "numeric", "display"], []],
    ["system-mono", ["numeric", "display"], ["ui", "prose"]],
    ["atkinson-hyperlegible-next", ["ui", "prose", "display"], ["numeric"]],
    ["space-grotesk", ["ui", "prose", "display"], ["numeric"]],
    ["oxanium", ["ui", "prose", "display"], ["numeric"]],
    ["vt323", ["numeric", "display"], ["ui", "prose"]],
    ["press-start-2p", ["display"], ["ui", "prose", "numeric"]],
  ])("enforces the approved roles for %s", (id, allowed, denied) => {
    expect(isFontId(id)).toBe(true);
    for (const role of allowed) expect(isFontAllowed(role, id)).toBe(true);
    for (const role of denied) expect(isFontAllowed(role, id)).toBe(false);
  });

  it("uses the corresponding app-role allowlist for widgets", () => {
    expect(isFontAllowed("widgetUi", "space-grotesk")).toBe(true);
    expect(isFontAllowed("widgetProse", "literata")).toBe(true);
    expect(isFontAllowed("widgetNumeric", "vt323")).toBe(true);
    expect(isFontAllowed("widgetDisplay", "press-start-2p")).toBe(true);
    expect(isFontAllowed("widgetUi", "system-mono")).toBe(false);
    expect(isFontAllowed("widgetProse", "vt323")).toBe(false);
    expect(isFontAllowed("widgetNumeric", "oxanium")).toBe(false);
  });

  it.each([
    "System-sans",
    " system-sans",
    "system-sans ",
    'system-ui, "sans-serif"',
    "unknown-font",
    "url(https://example.test/font)",
    null,
    undefined,
    1,
    {},
    [],
  ])("rejects non-exact font IDs %j", (value) => {
    expect(isFontId(value)).toBe(false);
  });

  it("resolves app overrides before widget inheritance", () => {
    expect(resolveFonts(base, { ui: "space-grotesk", display: "oxanium" })).toEqual({
      ui: "space-grotesk",
      prose: "literata",
      numeric: "ibm-plex-mono",
      display: "oxanium",
      widgetUi: "space-grotesk",
      widgetProse: "literata",
      widgetNumeric: "ibm-plex-mono",
      widgetDisplay: "oxanium",
    });
  });

  it("defaults omitted overrides to pure app-to-widget inheritance", () => {
    expect(resolveFonts(base)).toEqual({
      ui: "system-sans",
      prose: "literata",
      numeric: "ibm-plex-mono",
      display: "system-sans",
      widgetUi: "system-sans",
      widgetProse: "literata",
      widgetNumeric: "ibm-plex-mono",
      widgetDisplay: "system-sans",
    });
  });

  it("prefers explicit widget values over their resolved app values", () => {
    expect(resolveFonts({ ...base, widgetNumeric: "vt323" }, { numeric: "system-mono" })?.widgetNumeric).toBe("vt323");
    expect(resolveFonts({ ...base, widgetDisplay: "system-serif" }, { widgetDisplay: "press-start-2p" })?.widgetDisplay).toBe(
      "press-start-2p",
    );
  });

  it("makes widgets inherit again after an override is removed", () => {
    const overrides: { ui: FontId; widgetUi?: FontId } = { ui: "space-grotesk", widgetUi: "system-serif" };
    expect(resolveFonts(base, overrides)?.widgetUi).toBe("system-serif");

    delete overrides.widgetUi;

    expect(resolveFonts(base, overrides)?.widgetUi).toBe("space-grotesk");
  });

  it("rejects role-incompatible values", () => {
    expect(resolveFonts(base, { ui: "press-start-2p" })).toBeNull();
    expect(resolveFonts(base, { widgetNumeric: "oxanium" })).toBeNull();
    expect(isFontAllowed("display", "press-start-2p")).toBe(true);
    expect(isFontId("url(https://example.test/font)")).toBe(false);
  });

  it.each([
    ["missing app role", { ui: "system-sans", prose: "literata", numeric: "ibm-plex-mono" }, undefined],
    ["unknown base key", { ...base, accent: "system-sans" }, undefined],
    ["unknown override key", base, { accent: "system-sans" }],
    ["base array", [base], undefined],
    ["null base", null, undefined],
    ["override array", base, []],
    ["null overrides", base, null],
    ["own undefined base", { ...base, ui: undefined }, undefined],
    ["own undefined override", base, { widgetUi: undefined }],
    ["own null base", { ...base, ui: null }, undefined],
    ["own null override", base, { widgetUi: null }],
  ])("rejects malformed records: %s", (_name, candidateBase, overrides) => {
    expect(resolveFonts(candidateBase, overrides)).toBeNull();
  });

  it("rejects symbol keys in base and overrides", () => {
    const symbol = Symbol("font");
    expect(resolveFonts({ ...base, [symbol]: "system-sans" })).toBeNull();
    expect(resolveFonts(base, { [symbol]: "system-sans" })).toBeNull();
  });

  it("rejects inherited app roles and custom prototypes", () => {
    const inherited = Object.create(base) as Record<string, unknown>;
    expect(resolveFonts(inherited)).toBeNull();
    expect(resolveFonts(base, Object.create({ ui: "space-grotesk" }) as object)).toBeNull();
  });

  it("accepts null-prototype records", () => {
    const nullBase = Object.assign(Object.create(null) as Record<string, unknown>, base);
    const nullOverrides = Object.assign(Object.create(null) as Record<string, unknown>, { numeric: "system-mono" });
    expect(resolveFonts(nullBase, nullOverrides)?.numeric).toBe("system-mono");
  });

  it("rejects accessors without invoking them", () => {
    let calls = 0;
    const accessorBase = { ...base };
    Object.defineProperty(accessorBase, "ui", {
      enumerable: true,
      get() {
        calls += 1;
        return "system-sans";
      },
    });
    const accessorOverrides = {};
    Object.defineProperty(accessorOverrides, "widgetUi", {
      enumerable: true,
      get() {
        calls += 1;
        return "system-sans";
      },
    });

    expect(resolveFonts(accessorBase)).toBeNull();
    expect(resolveFonts(base, accessorOverrides)).toBeNull();
    expect(calls).toBe(0);
  });

  it("validates base independently before applying overrides", () => {
    expect(resolveFonts({ ...base, ui: "unknown-font" }, { ui: "space-grotesk" })).toBeNull();
  });

  it("does not mutate inputs and returns isolated frozen results", () => {
    const inputBase = { ...base };
    const overrides = { ui: "space-grotesk" };
    const first = resolveFonts(inputBase, overrides);
    const second = resolveFonts(inputBase, overrides);

    expect(inputBase).toEqual(base);
    expect(overrides).toEqual({ ui: "space-grotesk" });
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { ui: string }).ui = "system-serif";
    }).toThrow(TypeError);
    expect(second?.ui).toBe("space-grotesk");
  });

  it("keeps validation stable after attempted registry mutation", () => {
    expect(() => {
      (FONT_DEFINITIONS as FontDefinitionLike[]).push({
        id: "unsafe-font",
        label: "Unsafe",
        roles: ["ui"],
      });
    }).toThrow(TypeError);
    expect(() => {
      (FONT_DEFINITIONS[0]!.roles as string[]).push("numeric");
    }).toThrow(TypeError);
    expect(isFontId("unsafe-font")).toBe(false);
    expect(isFontAllowed("numeric", "system-sans")).toBe(false);
  });
});

interface FontDefinitionLike {
  id: string;
  label: string;
  roles: string[];
}
