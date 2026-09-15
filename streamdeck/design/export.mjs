/**
 * The plugin's PNGs, from the SVGs beside this file.
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

/** A white glyph, in the app's colors on the app's ground, inset so the key has a margin. */
function key(svg, ink) {
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
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

for (const file of readdirSync(join(here, "actions")).filter((f) => f.endsWith(".svg"))) {
  const name = file.replace(/\.svg$/, "");
  const svg = read(join("actions", file));
  write(svg, join(imgs, "actions", name), 20);
  write(key(svg, name === "undo" ? WARN : ACCENT), join(imgs, "keys", name), 72);
}
