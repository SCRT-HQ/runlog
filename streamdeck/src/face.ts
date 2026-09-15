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
 * Glyph widths in em for the system sans at weight 600 - Segoe UI Semibold
 * on Windows, and near enough everywhere else. Counting characters was
 * pessimistic: "connected" is nine narrow letters and fits at 26, but a
 * count of ten sends it to 22. So the face measures instead, in classes
 * coarse enough to read and close enough that the rendered ink stays
 * inside the frame.
 */
const EM: Record<string, number> = {};
for (const c of "ijl'.,:;!| ") EM[c] = 0.28;
for (const c of "ftrI") EM[c] = 0.36;
for (const c of "mw") EM[c] = 0.85;
for (const c of "MW") EM[c] = 0.92;
EM["…"] = 0.9;

function em(ch: string): number {
  const known = EM[ch];
  if (known !== undefined) return known;
  if (/[0-9a-z]/.test(ch)) return 0.55;
  if (/[A-Z]/.test(ch)) return 0.68;
  return 0.6;
}

/** How wide a line of text draws, in px, at this font size. */
export function measure(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += em(ch);
  return w * size;
}

/**
 * The frame's usable width. 144 less 8 either side: the stroke is 3px wide
 * centered at x=3, so 8 leaves 5px of clear ground inside it. Text is
 * centered on 72, so a line no wider than this never reaches x=8 or x=136.
 */
const LINE = 144 - 2 * 8;
const MAX_LINES = 3;

/**
 * Greedy word wrap by measured width: pack words onto a line up to `width`
 * px at `size`, at most `lines` lines. A word too wide for a line of its
 * own is broken by characters and carries on below. The last line gets an
 * ellipsis if any text was left over.
 */
export function wrap(text: string, size: number, width = LINE, lines = MAX_LINES): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < words.length && out.length < lines) {
    const word = words[i]!;
    if (measure(word, size) > width) {
      let cut = "";
      for (const ch of word) {
        if (measure(cut + ch, size) > width) break;
        cut += ch;
      }
      // One glyph always goes, or a face narrower than its own type would
      // loop here forever.
      if (cut === "") cut = [...word][0]!;
      out.push(cut);
      words[i] = word.slice(cut.length);
      continue;
    }
    let line = word;
    i++;
    while (i < words.length && measure(line + " " + words[i], size) <= width) {
      line += " " + words[i];
      i++;
    }
    out.push(line);
  }
  if (i < words.length && out.length > 0) {
    let last = out[out.length - 1]!;
    while (last.length > 0 && measure(last + "…", size) > width) last = last.slice(0, -1);
    out[out.length - 1] = last + "…";
  }
  return out;
}

/**
 * The type scale, biggest first. Every step gets the same three lines and
 * the same 128px; what changes is how much of a phrase that holds. A title
 * takes the first step that keeps every word whole; one too long for the
 * last step is wrapped to it anyway and ellipsized rather than drawn over
 * the frame.
 */
const SCALE = [40, 34, 30, 26, 22] as const;

/** Whether wrapping at this size keeps every word of the phrase. */
function whole(text: string, size: number): boolean {
  return wrap(text, size).join(" ") === text.split(/\s+/).filter(Boolean).join(" ");
}

function typeset(text: string): { lines: string[]; size: number } {
  const size = SCALE.find((s) => whole(text, s)) ?? SCALE[SCALE.length - 1]!;
  return { lines: wrap(text, size), size };
}

export function faceImage(face: Face): string {
  const t = TONE[face.tone];
  const { lines, size } = typeset(face.title);
  const top = 72 - ((lines.length - 1) * size * 1.15) / 2 + (face.when ? -8 : 0);
  // One positioned <text> per line, baseline given outright: the software
  // draws SVG with a renderer that honors x and y on a text element and
  // little else - a tspan with its own position, or a dominant-baseline,
  // left every title off the key while the small line beneath it showed.
  // 0.36em is where the middle of a semibold sans sits above its baseline.
  const spans = lines
    .map(
      (l, i) =>
        `<text class="t" x="72" y="${(top + i * size * 1.15 + size * 0.36).toFixed(1)}" text-anchor="middle" font-size="${size}" font-weight="600" fill="${t.ink}" font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif">${esc(l)}</text>`,
    )
    .join("");
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
    spans +
    when +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
