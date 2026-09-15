import { describe, expect, it } from "vitest";
import type { Face, Tone } from "./state";
import { faceImage, measure, wrap } from "./face";

const svgOf = (face: Face, glyph?: string) => Buffer.from(faceImage(face, glyph).split(",")[1]!, "base64").toString("utf8");

/** The lines a face draws, with the size and the baselines it drew them at. */
function drawn(title: string, has: { when?: string; glyph?: string } = {}): { lines: string[]; size: number; ys: number[] } {
  const svg = svgOf({ title, tone: "live", ...(has.when === undefined ? {} : { when: has.when }) }, has.glyph);
  const spans = [...svg.matchAll(/<text class="t" x="72" y="([\d.]+)"[^>]*font-size="(\d+)"[^>]*>([^<]*)</g)];
  return { lines: spans.map((s) => s[3]!), size: Number(spans[0]![2]), ys: spans.map((s) => Number(s[1])) };
}

/**
 * How far a line's ink reaches from its baseline: 0.36em above the baseline
 * is the middle of the type, and half a line box (1.15em) either side of
 * that middle is as far as an ascender or a descender goes.
 */
const band = (y: number, size: number) => ({ top: y - size * 0.36 - size * 0.575, bottom: y - size * 0.36 + size * 0.575 });

/** The whole title block's reach, first line's top to last line's bottom. */
function block(d: { size: number; ys: number[] }): { top: number; bottom: number } {
  return { top: band(d.ys[0]!, d.size).top, bottom: band(d.ys[d.ys.length - 1]!, d.size).bottom };
}

/** The `when` line a face draws, with the font size it drew it at. */
function whenLine(when: string): { text: string; size: number } {
  const svg = svgOf({ title: "Weather", tone: "live", when });
  const m = /<text x="72" y="126"[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/.exec(svg)!;
  return { size: Number(m[1]), text: m[2]! };
}

describe("faceImage", () => {
  it("is a base64 svg data uri, never raw svg", () => {
    const uri = faceImage({ title: "Roll the Weather", tone: "live" });
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = Buffer.from(uri.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8");
    expect(svg).toContain("Roll the");
    expect(svg).toContain('viewBox="0 0 144 144"');
  });
  it("escapes what a pack might put in a label", () => {
    const svg = Buffer.from(faceImage({ title: '<Bowl> & "Kiln"', tone: "dim" }).split(",")[1]!, "base64").toString("utf8");
    expect(svg).not.toContain("<Bowl>");
    expect(svg).toContain("&lt;Bowl&gt; &amp; &quot;Kiln&quot;");
  });
  it("wraps a long label onto three lines and no more, ellipsized rather than clipped", () => {
    const svg = Buffer.from(
      faceImage({ title: "Name the bowl on the page before the kiln is lit", tone: "refuse" }).split(",")[1]!,
      "base64",
    ).toString("utf8");
    expect((svg.match(/<text class="t"/g) ?? []).length).toBe(3);
    expect(svg).toContain("…");
    // The whole phrase is still there for a tooltip to read.
    expect(svg).toContain("<title>Name the bowl on the page before the kiln is lit</title>");
  });
  it("puts a long phrase on three lines, none wider than the frame", () => {
    const { lines, size } = drawn("Draw what is wrong with the world");
    expect(lines.length).toBe(3);
    for (const l of lines) expect(measure(l, size)).toBeLessThanOrEqual(128);
  });
  it("measures a status rather than counting it", () => {
    // Nine narrow letters: a count of ten sent "connected" to 22, a
    // measurement keeps it four steps up.
    const { lines, size } = drawn("Not connected");
    expect(lines).toEqual(["Not", "connected"]);
    expect(size).toBeGreaterThanOrEqual(26);
  });
  it("gives a one-word title the largest type that holds it", () => {
    const { lines, size } = drawn("Enter");
    expect(lines).toEqual(["Enter"]);
    expect(size).toBe(40);
  });
  it("keeps a metric at the largest type", () => {
    expect(drawn("4/10").size).toBe(40);
  });
  it("steps a word too wide for the largest size down rather than over the frame", () => {
    const { lines, size } = drawn("Reconnect");
    expect(lines).toEqual(["Reconnect"]);
    expect(size).toBeLessThan(40);
    expect(measure("Reconnect", size)).toBeLessThanOrEqual(128);
  });
  it("breaks a single word too long for any size and ellipsizes it", () => {
    const { lines } = drawn("a".repeat(40));
    expect(lines.length).toBe(3);
    expect(lines[2]!.endsWith("…")).toBe(true);
  });
  it("draws the when line but not the fraction", () => {
    const svg = Buffer.from(faceImage({ title: "Weather", tone: "live", when: "2:14", fraction: 0.5 }).split(",")[1]!, "base64").toString(
      "utf8",
    );
    expect(svg).toContain("2:14");
    expect(svg).not.toContain("0.5");
  });
  it("leaves a short when line alone", () => {
    expect(whenLine("Deaths")).toEqual({ text: "Deaths", size: 16 });
  });
  it("holds the whole of the key's one instruction", () => {
    // Thirteen characters, which is the budget exactly. At 18px it came
    // out "press Conne…", which is not an instruction.
    expect(whenLine("press Connect").text).toBe("press Connect");
  });
  it("cuts a when line at a word boundary that leaves six characters or more", () => {
    // "Scenes before" is thirteen characters and fits; adding "a" runs
    // past the budget. So the cut lands on the word boundary rather than
    // mid-word.
    expect(whenLine("Scenes before a warp").text).toBe("Scenes before…");
  });
  it("never keeps more than 13 characters of a when line, plus the ellipsis", () => {
    const { text } = whenLine("Whatever the pack calls it");
    expect(text.endsWith("…")).toBe(true);
    expect(text.replace("…", "").length).toBeLessThanOrEqual(13);
  });
  it("draws the when line at font-size 16", () => {
    expect(whenLine("press Connect").size).toBe(16);
  });
});

describe("a title that fits the room it is given", () => {
  const GLYPH = '<path d="M46 26 L118 72 L46 118 Z" fill="#ffffff"/>';
  /** The band the `when` line owns: a 16px line on the baseline at 126. */
  const BAND = 108;

  it("holds a long title clear of the when line under it", () => {
    // From a photograph of a real deck: "Give Great Runes" came out three
    // lines of large type and sat on top of the clock beneath it.
    const d = drawn("Give Great Runes", { when: "2:14" });
    expect(block(d).bottom).toBeLessThanOrEqual(BAND);
    for (const y of d.ys) expect(band(y, d.size).bottom).toBeLessThanOrEqual(BAND);
  });
  it("spends the when line's room on the title when there is no when line", () => {
    const wide = drawn("Give Great Runes");
    const narrow = drawn("Give Great Runes", { when: "2:14" });
    expect(wide.size).toBe(30);
    expect(wide.lines).toEqual(["Give", "Great", "Runes"]);
    expect(narrow.size).toBeLessThan(wide.size);
  });
  it("only ever puts three lines over a when line at the smallest step", () => {
    const d = drawn("Draw what is wrong with the world", { when: "2:14" });
    expect(d.lines.length).toBe(3);
    expect(d.size).toBe(22);
    expect(block(d).bottom).toBeLessThanOrEqual(BAND);
  });
  it("still fits two lines of 30 over a when line", () => {
    for (const when of [undefined, "2:14"]) {
      const d = drawn("I settled it", { ...(when === undefined ? {} : { when }) });
      expect(d.size, `when: ${String(when)}`).toBe(30);
      expect(d.lines.length).toBe(2);
    }
  });
  it("starts the title below the corner glyph rather than behind it", () => {
    for (const title of ["Enter", "Not connected", "Draw what is wrong with the world"]) {
      const d = drawn(title, { glyph: GLYPH });
      expect(block(d).top, title).toBeGreaterThanOrEqual(36);
    }
  });
  it("fits a title between a glyph and a when line when the key wears both", () => {
    for (const title of ["Give Larval Tears", "Draw what is wrong with the world", "Not connected"]) {
      const b = block(drawn(title, { glyph: GLYPH, when: "press Connect" }));
      expect(b.top, title).toBeGreaterThanOrEqual(36);
      expect(b.bottom, title).toBeLessThanOrEqual(BAND);
    }
  });
  it("keeps every title inside the frame, whatever else the key is wearing", () => {
    const titles = ["Enter", "4/10", "Give Great Runes", "I settled it", "Name the bowl on the page before the kiln is lit"];
    for (const title of titles)
      for (const when of [undefined, "2:14"])
        for (const glyph of [undefined, GLYPH]) {
          const d = drawn(title, { ...(when === undefined ? {} : { when }), ...(glyph === undefined ? {} : { glyph }) });
          const b = block(d);
          const where = `${title} when:${String(when)} glyph:${glyph !== undefined}`;
          expect(b.top, where).toBeGreaterThanOrEqual(8);
          expect(b.bottom, where).toBeLessThanOrEqual(136);
          if (when !== undefined) expect(b.bottom, where).toBeLessThanOrEqual(BAND);
          if (glyph !== undefined) expect(b.top, where).toBeGreaterThanOrEqual(36);
        }
  });
});

describe("a tone per family of key", () => {
  const frame = (svg: string) => /<rect x="3"[^>]*stroke="([^"]+)" stroke-width="([\d.]+)"/.exec(svg)!;

  it("gives the celadon edge to a key that moves the run, and to nothing else", () => {
    expect(frame(svgOf({ title: "Roll", tone: "live" }))[1]).toBe("#8cc3a6");
    for (const tone of ["deck", "readout", "undo", "dim"] as const) {
      expect(frame(svgOf({ title: "Roll", tone }))[1], tone).not.toBe("#8cc3a6");
    }
  });
  it("draws undo lit, with the kiln edge a refusal uses", () => {
    const undo = svgOf({ title: "Undo", tone: "undo" });
    expect(frame(undo)[1]).toBe(frame(svgOf({ title: "No", tone: "refuse" }))[1]);
    // A kiln-tinted ground under the kiln edge, and the lit ink, so it
    // reads as a key with something to do rather than as a key that has
    // just refused. The refusal keeps its own darker, redder ground.
    expect(undo).toContain('fill="#3a2a1f"');
    expect(undo).toContain('fill="#e7eae6"');
    expect(undo).not.toContain('fill="#33211a"');
  });
  it("draws a readout on the dark ground, with a hairline and a legible label", () => {
    const svg = svgOf({ title: "4/10", tone: "readout", when: "Flasks" });
    expect(svg).toContain('<rect width="144" height="144" rx="14" fill="#121413"/>');
    expect(Number(frame(svg)[2])).toBeLessThan(3);
    // The label sits on the ground, not on the edge color, which at this
    // tone is too dark to read anything in.
    expect(/y="126"[^>]*fill="([^"]+)"/.exec(svg)![1]).toBe("#8d958f");
  });
  it("draws the furniture lit but unaccented", () => {
    const svg = svgOf({ title: "Disconnect", tone: "deck" });
    expect(frame(svg)[1]).toBe("#2f3733");
    expect(svg).toContain('fill="#e7eae6"');
  });

  it("wears its action's glyph in the corner, big enough to name across a room", () => {
    const glyph = '<path d="M46 26 L118 72 L46 118 Z" fill="#ffffff"/>';
    const svg = svgOf({ title: "Roll", tone: "live" }, glyph);
    const g = /<g transform="translate\((\d+) (\d+)\) scale\(([\d.]+)\)" opacity="([\d.]+)">(.*?)<\/g>/.exec(svg)!;
    expect([g[1], g[2]]).toEqual(["8", "8"]);
    // 18px at 70% was a smudge on the deck in the photograph that started
    // this: 28px at 85% is a mark, and it still ends at y=36, where the
    // title now starts.
    expect(Number(g[3]) * 144).toBeCloseTo(28);
    expect(g[4]).toBe("0.85");
    expect(8 + Number(g[3]) * 144).toBeCloseTo(36);
    // White is the drawing's own; a key wears it in the tone's color.
    expect(g[5]).not.toContain("#ffffff");
    expect(g[5]).toContain("#8cc3a6");
  });
  it("draws no corner at all for an action with no glyph", () => {
    expect(svgOf({ title: "Roll", tone: "live" })).not.toContain("<g transform");
  });
});

/**
 * WCAG 2 contrast, worked here rather than taken as a dependency: the
 * relative luminance of each color, the lighter over the darker, and the
 * 0.05 that keeps black from dividing by nothing.
 */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("grounds a deck can tell apart", () => {
  const TONES = ["live", "dim", "refuse", "undo", "deck", "readout"] as const satisfies readonly Tone[];
  const parts = (tone: Tone) => {
    const svg = svgOf({ title: "Give", tone, when: "2:14" });
    return {
      ground: /<rect width="144" height="144" rx="14" fill="([^"]+)"/.exec(svg)![1]!,
      ink: /<text class="t"[^>]*fill="([^"]+)"/.exec(svg)![1]!,
      quiet: /<text x="72" y="126"[^>]*fill="([^"]+)"/.exec(svg)![1]!,
    };
  };

  it("tints the ground by family, inside the app's two accents", () => {
    // The photograph that started this had six families on what looked
    // like one dark green. Celadon under a key that moves the run, kiln
    // under undo and under a refusal, neutral under the furniture, and
    // near-black under a readout so the number floats.
    expect(parts("live").ground).toBe("#243d31");
    expect(parts("undo").ground).toBe("#3a2a1f");
    expect(parts("deck").ground).toBe("#262b28");
    expect(parts("readout").ground).toBe("#121413");
    expect(parts("dim").ground).toBe("#1b201d");
    expect(parts("refuse").ground).toBe("#33211a");
  });
  it("gives no two families the same ground", () => {
    const grounds = TONES.map((t) => parts(t).ground);
    expect(new Set(grounds).size).toBe(grounds.length);
  });
  it("keeps every title legible on the ground it was moved to", () => {
    for (const tone of TONES) {
      const { ink, ground } = parts(tone);
      expect(contrast(ink, ground), `${tone} ink ${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps every when line legible, small as it is", () => {
    // 3:1 is the large-text floor, and the one this line is held to: it is
    // a second line rather than the label. The dim tone reads its own ink
    // here, because its edge is a near-ground nobody could read a word in.
    for (const tone of TONES) {
      const { quiet, ground } = parts(tone);
      expect(contrast(quiet, ground), `${tone} when line ${quiet} on ${ground}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("measure", () => {
  it("tells narrow glyphs from wide ones", () => {
    expect(measure("iii", 40)).toBeLessThan(measure("WWW", 40));
  });
  it("scales with the size", () => {
    expect(measure("Undo", 44)).toBeCloseTo(measure("Undo", 22) * 2);
  });
});

describe("wrap", () => {
  it("keeps short text on one line", () => {
    expect(wrap("Roll", 40)).toEqual(["Roll"]);
  });
  it("moves a word down rather than spill the line", () => {
    const out = wrap("Name the bowl", 22);
    expect(out).toEqual(["Name the", "bowl"]);
    for (const l of out) expect(measure(l, 22)).toBeLessThanOrEqual(128);
  });
  it("breaks a hyphenated word at the hyphen, and keeps the hyphen", () => {
    // Seen on a deck: "Bare-handed" drew as "Bare-hande" over "d". The
    // hyphen is a break the word already has, so it is the one to take.
    expect(wrap("Bare-handed", 34)).toEqual(["Bare-", "handed"]);
    expect(drawn("Bare-handed").lines).toEqual(["Bare-", "handed"]);
  });
  it("breaks a single word wider than the line instead of looping", () => {
    const out = wrap("Supercalifragilisticexpialidocious", 22);
    expect(out.length).toBe(3);
    expect(out.join("")).toBe("Supercalifragilisticexpialidocious");
    for (const l of out) expect(measure(l, 22)).toBeLessThanOrEqual(128);
  });
  it("never returns more lines than asked", () => {
    const out = wrap("one two three four five six seven eight nine ten", 22);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out[out.length - 1]!.endsWith("…")).toBe(true);
  });
});
