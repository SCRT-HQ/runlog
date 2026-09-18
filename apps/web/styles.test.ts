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

/**
 * The token layer, held to what it promises rather than to a class list.
 *
 * Every rule below is stated as a property of the sheet: which names a look
 * has to answer to, what a shorthand may not undo, and where a control's
 * size is allowed to come from. A slice that migrates next month renames
 * selectors freely; these keep holding.
 */
interface Rule {
  selector: string;
  decls: { prop: string; value: string }[];
}

/** Every rule in the sheet, at-rules flattened, comments gone. */
function rules(css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Rule[] = [];
  let at = 0;
  for (;;) {
    const open = clean.indexOf("{", at);
    if (open < 0) break;
    const selector = clean.slice(at, open).trim().replace(/\s+/g, " ");
    // An at-rule holds rules rather than declarations, so step inside it.
    if (selector.startsWith("@")) {
      at = open + 1;
      continue;
    }
    const close = clean.indexOf("}", open);
    if (close < 0) break;
    found.push({
      selector: selector.replace(/^\}\s*/, ""),
      decls: clean
        .slice(open + 1, close)
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const colon = d.indexOf(":");
          return { prop: d.slice(0, colon).trim(), value: d.slice(colon + 1).trim() };
        })
        .filter((d) => d.prop),
    });
    at = close + 1;
  }
  return found;
}

const sheet = rules(readFileSync(join(here, "src/styles.css"), "utf8"));
/** The blocks that paint a look: the default, the system's light, and the four saved themes. */
const looks = sheet.filter((r) => /^:root/.test(r.selector) && r.decls.some((d) => d.prop === "--bg"));

describe("the semantic tokens", () => {
  const roles = ["--bg", "--surface", "--surface-raised", "--line", "--text", "--text-muted", "--accent", "--warn", "--danger", "--focus"];

  it("gives every look all ten color roles of its own", () => {
    // The default, the system's light, and the four themes a saved id names.
    expect(looks.map((l) => l.selector)).toHaveLength(6);
    expect(looks.filter((l) => /\[data-theme=/.test(l.selector))).toHaveLength(4);
    for (const look of looks) {
      const named = new Set(look.decls.map((d) => d.prop));
      expect([look.selector, roles.filter((r) => !named.has(r))]).toEqual([look.selector, []]);
    }
  });

  it("declares the three families and the five type roles", () => {
    const base = looks.find((l) => l.selector === ":root");
    const named = new Set(base?.decls.map((d) => d.prop) ?? []);
    for (const token of [
      "--font-ui",
      "--font-prose",
      "--font-mono",
      "--font-display",
      "--font-page-title",
      "--font-section-title",
      "--font-body",
      "--font-control",
      "--font-caption",
      "--control-h",
      "--control-h-compact",
      "--control-h-touch",
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => `--space-${n}`),
    ]) {
      expect([token, named.has(token)]).toEqual([token, true]);
    }
  });
});

describe("what a migrated control promises", () => {
  it("never lets a shorthand throw away a family named above it", () => {
    // What `.ghost` did: `font-family`, then `font: inherit` under it, and
    // the button came out in the page's reading face.
    const undone = sheet.filter((r) => {
      const family = r.decls.findIndex((d) => d.prop === "font-family");
      const shorthand = r.decls.map((d, i) => (d.prop === "font" ? i : -1)).filter((i) => i >= 0);
      return family >= 0 && shorthand.some((i) => i > family);
    });
    expect(undone.map((r) => r.selector)).toEqual([]);
  });

  it("names the family inside the shorthand wherever it states a role", () => {
    const loose = sheet.filter((r) =>
      r.decls.some(
        (d) =>
          d.prop === "font" &&
          /var\(--font-(page-title|section-title|body|control|caption)\)/.test(d.value) &&
          !/var\(--font-(ui|prose|mono|display)\)/.test(d.value),
      ),
    );
    expect(loose.map((r) => r.selector)).toEqual([]);
  });

  it("takes a control's size from a token wherever it takes its height from one", () => {
    const heights = sheet.filter((r) => r.decls.some((d) => d.prop === "min-height" && /var\(--control-h/.test(d.value)));
    expect(heights.length).toBeGreaterThan(3);
    const literal = heights.filter((r) => r.decls.some((d) => /^font(-size)?$/.test(d.prop) && /\d*\.?\d+(rem|px|em)/.test(d.value)));
    expect(literal.map((r) => r.selector)).toEqual([]);
  });

  it("gives a shorter control the same word as a tall one", () => {
    // The design's 4.3: a compact control buys its room in height, never in
    // text size, and a dense row gains no size of its own.
    const compact = sheet.filter((r) => r.decls.some((d) => d.prop === "min-height" && /var\(--control-h-compact\)/.test(d.value)));
    expect(compact.length).toBeGreaterThan(1);
    const shrunk = compact.filter((r) => r.decls.some((d) => d.prop === "font-size" && d.value !== "var(--size-control)"));
    expect(shrunk.map((r) => r.selector)).toEqual([]);
  });

  it("draws the section label at the heading role rather than at a size of its own", () => {
    const labels = sheet.filter((r) => r.decls.some((d) => d.prop === "font" && /var\(--font-section-title\)/.test(d.value)));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect([label.selector, label.decls.some((d) => d.prop === "font-size")]).toEqual([label.selector, false]);
    }
  });

  it("uses the display family only for the three existing UI page titles", () => {
    const display = sheet.filter((r) => r.decls.some((d) => /var\(--font-display\)/.test(d.value)));
    expect(display.map((r) => r.selector)).toEqual([":where(.pageHeader) h1", ".profileApplication > h2", ".marketHead h2"]);
  });
});
