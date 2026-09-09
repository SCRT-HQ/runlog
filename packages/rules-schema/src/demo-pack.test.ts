import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "./load.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const demoPath = join(repoRoot, "packs", "demo", "pack.yaml");

/**
 * The demo pack doubles as the contract's own regression test. If a schema
 * change breaks it, that is a signal about every pack in the wild: the demo
 * is meant to use every construct at least once precisely so this test has
 * teeth.
 */
describe("the demo pack", () => {
  const result = loadPackText(readFileSync(demoPath, "utf8"), "yaml");

  it("loads with no errors and no warnings", () => {
    if (!result.ok) {
      throw new Error(
        `demo pack failed to load:\n${result.diagnostics
          .map((d) => `  [${d.level}] ${d.code} at ${d.path || "<root>"}: ${d.message}`)
          .join("\n")}`,
      );
    }
    expect(result.diagnostics).toEqual([]);
  });

  it("exercises both table resolution kinds", () => {
    const pack = result.ok ? result.pack : null;
    const kinds = new Set(Object.values(pack!.tables).map((t) => t.resolution));
    expect(kinds).toEqual(new Set(["lookup", "bands"]));
  });

  it("declares every capability it actually uses", () => {
    const pack = result.ok ? result.pack : null;
    expect(pack!.capabilities).toEqual(
      expect.arrayContaining(["decks", "counters", "backwardTargeting", "bandsResolution"]),
    );
  });

  it("keeps the d100 check table tiling 1..100", () => {
    const pack = result.ok ? result.pack : null;
    const check = pack!.tables.check!;
    expect(check.resolution).toBe("lookup");
    const covered = new Set<number>();
    for (const entry of check.entries as Array<{ range: [number, number] }>) {
      for (let n = entry.range[0]; n <= entry.range[1]; n++) covered.add(n);
    }
    expect(covered.size).toBe(100);
  });

  it("is redistributable, so the app may include its text in exports", () => {
    const pack = result.ok ? result.pack : null;
    expect(pack!.license.redistributable).toBe(true);
  });
});
