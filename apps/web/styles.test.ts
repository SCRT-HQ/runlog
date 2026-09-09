import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * The stylesheet has to parse, all of it.
 *
 * esbuild recovers from a syntax error by dropping the rule it cannot read
 * and printing a warning nobody reads. The build stays green while every rule
 * after the mistake is gone, which is exactly what happened when a merge lost
 * a closing brace. So the same minifier is asked here, and any warning fails.
 */
const here = dirname(fileURLToPath(import.meta.url));

async function problems(css: string): Promise<string[]> {
  const { warnings } = await transform(css, { loader: "css", minify: true, logLevel: "silent" });
  return warnings.map((w) => `${w.text}${w.location ? ` (line ${w.location.line})` : ""}`);
}

describe("the stylesheets", () => {
  for (const file of ["src/styles.css", "src/fonts.css"]) {
    it(`${file} parses without a single warning`, async () => {
      expect(await problems(readFileSync(join(here, file), "utf8"))).toEqual([]);
    });
  }

  it("would catch the brace a merge lost", async () => {
    const found = await problems(".a {\n  color: red;\n.b {\n  color: blue;\n}\n");
    expect(found.some((p) => /Expected "}"/.test(p))).toBe(true);
  });
});
