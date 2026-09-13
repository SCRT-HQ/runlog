import { describe, expect, it } from "vitest";
import { appliesFor, fits, framesForGesture, landedOf, profileOf, revert, revertGroup, setupFor, type ControlProfile } from "../lib/handlers/control";

/**
 * The mapping runs on a profile written in somebody's browser and reaches
 * a program that edits another program's memory, so the two things these
 * tests care about are that a result reaches the right players and that
 * nothing malformed reaches anyone at all.
 */

const curses: ControlProfile = {
  setup: [{ op: "flag.set", args: { name: "player.noRoll", value: true } }],
  rows: [
    { tag: "curse", label: "A curse", for: 90, ops: [{ op: "flag.set", args: { name: "player.noRoll", value: true } }] },
    { table: "curse", entry: "rot", label: "Scarlet Rot", ops: [{ op: "speffect.apply", args: { id: 6900 } }] },
    { table: "relocate", to: "all", ops: [{ op: "warp.position", args: { block: 60, x: 1, y: 2, z: 3 } }] },
    { entry: "mira-only", to: "Mira", ops: [{ op: "flag.set", args: { name: "player.noDeath", value: true } }] },
  ],
};

const landed = (over: Record<string, unknown>) => landedOf({ n: 4, unit: 2, tableId: "curse", entryId: "rot", ...over })!;

describe("reading a profile", () => {
  it("takes what is well formed and drops the rest", () => {
    const p = profileOf({
      control: {
        setup: [{ op: "flag.set", args: { name: "a", value: true } }, { op: 12 }, "nonsense"],
        rows: [
          { entry: "rot", ops: [{ op: "speffect.apply" }] },
          { entry: "no-ops", ops: [] },
          { ops: [{ op: "x" }] },
          "nonsense",
        ],
      },
    });
    expect(p?.setup).toEqual([{ op: "flag.set", args: { name: "a", value: true } }]);
    // The row with no ops and the row selecting nothing are both gone.
    expect(p?.rows).toEqual([{ entry: "rot", ops: [{ op: "speffect.apply", args: {} }] }]);
  });

  it("is nothing at all when there is no profile, or an empty one", () => {
    expect(profileOf(null)).toBeNull();
    expect(profileOf({})).toBeNull();
    expect(profileOf({ control: {} })).toBeNull();
    expect(profileOf({ control: { rows: [] } })).toBeNull();
    expect(profileOf("a run")).toBeNull();
  });

  it("holds a lifetime to something a person could live through", () => {
    const p = profileOf({ control: { rows: [{ entry: "a", for: 999999, ops: [{ op: "x" }] }, { entry: "b", for: -5, ops: [{ op: "x" }] }] } });
    expect(p?.rows?.[0]?.for).toBe(3600);
    expect(p?.rows?.[1]?.for).toBe(1);
  });

  it("will not let one profile flood a socket", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ entry: `e${i}`, ops: [{ op: "x" }] }));
    expect(profileOf({ control: { rows: many } })?.rows).toHaveLength(20);
  });
});

describe("what a result produces", () => {
  it("matches on the entry, and says how long it lasts", () => {
    const [frame, ...rest] = appliesFor({ rows: [curses.rows![1]!] }, landed({}), undefined);
    expect(rest).toEqual([]);
    expect(JSON.parse(frame!)).toEqual({
      t: "apply",
      id: "o4#0",
      label: "Scarlet Rot",
      ops: [{ op: "speffect.apply", args: { id: 6900 } }],
    });
  });

  it("matches on a tag, so one row covers a table full of curses", () => {
    const frames = appliesFor(curses, landed({ entryId: "frost", tags: ["curse"] }), undefined);
    expect(frames.map((f) => JSON.parse(f).id)).toEqual(["o4#0"]);
    expect(JSON.parse(frames[0]!).for).toBe(90);
  });

  it("lets a tag row and an entry row both land, each as its own effect", () => {
    const frames = appliesFor(curses, landed({ tags: ["curse"] }), undefined);
    expect(frames.map((f) => JSON.parse(f).id)).toEqual(["o4#0", "o4#1"]);
  });

  it("gives the same result the same id twice, so a replay is not a second effect", () => {
    const once = appliesFor(curses, landed({}), undefined);
    const again = appliesFor(curses, landed({}), undefined);
    expect(once).toEqual(again);
  });

  it("falls back to the words for a label when the row has none", () => {
    const p: ControlProfile = { rows: [{ entry: "rot", ops: [{ op: "x" }] }] };
    expect(JSON.parse(appliesFor(p, landed({ text: "A dry wind." }), undefined)[0]!).label).toBe("A dry wind.");
  });

  it("keeps an entry row to its own table where two tables share an id", () => {
    expect(appliesFor(curses, landed({ tableId: "elsewhere" }), undefined)).toEqual([]);
  });

  it("matches a whole table where that is what the row asked for", () => {
    const frames = appliesFor(curses, landed({ tableId: "relocate", entryId: "lift" }), "Mira");
    expect(JSON.parse(frames[0]!).ops[0].op).toBe("warp.position");
  });
});

describe("who an effect reaches", () => {
  it("reaches everyone when a row names nobody", () => {
    expect(appliesFor(curses, landed({ tags: ["curse"] }), undefined)).toHaveLength(2);
    expect(appliesFor(curses, landed({ tags: ["curse"] }), "Kel")).toHaveLength(2);
  });

  it("reaches only the seat a row names", () => {
    const one = landed({ entryId: "mira-only", tableId: "any" });
    expect(appliesFor(curses, one, "Mira").map((f) => JSON.parse(f).id)).toEqual(["o4#3"]);
    expect(appliesFor(curses, one, "mira")).toHaveLength(1);
    expect(appliesFor(curses, one, "Kel")).toEqual([]);
    // A tool that never said which player it is hears only what is for
    // everyone, rather than everything.
    expect(appliesFor(curses, one, undefined)).toEqual([]);
  });
});

describe("the run's own terms", () => {
  it("are one effect, under an id the run can take back", () => {
    expect(JSON.parse(setupFor(curses)!)).toEqual({
      t: "apply",
      id: "setup",
      label: "The run's terms",
      ops: [{ op: "flag.set", args: { name: "player.noRoll", value: true } }],
    });
  });

  it("are nothing where a profile sets none", () => {
    expect(setupFor({ rows: [] })).toBeNull();
  });
});

describe("gestures other than a result", () => {
  it("take everything off when the run ends, since nothing should outlive it", () => {
    expect(framesForGesture(curses, "run-ended", {}, undefined)).toEqual([revert("*")]);
  });

  it("say nothing about a unit closing, a clock or a tally", () => {
    for (const kind of ["unit-closed", "clock", "counter", "award", "rolled"]) {
      expect(framesForGesture(curses, kind, { n: 1 }, undefined)).toEqual([]);
    }
  });

  it("say nothing about a result with no ids on it, rather than guessing from the words", () => {
    expect(landedOf({ n: 1, table: "Curse", text: "Scarlet rot." })).toBeNull();
    expect(framesForGesture(curses, "outcome", { n: 1, table: "Curse", text: "Scarlet rot." }, undefined)).toEqual([]);
  });
});

describe("how long an effect lasts", () => {
  it("files an effect that lasts a unit under that unit, rather than a number of seconds", () => {
    const p: ControlProfile = { rows: [{ tag: "curse", until: "unit", ops: [{ op: "x" }] }] };
    const frame = JSON.parse(appliesFor(p, landed({ tags: ["curse"] }), undefined)[0]!);
    expect(frame.group).toBe("unit:2");
    expect(frame.for).toBeUndefined();
  });

  it("takes a whole unit's effects back when the unit closes", () => {
    expect(framesForGesture({ rows: [] }, "unit-closed", { unit: 2, unitsDone: 2 }, undefined)).toEqual([revertGroup("unit:2")]);
    // A unit that did not say which one it was takes nothing back,
    // rather than taking back the wrong thing.
    expect(framesForGesture({ rows: [] }, "unit-closed", {}, undefined)).toEqual([]);
  });

  it("prefers seconds where a row somehow says both", () => {
    const p = profileOf({ control: { rows: [{ entry: "rot", for: 30, until: "unit", ops: [{ op: "x" }] }] } })!;
    expect(p.rows![0]!.until).toBeUndefined();
    expect(p.rows![0]!.for).toBe(30);
  });

  it("says nothing about a unit for a result that never said which unit it was in", () => {
    const p: ControlProfile = { rows: [{ entry: "rot", until: "unit", ops: [{ op: "x" }] }] };
    const frame = JSON.parse(appliesFor(p, landedOf({ n: 1, tableId: "curse", entryId: "rot" })!, undefined)[0]!);
    expect(frame.group).toBeUndefined();
  });
});

describe("the program a profile was written for", () => {
  it("is kept, and holds the profile to it", () => {
    const p = profileOf({ control: { tool: "TarnishedTool", rows: [{ entry: "a", ops: [{ op: "x" }] }] } })!;
    expect(p.tool).toBe("TarnishedTool");
    expect(fits(p, "TarnishedTool")).toBe(true);
    expect(fits(p, "tarnishedtool")).toBe(true);
    expect(fits(p, "SomethingElse")).toBe(false);
    // A tool that never said what it is does not get the benefit of the
    // doubt: two programs can easily share an operation name.
    expect(fits(p, undefined)).toBe(false);
  });

  it("is optional, and a profile naming none is for whatever is listening", () => {
    const p = profileOf({ control: { rows: [{ entry: "a", ops: [{ op: "x" }] }] } })!;
    expect(p.tool).toBeUndefined();
    expect(fits(p, undefined)).toBe(true);
    expect(fits(p, "AnythingAtAll")).toBe(true);
  });
});
