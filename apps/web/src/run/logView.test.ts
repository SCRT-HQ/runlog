import { describe, expect, it } from "vitest";
import { logLines } from "./logView.ts";

describe("reading the log", () => {
  const rolls = ["a", "b", "c", "d", "e", "f", "g", "h"];

  it("reads newest first by default, numbered from the start", () => {
    const lines = logLines(rolls, "newest", 0);
    expect(lines.map((l) => l.index)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(lines[0]!.outcome).toBe("h");
  });

  it("reads oldest first when asked", () => {
    expect(logLines(rolls, "oldest", 0).map((l) => l.outcome)).toEqual(rolls);
  });

  it("keeps the same last lines whichever way they are read", () => {
    expect(logLines(rolls, "oldest", 3).map((l) => l.index)).toEqual([6, 7, 8]);
    expect(logLines(rolls, "newest", 3).map((l) => l.index)).toEqual([8, 7, 6]);
  });

  it("shows everything when the limit is larger than the log", () => {
    expect(logLines(rolls, "oldest", 24)).toHaveLength(8);
  });
});
