import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@runlog/rules-schema";
import { asSection, countBySection, hashForSection, SECTIONS, sectionOfPath } from "./model.ts";

const problem = (path: string, level: Diagnostic["level"] = "error"): Diagnostic => ({ level, code: "test/x", message: "x", path });

/**
 * Which section owns a problem.
 *
 * The count beside a section's name is the only thing that says where the
 * work is, so a path landing in the wrong section is a person looking in
 * the wrong place. Every root the schema has is named here on purpose:
 * anything not named is Test's, which is the section that lists the lot.
 */
describe("the section a dotted path belongs to", () => {
  it("puts what the pack is, needs and calls things in Overview", () => {
    for (const path of ["title", "id", "version", "author", "category", "tags", "description", "requires[0].label", "vocabulary.run.one"]) {
      expect(sectionOfPath(path)).toBe("overview");
    }
  });

  it("puts a table, however deep, in Tables", () => {
    expect(sectionOfPath("tables")).toBe("tables");
    expect(sectionOfPath("tables.setback.entries[3]")).toBe("tables");
  });

  it("puts the flow and how a unit behaves in Flow", () => {
    expect(sectionOfPath("phases[1].steps[0].kind")).toBe("flow");
    expect(sectionOfPath("unit.max")).toBe("flow");
  });

  it("puts the ways to play in Modes", () => {
    expect(sectionOfPath("modes.standard.label")).toBe("modes");
    expect(sectionOfPath("defaultMode")).toBe("modes");
    expect(sectionOfPath("players.roles[0].id")).toBe("modes");
  });

  it("puts what it takes to hand the pack over in Publish", () => {
    expect(sectionOfPath("license.id")).toBe("publish");
    expect(sectionOfPath("signature.alg")).toBe("publish");
    expect(sectionOfPath("issue.to")).toBe("publish");
  });

  it("gives Test everything structural, and anything with no path at all", () => {
    expect(sectionOfPath("")).toBe("test");
    expect(sectionOfPath("capabilities")).toBe("test");
    expect(sectionOfPath("schemaVersion")).toBe("test");
  });
});

describe("what each section owes", () => {
  it("counts errors and warnings apart, so a section can be colored by the worse one", () => {
    const counts = countBySection([problem("title"), problem("tags", "warning"), problem("tables.a.entries[0]"), problem("")]);
    expect(counts.overview).toEqual({ errors: 1, warnings: 1 });
    expect(counts.tables).toEqual({ errors: 1, warnings: 0 });
    expect(counts.test).toEqual({ errors: 1, warnings: 0 });
    expect(counts.modes).toEqual({ errors: 0, warnings: 0 });
  });

  it("has a row for every section, so nothing has to guard against a missing one", () => {
    expect(Object.keys(countBySection([]))).toEqual(SECTIONS.map((s) => s.id));
  });
});

describe("a section and its address", () => {
  it("round-trips, with Overview as the bare address", () => {
    for (const { id } of SECTIONS) {
      expect(asSection(hashForSection(id).replace(/^#create\/?/, ""))).toBe(id);
    }
    expect(hashForSection("overview")).toBe("#create");
    expect(hashForSection("tables")).toBe("#create/tables");
  });

  it("falls back to the first section for a segment that is not one", () => {
    expect(asSection("")).toBe("overview");
    expect(asSection(null)).toBe("overview");
    expect(asSection("nonsense")).toBe("overview");
  });
});
