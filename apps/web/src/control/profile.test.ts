import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { complaints, describes, entriesOf, parse, tagsOf, tidy, type ControlProfile } from "./profile.ts";

/**
 * A profile is written at a desk, often with nothing attached, and is
 * found out an hour into a run. So what these check is that the panel can
 * say what is wrong with one before anybody plays it, and that what
 * travels is exactly what was meant.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const r = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!r.ok) throw new Error("could not load the demo pack");
const kiln = r.pack;

const rot: ControlProfile = {
  tool: "TarnishedTool",
  rows: [{ table: "check", entry: "check-recent", ops: [{ op: "speffect.apply", args: { id: 6900 } }] }],
};

describe("reading the pack", () => {
  it("finds the tags an entry carries, which is what a tag row picks from", () => {
    expect(tagsOf(kiln)).toContain("setback");
  });

  it("says what a row matches in the pack's own words", () => {
    const entry = entriesOf(kiln, "check").find((e) => e.id === "check-recent")!;
    expect(describes(kiln, rot.rows![0]!)).toBe(`${kiln.tables.check!.title} · ${entry.text}`);
    expect(describes(kiln, { tag: "setback", ops: [] })).toBe("Anything tagged setback");
    expect(describes(kiln, { table: "form", ops: [] })).toBe(`Anything from ${kiln.tables.form!.title}`);
  });
});

describe("what is wrong with a profile", () => {
  it("is nothing, for one that matches this pack", () => {
    expect(complaints(kiln, rot)).toEqual([]);
  });

  it("catches a row that can never fire", () => {
    const said = complaints(kiln, { tool: "TarnishedTool", rows: [{ tag: "curse", ops: [{ op: "speffect.apply", args: { id: 1 } }] }] });
    expect(said.some((c) => c.fatal && c.says.includes("tagged curse"))).toBe(true);

    const noTable = complaints(kiln, { tool: "TarnishedTool", rows: [{ table: "nope", ops: [{ op: "speffect.apply", args: { id: 1 } }] }] });
    expect(noTable.some((c) => c.fatal && c.says.includes("no table called nope"))).toBe(true);

    const noEntry = complaints(kiln, { tool: "TarnishedTool", rows: [{ table: "form", entry: "nope", ops: [{ op: "speffect.apply", args: { id: 1 } }] }] });
    expect(noEntry.some((c) => c.fatal && c.says.includes("no entry called nope"))).toBe(true);
  });

  it("catches a row that would do nothing, and one that matches nothing at all", () => {
    expect(complaints(kiln, { rows: [{ tag: "setback", ops: [] }] }).some((c) => c.says === "Does nothing.")).toBe(true);
    expect(complaints(kiln, { rows: [{ ops: [{ op: "x", args: {} }] }] }).some((c) => c.says.includes("never fire"))).toBe(true);
  });

  it("catches an argument the tool will refuse, before a run does", () => {
    const tooFast: ControlProfile = {
      tool: "TarnishedTool",
      rows: [{ tag: "setback", ops: [{ op: "value.set", args: { name: "player.speed", value: 40 } }] }],
    };
    expect(complaints(kiln, tooFast).some((c) => c.says.includes("above 10"))).toBe(true);

    // Each named number has its own range, so the complaint has to know
    // which one is being set rather than one range for the operation.
    const fine: ControlProfile = {
      tool: "TarnishedTool",
      rows: [{ tag: "setback", ops: [{ op: "value.set", args: { name: "player.vigor", value: 40 } }] }],
    };
    expect(complaints(kiln, fine)).toEqual([]);
  });

  it("catches a missing argument and a name the build does not know", () => {
    const missing = complaints(kiln, { tool: "TarnishedTool", rows: [{ tag: "setback", ops: [{ op: "speffect.apply", args: {} }] }] });
    expect(missing.some((c) => c.fatal && c.says.includes("needs"))).toBe(true);

    const unknown = complaints(kiln, { tool: "TarnishedTool", rows: [{ tag: "setback", ops: [{ op: "flag.set", args: { name: "player.flies", value: true } }] }] });
    expect(unknown.some((c) => c.says.includes("player.flies"))).toBe(true);
  });

  it("says an operation it has never heard of will be sent anyway, rather than calling it wrong", () => {
    const said = complaints(kiln, { tool: "TarnishedTool", rows: [{ tag: "setback", ops: [{ op: "future.thing", args: {} }] }] });
    expect(said).toHaveLength(1);
    expect(said[0]!.fatal).toBeFalsy();
    expect(said[0]!.says).toContain("sent anyway");
  });

  it("checks the run's terms as closely as any row", () => {
    const said = complaints(kiln, { tool: "TarnishedTool", setup: [{ op: "flag.set", args: { value: true } }] });
    expect(said[0]!.where).toBe("The run's terms · 1");
    expect(said[0]!.fatal).toBe(true);
  });
});

describe("what travels", () => {
  it("drops empties and leaves nothing extra", () => {
    const out = tidy({
      tool: "TarnishedTool",
      setup: [],
      rows: [
        { table: "form", entry: "form-bowl", label: "", to: "all", for: 0, ops: [{ op: "speffect.apply", args: { id: 1 } }] },
        { tag: "setback", ops: [] },
      ],
    });
    expect(out).toEqual({ tool: "TarnishedTool", rows: [{ table: "form", entry: "form-bowl", ops: [{ op: "speffect.apply", args: { id: 1 } }] }] });
  });

  it("keeps seconds over a unit where a row somehow has both, as the server does", () => {
    expect(tidy({ rows: [{ tag: "setback", for: 30, until: "unit", ops: [{ op: "x", args: {} }] }] }).rows![0]).toEqual({
      tag: "setback",
      for: 30,
      ops: [{ op: "x", args: {} }],
    });
  });

  it("rounds a lifetime somebody typed as a fraction", () => {
    expect(tidy({ rows: [{ tag: "setback", for: 90.6, ops: [{ op: "x", args: {} }] }] }).rows![0]!.for).toBe(91);
  });
});

describe("a profile from a file", () => {
  it("comes back as what was written", () => {
    const there = tidy(rot);
    expect(parse(JSON.stringify(there))).toEqual({ ...there, setup: [] });
  });

  it("is nothing at all when the file is not one", () => {
    expect(parse("")).toBeNull();
    expect(parse("oh dear")).toBeNull();
    expect(parse("[1,2]")).toBeNull();
    expect(parse('"a profile"')).toBeNull();
  });

  it("drops what it cannot read rather than half building a row", () => {
    const out = parse(JSON.stringify({ tool: "T", rows: [{ tag: "a", ops: [{ op: "x" }, { nope: 1 }, "junk"] }, "junk"] }))!;
    expect(out.rows).toEqual([{ tag: "a", ops: [{ op: "x", args: {} }] }]);
  });
});
