import { describe, expect, it } from "vitest";
import { faceImage, measure, wrap } from "./face";

/** The lines a face draws, with the size it drew them at. */
function drawn(title: string): { lines: string[]; size: number } {
  const svg = Buffer.from(faceImage({ title, tone: "live" }).split(",")[1]!, "base64").toString("utf8");
  return {
    lines: [...svg.matchAll(/<text class="t"[^>]*>([^<]*)<[/]text>/g)].map((m) => m[1]!),
    size: Number(/font-size="(\d+)" font-weight/.exec(svg)![1]),
  };
}

/** The `when` line a face draws, with the font size it drew it at. */
function whenLine(when: string): { text: string; size: number } {
  const svg = Buffer.from(faceImage({ title: "Weather", tone: "live", when }).split(",")[1]!, "base64").toString("utf8");
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

describe("a tone per family of key", () => {
  const svgOf = (face: Parameters<typeof faceImage>[0], glyph?: string) =>
    Buffer.from(faceImage(face, glyph).split(",")[1]!, "base64").toString("utf8");
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
    // The lit ground and the lit ink, so it reads as a key with something
    // to do rather than as a key that has just refused.
    expect(undo).toContain('fill="#1e2f27"');
    expect(undo).toContain('fill="#e7eae6"');
  });
  it("draws a readout on the dark ground, with a hairline and a legible label", () => {
    const svg = svgOf({ title: "4/10", tone: "readout", when: "Flasks" });
    expect(svg).toContain('<rect width="144" height="144" rx="14" fill="#151311"/>');
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

  it("wears its action's glyph in the corner, in the tone's own color", () => {
    const glyph = '<path d="M46 26 L118 72 L46 118 Z" fill="#ffffff"/>';
    const svg = svgOf({ title: "Roll", tone: "live" }, glyph);
    const g = /<g transform="translate\((\d+) (\d+)\) scale\(([\d.]+)\)" opacity="([\d.]+)">(.*?)<\/g>/.exec(svg)!;
    expect([g[1], g[2]]).toEqual(["8", "8"]);
    expect(Number(g[3]) * 144).toBeCloseTo(18);
    expect(g[4]).toBe("0.7");
    // White is the drawing's own; a key wears it in the tone's color.
    expect(g[5]).not.toContain("#ffffff");
    expect(g[5]).toContain("#8cc3a6");
  });
  it("draws no corner at all for an action with no glyph", () => {
    expect(svgOf({ title: "Roll", tone: "live" })).not.toContain("<g transform");
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
