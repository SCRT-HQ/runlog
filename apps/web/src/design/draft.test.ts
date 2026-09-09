import { describe, expect, it } from "vitest";
import { parsePack } from "@runlog/rules-schema";
import { blankPack, coverage, coverageSummary, isBlank, packFilename } from "./draft.ts";

describe("the pack a new author starts from", () => {
  /**
   * The first thing someone sees in the editor should be a game they can press
   * Play on, not a list of what is missing. A blank that does not load teaches
   * the format as a series of complaints.
   */
  it("loads, with nothing to report", () => {
    const result = parsePack(blankPack());
    const shown = result.diagnostics.map((d) => `${d.code} at ${d.path}: ${d.message}`);
    expect(shown).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("has a phase that closes a unit, so a run can actually progress", () => {
    const phases = blankPack().phases as Array<{ steps: Array<{ kind: string }> }>;
    expect(phases.some((p) => p.steps.some((s) => s.kind === "finalizeUnit"))).toBe(true);
  });
});

/**
 * The check that decides whether opening the Designer should ask "which
 * pack?" at all. Missing this either way is its own kind of bad surprise:
 * asking about a pack nobody has touched yet, or silently discarding one
 * that has real work in it.
 */
describe("recognizing the untouched scaffold", () => {
  it("calls the pack a fresh draft starts as blank", () => {
    expect(isBlank(blankPack())).toBe(true);
  });

  it("stops calling it blank the moment a single field changes", () => {
    expect(isBlank({ ...blankPack(), title: "Two-Line Days" })).toBe(false);
    expect(isBlank({ ...blankPack(), author: "Someone" })).toBe(false);
  });

  it("calls a pack with its own tables and phases not blank", () => {
    const started = {
      ...blankPack(),
      title: "Two-Line Days",
      tables: { ...(blankPack().tables as object), extra: { resolution: "keyed", title: "Extra", entries: [] } },
    };
    expect(isBlank(started)).toBe(false);
  });
});

describe("naming the file", () => {
  it("uses the last segment of the id and the version", () => {
    const pack = { ...blankPack(), id: "com.example.two-line-days", version: "1.2.0" };
    expect(packFilename(pack)).toBe("two-line-days-1.2.0.yaml");
  });

  it("copes with an id still being typed", () => {
    expect(packFilename({})).toBe("pack-0.0.0.yaml");
    expect(packFilename({ id: "com.example.", version: "0.1.0" })).toBe("pack-0.1.0.yaml");
  });

  it("keeps a filename a filesystem will accept", () => {
    expect(packFilename({ id: "com.example.my game/v2", version: "0.1.0" })).toBe(
      "my-game-v2-0.1.0.yaml",
    );
  });
});

/**
 * Ranges that do not tile are the mistake every table author makes. The linter
 * reports them on save; this is what draws them while the numbers are still in
 * the author's head, so it has to agree with the linter about what is wrong.
 */
describe("range coverage", () => {
  const entry = (id: string, from: number, to: number) => ({ id, range: [from, to], text: "x" });

  it("reports a table that tiles its span exactly", () => {
    const segments = coverage("d6", [entry("a", 1, 3), entry("b", 4, 6)]);
    expect(segments.every((s) => s.claims === 1)).toBe(true);
    expect(coverageSummary(segments)).toEqual({ ok: true, text: "covered exactly" });
  });

  it("finds a gap in the middle", () => {
    const segments = coverage("d6", [entry("a", 1, 2), entry("b", 5, 6)]);
    const gap = segments.find((s) => s.claims === 0);
    expect(gap).toMatchObject({ from: 3, to: 4 });
    expect(coverageSummary(segments).text).toContain("unreachable: 3-4");
  });

  it("finds a gap at the end, which is the one people miss", () => {
    // A d100 table stopping at 99 looks finished and is not.
    const segments = coverage("d100", [entry("a", 1, 99)]);
    expect(segments.find((s) => s.claims === 0)).toMatchObject({ from: 100, to: 100 });
    expect(coverageSummary(segments).text).toContain("unreachable: 100");
  });

  it("finds two entries claiming the same numbers, and says which", () => {
    const segments = coverage("d6", [entry("a", 1, 4), entry("b", 3, 6)]);
    const over = segments.find((s) => s.claims > 1);
    expect(over).toMatchObject({ from: 3, to: 4 });
    expect(over!.entries).toEqual(["a", "b"]);
    expect(coverageSummary(segments).text).toContain("claimed twice: 3-4");
  });

  it("reports both a gap and an overlap at once", () => {
    const text = coverageSummary(coverage("d6", [entry("a", 1, 3), entry("b", 2, 4)])).text;
    expect(text).toContain("unreachable");
    expect(text).toContain("claimed twice");
  });

  it("uses the dice expression's real span, not an assumed one", () => {
    // 2d6 runs 2-12; a table covering 1-6 is mostly missing.
    const segments = coverage("2d6", [entry("a", 2, 12)]);
    expect(segments).toEqual([{ from: 2, to: 12, claims: 1, entries: ["a"] }]);
  });

  it("ignores an entry whose range is still being typed", () => {
    // Mid-edit a range can be absent or half a number. That is not an error
    // worth shouting about; it is someone typing.
    const segments = coverage("d6", [entry("a", 1, 6), { id: "b", text: "x" }]);
    expect(segments.every((s) => s.claims === 1)).toBe(true);
  });

  it("says nothing about a dice expression it cannot read", () => {
    // The schema will complain about the expression itself; a coverage bar
    // guessing at a span would just be a second, wronger complaint.
    expect(coverageSummary(coverage("nonsense", []))).toMatchObject({ ok: true });
  });

  it("refuses to enumerate an absurd span", () => {
    expect(coverage("d1000000", [])).toEqual([]);
  });

  it("collapses runs rather than returning one segment per number", () => {
    // A d100 table should be a handful of segments, not a hundred.
    expect(coverage("d100", [entry("a", 1, 50), entry("b", 51, 100)])).toHaveLength(2);
  });

  it("keeps segments distinct when different entries claim them", () => {
    // Two adjacent spans each claimed once are not the same segment, or the
    // bar would say "covered" while hiding which entry owns what.
    const segments = coverage("d4", [entry("a", 1, 2), entry("b", 3, 4)]);
    expect(segments.map((s) => s.entries)).toEqual([["a"], ["b"]]);
  });
});
