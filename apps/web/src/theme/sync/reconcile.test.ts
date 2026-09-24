import { describe, expect, it } from "vitest";
import { createThemeRecordFromPreset, type RemoteThemeV1, type ThemeRecordV1 } from "@runlog/themes";
import type { ThemeMutationV1 } from "./outbox.ts";
import { copyName, copyRecord, decidePush, retryDelay, THEME_RETRY } from "./reconcile.ts";

function record(name = "Kiln", id = "t1"): ThemeRecordV1 {
  const made = createThemeRecordFromPreset({ id, name, presetId: "ember" });
  if (!made.ok) throw new Error("fixture");
  return made.value;
}
const NOW = 1_000_000;
const put = (over: Partial<ThemeMutationV1> = {}): ThemeMutationV1 => ({
  seq: 1,
  themeId: "t1",
  op: "put",
  record: record("Mine"),
  base: { kind: "revision", revision: 2 },
  key: "key-0000000000000001",
  sent: true,
  attempts: 1,
  notBefore: 0,
  hold: null,
  ...over,
});
const del = (over: Partial<ThemeMutationV1> = {}): ThemeMutationV1 => put({ op: "delete", record: null, ...over });
const live = (name: string, revision = 3): RemoteThemeV1 => ({
  state: "live",
  id: "t1",
  revision,
  updatedAt: "2026-09-23T10:00:00.000Z",
  record: record(name),
});
const gone: RemoteThemeV1 = {
  state: "deleted",
  id: "t1",
  revision: 3,
  updatedAt: "2026-09-23T10:00:00.000Z",
  deletedAt: "2026-09-23T10:00:00.000Z",
};
const saved = { kind: "saved" as const, id: "t1", localRevision: 4, record: record("Mine") };

describe("deciding what a push answer means", () => {
  it("confirms a write the server took, first time or replayed", () => {
    expect(decidePush(put(), { kind: "ok", theme: live("Mine"), replayed: true }, saved, NOW)).toEqual({
      kind: "confirm",
      remote: { id: "t1", revision: 3, state: "live" },
    });
  });

  it("confirms a conflict whose server content is this very change (a lost answer after its receipt expired)", () => {
    expect(decidePush(put(), { kind: "conflict", current: live("Mine", 3) }, saved, NOW)).toEqual({
      kind: "confirm",
      remote: { id: "t1", revision: 3, state: "live" },
    });
  });

  it("keeps the server's edit and saves this one as a conflict copy", () => {
    expect(decidePush(put(), { kind: "conflict", current: live("Theirs") }, saved, NOW)).toEqual({
      kind: "conflict",
      server: live("Theirs"),
      copy: "conflict",
      recreate: false,
      keptServer: false,
    });
  });

  it("never revives a deleted id: an edit that meets a tombstone becomes a recovered copy", () => {
    expect(decidePush(put(), { kind: "conflict", current: gone }, saved, NOW)).toEqual({
      kind: "conflict",
      server: gone,
      copy: "recovery",
      recreate: false,
      keptServer: false,
    });
  });

  it("recreates when the server has nothing under the id at all", () => {
    expect(decidePush(put(), { kind: "conflict", current: null }, saved, NOW)).toEqual({
      kind: "conflict",
      server: null,
      copy: null,
      recreate: true,
      keptServer: false,
    });
  });

  it("lets a delete that lost to a newer edit keep the edit, and says so", () => {
    const deleted = { kind: "deleted" as const, id: "t1", localRevision: 5 };
    expect(decidePush(del(), { kind: "conflict", current: live("Theirs") }, deleted, NOW)).toEqual({
      kind: "conflict",
      server: live("Theirs"),
      copy: null,
      recreate: false,
      keptServer: true,
    });
    expect(decidePush(del(), { kind: "conflict", current: gone }, deleted, NOW)).toEqual({
      kind: "confirm",
      remote: { id: "t1", revision: 3, state: "deleted" },
    });
    expect(decidePush(del(), { kind: "conflict", current: null }, deleted, NOW)).toEqual({ kind: "drop" });
  });

  it("keeps the server's edit and makes no copy when this device has since deleted the theme", () => {
    const deleted = { kind: "deleted" as const, id: "t1", localRevision: 5 };
    expect(decidePush(put(), { kind: "conflict", current: live("Theirs") }, deleted, NOW)).toEqual({
      kind: "conflict",
      server: live("Theirs"),
      copy: null,
      recreate: false,
      keptServer: true,
    });
  });

  it("holds what waits on the person, and names the field the server refused", () => {
    expect(decidePush(put(), { kind: "library-full", limit: 200 }, saved, NOW)).toEqual({
      kind: "hold",
      hold: "library-full",
      detail: null,
    });
    expect(
      decidePush(
        put(),
        { kind: "rejected", code: "invalid-theme", message: "bad", issues: [{ path: "$.name", message: "Expected a name" }] },
        saved,
        NOW,
      ),
    ).toEqual({ kind: "hold", hold: "invalid", detail: "$.name: Expected a name" });
    expect(decidePush(put(), { kind: "too-large" }, saved, NOW)).toEqual({ kind: "hold", hold: "invalid", detail: "larger than 64 KiB" });
  });

  it("waits out a rate limit without spending a try", () => {
    expect(decidePush(put(), { kind: "rate-limited", retryAfterMs: 12_000 }, saved, NOW)).toEqual({
      kind: "retry",
      notBefore: NOW + 12_000,
      countsAsTry: false,
    });
  });

  it("backs off 20 s, doubling, to 5 minutes, and gives up after the eighth try", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(retryDelay)).toEqual([
      20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000, 300_000, 300_000,
    ]);
    expect(decidePush(put({ attempts: 3 }), { kind: "error" }, saved, NOW)).toEqual({
      kind: "retry",
      notBefore: NOW + 80_000,
      countsAsTry: true,
    });
    expect(decidePush(put({ attempts: THEME_RETRY.tries }), { kind: "error" }, saved, NOW)).toEqual({
      kind: "hold",
      hold: "retry-exhausted",
      detail: null,
    });
  });

  it("pauses offline and stops for sign-in without touching the entry's tries", () => {
    expect(decidePush(put(), { kind: "offline" }, saved, NOW)).toEqual({ kind: "pause-offline" });
    expect(decidePush(put(), { kind: "unauthorized" }, saved, NOW)).toEqual({ kind: "stop-signed-out" });
  });
});

describe("naming a copy", () => {
  it("adds a plain suffix and stays within 80 characters", () => {
    expect(copyName("Kiln", "conflict")).toBe("Kiln (conflict copy)");
    expect(copyName("Kiln", "recovery")).toBe("Kiln (recovered)");
    const long = "é".repeat(80);
    expect([...copyName(long, "conflict")].length).toBe(80);
  });

  it("makes a new id at content revision 1 with the same look", () => {
    const copy = copyRecord(record("Kiln"), "theme_new", "conflict");
    expect(copy).toMatchObject({ id: "theme_new", name: "Kiln (conflict copy)", contentRevision: 1 });
    expect(copy.base).toEqual(record("Kiln").base);
  });
});
