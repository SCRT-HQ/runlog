import { describe, expect, it } from "vitest";

import { assessContrast, contrastRatio, parseOpaqueColor, relativeLuminance } from "./index.ts";

const black = parseOpaqueColor("#000")!;
const white = parseOpaqueColor("#fff")!;

describe("theme contrast", () => {
  it("measures black and white as the endpoints", () => {
    expect(relativeLuminance(black)).toBe(0);
    expect(relativeLuminance(white)).toBe(1);
    expect(contrastRatio(black, white)).toBe(21);
    expect(contrastRatio(white, black)).toBe(21);
    expect(contrastRatio(black, black)).toBe(1);
  });

  it("uses the standard chromatic luminance weights", () => {
    expect(relativeLuminance(parseOpaqueColor("#ff0000")!)).toBe(0.2126);
    expect(relativeLuminance(parseOpaqueColor("#00ff00")!)).toBe(0.7152);
    expect(relativeLuminance(parseOpaqueColor("#0000ff")!)).toBe(0.0722);
  });

  it("linearizes channels on the correct side of the sRGB boundary", () => {
    expect(relativeLuminance(parseOpaqueColor("#0a0a0a")!)).toBeCloseTo(0.0030352698354883748, 15);
    expect(relativeLuminance(parseOpaqueColor("#0b0b0b")!)).toBeCloseTo(0.0033465357638991608, 15);
  });

  it("does not upgrade a near-threshold text color by rounding", () => {
    const result = assessContrast(parseOpaqueColor("#777777")!, white, 4.5);
    expect(result.ratio).toBeCloseTo(4.478089, 5);
    expect(result.minimum).toBe(4.5);
    expect(result.passes).toBe(false);
    expect(assessContrast(parseOpaqueColor("#767676")!, white, 4.5).passes).toBe(true);
  });

  it("applies the caller's pair target, not an implicit text default", () => {
    expect(assessContrast(parseOpaqueColor("#888888")!, white, 3).passes).toBe(true);
    expect(assessContrast(parseOpaqueColor("#888888")!, white, 4.5).passes).toBe(false);
    expect(assessContrast(parseOpaqueColor("#666666")!, white, 7).passes).toBe(false);
    expect(assessContrast(parseOpaqueColor("#555555")!, white, 7).passes).toBe(true);
  });

  it("returns a fresh assessment for each call", () => {
    const first = assessContrast(black, white, 7);
    const second = assessContrast(black, white, 7);

    expect(first).not.toBe(second);
  });
});
