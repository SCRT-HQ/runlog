import { describe, expect, it } from "vitest";
import { createThemeRecordFromPreset, type ThemeRecordV1 } from "@runlog/themes";
import { planLocalChange, type ThemeMutationV1 } from "./outbox.ts";

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
      queued: [entry({ seq: 7, attempts: 1 })],
      remote: null,
      change: { op: "put", record: record("Kiln 2") },
      newKey,
    });
    expect(plan).toMatchObject({ kind: "append", entry: { base: { kind: "previous" } } });
    expect("entry" in plan ? plan.entry.key : null).not.toBe("key-0000000000000000");
  });

  it("replaces a refused entry with a new key", () => {
    const plan = planLocalChange({
      queued: [entry({ seq: 7, attempts: 3, hold: "invalid" })],
      remote: null,
      change: { op: "put", record: record("Fixed") },
      newKey,
    });
    expect(plan).toMatchObject({ kind: "replace", seq: 7, entry: { attempts: 0, hold: null, record: { name: "Fixed" } } });
    expect("entry" in plan ? plan.entry.key : null).not.toBe("key-0000000000000000");
  });

  it("drops a create that never left when the theme is deleted", () => {
    expect(
      planLocalChange({ queued: [entry({ seq: 3 }), entry({ seq: 4 })], remote: null, change: { op: "delete", id: "t1" }, newKey }),
    ).toEqual({ kind: "drop", seqs: [3, 4] });
  });

  it("keeps a delete behind anything the server may have seen", () => {
    expect(
      planLocalChange({ queued: [entry({ seq: 3, attempts: 1 })], remote: null, change: { op: "delete", id: "t1" }, newKey }),
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

  it("has nothing to send for a theme the server never had and nothing queued", () => {
    expect(planLocalChange({ queued: [], remote: null, change: { op: "delete", id: "t1" }, newKey })).toEqual({ kind: "none" });
  });
});
