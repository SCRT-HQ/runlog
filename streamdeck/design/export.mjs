/**
 * The plugin's PNGs, and the glyphs it draws in a key's corner, from the
 * SVGs beside this file.
 *
 * Elgato wants PNG at two sizes for everything, and wants two different
 * things from one glyph: the action list takes it white on nothing at 20
 * square, and a key takes it in the app's colors on the app's ground at 72
 * square. So each glyph is drawn once, in white, and the key image is that
 * same glyph recolored and set on a ground here rather than drawn twice.
 *
 * `npm run icons -w streamdeck`. Nothing at run time depends on this; the
 * rasterizer is a devDependency of the repository, not of the plugin.
 */
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const imgs = join(here, "..", "com.scrthq.runlog.sdPlugin", "imgs");
const src = join(here, "..", "src");

/** The app's own: the ground, celadon, and kiln for the one key that takes something back. */
const GROUND = "#151311";
const ACCENT = "#9fd3b6";
const WARN = "#e0a94f";

/** Both sizes of one drawing, `@2x` being the second. */
function write(svg, out, size) {
  mkdirSync(dirname(out), { recursive: true });
  for (const [suffix, w] of [
    ["", size],
    ["@2x", size * 2],
  ]) {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: w } }).render().asPng();
    writeFileSync(`${out}${suffix}.png`, png);
  }
}

/** What a drawing is, with the document around it and the notes in it taken off. */
function body(svg) {
  let inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  // To a fixed point, so a comment left behind by removing another (one
  // that had `<!--` inside it) goes too. These are our own drawings, but
  // the markup ends up inside every key face, and a scanner is right to
  // want the pass to finish what it starts.
  for (let before = ""; before !== inner;) {
    before = inner;
    inner = inner.replace(/<!--[\s\S]*?-->/g, "");
  }
  return inner.replace(/\s+/g, " ").trim();
}

/** A white glyph, in the app's colors on the app's ground, inset so the key has a margin. */
function key(svg, ink) {
  const inner = body(svg);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" rx="14" fill="${GROUND}"/>` +
    `<g transform="translate(15.84 15.84) scale(0.78)">${inner.replaceAll("#ffffff", ink)}</g>` +
    `</svg>`
  );
}

const read = (p) => readFileSync(join(here, p), "utf8");

// The two sizes each of these wants are the schema's, not a choice:
// 256 for the icon in preferences, 28 for the action list's group, 20 for
// a row in that list, 72 for a key.
write(read("mark.svg"), join(imgs, "plugin"), 256);
write(read("category.svg"), join(imgs, "category"), 28);

const glyphs = [];
for (const file of readdirSync(join(here, "actions")).filter((f) => f.endsWith(".svg"))) {
  const name = file.replace(/\.svg$/, "");
  const svg = read(join("actions", file));
  write(svg, join(imgs, "actions", name), 20);
  write(key(svg, name === "undo" ? WARN : ACCENT), join(imgs, "keys", name), 72);
  glyphs.push([name, body(svg)]);
}

/**
 * The same drawings as strings the plugin can inline, so a key can wear its
 * own glyph in the corner without reading a file while it draws.
 *
 * Still white: `faceImage` swaps the white for whichever color the tone
 * wants, exactly as `key` above does for the key images.
 */
writeFileSync(
  join(src, "glyphs.ts"),
  `/**\n` +
    ` * Each action's drawing, as markup to inline in a key face.\n` +
    ` *\n` +
    ` * Written by \`npm run icons -w streamdeck\` from \`design/actions/*.svg\`.\n` +
    ` * Edit the drawings, not this file. The viewBox they are drawn in is 144\n` +
    ` * square, which is what \`face.ts\` scales them down from.\n` +
    ` */\n` +
    `export const GLYPHS: Record<string, string> = {\n` +
    // Single quotes around markup full of double ones, which is the quote
    // the formatter picks for the same reason: fewer escapes. The break
    // past 140 columns is the formatter's too, so this file is written as
    // it would rewrite it and `format:check` has nothing to say.
    glyphs
      .map(([name, markup]) => {
        const line = `  ${name}: '${markup}',`;
        // Prettier puts an over-long string on a line of its own unless the
        // key is short - shorter than `tabWidth + 3`, which is five here -
        // in which case it leaves it beside the key however long it runs.
        const short = name.length < 5;
        return `${line.length <= 140 || short ? line : `  ${name}:\n    '${markup}',`}\n`;
      })
      .join("") +
    `};\n`,
);
