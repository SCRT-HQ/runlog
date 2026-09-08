import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { deflateSync } from "node:zlib";
import { envConfig, type EnvConfig, type EnvName } from "../infra/lib/config";
import { dependenciesOf, type Dependency } from "../../scripts/licenses";

/**
 * The hosted layer, laid over a build of the app.
 *
 * The app in SCRT-HQ/runlog is generic: it runs from disk, from GitHub
 * Pages, or from anyone's bucket, and knows nothing about who operates it.
 * An address someone runs as a service needs more — terms, a privacy
 * policy, pricing, a way to reach the operator, an image for links, the
 * files crawlers ask for — and those are this repository's to say. They
 * live in `hosted/pages/` as templates and are copied into the built `dist` at
 * publish time with the words for the environment filled in. The app finds
 * `hosted.json` at its own root and, when it is there, shows a footer and
 * asks people signed in to accept the terms; when it is not, it is the
 * plain app and shows nothing.
 *
 * Nothing here runs at request time. It is a build step, and a pure one:
 * the same inputs make the same files.
 */

const HOSTED_DIR = join(__dirname, "..", "pages");

/** Where the app comes from: what a footer's version and commit link to. */
export const SOURCE_URL = "https://github.com/SCRT-HQ/runlog";

/** Every `{{NAME}}` in the templates, with what goes there. */
export type Words = Record<string, string>;

export function wordsFor(config: EnvConfig, build: { version: string; sha: string; today: Date }): Words {
  const day = build.today.toISOString().slice(0, 10);
  const expires = new Date(build.today);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const { hosted } = config;
  return {
    DOMAIN: config.domain,
    OPERATOR: hosted.operator,
    OPERATOR_SHORT: hosted.operatorShort,
    // The name in a footer goes to the operator's own site, else to the about page.
    OPERATOR_URL: hosted.operatorUrl ?? `https://${config.domain}/about.html`,
    SUPPORT: hosted.support,
    TERMS_VERSION: hosted.termsVersion,
    TERMS_DATE: hosted.termsDate,
    VERSION: build.version,
    SHA: build.sha,
    // The build, as links: the release it is, and the commit it was made from.
    RELEASE_URL: `${SOURCE_URL}/releases/tag/v${build.version}`,
    COMMIT_URL: build.sha ? `${SOURCE_URL}/commit/${build.sha}` : SOURCE_URL,
    DATE: day,
    YEAR: String(build.today.getUTCFullYear()),
    EXPIRES: expires.toISOString(),
    LOG_RETENTION: "one month",
    BILLING: hosted.billing ? "true" : "false",
    // The sign-in client, for a build that was built without one: the
    // published package's, which the shell then names (see headTags).
    SIGN_IN: config.workosClientId,
    PLANS_NOTE: hosted.billing
      ? "Subscribe from your profile in the app."
      : "Not switched on yet: everything in Plus is free for everyone while Runlog is in preview.",
  };
}

/** Fill the placeholders. An unknown one is a mistake in a template, and says so. */
export function substitute(text: string, words: Words): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (_, name: string) => {
    const value = words[name];
    if (value === undefined) throw new Error(`no word for {{${name}}}`);
    return value;
  });
}

/** The tags that make a link to the app unfurl: title, description, image, canonical address. */
export function headTags(words: Words): string {
  const url = `https://${words["DOMAIN"]}/`;
  const description = "A referee and run log for dice-driven games played around the things you already do.";
  return [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Runlog" />`,
    `<meta property="og:title" content="Runlog" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${url}og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="runlog:build" content="${words["VERSION"]} ${words["SHA"]}" />`,
    // How a published build, built with no client, signs in here: the app
    // reads this tag when its build has none (apps/web/src/auth/config.ts).
    ...(words["SIGN_IN"] ? [`<meta name="runlog:sign-in" content="${words["SIGN_IN"]}" />`] : []),
  ].join("\n    ");
}

/**
 * Put the tags into the shell. The app leaves a marker for them; a build
 * without one (an older app) gets them before `</head>` instead, so the
 * overlay never depends on the app repository moving first.
 */
export function injectHead(html: string, tags: string): string {
  const marker = "<!-- hosted:head -->";
  if (html.includes(marker)) return html.replace(marker, tags);
  return html.replace("</head>", `    ${tags}\n  </head>`);
}

// ---- licenses ---------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function licensesPage(deps: Dependency[], words: Words): string {
  const rows = deps
    .map(
      (d) => `      <li>
        <strong>${esc(d.name)}</strong> <code>${esc(d.version)}</code> · ${esc(d.license)}${
          d.text ? `\n        <details><summary>License text</summary><pre>${esc(d.text.trim())}</pre></details>` : ""
        }
      </li>`,
    )
    .join("\n");
  return substitute(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Open-source licenses · Runlog</title>
    <meta name="description" content="Runlog's own license and the licenses of the software it is built from." />
    <link rel="stylesheet" href="/hosted.css" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    <link rel="canonical" href="https://{{DOMAIN}}/licenses.html" />
    <style>
      .deps { list-style: none; padding: 0; }
      .deps li { padding: 0.5rem 0; border-bottom: 1px solid var(--line); }
      .deps pre { white-space: pre-wrap; font-size: 0.78rem; color: var(--muted); max-height: 24rem; overflow: auto; }
      .deps summary { cursor: pointer; color: var(--muted); font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="/"><img src="/icon.svg" alt="" />Runlog</a>
      <nav>
        <a href="/#guide">Guide</a>
        <a href="/pricing.html">Pricing</a>
        <a href="/legal/terms.html">Terms</a>
        <a href="/legal/privacy.html">Privacy</a>
        <a href="/legal/publishers.html">Publishers</a>
        <a href="/about.html">About</a>
      </nav>
    </header>
    <main>
      <h1>Open-source licenses</h1>
      <p class="lede">Runlog is free software, and stands on other people's.</p>

      <h2>Runlog</h2>
      <p>The app, engine, schema and command line are © {{YEAR}} {{OPERATOR}} and contributors, under the MIT license:</p>
      <pre>${esc(MIT_TEXT)}</pre>

      <h2>What it is built from</h2>
      <p>The packages the built app depends on, with the license each declares. Generated from the lockfile at build {{VERSION}} {{SHA}}.</p>
      <ul class="deps">
${rows}
      </ul>
    </main>
    <footer>
      <span>© {{YEAR}} <a href="{{OPERATOR_URL}}">{{OPERATOR}}</a></span>
      <a href="/legal/terms.html">Terms</a>
      <a href="/legal/privacy.html">Privacy</a>
      <a href="/licenses.html">Open-source licenses</a>
      <a href="https://github.com/SCRT-HQ/runlog">Source</a>
      <span class="build">Runlog <a href="{{RELEASE_URL}}">{{VERSION}}</a> <a href="{{COMMIT_URL}}">{{SHA}}</a></span>
    </footer>
  </body>
</html>
`,
    words,
  );
}

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

// ---- the link image ---------------------------------------------------

type Rgb = [number, number, number];

/**
 * A PNG, drawn pixel by pixel and written by hand.
 *
 * There is no image library here and none is worth adding for one still
 * picture. The image is the app's mark: a die face on the app's ground,
 * beside the ruled lines of a log. No text, because there is no font to
 * set it in; the title travels in the tags beside the image.
 */
export function ogImage(width = 1200, height = 630): Buffer {
  const ground: Rgb = [0x15, 0x13, 0x11];
  const celadon: Rgb = [0x9f, 0xd3, 0xb6];
  const pip: Rgb = [0x15, 0x13, 0x11];
  const rule: Rgb = [0x3a, 0x34, 0x2e];
  const ink: Rgb = [0xb3, 0xa9, 0x9b];

  const px = new Uint8Array(width * height * 3);
  const put = (x: number, y: number, [r, g, b]: Rgb) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };
  const fill = (color: Rgb, inside: (x: number, y: number) => boolean) => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inside(x, y)) put(x, y, color);
  };
  const roundedRect = (x0: number, y0: number, w: number, h: number, r: number) => (x: number, y: number) => {
    if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
    const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
    const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

  fill(ground, () => true);
  // The die: a five, the roll that says "something happened".
  const size = 330;
  const dx = 150;
  const dy = (height - size) / 2;
  fill(celadon, roundedRect(dx, dy, size, size, 48));
  const third = size / 3.4;
  const c = dx + size / 2;
  const cy = dy + size / 2;
  const pips: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ];
  for (const [ox, oy] of pips) {
    fill(pip, disc(c + ox * third, cy + oy * third, 28));
  }
  // The log: ruled lines, the first three written on.
  const lx = dx + size + 110;
  const lw = width - lx - 150;
  for (let i = 0; i < 6; i++) {
    const y = Math.round(dy + 30 + i * 58);
    fill(rule, roundedRect(lx, y, lw, 4, 2));
    if (i < 3) fill(ink, roundedRect(lx, y - 26, Math.round(lw * [0.72, 0.55, 0.64][i]!), 16, 8));
  }
  return encodePng(width, height, px);
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let crcTable: Uint32Array | undefined;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- laying it over ---------------------------------------------------

export interface Overlay {
  dist: string;
  /**
   * Where the app came from: this repository's root, with its lockfile, or
   * the published package's directory, which carries `licenses.json` and
   * its own version instead. Either says what went out and what it is
   * made of.
   */
  appRoot: string;
  env: EnvName;
  sha: string;
  /** The app's version, when the root does not say (a build laid over by hand). */
  version?: string;
  today?: Date;
  /** Where the templates are; the repository's `hosted/` unless a test says otherwise. */
  templates?: string;
}

/** The app's version: the repository's web app, or the published package's. */
function versionAt(appRoot: string): string {
  for (const file of [join(appRoot, "apps", "web", "package.json"), join(appRoot, "package.json")]) {
    if (existsSync(file)) return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
  }
  throw new Error(`${appRoot} is neither the repository nor a published package; pass --version`);
}

/** What the app is made of: from the lockfile where there is one, else from the notice the package ships. */
function dependenciesAt(appRoot: string): Dependency[] {
  if (existsSync(join(appRoot, "package-lock.json"))) return dependenciesOf(appRoot);
  const shipped = join(appRoot, "licenses.json");
  if (existsSync(shipped)) return JSON.parse(readFileSync(shipped, "utf8")) as Dependency[];
  return [];
}

/** Copy the hosted files into the build, filled in, and stamp the shell. Returns what was written, relative to `dist`. */
export function overlay(opts: Overlay): string[] {
  const config = envConfig(opts.env);
  const words = wordsFor(config, { version: opts.version ?? versionAt(opts.appRoot), sha: opts.sha.slice(0, 12), today: opts.today ?? new Date() });
  const templates = opts.templates ?? HOSTED_DIR;
  const written: string[] = [];
  const write = (rel: string, body: string | Buffer) => {
    const target = join(opts.dist, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    written.push(rel.split("\\").join("/"));
  };

  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else write(relative(templates, full), substitute(readFileSync(full, "utf8"), words));
    }
  };
  walk(templates);

  write("licenses.html", licensesPage(dependenciesAt(opts.appRoot), words));
  write("og.png", ogImage());

  const shell = join(opts.dist, "index.html");
  if (existsSync(shell)) {
    writeFileSync(shell, injectHead(readFileSync(shell, "utf8"), headTags(words)));
    written.push("index.html");
  }
  return written;
}

/** A short fingerprint of what went out, for the step summary. */
export function fingerprint(dist: string, files: string[]): string {
  const h = createHash("sha256");
  for (const f of files) h.update(readFileSync(join(dist, f)));
  return h.digest("hex").slice(0, 12);
}

// ---- the command ------------------------------------------------------

if (require.main === module) {
  const arg = (name: string, fallback?: string) => {
    const i = process.argv.indexOf(`--${name}`);
    const v = i >= 0 ? process.argv[i + 1] : undefined;
    if (v === undefined && fallback === undefined) throw new Error(`--${name} is required`);
    return v ?? fallback!;
  };
  const env = arg("env");
  if (env !== "dev" && env !== "prd") throw new Error(`--env must be dev or prd, not ${env}`);
  const dist = arg("dist");
  const version = arg("version", "");
  const files = overlay({ dist, appRoot: arg("app"), env, sha: arg("sha", ""), ...(version ? { version } : {}) });
  console.log(`hosted layer over ${dist}: ${files.length} files, ${fingerprint(dist, files)}`);
}
