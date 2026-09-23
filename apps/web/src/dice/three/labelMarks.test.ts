import { describe, expect, it } from "vitest";
import { labelMarks } from "./labelMarks.ts";

describe("the marks on a 3D die's face", () => {
  it("underlines a 6 and a 9 on every die", () => {
    expect(labelMarks("6", "normal")).toEqual({ underline: true, ring: false });
    expect(labelMarks("9", undefined)).toEqual({ underline: true, ring: false });
  });
  it("rings every numeral on a challenge die, so it differs by more than its body color", () => {
    expect(labelMarks("4", "challenge")).toEqual({ underline: false, ring: true });
    expect(labelMarks("6", "challenge")).toEqual({ underline: true, ring: true });
  });
});
