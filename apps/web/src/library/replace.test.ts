import { describe, expect, it } from "vitest";
import type { Pack } from "@runlog/rules-schema";
import type { StoredPack } from "../storage/db.ts";
import { keptFromFile, notThisPack, replacedNotice } from "./replace.ts";

/**
 * Loading a newer file of a pack already on the shelf.
 *
 * This used to build the record from scratch, which quietly dropped the
 * pack's sync switch. With the switch off the pack fell out of the set the
 * engine pushes, the account still had the old text, and the next sync
 * pulled that old text back over the new file: the player could not
 * update a pack without forgetting it, and forgetting it takes its runs.
 */

const pack = (over: Partial<Pack> = {}) => ({ id: "com.example.kiln", title: "Kiln Yard", version: "1.1.0", ...over }) as Pack;

const onShelf: StoredPack = {
  id: "com.example.kiln",
  title: "Kiln Yard",
  version: "1.0.0",
  source: "old: text",
  format: "yaml",
  filename: "kiln.yaml",
  importedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  sync: true,
};

describe("a file of a pack already on the shelf", () => {
  const next = keptFromFile(onShelf, pack(), "new: text", "kiln-v2.yml", "2026-02-01T00:00:00Z");

  it("is the same record with the new text, version and filename", () => {
    expect(next.id).toBe(onShelf.id);
    expect(next.source).toBe("new: text");
    expect(next.version).toBe("1.1.0");
    expect(next.filename).toBe("kiln-v2.yml");
    expect(next.format).toBe("yaml");
    expect(next.updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("keeps when it first arrived and whether it travels to the account", () => {
    expect(next.importedAt).toBe(onShelf.importedAt);
    expect(next.sync).toBe(true);
  });

  it("keeps a switch that was turned off, off", () => {
    expect(keptFromFile({ ...onShelf, sync: false }, pack(), "t", "kiln.yaml", "2026-02-01T00:00:00Z").sync).toBe(false);
  });

  it("is the player's own from then on: no catalog to ask, no seal", () => {
    const wasCatalog: StoredPack = { ...onShelf, origin: "catalog", catalog: { id: "com.example.kiln", version: "1.0.0" } };
    const replaced = keptFromFile(wasCatalog, pack(), "t", "kiln.yaml", "2026-02-01T00:00:00Z");
    expect(replaced.origin).toBeUndefined();
    expect(replaced.catalog).toBeUndefined();
    expect(keptFromFile({ ...onShelf, sealed: true }, pack(), "t", "kiln.yaml", "2026-02-01T00:00:00Z").sealed).toBeUndefined();
  });

  it("starts over for a pack nobody has, or one that was forgotten", () => {
    const fresh = keptFromFile(null, pack(), "t", "kiln.json", "2026-02-01T00:00:00Z");
    expect(fresh.importedAt).toBe("2026-02-01T00:00:00Z");
    expect(fresh.format).toBe("json");
    expect(fresh.sync).toBeUndefined();
    const revived = keptFromFile({ ...onShelf, deletedAt: "2026-01-02T00:00:00Z" }, pack(), "t", "kiln.yaml", "2026-02-01T00:00:00Z");
    expect(revived.deletedAt).toBeUndefined();
    expect(revived.importedAt).toBe("2026-02-01T00:00:00Z");
    expect(revived.sync).toBeUndefined();
  });
});

describe("a file picked for the wrong pack", () => {
  it("is refused by id, and told where it does belong", () => {
    const why = notThisPack(onShelf, pack({ id: "com.example.other", title: "Other Game" }));
    expect(why).toContain("Other Game (com.example.other), not Kiln Yard");
    expect(why).toContain("Load a pack from a file");
  });

  it("is fine when the ids match, whatever the title says now", () => {
    expect(notThisPack(onShelf, pack({ title: "Kiln Yard, Second Firing" }))).toBeNull();
  });
});

describe("the notice afterwards", () => {
  it("says which version replaced which, in the pack's own word for runs", () => {
    const next = keptFromFile(onShelf, pack(), "t", "kiln.yaml", "2026-02-01T00:00:00Z");
    expect(replacedNotice(onShelf, next, "firings")).toBe("Kiln Yard: v1.0.0 replaced with v1.1.0. Its firings are kept.");
  });

  it("says so when the version did not move", () => {
    const next = keptFromFile(onShelf, pack({ version: "1.0.0" }), "t", "kiln.yaml", "2026-02-01T00:00:00Z");
    expect(replacedNotice(onShelf, next, "runs")).toBe("Kiln Yard: v1.0.0 replaced with a new copy, still v1.0.0. Its runs are kept.");
  });
});
