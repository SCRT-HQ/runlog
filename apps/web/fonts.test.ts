import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dependenciesOf } from "../../scripts/licenses.ts";

interface ExpectedFace {
  family: string;
  style: string;
  display: string;
  weight: string;
  source: string;
  format: string;
  packageName: string;
  packageFile: string;
  sourceBytes: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const fontsCss = readFileSync(join(here, "src/fonts.css"), "utf8");
const latinRange =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

const expectedFaces: ExpectedFace[] = [
  {
    family: "Atkinson Hyperlegible Next Variable",
    style: "normal",
    display: "swap",
    weight: "200 800",
    source: "@font-atkinson-next/atkinson-hyperlegible-next-latin-wght-normal.woff2",
    format: "woff2-variations",
    packageName: "@fontsource-variable/atkinson-hyperlegible-next",
    packageFile: "atkinson-hyperlegible-next-latin-wght-normal.woff2",
    sourceBytes: 33996,
  },
  {
    family: "Atkinson Hyperlegible Next Variable",
    style: "italic",
    display: "swap",
    weight: "200 800",
    source: "@font-atkinson-next/atkinson-hyperlegible-next-latin-wght-italic.woff2",
    format: "woff2-variations",
    packageName: "@fontsource-variable/atkinson-hyperlegible-next",
    packageFile: "atkinson-hyperlegible-next-latin-wght-italic.woff2",
    sourceBytes: 37644,
  },
  {
    family: "Space Grotesk Variable",
    style: "normal",
    display: "swap",
    weight: "300 700",
    source: "@font-space-grotesk/space-grotesk-latin-wght-normal.woff2",
    format: "woff2-variations",
    packageName: "@fontsource-variable/space-grotesk",
    packageFile: "space-grotesk-latin-wght-normal.woff2",
    sourceBytes: 22288,
  },
  {
    family: "Oxanium Variable",
    style: "normal",
    display: "swap",
    weight: "200 800",
    source: "@font-oxanium/oxanium-latin-wght-normal.woff2",
    format: "woff2-variations",
    packageName: "@fontsource-variable/oxanium",
    packageFile: "oxanium-latin-wght-normal.woff2",
    sourceBytes: 14044,
  },
  {
    family: "VT323",
    style: "normal",
    display: "swap",
    weight: "400",
    source: "@font-vt323/vt323-latin-400-normal.woff2",
    format: "woff2",
    packageName: "@fontsource/vt323",
    packageFile: "vt323-latin-400-normal.woff2",
    sourceBytes: 17936,
  },
  {
    family: "Press Start 2P",
    style: "normal",
    display: "swap",
    weight: "400",
    source: "@font-press-start-2p/press-start-2p-latin-400-normal.woff2",
    format: "woff2",
    packageName: "@fontsource/press-start-2p",
    packageFile: "press-start-2p-latin-400-normal.woff2",
    sourceBytes: 12512,
  },
];

function declarations(body: string): Map<string, string> {
  return new Map(
    body
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const colon = part.indexOf(":");
        return [
          part.slice(0, colon).trim(),
          part
            .slice(colon + 1)
            .trim()
            .replace(/\s+/g, " "),
        ];
      }),
  );
}

function fontFaces(css: string): Map<string, string>[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => declarations(match[1] ?? ""));
}

describe("the bundled theme font catalog", () => {
  it("declares exactly the six requested Latin WOFF2 faces and ships valid package files", () => {
    const requestedFamilies = new Set(expectedFaces.map((face) => face.family));
    const actual = fontFaces(fontsCss).filter((face) => requestedFamilies.has((face.get("font-family") ?? "").replaceAll('"', "")));

    // Assert declarations before touching package files so RED proves the CSS feature is missing.
    expect(
      actual.map((face) => ({
        family: (face.get("font-family") ?? "").replaceAll('"', ""),
        style: face.get("font-style"),
        display: face.get("font-display"),
        weight: face.get("font-weight"),
        source: face.get("src"),
        range: face.get("unicode-range"),
      })),
    ).toEqual(
      expectedFaces.map((face) => ({
        family: face.family,
        style: face.style,
        display: face.display,
        weight: face.weight,
        source: `url("${face.source}") format("${face.format}")`,
        range: latinRange,
      })),
    );

    for (const face of expectedFaces) {
      const bytes = readFileSync(join(root, "node_modules", face.packageName, "files", face.packageFile));
      expect(bytes.subarray(0, 4).toString("ascii"), face.family).toBe("wOF2");
      expect(bytes.byteLength, face.family).toBe(face.sourceBytes);
    }
  });

  it("includes complete OFL-1.1 notices for all five production dependencies", () => {
    const notices = new Map(dependenciesOf(root).map((notice) => [notice.name, notice]));
    for (const name of new Set(expectedFaces.map((face) => face.packageName))) {
      const notice = notices.get(name);
      expect(notice, name).toBeDefined();
      expect(notice?.license, name).toBe("OFL-1.1");
      expect(notice?.text, name).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });
});
