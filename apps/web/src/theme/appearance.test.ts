// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  BUILTIN_PRESETS,
  createThemeRecordFromPreset,
  resolveThemeRecord,
  snapshotToResolvedColors,
  type PresentationSnapshotV1,
} from "@runlog/themes";
import {
  APPEARANCE_KEY,
  applyBootAppearance,
  isThemeRecoveryAddress,
  parseBootAppearance,
  readBootAppearance,
  snapshotForBuiltin,
  writeBootAppearance,
  type AppearanceStorage,
  type BootAppearanceV1,
} from "./appearance.ts";
import { compilePresentation } from "./presentation.ts";

const SYSTEM: BootAppearanceV1 = { schemaVersion: 1, mode: "system" };

function snapshotFixture(presetId: (typeof BUILTIN_PRESETS)[number]["id"] = "rainbow-road"): PresentationSnapshotV1 {
  const record = createThemeRecordFromPreset({ id: "fixture", name: "Private fixture name", presetId });
  if (!record.ok) throw new Error("record fixture");
  const snapshot = resolveThemeRecord(record.value);
  if (!snapshot.ok) throw new Error("snapshot fixture");
  return snapshot.value;
}

function memoryStorage(entries: readonly (readonly [string, string])[] = []) {
  const values = new Map(entries);
  const reads: string[] = [];
  const writes: Array<readonly [string, string]> = [];
  const storage: AppearanceStorage = {
    getItem(key) {
      reads.push(key);
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
  return { values, reads, writes, storage };
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
  if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  localStorage.clear();
});

describe("boot appearance validation", () => {
  it("accepts, copies and freezes exact system and snapshot envelopes", () => {
    const snapshot = snapshotFixture();
    const input = {
      schemaVersion: 1 as const,
      mode: "snapshot" as const,
      snapshot: {
        ...snapshot,
        colors: { ...snapshot.colors, "surface.page": "#ABC" },
        feedbackBackgrounds: { ...snapshot.feedbackBackgrounds },
        fonts: { ...snapshot.fonts },
      },
    };

    const system = parseBootAppearance(SYSTEM);
    const parsed = parseBootAppearance(input);

    expect(system).toEqual({ ok: true, value: SYSTEM });
    expect(parsed).toMatchObject({ ok: true, value: { mode: "snapshot", snapshot: { colors: { "surface.page": "#aabbcc" } } } });
    if (!system.ok || !parsed.ok || parsed.value.mode !== "snapshot") throw new Error("valid fixtures");
    input.snapshot.colors["surface.page"] = "#000";
    expect(parsed.value.snapshot.colors["surface.page"]).toBe("#aabbcc");
    expect(Object.isFrozen(system)).toBe(true);
    expect(Object.isFrozen(system.value)).toBe(true);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.snapshot)).toBe(true);
    expect(Object.isFrozen(parsed.value.snapshot.colors)).toBe(true);
  });

  it("rejects modes, versions, missing fields, unknown fields and non-plain envelopes", () => {
    const snapshot = snapshotFixture();
    const invalid: unknown[] = [
      null,
      [],
      { schemaVersion: 2, mode: "system" },
      { schemaVersion: 1 },
      { schemaVersion: 1, mode: "unknown" },
      { schemaVersion: 1, mode: "system", snapshot },
      { schemaVersion: 1, mode: "system", owner: "private" },
      { schemaVersion: 1, mode: "snapshot" },
      { schemaVersion: 1, mode: "snapshot", snapshot, name: "Private" },
      Object.assign(Object.create({ inherited: true }) as object, SYSTEM),
      { ...SYSTEM, [Symbol("private")]: true },
    ];

    for (const value of invalid) expect(parseBootAppearance(value).ok).toBe(false);
    expect(parseBootAppearance(Object.assign(Object.create(null) as object, SYSTEM))).toEqual({ ok: true, value: SYSTEM });
  });

  it("rejects accessors without invoking them at either envelope level", () => {
    let calls = 0;
    const envelope = { ...SYSTEM };
    Object.defineProperty(envelope, "mode", {
      enumerable: true,
      get() {
        calls += 1;
        return "system";
      },
    });
    const snapshot = { ...snapshotFixture() };
    Object.defineProperty(snapshot, "colorScheme", {
      enumerable: true,
      get() {
        calls += 1;
        return "dark";
      },
    });

    expect(parseBootAppearance(envelope).ok).toBe(false);
    expect(parseBootAppearance({ schemaVersion: 1, mode: "snapshot", snapshot }).ok).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("built-in appearance snapshots", () => {
  it.each(BUILTIN_PRESETS)("resolves $id through the shared record contract with all app and widget values", (preset) => {
    const snapshot = snapshotForBuiltin(preset.id);
    const expectedRecord = createThemeRecordFromPreset({ id: "expected", name: "Expected", presetId: preset.id });
    if (!expectedRecord.ok) throw new Error("record fixture");
    const expected = resolveThemeRecord(expectedRecord.value);
    if (!expected.ok) throw new Error("snapshot fixture");

    expect(snapshot).toEqual(expected.value);
    expect(Object.keys(snapshot.colors)).toHaveLength(25);
    expect(Object.keys(snapshot.fonts)).toHaveLength(10);
    for (const scope of ["app", "widget"] as const) {
      expect(compilePresentation(snapshotToResolvedColors(snapshot), snapshot.fonts, snapshot.colorScheme, scope)).toEqual(
        compilePresentation(snapshotToResolvedColors(expected.value), expected.value.fonts, expected.value.colorScheme, scope),
      );
    }
    expect(JSON.stringify(snapshot)).not.toMatch(/name|contentRevision|overrides|fixture|expected/i);
  });

  it("keeps the specialized stardust widget and font presentation", () => {
    const snapshot = snapshotForBuiltin("stardust");
    const app = compilePresentation(snapshotToResolvedColors(snapshot), snapshot.fonts, snapshot.colorScheme, "app");
    const widget = compilePresentation(snapshotToResolvedColors(snapshot), snapshot.fonts, snapshot.colorScheme, "widget");

    expect(snapshot.fonts).toMatchObject({ ui: "space-grotesk", numeric: "ibm-plex-mono", widgetUi: "space-grotesk" });
    expect(widget["--bg"]).toBe(snapshot.colors["widget.ground"]);
    expect(widget["--panel"]).toBe(snapshot.colors["widget.panel"]);
    expect(widget["--font-ui"]).toContain("Space Grotesk");
    expect(app["--bg"]).toBe(snapshot.colors["surface.page"]);
  });
});

describe("boot appearance storage", () => {
  it("migrates a legacy built-in non-destructively, then lets explicit System mask it", () => {
    const values = new Map([["runlog.theme", "stardust"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const appearance = readBootAppearance(storage);
    expect(appearance.mode).toBe("snapshot");
    expect(values.size).toBe(1);
    writeBootAppearance({ schemaVersion: 1, mode: "system" }, storage);
    expect(readBootAppearance(storage)).toEqual({ schemaVersion: 1, mode: "system" });
    expect(values.get("runlog.theme")).toBe("stardust");
  });

  it("reads the new key first and never consults legacy storage when it is present", () => {
    const snapshot = snapshotForBuiltin("ember");
    const stored = JSON.stringify({ schemaVersion: 1, mode: "snapshot", snapshot });
    const memory = memoryStorage([
      [APPEARANCE_KEY, stored],
      ["runlog.theme", "stardust"],
    ]);

    expect(readBootAppearance(memory.storage)).toEqual({ schemaVersion: 1, mode: "snapshot", snapshot });
    expect(memory.reads).toEqual([APPEARANCE_KEY]);
    expect(memory.writes).toEqual([]);
  });

  it("returns safe System for a malformed, invalid or oversized present envelope instead of falling back", () => {
    const oversized = `${" ".repeat(65_536)}${JSON.stringify(SYSTEM)}`;
    for (const stored of ["{", JSON.stringify({ ...SYSTEM, extra: true }), oversized]) {
      const memory = memoryStorage([
        [APPEARANCE_KEY, stored],
        ["runlog.theme", "stardust"],
      ]);
      expect(readBootAppearance(memory.storage)).toEqual(SYSTEM);
      expect(memory.reads).toEqual([APPEARANCE_KEY]);
    }
  });

  it("measures the 65,536 limit in UTF-8 bytes", () => {
    const multibyteOversized = `${" ".repeat(65_530)} ${JSON.stringify(SYSTEM)}`;
    const memory = memoryStorage([
      [APPEARANCE_KEY, multibyteOversized],
      ["runlog.theme", "stardust"],
    ]);

    expect(new TextEncoder().encode(multibyteOversized).byteLength).toBeGreaterThan(65_536);
    expect(readBootAppearance(memory.storage)).toEqual(SYSTEM);
    expect(memory.reads).toEqual([APPEARANCE_KEY]);
  });

  it("accepts a valid envelope at exactly the 65,536-byte boundary", () => {
    const snapshot = snapshotForBuiltin("ember");
    const envelope = JSON.stringify({ schemaVersion: 1, mode: "snapshot", snapshot });
    const stored = `${" ".repeat(65_536 - new TextEncoder().encode(envelope).byteLength)}${envelope}`;
    const memory = memoryStorage([[APPEARANCE_KEY, stored]]);

    expect(new TextEncoder().encode(stored).byteLength).toBe(65_536);
    expect(readBootAppearance(memory.storage)).toEqual({ schemaVersion: 1, mode: "snapshot", snapshot });
  });

  it.each([null, "system", "missing", "not-a-theme"])("maps absent or unknown legacy choice %s to System", (legacy) => {
    const entries = legacy === null ? [] : ([["runlog.theme", legacy]] as const);
    const memory = memoryStorage(entries);
    expect(readBootAppearance(memory.storage)).toEqual(SYSTEM);
    expect(memory.values.size).toBe(entries.length);
    expect(memory.writes).toEqual([]);
  });

  it("falls back safely when passed storage is null, reads throw, or the default global getter throws", () => {
    expect(readBootAppearance(null)).toEqual(SYSTEM);
    expect(
      readBootAppearance({
        getItem() {
          throw new Error("locked");
        },
        setItem() {},
      }),
    ).toEqual(SYSTEM);

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked getter");
      },
    });
    expect(readBootAppearance()).toEqual(SYSTEM);
  });

  it("writes a canonical presentation-only envelope without mutating the caller", () => {
    const original = snapshotFixture();
    const input = {
      schemaVersion: 1 as const,
      mode: "snapshot" as const,
      snapshot: { ...original, colors: { ...original.colors, "surface.page": "#ABC" as never } },
    };
    const memory = memoryStorage();

    writeBootAppearance(input, memory.storage);

    const stored = memory.values.get(APPEARANCE_KEY);
    expect(stored).toBeDefined();
    expect(JSON.parse(stored!)).toMatchObject({
      schemaVersion: 1,
      mode: "snapshot",
      snapshot: { colors: { "surface.page": "#aabbcc" } },
    });
    expect(stored).not.toMatch(/Private fixture name|\"id\"|contentRevision|overrides/);
    expect(input.snapshot.colors["surface.page"]).toBe("#ABC");
    const parsed = parseBootAppearance(input);
    if (!parsed.ok) throw new Error("appearance fixture");
    expect(readBootAppearance(memory.storage)).toEqual(parsed.value);
  });

  it("throws useful errors for unavailable storage and setter failures", () => {
    expect(() => writeBootAppearance(SYSTEM, null)).toThrow(/storage.*unavailable/i);
    expect(() =>
      writeBootAppearance(SYSTEM, {
        getItem() {
          return null;
        },
        setItem() {
          throw new Error("quota");
        },
      }),
    ).toThrow(/save.*appearance/i);

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked getter");
      },
    });
    expect(() => writeBootAppearance(SYSTEM)).toThrow(/storage.*unavailable/i);
  });

  it("validates before touching storage", () => {
    let writes = 0;
    const storage: AppearanceStorage = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
      },
    };
    const invalid = { schemaVersion: 1, mode: "system", private: true } as unknown as BootAppearanceV1;

    expect(() => writeBootAppearance(invalid, storage)).toThrow(TypeError);
    expect(writes).toBe(0);
  });
});

describe("boot appearance application", () => {
  it("System removes only managed presentation and stale theme state", () => {
    const target = document.createElement("section");
    target.dataset.theme = "ember";
    target.dataset.widget = "score";
    target.setAttribute("aria-label", "Score widget");
    target.style.setProperty("--bg", "hotpink");
    target.style.setProperty("--success-background", "purple");
    target.style.setProperty("--unrelated", "preserved");
    target.style.borderTopWidth = "7px";

    applyBootAppearance(SYSTEM, target);

    expect(target.style.getPropertyValue("--bg")).toBe("");
    expect(target.style.getPropertyValue("--success-background")).toBe("");
    expect(target.style.getPropertyValue("--unrelated")).toBe("preserved");
    expect(target.style.borderTopWidth).toBe("7px");
    expect(target.hasAttribute("data-theme")).toBe(false);
    expect(target.dataset.widget).toBe("score");
    expect(target.getAttribute("aria-label")).toBe("Score widget");
  });

  it.each(["app", "widget"] as const)(
    "applies snapshot values for %s scope without changing the document or widget attributes",
    (scope) => {
      const snapshot = snapshotForBuiltin("stardust");
      const value: BootAppearanceV1 = { schemaVersion: 1, mode: "snapshot", snapshot };
      const target = document.createElement("section");
      target.dataset.theme = "daylight";
      target.dataset.widget = "score";
      target.style.setProperty("--unrelated", "preserved");
      const before = document.documentElement.getAttribute("style");

      applyBootAppearance(value, target, scope);

      const expected = compilePresentation(snapshotToResolvedColors(snapshot), snapshot.fonts, snapshot.colorScheme, scope);
      expect(target.style.getPropertyValue("--bg")).toBe(expected["--bg"]);
      expect(target.style.getPropertyValue("--panel")).toBe(expected["--panel"]);
      expect(target.style.getPropertyValue("--font-ui")).toBe(expected["--font-ui"]);
      expect(target.style.getPropertyValue("--unrelated")).toBe("preserved");
      expect(target.hasAttribute("data-theme")).toBe(false);
      expect(target.dataset.widget).toBe("score");
      expect(document.documentElement.getAttribute("style")).toBe(before);
    },
  );

  it("sets absent optional feedback backgrounds to initial on nested snapshot targets", () => {
    document.documentElement.style.setProperty("--success-background", "hotpink");
    document.documentElement.style.setProperty("--warning-background", "orange");
    document.documentElement.style.setProperty("--danger-background", "purple");
    const target = document.createElement("section");
    document.body.append(target);
    const snapshot = snapshotForBuiltin("daylight");

    applyBootAppearance({ schemaVersion: 1, mode: "snapshot", snapshot }, target, "widget");

    expect(target.style.getPropertyValue("--success-background")).toBe("initial");
    expect(target.style.getPropertyValue("--warning-background")).toBe("initial");
    expect(target.style.getPropertyValue("--danger-background")).toBe("initial");
    target.remove();
  });

  it("retains explicit feedback backgrounds while isolating derived siblings", () => {
    const base = snapshotFixture();
    const parsed = parseBootAppearance({
      schemaVersion: 1,
      mode: "snapshot",
      snapshot: {
        ...base,
        feedbackBackgrounds: {
          ...base.feedbackBackgrounds,
          "feedback.successBackground": { mode: "explicit", color: "#123456" },
        },
      },
    });
    if (!parsed.ok) throw new Error("appearance fixture");
    const target = document.createElement("section");
    document.body.append(target);

    applyBootAppearance(parsed.value, target);

    expect(target.style.getPropertyValue("--success-background")).toBe("#123456");
    expect(target.style.getPropertyValue("--warning-background")).toBe("initial");
    expect(target.style.getPropertyValue("--danger-background")).toBe("initial");
    target.remove();
  });

  it("validates before changing any attribute or style", () => {
    const target = document.createElement("section");
    target.dataset.theme = "ember";
    target.style.setProperty("--bg", "hotpink");
    const before = target.outerHTML;
    const invalid = { schemaVersion: 1, mode: "system", private: true } as unknown as BootAppearanceV1;

    expect(() => applyBootAppearance(invalid, target)).toThrow(TypeError);
    expect(target.outerHTML).toBe(before);
  });
});

describe("theme recovery address", () => {
  it("matches only the exact hash-form recovery address", () => {
    expect(isThemeRecoveryAddress("#themes/recovery")).toBe(true);
    for (const address of ["", "themes/recovery", "/themes/recovery", "#themes/recovery/", "#themes/recovery?x=1", "#Themes/recovery"]) {
      expect(isThemeRecoveryAddress(address), address).toBe(false);
    }
  });
});
