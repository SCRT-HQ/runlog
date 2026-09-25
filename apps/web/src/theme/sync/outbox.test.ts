import { describe, expect, it } from "vitest";
import { createThemeRecordFromPreset, type ThemeRecordV1 } from "@runlog/themes";
import { parseMutation, planLocalChange, planRefused, type ThemeMutationV1 } from "./outbox.ts";

function record(name = "Kiln"): ThemeRecordV1 {
  const made = createThemeRecordFromPreset({ id: "t1", name, presetId: "ember" });
  if (!made.ok) throw new Error("fixture");
  return made.value;
}
let keys = 0;
const newKey = () => `key-${String((keys += 1)).padStart(16, "0")}`;
const entry = (over: Partial<ThemeMutationV1>): ThemeMutationV1 => ({
  seq: 1,
  themeId: "t1",
  op: "put",
  record: record(),
  base: { kind: "none" },
  key: "key-0000000000000000",
  sent: false,
  attempts: 0,
  notBefore: 0,
  hold: null,
  ...over,
});

describe("planning a local change", () => {
  it("queues a create for a theme the server has never had", () => {
    expect(planLocalChange({ queued: [], remote: null, change: { op: "put", record: record() }, newKey })).toMatchObject({
      kind: "append",
      entry: { op: "put", base: { kind: "none" }, attempts: 0 },
    });
  });

  it("queues an update from the confirmed revision", () => {
    expect(
      planLocalChange({ queued: [], remote: { id: "t1", revision: 4, state: "live" }, change: { op: "put", record: record() }, newKey }),
    ).toMatchObject({ kind: "append", entry: { base: { kind: "revision", revision: 4 } } });
  });

  it("folds repeated unsent saves into one entry with the same key and base", () => {
    const plan = planLocalChange({
      queued: [entry({ seq: 7, base: { kind: "revision", revision: 4 } })],
      remote: null,
      change: { op: "put", record: record("Kiln 2") },
      newKey,
    });
    expect(plan).toMatchObject({
      kind: "replace",
      seq: 7,
      entry: { key: "key-0000000000000000", base: { kind: "revision", revision: 4 }, record: { name: "Kiln 2" } },
    });
  });

  it("never folds into an entry that may have reached the server", () => {
    const plan = planLocalChange({
      queued: [entry({ seq: 7, sent: true, attempts: 1 })],
      remote: null,
      change: { op: "put", record: record("Kiln 2") },
      newKey,
    });
    expect(plan).toMatchObject({ kind: "append", entry: { base: { kind: "previous" } } });
    expect("entry" in plan ? plan.entry.key : null).not.toBe("key-0000000000000000");
  });

  it("replaces a refused entry with a new key", () => {
    const plan = planLocalChange({
      queued: [entry({ seq: 7, sent: true, attempts: 3, hold: "invalid" })],
      remote: null,
      change: { op: "put", record: record("Fixed") },
      newKey,
    });
    expect(plan).toMatchObject({ kind: "replace", seq: 7, entry: { sent: false, attempts: 0, hold: null, record: { name: "Fixed" } } });
    expect("entry" in plan ? plan.entry.key : null).not.toBe("key-0000000000000000");
  });

  it("drops a create that never left when the theme is deleted", () => {
    expect(
      planLocalChange({ queued: [entry({ seq: 3 }), entry({ seq: 4 })], remote: null, change: { op: "delete", id: "t1" }, newKey }),
    ).toEqual({ kind: "drop", seqs: [3, 4] });
  });

  it("keeps a delete behind anything the server may have seen", () => {
    expect(
      planLocalChange({ queued: [entry({ seq: 3, sent: true, attempts: 1 })], remote: null, change: { op: "delete", id: "t1" }, newKey }),
    ).toMatchObject({ kind: "append", entry: { op: "delete", base: { kind: "previous" }, record: null } });
    expect(
      planLocalChange({ queued: [], remote: { id: "t1", revision: 2, state: "live" }, change: { op: "delete", id: "t1" }, newKey }),
    ).toMatchObject({ kind: "append", entry: { op: "delete", base: { kind: "revision", revision: 2 } } });
    expect(
      planLocalChange({
        queued: [entry({ seq: 3, base: { kind: "revision", revision: 2 } })],
        remote: null,
        change: { op: "delete", id: "t1" },
        newKey,
      }),
    ).toMatchObject({ kind: "replace", seq: 3, entry: { op: "delete", base: { kind: "revision", revision: 2 } } });
  });

  it("treats a released entry that was sent as sent: a save appends behind it with a new key", () => {
    // releaseHolds clears attempts, hold and notBefore, but the server may already hold this key and body.
    const released = entry({ seq: 7, sent: true, attempts: 0, hold: null });
    const plan = planLocalChange({ queued: [released], remote: null, change: { op: "put", record: record("Later") }, newKey });
    expect(plan).toMatchObject({ kind: "append", entry: { sent: false, base: { kind: "previous" }, record: { name: "Later" } } });
    expect("entry" in plan ? plan.entry.key : null).not.toBe(released.key);
  });

  it("appends a delete behind a released create that was sent, instead of dropping the create", () => {
    const released = entry({ seq: 7, sent: true, attempts: 0, hold: null, base: { kind: "none" } });
    expect(planLocalChange({ queued: [released], remote: null, change: { op: "delete", id: "t1" }, newKey })).toMatchObject({
      kind: "append",
      entry: { op: "delete", base: { kind: "previous" } },
    });
    const revised = entry({ seq: 7, sent: true, base: { kind: "revision", revision: 2 } });
    expect(planLocalChange({ queued: [revised], remote: null, change: { op: "delete", id: "t1" }, newKey })).toMatchObject({
      kind: "append",
      entry: { op: "delete", base: { kind: "previous" } },
    });
  });

  describe.each(["invalid", "library-full"] as const)("a delete behind a put the server refused as %s", (hold) => {
    it("drops a refused create: the server never had the theme", () => {
      const refused = entry({ seq: 7, sent: true, attempts: 1, hold, base: { kind: "none" } });
      expect(planLocalChange({ queued: [refused], remote: null, change: { op: "delete", id: "t1" }, newKey })).toEqual({
        kind: "drop",
        seqs: [7],
      });
    });

    it("replaces a refused update with a delete at its base, under a new key", () => {
      const refused = entry({ seq: 7, sent: true, attempts: 1, hold, base: { kind: "revision", revision: 4 } });
      const plan = planLocalChange({
        queued: [refused],
        remote: { id: "t1", revision: 4, state: "live" },
        change: { op: "delete", id: "t1" },
        newKey,
      });
      expect(plan).toMatchObject({
        kind: "replace",
        seq: 7,
        entry: { op: "delete", record: null, base: { kind: "revision", revision: 4 }, sent: false, attempts: 0, hold: null },
      });
      expect("entry" in plan ? plan.entry.key : null).not.toBe(refused.key);
    });
  });

  it("still appends a delete behind a put that ran out of tries: it may have reached the server", () => {
    const exhausted = entry({ seq: 7, sent: true, attempts: 8, hold: "retry-exhausted", base: { kind: "none" } });
    expect(planLocalChange({ queued: [exhausted], remote: null, change: { op: "delete", id: "t1" }, newKey })).toMatchObject({
      kind: "append",
      entry: { op: "delete", base: { kind: "previous" } },
    });
  });

  it("has nothing to send for a theme the server never had and nothing queued", () => {
    expect(planLocalChange({ queued: [], remote: null, change: { op: "delete", id: "t1" }, newKey })).toEqual({ kind: "none" });
  });
});

describe("planning after a refusal", () => {
  const refused = (over: Partial<ThemeMutationV1> = {}) =>
    entry({ seq: 1, sent: true, attempts: 1, base: { kind: "revision", revision: 3 }, key: "key-refused-000000000", ...over });
  const behind = (over: Partial<ThemeMutationV1> = {}) =>
    entry({ seq: 2, record: record("Later"), base: { kind: "previous" }, key: "key-behind-0000000000", ...over });

  it("folds an unsent save behind the refused entry into it, under a new key from the refused base", () => {
    const plan = planRefused({ queued: [refused(), behind()], seq: 1, hold: "invalid", attempts: 1, newKey });
    expect(plan).toMatchObject({
      kind: "collapse",
      entry: { seq: 1, op: "put", record: { name: "Later" }, base: { kind: "revision", revision: 3 }, sent: false, hold: null },
      drop: [2],
    });
  });

  it("holds instead of folding when the refused entry's base is the one before it", () => {
    const plan = planRefused({
      queued: [refused({ base: { kind: "previous" } }), behind()],
      seq: 1,
      hold: "invalid",
      attempts: 1,
      newKey,
    });
    expect(plan).toEqual({
      kind: "hold",
      entry: { ...refused({ base: { kind: "previous" } }), sent: true, attempts: 1, notBefore: 0, hold: "invalid" },
    });
  });

  it("holds instead of folding when anything behind it was already sent", () => {
    const sentBehind = behind({ sent: true, attempts: 1 });
    const plan = planRefused({ queued: [refused(), sentBehind], seq: 1, hold: "library-full", attempts: 1, newKey });
    expect(plan).toMatchObject({ kind: "hold", entry: { seq: 1, key: "key-refused-000000000", hold: "library-full" } });
  });

  it("holds instead of folding when an entry behind it is held", () => {
    const plan = planRefused({
      queued: [refused(), behind(), behind({ seq: 3, hold: "retry-exhausted" })],
      seq: 1,
      hold: "invalid",
      attempts: 1,
      newKey,
    });
    expect(plan?.kind).toBe("hold");
  });
});

describe("reading a stored outbox entry", () => {
  it("requires the sent flag", () => {
    const { sent: _sent, ...withoutSent } = entry({ seq: 2 });
    expect(() => parseMutation(withoutSent)).toThrow(/sent/);
    expect(() => parseMutation({ ...withoutSent, sent: "yes" })).toThrow(/sent/);
    expect(parseMutation(entry({ seq: 2, sent: true }))).toMatchObject({ sent: true });
  });
});
