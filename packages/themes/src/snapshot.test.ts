import { describe, expect, it } from "vitest";

import {
  COLOR_DEFINITIONS,
  FONT_ROLE_DEFINITIONS,
  createThemeRecordFromPreset,
  parsePresentationSnapshot,
  presentationSnapshotKey,
  resolveThemeRecord,
  snapshotToResolvedColors,
  type PresentationSnapshotV1,
} from "./index.ts";

function makeSnapshot(): PresentationSnapshotV1 {
  const record = createThemeRecordFromPreset({ id: "snapshot", name: "Snapshot", presetId: "rainbow-road" });
  if (!record.ok) throw new Error("record fixture");
  const snapshot = resolveThemeRecord(record.value);
  if (!snapshot.ok) throw new Error("snapshot fixture");
  return snapshot.value;
}

describe("presentation snapshots", () => {
  it("round-trips an exact JSON snapshot with all appearance values and no record metadata", () => {
    const snapshot = makeSnapshot();
    const roundTrip = parsePresentationSnapshot(JSON.parse(JSON.stringify(snapshot)));

    expect(roundTrip).toEqual({ ok: true, value: snapshot });
    expect(Object.keys(snapshot.colors)).toHaveLength(25);
    expect(Object.keys(snapshot.feedbackBackgrounds)).toHaveLength(3);
    expect(Object.keys(snapshot.fonts)).toHaveLength(10);
    expect(snapshot).not.toHaveProperty("id");
    expect(snapshot).not.toHaveProperty("name");
    expect(snapshot).not.toHaveProperty("revision");
  });

  it("round-trips four independent move accent overrides", () => {
    const record = createThemeRecordFromPreset({ id: "decorations", name: "Decorations", presetId: "rainbow-road" });
    if (!record.ok) throw new Error("record fixture");
    const resolved = resolveThemeRecord({
      ...record.value,
      overrides: {
        colors: {
          "interaction.moveAccent": "rgb(1 2 3)",
          "interaction.moveAccent2": "rgb(4 5 6)",
          "interaction.moveAccent3": "#789",
          "interaction.moveAccent4": "rgb(10 11 12)",
        },
        fonts: {},
      },
    });
    if (!resolved.ok) throw new Error("snapshot fixture");

    const restored = parsePresentationSnapshot(JSON.parse(JSON.stringify(resolved.value)));

    expect(restored).toMatchObject({
      ok: true,
      value: {
        colors: {
          "interaction.moveAccent": "#010203",
          "interaction.moveAccent2": "#040506",
          "interaction.moveAccent3": "#778899",
          "interaction.moveAccent4": "#0a0b0c",
        },
      },
    });
  });

  it("requires every registered non-feedback color, feedback background and font role", () => {
    const snapshot = makeSnapshot();
    const colorKeys = COLOR_DEFINITIONS.filter(({ kind }) => kind !== "feedbackBackground").map(({ id }) => id);
    const feedbackKeys = COLOR_DEFINITIONS.filter(({ kind }) => kind === "feedbackBackground").map(({ id }) => id);
    const fontKeys = FONT_ROLE_DEFINITIONS.map(({ id }) => id);

    for (const key of colorKeys) {
      const colors = { ...snapshot.colors } as Record<string, unknown>;
      delete colors[key];
      expect(parsePresentationSnapshot({ ...snapshot, colors }).ok, key).toBe(false);
    }
    for (const key of feedbackKeys) {
      const feedbackBackgrounds = { ...snapshot.feedbackBackgrounds } as Record<string, unknown>;
      delete feedbackBackgrounds[key];
      expect(parsePresentationSnapshot({ ...snapshot, feedbackBackgrounds }).ok, key).toBe(false);
    }
    for (const key of fontKeys) {
      const fonts = { ...snapshot.fonts } as Record<string, unknown>;
      delete fonts[key];
      expect(parsePresentationSnapshot({ ...snapshot, fonts }).ok, key).toBe(false);
    }
  });

  it("rejects extra keys, future versions and non-appearance metadata", () => {
    const snapshot = makeSnapshot();
    expect(parsePresentationSnapshot({ ...snapshot, schemaVersion: 2 }).ok).toBe(false);
    expect(parsePresentationSnapshot({ ...snapshot, tokenVersion: 2 }).ok).toBe(false);
    for (const extra of [{ name: "Theme" }, { id: "theme" }, { accountId: "secret" }, { revision: 2 }]) {
      expect(parsePresentationSnapshot({ ...snapshot, ...extra }).ok).toBe(false);
    }
    expect(parsePresentationSnapshot({ ...snapshot, colors: { ...snapshot.colors, unknown: "#fff" } }).ok).toBe(false);
    expect(parsePresentationSnapshot({ ...snapshot, fonts: { ...snapshot.fonts, unknown: "system-sans" } }).ok).toBe(false);
  });

  it("enforces explicit and derived feedback wire modes", () => {
    const snapshot = makeSnapshot();
    const withSuccess = (value: unknown) => ({
      ...snapshot,
      feedbackBackgrounds: { ...snapshot.feedbackBackgrounds, "feedback.successBackground": value },
    });

    expect(parsePresentationSnapshot(withSuccess({ mode: "explicit", color: "rgb(1 2 3)" }))).toMatchObject({
      ok: true,
      value: { feedbackBackgrounds: { "feedback.successBackground": { mode: "explicit", color: "#010203" } } },
    });
    for (const invalid of [
      { mode: "explicit" },
      { mode: "explicit", color: "red" },
      { mode: "derived", color: "#fff" },
      { mode: null },
      null,
      "derived",
    ]) {
      expect(parsePresentationSnapshot(withSuccess(invalid)).ok).toBe(false);
    }
  });

  it("rejects invalid colors, fonts, CSS/network strings and malformed descriptors", () => {
    const snapshot = makeSnapshot();
    for (const color of ["red", "#1234", "var(--x)", "url(https://bad.test/x)", "rgb(0 0 0 / 1)", null]) {
      expect(parsePresentationSnapshot({ ...snapshot, colors: { ...snapshot.colors, "surface.page": color } }).ok).toBe(false);
    }
    expect(parsePresentationSnapshot({ ...snapshot, fonts: { ...snapshot.fonts, ui: "system-mono" } }).ok).toBe(false);

    let calls = 0;
    const accessor = { ...snapshot };
    Object.defineProperty(accessor, "colorScheme", {
      enumerable: true,
      get() {
        calls += 1;
        return "light";
      },
    });
    const hidden = { ...snapshot };
    Object.defineProperty(hidden, "owner", { value: "hidden", enumerable: false });
    expect(parsePresentationSnapshot(accessor).ok).toBe(false);
    expect(parsePresentationSnapshot(hidden).ok).toBe(false);
    expect(parsePresentationSnapshot({ ...snapshot, [Symbol("secret")]: true }).ok).toBe(false);
    expect(parsePresentationSnapshot(Object.assign(Object.create({ owner: true }) as object, snapshot)).ok).toBe(false);
    expect(calls).toBe(0);
    expect(parsePresentationSnapshot(Object.assign(Object.create(null) as object, snapshot)).ok).toBe(true);
  });

  it("copies, canonicalizes and deeply freezes parsed snapshots", () => {
    const original = makeSnapshot();
    const input = {
      ...original,
      colors: { ...original.colors, "surface.page": "#ABC" },
      feedbackBackgrounds: {
        ...original.feedbackBackgrounds,
        "feedback.successBackground": { mode: "explicit", color: "rgb(1 2 3)" },
      },
      fonts: { ...original.fonts },
    };
    const parsed = parsePresentationSnapshot(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("fixture");
    input.colors["surface.page"] = "#000" as never;
    input.feedbackBackgrounds["feedback.successBackground"].color = "#000";
    expect(parsed.value.colors["surface.page"]).toBe("#aabbcc");
    expect(parsed.value.feedbackBackgrounds["feedback.successBackground"]).toEqual({ mode: "explicit", color: "#010203" });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.colors)).toBe(true);
    expect(Object.isFrozen(parsed.value.feedbackBackgrounds)).toBe(true);
    expect(Object.values(parsed.value.feedbackBackgrounds).every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(parsed.value.fonts)).toBe(true);
  });

  it("adapts explicit and derived backgrounds to colors and null sentinels without mutating input", () => {
    const snapshot = makeSnapshot();
    const input = {
      ...snapshot,
      feedbackBackgrounds: {
        ...snapshot.feedbackBackgrounds,
        "feedback.warningBackground": { mode: "explicit" as const, color: "#ABC" as never },
      },
    };
    const adapted = snapshotToResolvedColors(input);

    expect(adapted.values).toEqual(snapshot.colors);
    expect(adapted.feedbackBackgrounds).toEqual({
      "feedback.successBackground": null,
      "feedback.warningBackground": "#aabbcc",
      "feedback.dangerBackground": null,
    });
    expect(input.feedbackBackgrounds["feedback.warningBackground"].color).toBe("#ABC");
    expect(Object.isFrozen(adapted)).toBe(true);
    expect(Object.isFrozen(adapted.values)).toBe(true);
    expect(Object.isFrozen(adapted.feedbackBackgrounds)).toBe(true);
  });

  it("throws before adapters or keys can expose invalid typed input", () => {
    const snapshot = makeSnapshot();
    const invalid = { ...snapshot, colors: { ...snapshot.colors, "surface.page": "url(https://bad.test/x)" } } as PresentationSnapshotV1;
    expect(() => snapshotToResolvedColors(invalid)).toThrow(TypeError);
    expect(() => presentationSnapshotKey(invalid)).toThrow(TypeError);
  });

  it("makes a canonical key stable under object key order and unrelated record metadata", () => {
    const snapshot = makeSnapshot();
    const reversed = {
      ...snapshot,
      colors: Object.fromEntries(Object.entries(snapshot.colors).reverse()),
      feedbackBackgrounds: Object.fromEntries(Object.entries(snapshot.feedbackBackgrounds).reverse()),
      fonts: Object.fromEntries(Object.entries(snapshot.fonts).reverse()),
    } as PresentationSnapshotV1;
    expect(presentationSnapshotKey(reversed)).toBe(presentationSnapshotKey(snapshot));

    const record = createThemeRecordFromPreset({ id: "one", name: "One", presetId: "rainbow-road", contentRevision: 1 });
    const renamed = createThemeRecordFromPreset({ id: "two", name: "Two", presetId: "rainbow-road", contentRevision: 99 });
    if (!record.ok || !renamed.ok) throw new Error("record fixture");
    const one = resolveThemeRecord(record.value);
    const two = resolveThemeRecord(renamed.value);
    if (!one.ok || !two.ok) throw new Error("snapshot fixture");
    expect(presentationSnapshotKey(one.value)).toBe(presentationSnapshotKey(two.value));
  });

  it("changes the key for every kind of appearance change", () => {
    const snapshot = makeSnapshot();
    const key = presentationSnapshotKey(snapshot);
    const changes: PresentationSnapshotV1[] = [
      { ...snapshot, colorScheme: "dark" },
      { ...snapshot, colors: { ...snapshot.colors, "surface.page": "#000000" as never } },
      { ...snapshot, fonts: { ...snapshot.fonts, ui: "system-serif" } },
      {
        ...snapshot,
        feedbackBackgrounds: {
          ...snapshot.feedbackBackgrounds,
          "feedback.successBackground": { mode: "explicit", color: "#010203" as never },
        },
      },
    ];
    for (const changed of changes) expect(presentationSnapshotKey(changed)).not.toBe(key);
  });
});
