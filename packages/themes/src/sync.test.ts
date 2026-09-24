import { describe, expect, it } from "vitest";
import { createThemeRecordFromPreset, type ThemeRecordV1 } from "./records.ts";
import {
  canonicalJson,
  IDEMPOTENCY_KEY_PATTERN,
  parseRemoteTheme,
  sameThemeContent,
  THEME_ID_PATTERN,
  THEME_SYNC_LIMITS,
  themeContentKey,
  themeRecordBytes,
} from "./sync.ts";

function record(id: string, name = "Kiln", contentRevision = 1): ThemeRecordV1 {
  const made = createThemeRecordFromPreset({ id, name, presetId: "ember", contentRevision });
  if (!made.ok) throw new Error("fixture");
  return made.value;
}

describe("the synced theme contract", () => {
  it("fixes the account limits the server and the app share", () => {
    expect(THEME_SYNC_LIMITS).toEqual({ maxThemes: 200, writesPerMinute: 30, maxRecordBytes: 65_536, pageSize: 50 });
    expect(Object.isFrozen(THEME_SYNC_LIMITS)).toBe(true);
  });

  it("reads a live theme and a tombstone", () => {
    const live = parseRemoteTheme({ state: "live", id: "t1", revision: 3, updatedAt: "2026-09-23T10:00:00.000Z", record: record("t1") });
    expect(live.ok && live.value.state === "live" && live.value.record.name).toBe("Kiln");
    const gone = parseRemoteTheme({
      state: "deleted",
      id: "t1",
      revision: 4,
      updatedAt: "2026-09-23T10:01:00.000Z",
      deletedAt: "2026-09-23T10:01:00.000Z",
    });
    expect(gone.ok && gone.value).toEqual({
      state: "deleted",
      id: "t1",
      revision: 4,
      updatedAt: "2026-09-23T10:01:00.000Z",
      deletedAt: "2026-09-23T10:01:00.000Z",
    });
  });

  it.each([
    ["no state", { id: "t1", revision: 1, updatedAt: "2026-09-23T10:00:00.000Z" }],
    ["an unknown state", { state: "archived", id: "t1", revision: 1, updatedAt: "2026-09-23T10:00:00.000Z" }],
    [
      "revision zero",
      { state: "deleted", id: "t1", revision: 0, updatedAt: "2026-09-23T10:00:00.000Z", deletedAt: "2026-09-23T10:00:00.000Z" },
    ],
    [
      "a bad id",
      { state: "deleted", id: "../t1", revision: 1, updatedAt: "2026-09-23T10:00:00.000Z", deletedAt: "2026-09-23T10:00:00.000Z" },
    ],
    ["a bad time", { state: "deleted", id: "t1", revision: 1, updatedAt: "yesterday", deletedAt: "2026-09-23T10:00:00.000Z" }],
    [
      "an owner",
      {
        state: "deleted",
        id: "t1",
        revision: 1,
        updatedAt: "2026-09-23T10:00:00.000Z",
        deletedAt: "2026-09-23T10:00:00.000Z",
        owner: "user_1",
      },
    ],
    [
      "a record on a tombstone",
      {
        state: "deleted",
        id: "t1",
        revision: 1,
        updatedAt: "2026-09-23T10:00:00.000Z",
        deletedAt: "2026-09-23T10:00:00.000Z",
        record: record("t1"),
      },
    ],
    ["a record for another id", { state: "live", id: "t2", revision: 1, updatedAt: "2026-09-23T10:00:00.000Z", record: record("t1") }],
    [
      "an invalid record",
      { state: "live", id: "t1", revision: 1, updatedAt: "2026-09-23T10:00:00.000Z", record: { ...record("t1"), name: "" } },
    ],
  ])("refuses %s", (_label, input) => {
    expect(parseRemoteTheme(input).ok).toBe(false);
  });

  it("compares content without the id, the local content revision, or key order", () => {
    const a = record("t1", "Kiln", 1);
    const b = record("t2", "Kiln", 9);
    expect(sameThemeContent(a, b)).toBe(true);
    expect(themeContentKey(a)).toBe(themeContentKey(b));
    expect(sameThemeContent(a, record("t1", "Kiln 2"))).toBe(false);
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });

  it("measures a record in UTF-8 bytes", () => {
    expect(themeRecordBytes(record("t1"))).toBe(new TextEncoder().encode(JSON.stringify(record("t1"))).byteLength);
  });

  it("shares the id and key shapes", () => {
    expect(THEME_ID_PATTERN.test("theme_1b2c")).toBe(true);
    expect(THEME_ID_PATTERN.test("../x")).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test("8c2f5e0a-1f7e-4c7e-9a51-3d2b1c0f9e8d")).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test("short")).toBe(false);
  });
});
