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
  it("wraps a long label onto three lines and no more", () => {
    const svg = Buffer.from(faceImage({ title: "Name the bowl on the page please", tone: "refuse" }).split(",")[1]!, "base64").toString(
      "utf8",
    );
    expect((svg.match(/<tspan/g) ?? []).length).toBe(3);
    expect(svg).toContain("…");
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
