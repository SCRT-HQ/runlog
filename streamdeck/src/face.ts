import type { Face, Tone } from "./state";

/**
 * A key face as SVG.
 *
 * SVG, because it needs no rasterizer and no native module in a package
 * the Marketplace installs; base64, because Stream Deck 7.5 on Windows
 * rejects a raw SVG string despite the documentation. 144 square is the
 * @2x size; the software scales it to any key.
 *
 * The palette is the app's own: celadon for a live key, kiln for a
 * refusal, the muted ink for a key with nothing to do. System sans, since
 * a font in an SVG would have to travel as base64 on every redraw.
 */
const TONE: Record<Tone, { ground: string; ink: string; edge: string }> = {
  live: { ground: "#1e2f27", ink: "#e7eae6", edge: "#8cc3a6" },
  dim: { ground: "#1b201d", ink: "#8d958f", edge: "#2f3733" },
  refuse: { ground: "#33211a", ink: "#e7eae6", edge: "#dd8f63" },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Greedy word wrap: pack words onto a line up to `width` characters, at
 * most `lines` lines. A word too long for a fresh line is cut rather than
 * looped over. The last line gets an ellipsis if any text was dropped -
 * either words left unplaced or a word cut to fit.
 */
export function wrap(text: string, width = 10, lines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  let truncated = false;
  while (i < words.length && out.length < lines) {
    let line = words[i]!;
    if (line.length > width) {
      line = line.slice(0, width);
      truncated = true;
      i++;
    } else {
      i++;
      while (i < words.length && (line + " " + words[i]).length <= width) {
        line += " " + words[i];
        i++;
      }
    }
    out.push(line);
  }
  if (i < words.length) truncated = true;
  if (truncated && out.length > 0) {
    const last = out[out.length - 1]!;
    out[out.length - 1] = last.length >= width ? last.slice(0, Math.max(0, width - 1)) + "…" : last + "…";
  }
  return out;
}

/**
 * The type scale, biggest first, with the line width each size holds.
 *
 * A 144px face with 12px either side leaves 120px for the title. The system
 * sans averages about 0.55em a glyph at these weights, so 120px is five
 * characters at 40, seven at 30 and ten at 22 - the frame decides the width,
 * not the other way about. A title takes the first step it fits in whole;
 * one too long for the last step is wrapped to it anyway and ellipsized on
 * the last line rather than drawn over the frame.
 */
const SCALE = [
  { size: 40, width: 5, lines: 1 },
  { size: 30, width: 7, lines: 2 },
  { size: 22, width: 10, lines: 3 },
] as const;

/** Whether wrapping at this step keeps every word of the phrase. */
function whole(text: string, step: (typeof SCALE)[number]): boolean {
  return wrap(text, step.width, step.lines).join(" ") === text.split(/\s+/).filter(Boolean).join(" ");
}

function typeset(text: string): { lines: string[]; size: number } {
  const step = SCALE.find((s) => whole(text, s)) ?? SCALE[SCALE.length - 1]!;
  return { lines: wrap(text, step.width, step.lines), size: step.size };
}

export function faceImage(face: Face): string {
  const t = TONE[face.tone];
  const { lines, size } = typeset(face.title);
  const top = 72 - ((lines.length - 1) * size * 1.15) / 2 + (face.when ? -8 : 0);
  const spans = lines.map((l, i) => `<tspan x="72" y="${(top + i * size * 1.15).toFixed(1)}">${esc(l)}</tspan>`).join("");
  const when = face.when
    ? `<text x="72" y="128" text-anchor="middle" font-size="12" fill="${t.edge}" font-family="ui-monospace, Menlo, Consolas, monospace">${esc(face.when.slice(0, 18))}</text>`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">` +
    // The full label, unwrapped, so a tooltip (or a test) sees the whole
    // thing even when the drawn lines above cut it short.
    `<title>${esc(face.title)}</title>` +
    `<rect width="144" height="144" rx="14" fill="${t.ground}"/>` +
    `<rect x="3" y="3" width="138" height="138" rx="12" fill="none" stroke="${t.edge}" stroke-width="3"/>` +
    `<text text-anchor="middle" dominant-baseline="middle" font-size="${size}" font-weight="600" fill="${t.ink}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">${spans}</text>` +
    when +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
