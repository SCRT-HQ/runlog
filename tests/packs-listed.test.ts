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
 * somebody has to remember to add a line to, and one pack was in
 * two of them for a week: written, tested, shipped in the app, and
 * absent from the catalog because one array had not been touched.
 *
 * A glob would have been the other fix, and the lists are deliberate,
 * because two directories are validated and played and never offered:
 * `packs/testing` is the bench, and `packs/demo` is the worked example
 * the guide and most of these tests are written against. What a player
 * is offered is `packs/sketches`, which is what the app globs. So this
 * holds the lists to the directories instead.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(repoRoot, p), "utf8");
const yamlIn = (dir: string) =>
  readdirSync(join(repoRoot, dir))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => `${dir}/${f}`)
    .sort();

/** What a player is offered, and what the app globs into its bundle. */
const shipped = yamlIn("packs/sketches");
/**
 * Validated and played, never listed: the bench, and the demo pack that
 * the authoring guide and most of the suite are written against. Both
 * have to keep loading; neither belongs in a storefront.
 */
const bench = [...yamlIn("packs/demo"), ...yamlIn("packs/testing")];

/**
 * Setups, which are a different document and not offered as packs.
 *
 * They are validated with everything else, because a setup that does not
 * load is one somebody finds out about when a run will not start. They
 * are not played, since there are no fixtures to replay, and not listed,
 * since the marketplace does not know the kind yet.
 */
const setups = yamlIn("packs/setups");

const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
const seed = read("scripts/seed-listings.ts");

describe("every pack this repo ships", () => {
  it("has some to check at all, so an empty directory cannot pass this file", () => {
    expect(shipped.length).toBeGreaterThan(5);
    expect(bench.length).toBeGreaterThan(1);
  });

  it("is validated by npm run check:packs", () => {
    const missing = [...shipped, ...bench, ...setups].filter((p) => !scripts["check:packs"]?.includes(p));
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

  it("leaves the bench and the demo pack out of the catalog, the deliberate absences", () => {
    for (const p of bench) expect(seed).not.toContain(`"${p}"`);
    // A setup is not a pack, and the shelf has no kind for one yet.
    for (const p of setups) expect(seed).not.toContain(`"${p}"`);
  });
});
