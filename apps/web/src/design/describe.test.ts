import { describe as group, expect, it } from "vitest";
import { describe } from "./describe.ts";

/**
 * Help text in the editor is the schema's own sentence.
 *
 * The alternative is a second set of labels written by hand, drifting from the
 * day they are written, and the copy in the app, which is where a beginner
 * actually is, would be the one nobody remembers to update. These tests are
 * really about the path walker: it has to survive maps, arrays and the
 * discriminated unions the format is built from.
 */
group("field descriptions from the schema", () => {
  it("finds a top-level field", () => {
    expect(describe("title")).toContain("name");
    expect(describe("id")).toContain("reverse-DNS");
  });

  it("walks into a nested object", () => {
    expect(describe("license.redistributable")).toContain("exports");
    expect(describe("vocabulary.finalize")).toBeTruthy();
  });

  it("walks through a map, whose keys are not in the schema", () => {
    // `tables.*` rather than `tables.myTable`: a concrete key cannot be found.
    expect(describe("tables.*.title")).toBeTruthy();
    expect(describe("tables.*.roll")).toBeTruthy();
  });

  it("walks through an array", () => {
    expect(describe("phases[].label")).toBeTruthy();
    expect(describe("phases[].steps[].label")).toBeTruthy();
  });

  it("finds a field inside a discriminated union", () => {
    // `entries` exists only within each resolution variant of a table.
    expect(describe("tables.*.entries[].text")).toContain("verbatim");
  });

  it("gives nothing for a path that is not in the schema, rather than throwing", () => {
    expect(describe("nope")).toBeUndefined();
    expect(describe("tables.*.nope.deeper")).toBeUndefined();
    expect(describe("")).toBeUndefined();
  });

  it("returns real sentences, not identifiers", () => {
    // Guards the guard: a walker returning field names would pass everything
    // above while teaching nobody anything.
    const help = describe("id");
    expect(help!.length).toBeGreaterThan(30);
    expect(help).toMatch(/[a-z] [a-z]/);
  });
});
