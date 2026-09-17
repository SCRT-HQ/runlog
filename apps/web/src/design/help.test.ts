import { describe as group, expect, it } from "vitest";
import { describe } from "./describe.ts";
import { HELP, help, schemaPath } from "./help.ts";

group("editing help", () => {
  it("keeps the first copy pass bounded to twenty schema-backed fields", () => {
    expect(Object.keys(HELP).length).toBeLessThanOrEqual(20);
    for (const key of Object.keys(HELP)) expect(describe(key), key).toBeTruthy();
  });

  it("explains choices without becoming a second validation rulebook", () => {
    for (const [key, words] of Object.entries(HELP)) {
      expect(words, key).not.toMatch(/\b(must|required|invalid)\b/i);
      expect(words, key).not.toMatch(/\d+\s*(?:-|to|through|\.\.)\s*\d+/i);
      expect(words, key).not.toContain("\u2014");
    }
  });

  it("uses the same copy for different table keys, mode keys, and array indices", () => {
    expect(help("tables.weather.roll")).toBe(HELP["tables.*.roll"]);
    expect(help("tables.other.entries[12].points")).toBe(HELP["tables.*.entries[].points"]);
    expect(help("modes.shared.seeded")).toBe(HELP["modes.*.seeded"]);
    expect(help("phases[2].steps[10].closesUnit")).toBe(HELP["phases[].steps[].closesUnit"]);
    expect(help("requires[3].optional")).toBe(HELP["requires[].optional"]);
    expect(schemaPath("tables.*.entries[].range")).toBe("tables.*.entries[].range");
  });

  it("returns null for missing keys, including object prototype names", () => {
    for (const key of ["", "unknown", "toString", "constructor", "__proto__", "tables.weather.nope"]) {
      expect(help(key)).toBeNull();
    }
  });
});
