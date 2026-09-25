import { describe, expect, it } from "vitest";
import { BUILTIN_PRESETS } from "./presets.ts";
import { createThemeRecordFromPreset } from "./records.ts";
import { resolveThemeRecord, type PresentationSnapshotV1 } from "./snapshot.ts";
import type { BuiltinColorBaseId } from "./colorBases.ts";
import {
  LOOK_CHANNEL_ID_PATTERN,
  LOOK_CHANNEL_LIMITS,
  LOOK_PUBLISHER_HEADER,
  LOOK_READ_HEADER,
  LOOK_READ_KEY_PATTERN,
  LOOK_SECRET_PATTERN,
  lookSnapshotBytes,
  parseLookChannelSummary,
  parsePublicLook,
} from "./follow.ts";

function snapshotOf(presetId: BuiltinColorBaseId): PresentationSnapshotV1 {
  const made = createThemeRecordFromPreset({ id: `fx-${presetId}`, name: "Kiln", presetId });
  if (!made.ok) throw new Error("fixture");
  const resolved = resolveThemeRecord(made.value);
  if (!resolved.ok) throw new Error("fixture");
  return resolved.value;
}
const AT = "2026-09-25T10:00:00.000Z";

describe("the theme link contract", () => {
  it("fixes the limits the server and the app share", () => {
    expect(LOOK_CHANNEL_LIMITS).toEqual({ maxRequestBytes: 4096, publishesPerMinute: 30, maxChannels: 10 });
    expect(Object.isFrozen(LOOK_CHANNEL_LIMITS)).toBe(true);
    expect(LOOK_READ_HEADER).toBe("x-runlog-look");
    expect(LOOK_PUBLISHER_HEADER).toBe("x-runlog-publisher");
  });

  it("keeps every built-in look well under the request cap", () => {
    for (const preset of BUILTIN_PRESETS) {
      const bytes = lookSnapshotBytes(snapshotOf(preset.id));
      expect(bytes).toBeGreaterThan(1000);
      expect(bytes).toBeLessThan(LOOK_CHANNEL_LIMITS.maxRequestBytes / 2);
    }
  });

  it("shares the id, key and secret shapes", () => {
    expect(LOOK_CHANNEL_ID_PATTERN.test("lk_AAAAAAAAAAAAAAAA")).toBe(true);
    expect(LOOK_CHANNEL_ID_PATTERN.test("public")).toBe(false);
    expect(LOOK_CHANNEL_ID_PATTERN.test("lk_short")).toBe(false);
    expect(LOOK_READ_KEY_PATTERN.test("r".repeat(32))).toBe(true);
    expect(LOOK_READ_KEY_PATTERN.test("r".repeat(31))).toBe(false);
    expect(LOOK_READ_KEY_PATTERN.test(`${"r".repeat(31)}&`)).toBe(false);
    expect(LOOK_SECRET_PATTERN.test("s".repeat(43))).toBe(true);
    expect(LOOK_SECRET_PATTERN.test("s".repeat(32))).toBe(false);
  });

  it("reads a public look: presentation values and a revision, nothing else", () => {
    const snapshot = snapshotOf("ember");
    const read = parsePublicLook({ schemaVersion: 1, revision: 3, snapshot });
    expect(read.ok && read.value.revision).toBe(3);
    expect(read.ok && read.value.snapshot.colors["widget.ground"]).toBe(snapshot.colors["widget.ground"]);
  });

  it.each([
    ["a theme name", { schemaVersion: 1, revision: 1, snapshot: snapshotOf("ember"), name: "Kiln" }],
    ["an owner", { schemaVersion: 1, revision: 1, snapshot: snapshotOf("ember"), owner: "user_1" }],
    ["a channel id", { schemaVersion: 1, revision: 1, snapshot: snapshotOf("ember"), id: "lk_AAAAAAAAAAAAAAAA" }],
    ["revision zero", { schemaVersion: 1, revision: 0, snapshot: snapshotOf("ember") }],
    ["a future schema", { schemaVersion: 2, revision: 1, snapshot: snapshotOf("ember") }],
    [
      "a color that is not a color",
      {
        schemaVersion: 1,
        revision: 1,
        snapshot: { ...snapshotOf("ember"), colors: { ...snapshotOf("ember").colors, "surface.page": "url(https://example.invalid/x)" } },
      },
    ],
    ["no snapshot", { schemaVersion: 1, revision: 1 }],
    ["not a record", "1.d.ffffff"],
  ])("refuses a public look with %s", (_label, input) => {
    expect(parsePublicLook(input).ok).toBe(false);
  });

  it("reads the owner's summary of a link and refuses anything that could carry a credential", () => {
    const summary = { id: "lk_AAAAAAAAAAAAAAAA", revision: 0, createdAt: AT, updatedAt: AT, publishedAt: null };
    expect(parseLookChannelSummary(summary)).toEqual({ ok: true, value: summary });
    expect(parseLookChannelSummary({ ...summary, revision: 4, publishedAt: AT }).ok).toBe(true);
    expect(parseLookChannelSummary({ ...summary, readKey: "r".repeat(32) }).ok).toBe(false);
    expect(parseLookChannelSummary({ ...summary, secret: "s".repeat(43) }).ok).toBe(false);
    expect(parseLookChannelSummary({ ...summary, id: "public" }).ok).toBe(false);
    expect(parseLookChannelSummary({ ...summary, revision: -1 }).ok).toBe(false);
    expect(parseLookChannelSummary({ ...summary, publishedAt: "yesterday" }).ok).toBe(false);
  });

  it("measures a snapshot as its canonical UTF-8 text", () => {
    const snapshot = snapshotOf("glaze");
    expect(lookSnapshotBytes(snapshot)).toBe(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength);
  });
});
