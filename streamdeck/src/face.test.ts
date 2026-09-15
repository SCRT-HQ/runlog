import { describe, expect, it } from "vitest";
import { faceImage, measure, wrap } from "./face";

/** The lines a face draws, with the size it drew them at. */
function drawn(title: string): { lines: string[]; size: number } {
  const svg = Buffer.from(faceImage({ title, tone: "live" }).split(",")[1]!, "base64").toString("utf8");
  return {
    lines: [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]!),
    size: Number(/font-size="(\d+)" font-weight/.exec(svg)![1]),
  };
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
    expect((svg.match(/<tspan/g) ?? []).length).toBe(3);
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
