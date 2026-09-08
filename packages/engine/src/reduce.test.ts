import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { canEndRun, nextUnit, reduce } from "./reduce.ts";
import { stepCompletionEvents } from "./flow.ts";
import { eligibleTargets, subjectLabel, subjectName, subjectTitle } from "./eligibility.ts";
import type { RunEvent } from "./events.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}

const kiln = loadPack("packs/demo/pack.yaml");
const signal = loadPack("packs/sketches/salt-and-signal.yaml");

let clock = 0;
/** Build an event with a monotonically increasing timestamp. */
function ev<T extends RunEvent["t"]>(
  t: T,
  props: Omit<Extract<RunEvent, { t: T }>, "t" | "at"> = {} as never,
): RunEvent {
  clock += 1000;
  return { t, at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, clock)).toISOString(), ...props } as RunEvent;
}

const start = () =>
  ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" });

/** A completed unit: enter, declare, close. */
const unit = (type: string): RunEvent[] => [
  ev("UnitEntered"),
  ev("SubjectDeclared", { subjectType: type }),
  ev("UnitFinalized"),
];

describe("reduce", () => {
  it("refuses a log that does not begin at the beginning", () => {
    expect(() => reduce(kiln, [ev("UnitEntered")])).toThrow(/must begin with RunStarted/);
  });

  it("seeds counters and resources from the pack's declared initial values", () => {
    const state = reduce(kiln, [start()]);
    expect(state.counters.calm).toBe(0);
    expect(state.resources.glaze).toBe(3);
    expect(state.status).toBe("active");
    expect(state.unit).toBe(0);
  });

  describe("determinism", () => {
    it("produces identical state when the same log is replayed", () => {
      // The property everything else leans on: undo, export and the shared-seed
      // modes are only trustworthy if a log folds the same way every time.
      const log = [start(), ...unit("Bowl"), ...unit("Vase"), ...unit("Cup")];
      expect(reduce(kiln, log)).toEqual(reduce(kiln, log));
    });

    it("gives the same state whether folded once or in two halves", () => {
      const log = [start(), ...unit("Bowl"), ...unit("Vase")];
      const whole = reduce(kiln, log);
      const prefix = log.slice(0, 4);
      const replayed = reduce(kiln, [...prefix, ...log.slice(4)]);
      expect(replayed).toEqual(whole);
    });
  });

  describe("subjects", () => {
    it("creates one per unit and numbers them in order", () => {
      const state = reduce(kiln, [start(), ...unit("Bowl"), ...unit("Vase")]);
      expect(state.subjects.map((s) => s.id)).toEqual([1, 2]);
      expect(state.subjects.map((s) => s.type)).toEqual(["Bowl", "Vase"]);
      expect(state.subjects.every((s) => s.finalized)).toBe(true);
    });

    it("leaves the current unit's subject unfinalized until the unit closes", () => {
      const state = reduce(kiln, [start(), ev("UnitEntered")]);
      expect(state.subjects[0]!.finalized).toBe(false);
      expect(eligibleTargets(kiln, state)).toEqual([]);
    });

    it("marks a removed subject rather than deleting it", () => {
      // Deleting would renumber everything after it, and targeting counts
      // positions -- history has to stay put.
      const state = reduce(kiln, [
        start(),
        ...unit("Bowl"),
        ...unit("Vase"),
        ev("SubjectRemoved", { subject: 1 }),
        ...unit("Cup"),
      ]);
      expect(state.subjects.map((s) => s.id)).toEqual([1, 2, 3]);
      expect(state.subjects[0]!.removed).toBe(true);
      expect(eligibleTargets(kiln, state).map((s) => s.id)).toEqual([2, 3]);
    });
  });

  describe("states", () => {
    it("attaches a subject-scoped state to the named subject", () => {
      const state = reduce(kiln, [
        start(),
        ...unit("Bowl"),
        ev("StateApplied", { state: "locked", subject: 1 }),
      ]);
      expect(state.subjects[0]!.states).toEqual(["locked"]);
      expect(state.runStates).toEqual([]);
    });

    it("routes a run-scoped state to the run, whatever the event says", () => {
      const state = reduce(kiln, [start(), ev("StateApplied", { state: "coldKiln", subject: 1 })]);
      expect(state.runStates).toEqual(["coldKiln"]);
    });

    it("does not attach the same state twice", () => {
      const state = reduce(kiln, [
        start(),
        ...unit("Bowl"),
        ev("StateApplied", { state: "locked", subject: 1 }),
        ev("StateApplied", { state: "locked", subject: 1 }),
      ]);
      expect(state.subjects[0]!.states).toEqual(["locked"]);
    });

    it("builds the label a player writes on the thing itself", () => {
      const state = reduce(kiln, [
        start(),
        ...unit("Tall vase"),
        ev("StateApplied", { state: "locked", subject: 1 }),
        ev("StateApplied", { state: "sealed", subject: 1 }),
      ]);
      expect(subjectLabel(kiln, state.subjects[0]!)).toBe("Piece 1 (Tall vase) [LK SL]");
    });
  });

  describe("counters", () => {
    /** A unit whose check produced nothing. */
    const quiet = (): RunEvent[] => [
      ev("UnitEntered"),
      ev("Rolled", { purpose: "check", dice: "d100", total: 5, values: [5], source: "physical" }),
      ev("OutcomeResolved", { table: "check", entryId: "check-quiet", cause: "phase" }),
      ev("PhaseCompleted", { phase: "check" }),
      ev("UnitFinalized"),
    ];

    /** A unit whose check reached back and inflicted a setback. */
    const setback = (): RunEvent[] => [
      ev("UnitEntered"),
      ev("Rolled", { purpose: "check", dice: "d100", total: 74, values: [74], source: "physical" }),
      ev("OutcomeResolved", { table: "check", entryId: "check-recent", cause: "phase" }),
      ev("OutcomeResolved", { table: "setback", entryId: "set-crack", cause: "action" }),
      ev("PhaseCompleted", { phase: "check" }),
      ev("UnitFinalized"),
    ];

    it("increments on the event the pack hooked", () => {
      const state = reduce(kiln, [start(), ...quiet(), ...quiet(), ...quiet()]);
      expect(state.counters.calm).toBe(3);
    });

    it("resets when the watched consequence happens", () => {
      const state = reduce(kiln, [start(), ...quiet(), ...quiet(), ...setback()]);
      expect(state.counters.calm).toBe(0);
    });

    it("keeps a reset at zero even though the phase completes afterwards", () => {
      // The subtle case, and the reason resets dominate their unit. Within one
      // unit the setback resolves *before* the check phase completes, so bare
      // event order would leave the streak at 1 when the streak plainly broke.
      const state = reduce(kiln, [start(), ...setback()]);
      expect(state.counters.calm).toBe(0);
    });

    it("resumes counting in the unit after a reset", () => {
      const state = reduce(kiln, [start(), ...setback(), ...quiet(), ...quiet()]);
      expect(state.counters.calm).toBe(2);
    });

    it("tallies a separate counter that has no reset rule", () => {
      const state = reduce(kiln, [start(), ...setback(), ...quiet(), ...setback()]);
      expect(state.counters.setbacksSuffered).toBe(2);
    });

    it("clamps to the declared bounds", () => {
      const state = reduce(kiln, [
        start(),
        ev("CounterChanged", { counter: "calm", set: 999 }),
      ]);
      expect(state.counters.calm).toBe(999); // calm declares no ceiling
      const bounded = reduce(kiln, [start(), ev("CounterChanged", { counter: "calm", by: -5 })]);
      expect(bounded.counters.calm).toBe(0); // but min is 0
    });
  });

  describe("resources", () => {
    it("adds and subtracts", () => {
      const state = reduce(kiln, [
        start(),
        ev("ResourceChanged", { resource: "glaze", by: 2 }),
        ev("ResourceChanged", { resource: "glaze", by: -1 }),
      ]);
      expect(state.resources.glaze).toBe(4);
    });

    it("clamps to the declared ceiling and floor", () => {
      const high = reduce(kiln, [start(), ev("ResourceChanged", { resource: "glaze", by: 99 })]);
      expect(high.resources.glaze).toBe(6);
      const low = reduce(kiln, [start(), ev("ResourceChanged", { resource: "glaze", by: -99 })]);
      expect(low.resources.glaze).toBe(0);
    });

    it("respects a floor below zero when a pack declares one", () => {
      // Salt & Signal lets Nerve run to -3. A hardcoded floor of zero would
      // quietly change that game's arithmetic.
      const state = reduce(signal, [
        ev("RunStarted", { packId: signal.id, packVersion: signal.version, mode: "standard" }),
        ev("ResourceChanged", { resource: "nerve", by: -99 }),
      ]);
      expect(state.resources.nerve).toBe(-3);
    });
  });

  describe("rewind", () => {
    it("sends the run back at the close of the unit, never before the first, and counts it", () => {
      const queued = reduce(kiln, [start(), ...unit("Bowl"), ev("UnitEntered"), ev("RewindQueued", { count: 1 })]);
      expect(queued.unit).toBe(2);
      expect(queued.rewindNext).toBe(1);
      expect(nextUnit(queued)).toBe(1);
      const back = reduce(kiln, [start(), ...unit("Bowl"), ...unit("Cup"), ev("UnitEntered"), ev("RewindQueued", { count: 1 }), ev("UnitFinalized"), ev("UnitEntered")]);
      expect(back.unit).toBe(2);
      expect(back.rewindNext).toBe(0);
      expect(back.rewinds).toBe(1);
      // The revisited unit starts over: a fresh subject, nothing done.
      expect(back.stepsDone).toEqual([]);
      expect(back.subjects.filter((s) => s.unit === 2)).toHaveLength(2);
      expect(back.subjects.findLast((s) => s.unit === 2)?.finalized).toBe(false);
      const floor = reduce(kiln, [start(), ...unit("Bowl"), ev("UnitEntered"), ev("RewindQueued", { count: 5 }), ev("UnitFinalized"), ev("UnitEntered")]);
      expect(floor.unit).toBe(1);
    });
  });

  describe("extra rolls", () => {
    it("owes the next unit its rolls, and pays them one roll at a time", () => {
      const owed = reduce(kiln, [start(), ...unit("Bowl"), ev("ExtraRollQueued", { table: "form", count: 1, unit: "next" })]);
      expect(owed.extraRollsNext).toEqual({ form: 1 });
      expect(owed.extraRolls).toEqual({});
      const next = reduce(kiln, [start(), ...unit("Bowl"), ev("ExtraRollQueued", { table: "form", count: 1, unit: "next" }), ev("UnitFinalized"), ev("UnitEntered")]);
      expect(next.extraRolls).toEqual({ form: 1 });
      expect(next.extraRollsNext).toEqual({});
      const paid = reduce(kiln, [start(), ...unit("Bowl"), ev("ExtraRollQueued", { table: "form", count: 2, unit: "current" }), ev("ExtraRollTaken", { table: "form" })]);
      expect(paid.extraRolls).toEqual({ form: 1 });
    });

    it("keeps a table step open while rolls are owed, then completes it", () => {
      const phase = { id: "shape", label: "Shape", steps: [{ kind: "rollTable" as const, table: "form", optional: false }] } as unknown as Parameters<typeof stepCompletionEvents>[0];
      const owing = reduce(kiln, [start(), ...unit("Bowl"), ev("ExtraRollQueued", { table: "form", count: 1, unit: "current" })]);
      expect(stepCompletionEvents(phase, 0, owing, "2026-01-01T00:00:01Z")).toEqual([{ t: "ExtraRollTaken", at: "2026-01-01T00:00:01Z", table: "form" }]);
      const settled = reduce(kiln, [start(), ...unit("Bowl")]);
      expect(stepCompletionEvents(phase, 0, settled, "2026-01-01T00:00:01Z").map((e) => e.t)).toEqual(["StepCompleted", "PhaseCompleted"]);
    });
  });

  describe("forced units", () => {
    it("blocks the run from ending while any are queued", () => {
      const state = reduce(kiln, [start(), ...unit("Bowl"), ev("UnitForced", { count: 2 })]);
      expect(state.forcedUnits).toBe(2);
      expect(canEndRun(state)).toMatchObject({ ok: false });
      expect(canEndRun(state).reason).toContain("2 forced");
    });

    it("works one off each time a unit is entered", () => {
      const state = reduce(kiln, [
        start(),
        ...unit("Bowl"),
        ev("UnitForced", { count: 2 }),
        ...unit("Vase"),
      ]);
      expect(state.forcedUnits).toBe(1);
      expect(canEndRun(state).ok).toBe(false);
    });

    it("allows the run to end once the queue is empty", () => {
      const state = reduce(kiln, [
        start(),
        ...unit("Bowl"),
        ev("UnitForced", { count: 1 }),
        ...unit("Vase"),
      ]);
      expect(canEndRun(state).ok).toBe(true);
    });
  });

  describe("the rest of the board", () => {
    it("records journal entries against their unit", () => {
      const state = reduce(kiln, [
        start(),
        ...unit("Bowl"),
        ev("JournalWritten", { unit: 1, text: "Wobbled, kept it anyway." }),
      ]);
      expect(state.journal[1]).toBe("Wobbled, kept it anyway.");
    });

    it("tracks a hand of cards", () => {
      const state = reduce(kiln, [
        start(),
        ev("CardDrawn", { deck: "charms", cardId: "kintsugi" }),
        ev("CardDrawn", { deck: "charms", cardId: "slipware" }),
        ev("CardPlayed", { deck: "charms", cardId: "kintsugi" }),
      ]);
      expect(state.hand).toEqual([{ deck: "charms", cardId: "slipware" }]);
    });

    it("remembers banned subject types", () => {
      const state = reduce(kiln, [start(), ev("TypeBanned", { subjectType: "Bowl" })]);
      expect(state.bannedTypes).toEqual(["Bowl"]);
    });

    it("keeps a readable history of what was resolved", () => {
      const state = reduce(kiln, [
        start(),
        ev("UnitEntered"),
        ev("OutcomeResolved", { table: "constraint", entryId: "con-thin", cause: "phase" }),
      ]);
      expect(state.outcomes).toEqual([
        expect.objectContaining({ unit: 1, table: "constraint", entryId: "con-thin" }),
      ]);
    });

    it("advances the clock so a run can span more than one sitting", () => {
      const log = [start(), ...unit("Bowl")];
      const state = reduce(kiln, log);
      expect(state.startedAt).toBe(log[0]!.at);
      expect(state.updatedAt).toBe(log.at(-1)!.at);
      expect(state.updatedAt > state.startedAt).toBe(true);
    });

    it("records the ending and closes the run", () => {
      const state = reduce(kiln, [start(), ...unit("Bowl"), ev("RunEnded", { ending: "kept" })]);
      expect(state.status).toBe("ended");
      expect(state.ending).toBe("kept");
      expect(canEndRun(state).ok).toBe(false);
    });
  });
});

/**
 * Renaming after the fact.
 *
 * A name typed in the moment is often wrong — a Piece turns out to be
 * something else by the time it is fired. The correction has to be an event
 * like anything else, or it would not survive a reload, an export, or an undo.
 */
describe("renaming a subject", () => {
  const started: RunEvent[] = [
    ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
    ev("UnitEntered"),
    ev("SubjectDeclared", { subjectType: "Tall vase" }),
  ];

  it("changes what it is called, and keeps what it was declared to be", () => {
    const state = reduce(kiln, [...started, ev("SubjectRenamed", { subject: 1, name: "Bottle" })]);
    expect(state.subjects[0]!.name).toBe("Bottle");
    expect(state.subjects[0]!.type).toBe("Tall vase");
  });

  it("is known by its noun and number until it is named, and the number never moves", () => {
    // Naming the first one does not make the second one "Piece 1": the
    // number is the id, so the default names count on regardless.
    const state = reduce(kiln, [
      ...started,
      ev("SubjectRenamed", { subject: 1, name: "Bottle" }),
      ev("UnitFinalized"),
      ev("UnitEntered"),
      ev("SubjectDeclared", { subjectType: "Lidded jar" }),
    ]);
    expect(state.subjects.map((s) => subjectName(kiln, s))).toEqual(["Bottle", "Piece 2"]);
    expect(subjectTitle(kiln, state.subjects[1]!)).toBe("Piece 2 (Lidded jar)");
  });

  it("keeps its id, its unit and its states", () => {
    // The thing is the same thing; only the label changed. Losing its states
    // here would quietly undo whatever the game had done to it.
    const state = reduce(kiln, [
      ...started,
      ev("StateApplied", { state: "sealed", subject: 1 }),
      ev("UnitFinalized"),
      ev("SubjectRenamed", { subject: 1, name: "Bottle" }),
    ]);
    expect(state.subjects[0]).toMatchObject({
      id: 1,
      unit: 1,
      states: ["sealed"],
      finalized: true,
      name: "Bottle",
    });
  });

  it("reaches back to a subject from an earlier unit", () => {
    const state = reduce(kiln, [
      ...started,
      ev("UnitFinalized"),
      ev("UnitEntered"),
      ev("SubjectDeclared", { subjectType: "Lidded jar" }),
      ev("SubjectRenamed", { subject: 1, name: "Bottle" }),
    ]);
    expect(state.subjects.map((s) => s.name)).toEqual(["Bottle", null]);
  });

  it("ignores a subject that does not exist", () => {
    const state = reduce(kiln, [...started, ev("SubjectRenamed", { subject: 99, name: "Ghost" })]);
    expect(state.subjects.map((s) => s.name)).toEqual([null]);
  });
});
