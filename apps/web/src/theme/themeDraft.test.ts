import { createThemeRecordFromPreset } from "@runlog/themes";
import { describe, expect, it } from "vitest";
import { parseThemeDraft } from "./themeDraft.ts";

function record(id = "theme_one", contentRevision = 1) {
  const parsed = createThemeRecordFromPreset({ id, name: "Theme one", presetId: "daylight", contentRevision });
  if (!parsed.ok) throw new Error("fixture record is invalid");
  return parsed.value;
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: "draft_one",
    sourceThemeId: null,
    baseLocalRevision: null,
    record: record(),
    rawName: "  unfinished name  ",
    rawColors: { "surface.page": "#12", "text.primary": "not a color" },
    ...overrides,
  };
}

describe("parseThemeDraft", () => {
  it("preserves invalid raw editor text beside a frozen last-valid preview", () => {
    const input = draft();
    const parsed = parseThemeDraft(input);

    expect(parsed).toMatchObject({
      ok: true,
      value: {
        id: "draft_one",
        rawName: "  unfinished name  ",
        rawColors: { "surface.page": "#12", "text.primary": "not a color" },
      },
    });
    if (!parsed.ok) return;
    expect(parsed.value).not.toBe(input);
    expect(parsed.value.record).not.toBe(input.record);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.rawColors)).toBe(true);
    expect(Object.isFrozen(parsed.value.record.overrides.colors)).toBe(true);
  });

  it("accepts an existing-theme draft only when source, base revision, and record agree", () => {
    const parsed = parseThemeDraft(draft({ sourceThemeId: "theme_one", baseLocalRevision: 4, record: record("theme_one", 7) }));
    expect(parsed.ok).toBe(true);

    expect(parseThemeDraft(draft({ sourceThemeId: "theme_one", baseLocalRevision: null })).ok).toBe(false);
    expect(parseThemeDraft(draft({ sourceThemeId: "theme_one", baseLocalRevision: 0 })).ok).toBe(false);
    expect(parseThemeDraft(draft({ sourceThemeId: "theme_two", baseLocalRevision: 1, record: record("theme_one") })).ok).toBe(false);
    expect(parseThemeDraft(draft({ sourceThemeId: null, baseLocalRevision: 1 })).ok).toBe(false);
  });

  it("rejects invalid identifiers, raw fields, and unknown color roles", () => {
    expect(parseThemeDraft(draft({ id: "bad id" })).ok).toBe(false);
    expect(parseThemeDraft(draft({ rawName: "x".repeat(1025) })).ok).toBe(false);
    expect(parseThemeDraft(draft({ rawColors: { "surface.page": "x".repeat(1025) } })).ok).toBe(false);
    expect(parseThemeDraft(draft({ rawColors: { unknownRole: "#fff" } })).ok).toBe(false);
    expect(parseThemeDraft(draft({ rawColors: { "surface.page": 3 } })).ok).toBe(false);
  });

  it("rejects unknown, accessor, symbol, non-enumerable, and prototype-bearing data without invoking getters", () => {
    expect(parseThemeDraft(draft({ extra: true })).ok).toBe(false);
    expect(parseThemeDraft(Object.assign(Object.create({ inherited: true }), draft())).ok).toBe(false);

    let reads = 0;
    const withGetter = draft();
    Object.defineProperty(withGetter, "rawName", {
      enumerable: true,
      get() {
        reads += 1;
        return "secret";
      },
    });
    expect(parseThemeDraft(withGetter).ok).toBe(false);
    expect(reads).toBe(0);

    const withSymbol = draft() as Record<PropertyKey, unknown>;
    withSymbol[Symbol("private")] = true;
    expect(parseThemeDraft(withSymbol).ok).toBe(false);

    const nonEnumerable = draft();
    Object.defineProperty(nonEnumerable, "hidden", { value: true });
    expect(parseThemeDraft(nonEnumerable).ok).toBe(false);
  });
});
