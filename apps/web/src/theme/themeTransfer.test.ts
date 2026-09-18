import { createThemeRecordFromPreset, parseThemeRecord, type ThemeRecordV1 } from "@runlog/themes";
import { describe, expect, it } from "vitest";
import { exportThemeJson, importThemeJson } from "./themeTransfer.ts";

const MAX_IMPORT_BYTES = 65_536;

function record(): ThemeRecordV1 {
  const created = createThemeRecordFromPreset({
    id: "original_id",
    name: "Portable theme",
    presetId: "cyberpunk-neon",
    baseRevision: 1,
    contentRevision: 42,
  });
  if (!created.ok) throw new Error("fixture record is invalid");

  const customized = parseThemeRecord({
    ...created.value,
    overrides: {
      colors: { "text.primary": "rgb(1, 2, 3)", "widget.panel": "#abcdef" },
      fonts: { ui: "literata", widgetDisplay: "press-start-2p" },
    },
  });
  if (!customized.ok) throw new Error("customized fixture is invalid");
  return customized.value;
}

describe("importThemeJson", () => {
  it("accepts exactly 65,536 UTF-8 bytes and rejects one byte more before parsing", () => {
    const compact = JSON.stringify(record());
    const exact = `${compact}${" ".repeat(MAX_IMPORT_BYTES - new TextEncoder().encode(compact).byteLength)}`;
    expect(new TextEncoder().encode(exact).byteLength).toBe(MAX_IMPORT_BYTES);
    expect(importThemeJson(exact, "minted_exact").ok).toBe(true);

    const oversized = `${exact} `;
    expect(new TextEncoder().encode(oversized).byteLength).toBe(MAX_IMPORT_BYTES + 1);
    expect(importThemeJson(oversized, "minted_large")).toEqual({
      ok: false,
      issues: [{ path: "$", message: "Theme JSON exceeds 65,536 UTF-8 bytes" }],
    });

    const multibyte = `\"${"🙂".repeat(20_000)}\"`;
    expect(multibyte.length).toBeLessThan(MAX_IMPORT_BYTES);
    expect(new TextEncoder().encode(multibyte).byteLength).toBeGreaterThan(MAX_IMPORT_BYTES);
    expect(importThemeJson(multibyte, "minted_multibyte")).toMatchObject({ ok: false });
  });

  it("imports one strict record with a caller-minted identity and revision one", () => {
    const original = record();
    const imported = importThemeJson(JSON.stringify(original), "minted_copy");

    expect(imported).toMatchObject({
      ok: true,
      value: {
        id: "minted_copy",
        name: original.name,
        base: original.base,
        overrides: original.overrides,
        contentRevision: 1,
      },
    });
    if (!imported.ok) return;
    expect(imported.value.id).not.toBe(original.id);
    expect(Object.isFrozen(imported.value)).toBe(true);
  });

  it("always uses the caller ID even when the portable ID resembles an existing identity", () => {
    const imported = importThemeJson(JSON.stringify({ ...record(), id: "already_in_library" }), "new_unique_id");
    expect(imported).toMatchObject({ ok: true, value: { id: "new_unique_id", contentRevision: 1 } });
  });

  it("rejects malformed JSON, multiple values, invalid minted IDs, unknown keys, and schema versions", () => {
    expect(importThemeJson("{", "minted")).toMatchObject({ ok: false, issues: [{ path: "$" }] });
    expect(importThemeJson(`${JSON.stringify(record())}\n${JSON.stringify(record())}`, "minted")).toMatchObject({ ok: false });
    expect(importThemeJson(JSON.stringify(record()), "bad id")).toMatchObject({
      ok: false,
      issues: [{ path: "$.id", message: "Invalid identifier" }],
    });
    expect(importThemeJson(JSON.stringify({ ...record(), ownerId: "private" }), "minted")).toMatchObject({
      ok: false,
      issues: [{ path: "$.ownerId", message: "Unknown field" }],
    });
    expect(importThemeJson(JSON.stringify({ ...record(), schemaVersion: 2 }), "minted")).toMatchObject({
      ok: false,
      issues: [{ path: "$.schemaVersion", message: "Unsupported schema version" }],
    });
    expect(importThemeJson(JSON.stringify([record()]), "minted")).toMatchObject({ ok: false });
  });

  it("rejects imported prototype keys as unknown portable fields", () => {
    const text = JSON.stringify({ ...record(), __proto__: undefined }).replace(/}$/, ',"__proto__":{"polluted":true}}');
    expect(importThemeJson(text, "minted")).toMatchObject({
      ok: false,
      issues: [{ path: "$.__proto__", message: "Unknown field" }],
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe("exportThemeJson", () => {
  it("pretty-serializes only validated portable fields and round-trips through import", () => {
    const original = record();
    const text = exportThemeJson(original);

    expect(text).toContain('\n  "schemaVersion": 1,');
    expect(Object.keys(JSON.parse(text))).toEqual(["schemaVersion", "id", "name", "base", "overrides", "contentRevision"]);
    expect(importThemeJson(text, "roundtrip_copy")).toMatchObject({
      ok: true,
      value: { ...original, id: "roundtrip_copy", contentRevision: 1 },
    });
  });

  it("throws TypeError for unknown fields, malformed content, prototypes, and accessors without invoking getters", () => {
    expect(() => exportThemeJson({ ...record(), accountId: "private" } as ThemeRecordV1)).toThrow(TypeError);
    expect(() => exportThemeJson({ ...record(), contentRevision: 0 } as ThemeRecordV1)).toThrow(TypeError);
    expect(() => exportThemeJson(Object.assign(Object.create({ inherited: true }), record()) as ThemeRecordV1)).toThrow(TypeError);

    let reads = 0;
    const accessor = { ...record() } as ThemeRecordV1;
    Object.defineProperty(accessor, "name", {
      enumerable: true,
      get() {
        reads += 1;
        return "secret";
      },
    });
    expect(() => exportThemeJson(accessor)).toThrow(TypeError);
    expect(reads).toBe(0);
  });
});
