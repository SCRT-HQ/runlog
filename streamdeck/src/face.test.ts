import { describe, expect, it } from "vitest";
import { faceImage, wrap } from "./face";

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
  it("puts a thirty-character phrase on three lines, none wider than the line", () => {
    const title = "Tick everything and Next Round";
    expect(title.length).toBe(30);
    const svg = Buffer.from(faceImage({ title, tone: "live" }).split(",")[1]!, "base64").toString("utf8");
    const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]!);
    expect(lines.length).toBe(3);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12);
    expect(svg).toContain('font-size="22"');
  });
  it("gives a one-word title the largest type", () => {
    const svg = Buffer.from(faceImage({ title: "Roll", tone: "live" }).split(",")[1]!, "base64").toString("utf8");
    expect(svg).toContain('font-size="40"');
    expect((svg.match(/<tspan/g) ?? []).length).toBe(1);
  });
  it("draws the when line but not the fraction", () => {
    const svg = Buffer.from(faceImage({ title: "Weather", tone: "live", when: "2:14", fraction: 0.5 }).split(",")[1]!, "base64").toString(
      "utf8",
    );
    expect(svg).toContain("2:14");
    expect(svg).not.toContain("0.5");
  });
});

describe("wrap", () => {
  it("keeps short text on one line", () => {
    expect(wrap("Roll")).toEqual(["Roll"]);
  });
  it("fits words exactly at the width without spilling a line", () => {
    // "Name the bowl" is 13 chars, one over the default width of 12 -
    // "bowl" moves to the next line rather than overflow the first.
    expect(wrap("Name the bowl", 13)).toEqual(["Name the bowl"]);
  });
  it("cuts a single word longer than the width instead of looping", () => {
    const out = wrap("Supercalifragilisticexpialidocious", 12, 3);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out[out.length - 1]!.endsWith("…")).toBe(true);
  });
  it("never returns more lines than asked", () => {
    const out = wrap("one two three four five six seven eight nine ten", 8, 3);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out[out.length - 1]!.endsWith("…")).toBe(true);
  });
});
