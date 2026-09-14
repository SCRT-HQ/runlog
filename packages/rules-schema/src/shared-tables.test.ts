import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSharedTables, resolveUses, SHARED_TABLES_SCHEMA_VERSION, type SharedTables } from "./shared-tables.ts";
import { loadSharedTablesText, whichKind } from "./load.ts";
import { Pack } from "./pack.ts";

/**
 * Tables somebody wrote once, folded into a pack that borrows them.
 *
 * The claims worth holding down are that a pack can choose a pitch, a run
 * can choose a different one, and that borrowing goes wrong loudly. A
 * borrowed entry that silently replaced one of the pack's own would be a
 * result that quietly stops coming up, which is the same shape of bug as
 * a renamed tag: nothing fails, the game is just different.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const set = (over: Partial<SharedTables> = {}): SharedTables =>
  parseSharedTables({
    kind: "tables",
    schemaVersion: SHARED_TABLES_SCHEMA_VERSION,
    id: "com.example.tables.curses",
    version: "1.0.0",
    title: "Curses",
    defaultVariant: "gentle",
    variants: {
      gentle: {
        title: "Gentle",
        roll: "d2",
        entries: [
          { id: "g1", range: [1, 1], text: "A small one." },
          { id: "g2", range: [2, 2], text: "Another." },
        ],
      },
      harsh: {
        title: "Harsh",
        roll: "d2",
        entries: [
          { id: "h1", range: [1, 1], text: "A big one." },
          { id: "h2", range: [2, 2], text: "Another." },
        ],
      },
    },
    ...over,
  }).tables!;

const packWith = (use: unknown[], tables: Record<string, unknown> = {}) =>
  Pack.parse({
    schemaVersion: 1,
    id: "com.example.borrower",
    version: "1.0.0",
    title: "Borrower",
    license: { id: "MIT", redistributable: true },
    vocabulary: { run: { one: "Run", many: "Runs" }, unit: { one: "Unit", many: "Units" }, subject: { one: "Thing", many: "Things" } },
    use,
    tables: {
      own: {
        resolution: "lookup",
        title: "Own",
        roll: "d2",
        entries: [
          { id: "o1", range: [1, 1], text: "Mine." },
          { id: "o2", range: [2, 2], text: "Also mine." },
        ],
      },
      ...tables,
    },
    phases: [{ id: "p", label: "P", steps: [{ kind: "rollTable", table: "own" }] }],
    modes: { m: { label: "M", units: { min: 1, max: 1 } } },
    defaultMode: "m",
  });

describe("a shared table set", () => {
  it("refuses a default naming a variant it does not have", () => {
    const r = parseSharedTables({ ...JSON.parse(JSON.stringify(set())), defaultVariant: "nonesuch" });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("tables/default");
  });

  it("is its own kind of document", () => {
    const yaml = readFileSync(join(repoRoot, "packs", "tables", "elden-ring-displacements.yaml"), "utf8");
    expect(whichKind(yaml, "yaml")).toBe("tables");
    expect(loadSharedTablesText(yaml, "yaml").ok).toBe(true);
  });
});

describe("borrowing them", () => {
  const provide = (id: string) => (id === "com.example.tables.curses" ? set() : null);

  it("takes the set's own default when nobody names a variant", () => {
    const { pack } = resolveUses(packWith([{ from: "com.example.tables.curses", as: "curse" }]), provide);
    expect(pack.tables["curse"]?.entries.map((e) => e.id)).toEqual(["g1", "g2"]);
  });

  it("takes the one the pack names", () => {
    const { pack } = resolveUses(packWith([{ from: "com.example.tables.curses", as: "curse", variant: "harsh" }]), provide);
    expect(pack.tables["curse"]?.entries.map((e) => e.id)).toEqual(["h1", "h2"]);
  });

  it("lets a run overrule the pack, which is the point of variants", () => {
    // The same pack, the harsh curses tonight, and no fork anywhere.
    const { pack } = resolveUses(packWith([{ from: "com.example.tables.curses", as: "curse", variant: "gentle" }]), provide, () => "harsh");
    expect(pack.tables["curse"]?.entries.map((e) => e.id)).toEqual(["h1", "h2"]);
  });

  it("appends to the pack's own table rather than replacing it, when asked", () => {
    const { pack, diagnostics } = resolveUses(packWith([{ from: "com.example.tables.curses", as: "own", merge: "append" }]), provide);
    expect(diagnostics).toEqual([]);
    expect(pack.tables["own"]?.entries.map((e) => e.id)).toEqual(["o1", "o2", "g1", "g2"]);
  });

  it("refuses to append entries that would replace the pack's own", () => {
    // Silently overwriting here is a result that stops coming up and
    // nothing anywhere saying so.
    const clashing = set({
      variants: { gentle: { title: "G", roll: "d1", entries: [{ id: "o1", range: [1, 1], text: "Not yours." }] } },
      defaultVariant: "gentle",
    });
    const { diagnostics } = resolveUses(packWith([{ from: "com.example.tables.curses", as: "own", merge: "append" }]), () => clashing);
    expect(diagnostics[0]?.code).toBe("use/clash");
    expect(diagnostics[0]?.message).toContain("o1");
  });

  it("says a set is missing rather than failing, since it may just not be on this device", () => {
    const { pack, diagnostics } = resolveUses(packWith([{ from: "com.example.tables.absent", as: "curse" }]), () => null);
    expect(diagnostics[0]?.code).toBe("use/missing");
    expect(diagnostics[0]?.level).toBe("warning");
    expect(pack.tables["curse"]).toBeUndefined();
  });

  it("says so when the variant named is not one the set has", () => {
    const { diagnostics } = resolveUses(packWith([{ from: "com.example.tables.curses", as: "curse", variant: "nonesuch" }]), provide);
    expect(diagnostics[0]?.code).toBe("use/variant");
    expect(diagnostics[0]?.message).toContain("gentle, harsh");
  });

  it("leaves a pack that borrows nothing exactly as it was", () => {
    const plain = packWith([]);
    expect(resolveUses(plain, provide).pack).toBe(plain);
  });
});
