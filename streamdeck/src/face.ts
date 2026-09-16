import type { Face, Tone } from "./state.ts";

/**
 * A key face as SVG.
 *
 * SVG, because it needs no rasterizer and no native module in a package
 * the Marketplace installs; base64, because Stream Deck 7.5 on Windows
 * rejects a raw SVG string despite the documentation. 144 square is the
 * @2x size; the software scales it to any key.
 *
 * The palette is the app's own: celadon for a key that moves the run,
 * kiln for a refusal and for undo, the muted ink for a key with nothing
 * to do. System sans, since a font in an SVG would have to travel as
 * base64 on every redraw.
 *
 * The grounds carry the family, because an edge 3px wide is not enough to
 * tell six kinds of key apart across a deck at arm's length: celadon-tinted
 * where the key moves the run, kiln-tinted for undo and for a refusal,
 * neutral and a shade lighter for the furniture, near-black under a readout
 * so the number floats. Every ink clears 4.5:1 on its own ground and every
 * `when` line clears 3:1, which `face.test.ts` checks rather than trusts.
 *
 * `stroke` is the frame's width, and `quiet` the color of the `when` line
 * and the corner glyph where the edge is too dark to read them in - a
 * readout, the furniture, and a key with nothing to do, whose frames are
 * hairlines and near-grounds rather than accents.
 */
const TONE: Record<Tone, { ground: string; ink: string; edge: string; stroke?: number; quiet?: string }> = {
  live: { ground: "#243d31", ink: "#e7eae6", edge: "#8cc3a6" },
  dim: { ground: "#1b201d", ink: "#8d958f", edge: "#2f3733", quiet: "#8d958f" },
  refuse: { ground: "#33211a", ink: "#e7eae6", edge: "#dd8f63" },
  undo: { ground: "#3a2a1f", ink: "#e7eae6", edge: "#dd8f63" },
  deck: { ground: "#262b28", ink: "#e7eae6", edge: "#2f3733", quiet: "#8d958f" },
  readout: { ground: "#121413", ink: "#e7eae6", edge: "#2f3733", stroke: 1, quiet: "#8d958f" },
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
 * The caption's own type: 16px monospace, on baselines 18px apart.
 *
 * It used to be one line cut to thirteen characters, which turned a tracker
 * called "Objectives per scene" into "Objectives p…" over a number with
 * half the key to itself. It is measured like the title now, and takes up
 * to three lines where the title leaves the room for them.
 *
 * 18px is the 16px type with a little lead. Three lines of it reach from a
 * baseline at 90 to the one at 126, and the lowest descender lands at 129,
 * inside the 136 the frame's 8px margin leaves.
 */
const WHEN_SIZE = 16;
const WHEN_LINE = 18;
const WHEN_LINES = 3;

/**
 * Greedy word wrap by measured width: pack words onto a line up to `width`
 * px at `size`, at most `lines` lines. A word too wide for a line of its
 * own is broken by characters and carries on below. The last line gets an
 * ellipsis if any text was left over.
 */
/**
 * The longest head of a hyphenated word that still fits, hyphen included,
 * or nothing where the word has no hyphen with anything in front of it.
 */
function hyphenated(word: string, size: number, width: number): string {
  let cut = "";
  for (let i = 1; i < word.length - 1; i++) {
    if (word[i] !== "-") continue;
    const head = word.slice(0, i + 1);
    if (measure(head, size) > width) break;
    cut = head;
  }
  return cut;
}

export function wrap(text: string, size: number, width = LINE, lines = MAX_LINES): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < words.length && out.length < lines) {
    const word = words[i]!;
    if (measure(word, size) > width) {
      // A hyphen is already a break somebody wrote into the word, so it is
      // the one to use: "Bare-handed" reads as "Bare-" and "handed", not
      // as "Bare-hande" and "d". The hyphen stays on the line it ends.
      let cut = hyphenated(word, size, width);
      if (cut === "") {
        for (const ch of word) {
          if (measure(cut + ch, size) > width) break;
          cut += ch;
        }
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
 * The caption's lines: the same word-first, hyphen-fallback breaking the
 * title gets, at the caption's size, and an "…" on the last line where the
 * text did not fit whole.
 */
export function wrapWhen(text: string, lines = WHEN_LINES): string[] {
  return wrap(text, WHEN_SIZE, LINE, lines);
}

/**
 * The type scale, biggest first. A title takes the first step that keeps
 * every word whole in the room it has; one too long for the last step is
 * wrapped to it anyway and ellipsized rather than drawn over the frame.
 */
const SCALE = [40, 34, 30, 26, 22] as const;

/** Baseline to baseline, as a multiple of the size. */
const LEADING = 1.15;

/**
 * The box the title is centered in: top, bottom, and so the room between.
 *
 * Height used to be nobody's business, since three lines at any size were
 * assumed to fit. They do not: "Give Great Runes" came out three lines of
 * 40px and sat on top of the `when` line under it. So the box shrinks for
 * whatever else the key is wearing. A glyph holds the top 36px (8px in,
 * 28px square); one caption line holds everything below 100, which leaves
 * its 16px band at y=126 clear, and each line above that takes another
 * `WHEN_LINE`; with neither, the title has 18 to 126 and sits centered on
 * the key the way it always did.
 */
function box(whenLines: number, glyph: boolean): { top: number; bottom: number } {
  const when = whenLines > 0;
  return { top: glyph ? 36 : when ? 20 : 18, bottom: when ? 100 - (whenLines - 1) * WHEN_LINE : glyph ? 116 : 126 };
}

/**
 * How many lines of this size the room holds, never more than `MAX_LINES`
 * and never fewer than one: a key with a glyph and a `when` line has room
 * for two lines of 26, and drawing a third would put it through the band
 * below. One line always draws, even where it overhangs, because a key with
 * nothing on it says less than a key with a cut title.
 */
function roomFor(size: number, room: number): number {
  return Math.max(1, Math.min(MAX_LINES, Math.floor(room / (size * LEADING))));
}

/** Whether wrapping at this size keeps every word of the phrase. */
function whole(text: string, size: number, lines: number): boolean {
  return wrap(text, size, LINE, lines).join(" ") === text.split(/\s+/).filter(Boolean).join(" ");
}

/**
 * The caption, on as many lines as the title can spare.
 *
 * The title has priority: the caption asks for up to three lines and gives
 * them back one at a time until some size in the scale holds the title
 * whole in the room that is left. A number like "3" spares all three; a
 * title like "Give Great Runes" spares one, and the caption is cut to it.
 */
function whenLines(text: string | undefined, title: string, glyph: boolean): string[] {
  if (text === undefined) return [];
  const want = wrapWhen(text);
  for (let n = want.length; n > 1; n--) {
    const { top, bottom } = box(n, glyph);
    if (SCALE.some((s) => whole(title, s, roomFor(s, bottom - top)))) return wrapWhen(text, n);
  }
  return wrapWhen(text, 1);
}

/**
 * The lines, the size, and where the middle of the first line sits. The
 * size is the largest whose lines fit the room as well as the width.
 */
function typeset(text: string, has: { when?: number; glyph?: boolean } = {}): { lines: string[]; size: number; top: number } {
  const { top, bottom } = box(has.when ?? 0, has.glyph === true);
  const room = bottom - top;
  const size = SCALE.find((s) => whole(text, s, roomFor(s, room))) ?? SCALE[SCALE.length - 1]!;
  const lines = wrap(text, size, LINE, roomFor(size, room));
  return { lines, size, top: (top + bottom) / 2 - ((lines.length - 1) * size * LEADING) / 2 };
}

/**
 * The corner glyph: 28px square, 8px in from the top and the left.
 *
 * The action's own drawing, so a key says which key it is while the title
 * says what it would do. The drawings are 144 square (`design/actions`),
 * so the scale is 28/144; they are drawn in white, and the white is
 * swapped for the tone's quiet color the way `design/export.mjs` swaps it
 * for the key images.
 *
 * 18px at 70% was a smudge on a deck across the room. 28px at 85% is a
 * mark you can name at arm's length and still not read before the title,
 * and the title now starts below it rather than behind it.
 */
const GLYPH_PX = 28;
const GLYPH_AT = 8;

function corner(glyph: string, color: string): string {
  const scale = (GLYPH_PX / 144).toFixed(5);
  return `<g transform="translate(${GLYPH_AT} ${GLYPH_AT}) scale(${scale})" opacity="0.85">${glyph.replaceAll("#ffffff", color)}</g>`;
}

export function faceImage(face: Face, glyph?: string): string {
  const t = TONE[face.tone];
  const quiet = t.quiet ?? t.edge;
  const caption = whenLines(face.when, face.title, glyph !== undefined);
  const { lines, size, top } = typeset(face.title, { when: caption.length, glyph: glyph !== undefined });
  // One positioned <text> per line, baseline given outright: the software
  // draws SVG with a renderer that honors x and y on a text element and
  // little else - a tspan with its own position, or a dominant-baseline,
  // left every title off the key while the small line beneath it showed.
  // 0.36em is where the middle of a semibold sans sits above its baseline.
  const spans = lines
    .map(
      (l, i) =>
        `<text class="t" x="72" y="${(top + i * size * LEADING + size * 0.36).toFixed(1)}" text-anchor="middle" font-size="${size}" font-weight="600" fill="${t.ink}" font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif">${esc(l)}</text>`,
    )
    .join("");
  // The caption sits on the bottom line whatever its height, so a key with
  // one line reads where it always did and the extra lines grow upward.
  const when = caption
    .map(
      (l, i) =>
        `<text class="w" x="72" y="${126 - (caption.length - 1 - i) * WHEN_LINE}" text-anchor="middle" font-size="${WHEN_SIZE}" fill="${quiet}" font-family="ui-monospace, Menlo, Consolas, monospace">${esc(l)}</text>`,
    )
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">` +
    // The full label, unwrapped, so a tooltip (or a test) sees the whole
    // thing even when the drawn lines above cut it short.
    `<title>${esc(face.title)}</title>` +
    `<rect width="144" height="144" rx="14" fill="${t.ground}"/>` +
    `<rect x="3" y="3" width="138" height="138" rx="12" fill="none" stroke="${t.edge}" stroke-width="${t.stroke ?? 3}"/>` +
    (glyph ? corner(glyph, quiet) : "") +
    spans +
    when +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
