import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every shipped pack, in every list that has to name it.
 *
 * A pack in this repository is named in four places: the app picks the
 * bundle up with a glob, and three hand-written lists validate it, play
 * its fixtures, and seed it into the catalog. Three of those are lists
 * somebody has to remember to add a line to, and Interference was in
 * two of them for a week: written, tested, shipped in the app, and
 * absent from the catalog because one array had not been touched.
 *
 * A glob would have been the other fix, and the lists are deliberate:
 * the test bench is validated and played and never listed. So this
 * holds the lists to the directory instead.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(repoRoot, p), "utf8");
const yamlIn = (dir: string) =>
  readdirSync(join(repoRoot, dir))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => `${dir}/${f}`)
    .sort();

/** What a player can be given: the demo packs and the sketches. */
const shipped = [...yamlIn("packs/demo"), ...yamlIn("packs/sketches")];
/** The bench, which is validated and played and never listed anywhere. */
const bench = yamlIn("packs/testing");

const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
const seed = read("scripts/seed-listings.ts");

describe("every pack this repo ships", () => {
  it("has some to check at all, so an empty directory cannot pass this file", () => {
    expect(shipped.length).toBeGreaterThan(15);
    expect(bench.length).toBeGreaterThan(0);
  });

  it("is validated by npm run check:packs", () => {
    const missing = [...shipped, ...bench].filter((p) => !scripts["check:packs"]?.includes(p));
    expect(missing, `add these to check:packs in package.json:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("has its own fixtures played by npm run test:packs", () => {
    const missing = [...shipped, ...bench].filter((p) => !scripts["test:packs"]?.includes(p));
    expect(missing, `add these to test:packs in package.json:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("is seeded into the catalog", () => {
    const missing = shipped.filter((p) => !seed.includes(`"${p}"`));
    expect(missing, `add these to PACKS in scripts/seed-listings.ts:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("leaves the test bench out of the catalog, which is the one deliberate absence", () => {
    for (const p of bench) expect(seed).not.toContain(`"${p}"`);
  });
});
