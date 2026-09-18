import { describe, expect, it } from "vitest";

import { BUILTIN_PRESETS, createThemeRecordFromPreset, parseThemeRecord, resolveThemeRecord, type ThemeRecordV1 } from "./index.ts";

function makeRecord(): ThemeRecordV1 {
  const result = createThemeRecordFromPreset({ id: "theme-1", name: "  My Road  ", presetId: "rainbow-road" });
  if (!result.ok) throw new Error("fixture");
  return result.value;
}

function expectRejected(input: unknown): void {
  expect(parseThemeRecord(input).ok).toBe(false);
}

describe("portable theme records", () => {
  it("creates an exact portable preset record and resolves normalized overrides", () => {
    const made = createThemeRecordFromPreset({ id: "theme-1", name: "  My Road  ", presetId: "rainbow-road" });
    expect(made.ok).toBe(true);
    if (!made.ok) throw new Error("fixture");
    expect(made.value.name).toBe("My Road");
    expect(made.value).toMatchObject({
      schemaVersion: 1,
      id: "theme-1",
      base: { id: "rainbow-road", revision: 1, colorScheme: "light" },
      overrides: { colors: {}, fonts: {} },
      contentRevision: 1,
    });

    const changed = {
      ...made.value,
      overrides: { colors: { "interaction.moveAccent": "rgb(1 2 3)" }, fonts: { ui: "space-grotesk" } },
    };
    const snapshot = resolveThemeRecord(changed);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) throw new Error("fixture");
    expect(snapshot.value.colors["interaction.moveAccent"]).toBe("#010203");
    expect(snapshot.value.fonts.widgetUi).toBe("space-grotesk");
    expect(snapshot.value.feedbackBackgrounds["feedback.successBackground"]).toEqual({ mode: "derived" });
    expect(parseThemeRecord({ ...made.value, owner: "not-portable" }).ok).toBe(false);
  });

  it("uses an explicit historical base revision or the catalog latest revision", () => {
    const oldSamurai = createThemeRecordFromPreset({
      id: "samurai-old",
      name: "Samurai old",
      presetId: "cyberpunk-neon",
      baseRevision: 1,
    });
    const latestSamurai = createThemeRecordFromPreset({ id: "samurai", name: "Samurai", presetId: "cyberpunk-neon" });

    expect(oldSamurai.ok && oldSamurai.value.base.revision).toBe(1);
    expect(latestSamurai.ok && latestSamurai.value.base.revision).toBe(2);
    if (!oldSamurai.ok || !latestSamurai.ok) throw new Error("fixture");
    expect(oldSamurai.value.base.colors["text.muted"]).toBe("#cdbbe8");
    expect(latestSamurai.value.base.colors["text.muted"]).toBe("#b9dfff");
  });

  it("creates a resolvable record for every built-in preset", () => {
    for (const preset of BUILTIN_PRESETS) {
      const made = createThemeRecordFromPreset({ id: `copy-${preset.id}`, name: preset.label, presetId: preset.id });
      expect(made.ok).toBe(true);
      if (!made.ok) continue;
      expect(resolveThemeRecord(made.value).ok).toBe(true);
    }
  });

  it("resolves a validated embedded base that is absent from the installed catalog", () => {
    const input = makeRecord();
    const portable = { ...input, base: { ...input.base, id: "retired-theme", revision: 73 } };
    const result = resolveThemeRecord(portable);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.colors["surface.page"]).toBe("#ededeb");
  });

  it("preserves optional base roles so final app overrides still flow to unoverridden widgets", () => {
    const original = makeRecord();
    const parsed = parseThemeRecord({
      ...original,
      base: {
        ...original.base,
        colors: { ...original.base.colors, "widget.panel": "#123" },
        fonts: { ...original.base.fonts, widgetProse: "system-serif" },
      },
      overrides: { colors: { "surface.page": "#abc" }, fonts: { ui: "space-grotesk", prose: "system-sans" } },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("fixture");
    expect(Object.hasOwn(parsed.value.base.colors, "widget.ground")).toBe(false);
    expect(parsed.value.base.colors["widget.panel"]).toBe("#112233");
    expect(Object.hasOwn(parsed.value.base.fonts, "widgetUi")).toBe(false);
    expect(parsed.value.base.fonts.widgetProse).toBe("system-serif");

    const snapshot = resolveThemeRecord(parsed.value);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) throw new Error("fixture");
    expect(snapshot.value.colors["widget.ground"]).toBe("#aabbcc");
    expect(snapshot.value.fonts.widgetUi).toBe("space-grotesk");
    expect(snapshot.value.fonts.widgetProse).toBe("system-serif");
  });

  it("accepts 80 Unicode code points after trimming and rejects 81", () => {
    expect(createThemeRecordFromPreset({ id: "emoji-80", name: `  ${"😀".repeat(80)}  `, presetId: "daylight" }).ok).toBe(true);
    expect(createThemeRecordFromPreset({ id: "emoji-81", name: "😀".repeat(81), presetId: "daylight" }).ok).toBe(false);
    expect(createThemeRecordFromPreset({ id: "empty", name: " \n ", presetId: "daylight" }).ok).toBe(false);
  });

  it.each(["", " has-space", "has.dot", "-leading", "a".repeat(129), null, 3])("rejects invalid record IDs %j", (id) => {
    expect(createThemeRecordFromPreset({ id: id as string, name: "Name", presetId: "daylight" }).ok).toBe(false);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, "1"])("rejects invalid revision %j", (revision) => {
    const original = makeRecord();
    expectRejected({ ...original, contentRevision: revision });
    expectRejected({ ...original, base: { ...original.base, revision } });
  });

  it("rejects future versions, unavailable presets/revisions and malformed factory inputs", () => {
    const original = makeRecord();
    expectRejected({ ...original, schemaVersion: 2 });
    expect(createThemeRecordFromPreset({ id: "bad", name: "Bad", presetId: "missing" as "daylight" }).ok).toBe(false);
    expect(createThemeRecordFromPreset({ id: "bad", name: "Bad", presetId: "daylight", baseRevision: 2 }).ok).toBe(false);
    expect(createThemeRecordFromPreset({ id: "bad", name: "Bad", presetId: "daylight", contentRevision: 0 }).ok).toBe(false);
    expect(createThemeRecordFromPreset({ id: "bad", name: "Bad", presetId: "daylight", extra: true } as never).ok).toBe(false);
  });

  it("rejects unknown or missing fields at every object level", () => {
    const original = makeRecord();
    const cases: unknown[] = [
      { ...original, unexpected: true },
      { ...original, base: { ...original.base, unexpected: true } },
      { ...original, base: { ...original.base, colors: { ...original.base.colors, unexpected: "#fff" } } },
      { ...original, base: { ...original.base, fonts: { ...original.base.fonts, unexpected: "system-sans" } } },
      { ...original, overrides: { ...original.overrides, unexpected: true } },
      { ...original, overrides: { ...original.overrides, colors: { unexpected: "#fff" } } },
      { ...original, overrides: { ...original.overrides, fonts: { unexpected: "system-sans" } } },
    ];
    const required = ["schemaVersion", "id", "name", "base", "overrides", "contentRevision"] as const;
    for (const key of required) {
      const candidate = { ...original } as Record<string, unknown>;
      delete candidate[key];
      cases.push(candidate);
    }
    for (const candidate of cases) expectRejected(candidate);
  });

  it("rejects invalid colors, fonts and arbitrary CSS/network values at record boundaries", () => {
    const original = makeRecord();
    for (const value of [null, undefined, "red", "#1234", "rgb(1 2 3 / 1)", "var(--x)", "url(https://bad.test/x)", "rgb(999 0 0)"]) {
      expectRejected({ ...original, overrides: { ...original.overrides, colors: { "surface.page": value } } });
    }
    for (const [role, font] of [
      ["ui", "system-mono"],
      ["numeric", "oxanium"],
      ["widgetTechnical", "vt323"],
      ["ui", null],
    ]) {
      expectRejected({ ...original, overrides: { ...original.overrides, fonts: { [role!]: font } } });
    }
  });

  it("rejects symbols, accessors, non-enumerable properties and foreign prototypes without invoking getters", () => {
    const original = makeRecord();
    let calls = 0;
    const accessor = { ...original };
    Object.defineProperty(accessor, "name", {
      enumerable: true,
      get() {
        calls += 1;
        return "Unsafe";
      },
    });
    const nonEnumerable = { ...original };
    Object.defineProperty(nonEnumerable, "owner", { value: "hidden", enumerable: false });
    const symbol = { ...original, [Symbol("secret")]: true };
    const inherited = Object.assign(Object.create({ owner: "inherited" }) as Record<string, unknown>, original);
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, original);

    expectRejected(accessor);
    expectRejected(nonEnumerable);
    expectRejected(symbol);
    expectRejected(inherited);
    expect(calls).toBe(0);
    expect(parseThemeRecord(nullPrototype).ok).toBe(true);
  });

  it("returns a validation failure when an unknown object cannot be safely inspected", () => {
    const proxy = Proxy.revocable({}, {});
    proxy.revoke();

    expect(() => parseThemeRecord(proxy.proxy)).not.toThrow();
    expect(parseThemeRecord(proxy.proxy).ok).toBe(false);
  });

  it("copies, canonicalizes and deeply freezes output without mutating or retaining caller data", () => {
    const source = makeRecord();
    const input = {
      ...source,
      base: { ...source.base, colors: { ...source.base.colors }, fonts: { ...source.base.fonts } },
      overrides: { colors: { "interaction.moveAccent": "#ABC" }, fonts: { ui: "space-grotesk" } },
    };
    const result = parseThemeRecord(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture");

    input.base.colors["surface.page"] = "#000" as never;
    input.overrides.colors["interaction.moveAccent"] = "#000";
    expect(result.value.base.colors["surface.page"]).toBe("#ededeb");
    expect(result.value.overrides.colors["interaction.moveAccent"]).toBe("#aabbcc");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.base)).toBe(true);
    expect(Object.isFrozen(result.value.base.colors)).toBe(true);
    expect(Object.isFrozen(result.value.base.fonts)).toBe(true);
    expect(Object.isFrozen(result.value.overrides)).toBe(true);
    expect(Object.isFrozen(result.value.overrides.colors)).toBe(true);
    expect(Object.isFrozen(result.value.overrides.fonts)).toBe(true);
    expect(() => {
      (result.value as { name: string }).name = "Mutated";
    }).toThrow(TypeError);
  });
});
