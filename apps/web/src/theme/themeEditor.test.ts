import {
  COLOR_DEFINITIONS,
  FONT_DEFINITIONS,
  FONT_ROLE_DEFINITIONS,
  createThemeRecordFromPreset,
  isFontAllowed,
  type ColorTokenId,
  type FontId,
  type FontRole,
} from "@runlog/themes";
import { describe, expect, it } from "vitest";
import { parseThemeDraft, type ThemeDraftV1 } from "./themeDraft.ts";
import { editThemeDraft, themeDraftKey, themeSaveCandidate, type ThemeEdit } from "./themeEditor.ts";

function draft(overrides: Partial<ThemeDraftV1> = {}): ThemeDraftV1 {
  const record = createThemeRecordFromPreset({
    id: "theme_one",
    name: "Theme one",
    presetId: "daylight",
    contentRevision: 7,
  });
  if (!record.ok) throw new Error("fixture record is invalid");

  const parsed = parseThemeDraft({
    schemaVersion: 1,
    id: "draft_one",
    sourceThemeId: "theme_one",
    baseLocalRevision: 3,
    record: record.value,
    rawName: "Theme one",
    rawColors: {},
    ...overrides,
  });
  if (!parsed.ok) throw new Error("fixture draft is invalid");
  return parsed.value;
}

describe("editThemeDraft", () => {
  it.each(COLOR_DEFINITIONS.map(({ id }) => [id] as const))("edits registered color role %s while preserving exact raw input", (role) => {
    const next = editThemeDraft(draft(), { type: "color", role, value: "  RGB(1, 2, 3)  " });

    expect(next.rawColors[role]).toBe("  RGB(1, 2, 3)  ");
    expect(next.record.overrides.colors[role]).toBe("#010203");
    expect(next.record.contentRevision).toBe(7);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.rawColors)).toBe(true);
    expect(Object.isFrozen(next.record.overrides.colors)).toBe(true);
  });

  it("retains partial color input without changing the last-valid preview, then resets raw and valid state", () => {
    const validDraft = draft();
    const next = editThemeDraft(validDraft, { type: "color", role: "text.primary", value: "#12" });

    expect(next.rawColors["text.primary"]).toBe("#12");
    expect(next.record).toEqual(validDraft.record);
    expect(themeSaveCandidate(next).ok).toBe(false);

    const reset = editThemeDraft(next, { type: "reset-color", role: "text.primary" });
    expect(Object.hasOwn(reset.rawColors, "text.primary")).toBe(false);
    expect(Object.hasOwn(reset.record.overrides.colors, "text.primary")).toBe(false);
  });

  it.each(FONT_ROLE_DEFINITIONS.map(({ id }) => [id] as const))("edits and resets an eligible font for role %s", (role) => {
    const eligible = FONT_DEFINITIONS.find(({ id }) => isFontAllowed(role, id));
    if (eligible === undefined) throw new Error(`missing eligible font fixture for ${role}`);

    const edited = editThemeDraft(draft(), { type: "font", role, value: eligible.id });
    expect(edited.record.overrides.fonts[role]).toBe(eligible.id);
    expect(edited.record.contentRevision).toBe(7);

    const reset = editThemeDraft(edited, { type: "reset-font", role });
    expect(Object.hasOwn(reset.record.overrides.fonts, role)).toBe(false);
  });

  it.each(FONT_ROLE_DEFINITIONS.flatMap(({ id: role }) => FONT_DEFINITIONS.map(({ id: font }) => [role, font] as const)))(
    "enforces the registered font allowlist for %s with %s",
    (role, font) => {
      const inheritedRole: Readonly<Record<FontRole, (typeof FONT_DEFINITIONS)[number]["roles"][number]>> = {
        ui: "ui",
        prose: "prose",
        numeric: "numeric",
        technical: "technical",
        display: "display",
        widgetUi: "ui",
        widgetProse: "prose",
        widgetNumeric: "numeric",
        widgetTechnical: "technical",
        widgetDisplay: "display",
      };
      const definition = FONT_DEFINITIONS.find(({ id }) => id === font);
      if (definition === undefined) throw new Error(`missing font fixture for ${font}`);

      if (definition.roles.includes(inheritedRole[role])) {
        expect(editThemeDraft(draft(), { type: "font", role, value: font }).record.overrides.fonts[role]).toBe(font);
      } else {
        expect(() => editThemeDraft(draft(), { type: "font", role, value: font })).toThrow(TypeError);
      }
    },
  );

  it("rejects ineligible or unknown programmatic edits", () => {
    expect(() => editThemeDraft(draft(), { type: "font", role: "numeric", value: "system-sans" })).toThrow(TypeError);
    expect(() => editThemeDraft(draft(), { type: "font", role: "not-a-role" as FontRole, value: "system-sans" })).toThrow(TypeError);
    expect(() => editThemeDraft(draft(), { type: "font", role: "ui", value: "remote-font" as FontId })).toThrow(TypeError);
    expect(() => editThemeDraft(draft(), { type: "color", role: "not-a-color" as ColorTokenId, value: "#123456" })).toThrow(TypeError);
    expect(() => editThemeDraft(draft(), { type: "base", presetId: "system" } as unknown as ThemeEdit)).toThrow(TypeError);
  });

  it("normalizes valid names, preserves invalid raw names, and enforces draft code-point bounds", () => {
    const normalized = editThemeDraft(draft(), { type: "name", value: "  A bright theme 🙂  " });
    expect(normalized.rawName).toBe("  A bright theme 🙂  ");
    expect(normalized.record.name).toBe("A bright theme 🙂");

    const empty = editThemeDraft(normalized, { type: "name", value: "   " });
    expect(empty.rawName).toBe("   ");
    expect(empty.record.name).toBe("A bright theme 🙂");
    expect(themeSaveCandidate(empty)).toMatchObject({ ok: false, issues: [{ path: "$.rawName" }] });

    const long = editThemeDraft(normalized, { type: "name", value: "🙂".repeat(81) });
    expect(long.record.name).toBe("A bright theme 🙂");
    expect(themeSaveCandidate(long)).toMatchObject({ ok: false, issues: [{ path: "$.rawName" }] });

    const exact = editThemeDraft(normalized, { type: "name", value: `  ${"🙂".repeat(80)}  ` });
    expect(themeSaveCandidate(exact)).toMatchObject({ ok: true, value: { name: "🙂".repeat(80) } });

    expect(() => editThemeDraft(draft(), { type: "name", value: "🙂".repeat(1025) })).toThrow(TypeError);
  });

  it("switches to the latest embedded base while preserving overrides, raw invalid values, identity, and revision", () => {
    const withColor = editThemeDraft(draft(), { type: "color", role: "interaction.accent", value: "#123456" });
    const withInvalid = editThemeDraft(withColor, { type: "color", role: "text.primary", value: "#12" });
    const withFont = editThemeDraft(withInvalid, { type: "font", role: "display", value: "press-start-2p" });
    const switched = editThemeDraft(withFont, { type: "base", presetId: "cyberpunk-neon" });

    expect(switched.record.base).toMatchObject({ id: "cyberpunk-neon", revision: 2 });
    expect(switched.record.overrides).toEqual(withFont.record.overrides);
    expect(switched.rawColors).toEqual(withFont.rawColors);
    expect(switched.record.id).toBe("theme_one");
    expect(switched.record.name).toBe("Theme one");
    expect(switched.rawName).toBe("Theme one");
    expect(switched.record.contentRevision).toBe(7);
  });

  it("resets all overrides and raw colors while preserving raw name, valid name, identity, base, and revision", () => {
    const named = editThemeDraft(draft(), { type: "name", value: "  Renamed  " });
    const colored = editThemeDraft(named, { type: "color", role: "text.primary", value: "#112233" });
    const partial = editThemeDraft(colored, { type: "color", role: "surface.page", value: "#1" });
    const fonted = editThemeDraft(partial, { type: "font", role: "ui", value: "literata" });
    const reset = editThemeDraft(fonted, { type: "reset-all" });

    expect(reset.rawName).toBe("  Renamed  ");
    expect(reset.record.name).toBe("Renamed");
    expect(reset.id).toBe(fonted.id);
    expect(reset.record.id).toBe(fonted.record.id);
    expect(reset.record.base).toEqual(fonted.record.base);
    expect(reset.record.contentRevision).toBe(7);
    expect(reset.rawColors).toEqual({});
    expect(reset.record.overrides).toEqual({ colors: {}, fonts: {} });
  });

  it("rejects malformed draft inputs and unknown edit variants", () => {
    expect(() => editThemeDraft({ ...draft(), extra: true } as ThemeDraftV1, { type: "reset-all" })).toThrow(TypeError);
    expect(() => editThemeDraft(draft(), { type: "future-edit" } as unknown as ThemeEdit)).toThrow(TypeError);
  });
});

describe("themeSaveCandidate", () => {
  it("validates every raw field independently and returns all associated paths", () => {
    const invalidName = editThemeDraft(draft(), { type: "name", value: " " });
    const firstColor = editThemeDraft(invalidName, { type: "color", role: "text.primary", value: "#12" });
    const secondColor = editThemeDraft(firstColor, { type: "color", role: "surface.page", value: "transparent" });

    expect(themeSaveCandidate(secondColor)).toEqual({
      ok: false,
      issues: [
        { path: "$.rawName", message: "Name must contain 1 to 80 Unicode code points" },
        { path: "$.rawColors.surface.page", message: "Invalid opaque color" },
        { path: "$.rawColors.text.primary", message: "Invalid opaque color" },
      ],
    });
  });

  it("returns a frozen normalized record without incrementing its content revision", () => {
    const named = editThemeDraft(draft(), { type: "name", value: "  Saved name  " });
    const colored = editThemeDraft(named, { type: "color", role: "text.primary", value: "RGB(17 34 51)" });
    const candidate = themeSaveCandidate(colored);

    expect(candidate).toMatchObject({
      ok: true,
      value: { name: "Saved name", contentRevision: 7, overrides: { colors: { "text.primary": "#112233" } } },
    });
    if (!candidate.ok) return;
    expect(Object.isFrozen(candidate.value)).toBe(true);
    expect(Object.isFrozen(candidate.value.overrides.colors)).toBe(true);
  });

  it("preserves a maximum safe current revision rather than wrapping or incrementing it", () => {
    const maximum = createThemeRecordFromPreset({
      id: "theme_one",
      name: "Theme one",
      presetId: "daylight",
      contentRevision: Number.MAX_SAFE_INTEGER,
    });
    if (!maximum.ok) throw new Error("maximum revision fixture is invalid");
    const current = draft({
      record: maximum.value,
    });
    expect(themeSaveCandidate(current)).toMatchObject({ ok: true, value: { contentRevision: Number.MAX_SAFE_INTEGER } });
  });
});

describe("themeDraftKey", () => {
  it("is canonical for complete draft content regardless of object insertion order", () => {
    const first = draft({ rawColors: { "text.primary": "#123456", "surface.page": "#abcdef" } });
    const second = draft({ rawColors: { "surface.page": "#abcdef", "text.primary": "#123456" } });

    expect(themeDraftKey(first)).toBe(themeDraftKey(second));
    expect(themeDraftKey(editThemeDraft(second, { type: "name", value: "Different" }))).not.toBe(themeDraftKey(first));
  });

  it("rejects malformed drafts instead of invoking accessors", () => {
    let reads = 0;
    const hostile = { ...draft() } as ThemeDraftV1;
    Object.defineProperty(hostile, "rawName", {
      enumerable: true,
      get() {
        reads += 1;
        return "stolen";
      },
    });

    expect(() => themeDraftKey(hostile)).toThrow(TypeError);
    expect(reads).toBe(0);
  });
});
