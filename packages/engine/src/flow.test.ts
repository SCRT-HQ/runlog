import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { activePhases, constrainedByOf, constraintsFor, entryWords, nextStep, stepCompletionEvents } from "./flow.ts";
import type { RunEvent } from "./events.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}
const kiln = loadPack("packs/demo/pack.yaml");

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent =>
  ({ t, at: NOW, ...props }) as RunEvent;

const start = [
  ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
];

/** Walk the flow, completing each step, and report the order visited. */
function walk(log: RunEvent[], limit = 12): string[] {
  const visited: string[] = [];
  let events = [...log];
  for (let i = 0; i < limit; i++) {
    const state = reduce(kiln, events);
    const step = nextStep(kiln, state);
    if (!step) break;
    visited.push(`${step.phase.id}#${step.index}`);
    events = [...events, ...stepCompletionEvents(step.phase, step.index, state, NOW)];
  }
  return visited;
}

describe("what the unit says on entry", () => {
  it("says the welcome on the first unit only, and the unit's word until its first step is done", () => {
    const talking = { ...kiln, unit: { ...kiln.unit, intro: "Welcome to the kiln yard.", onEnter: "Stage {n}: wedge, throw, fire." } } as Pack;
    // Before the first unit there is nothing to say.
    expect(entryWords(talking, reduce(talking, start))).toEqual([]);
    const entered = [...start, ev("UnitEntered", {})];
    const one = reduce(talking, entered);
    expect(entryWords(talking, one)).toEqual(["Welcome to the kiln yard.", "Stage 1: wedge, throw, fire."]);
    const stepped = reduce(talking, [...entered, ...stepCompletionEvents(talking.phases[0]!, 0, one, "2026-01-01T00:00:02Z")]);
    expect(entryWords(talking, stepped)).toEqual([]);
    const two = reduce(talking, [...entered, ev("UnitFinalized", {}), ev("UnitEntered", {})]);
    expect(entryWords(talking, two)).toEqual(["Stage 2: wedge, throw, fire."]);
    // A pack that says nothing says nothing.
    expect(entryWords(kiln, one)).toEqual([]);
  });
});

describe("moving through a unit", () => {
  it("has no step before the first unit is entered", () => {
    expect(nextStep(kiln, reduce(kiln, start))).toBeNull();
  });

  it("starts at the first step of the first phase", () => {
    const step = nextStep(kiln, reduce(kiln, [...start, ev("UnitEntered")]));
    expect(step).toMatchObject({ index: 0 });
    expect(step!.phase.id).toBe("enter");
  });

  /**
   * The regression this file exists for.
   *
   * A step that ran its work but never recorded itself left the flow pinned in
   * place while the log filled up behind it, which reads to a player as the
   * game simply refusing to move on.
   */
  it("advances once a step records itself as done", () => {
    const state = reduce(kiln, [...start, ev("UnitEntered")]);
    const first = nextStep(kiln, state)!;
    const after = reduce(kiln, [
      ...start,
      ev("UnitEntered"),
      ...stepCompletionEvents(first.phase, first.index, state, NOW),
    ]);
    const second = nextStep(kiln, after)!;
    expect(`${second.phase.id}#${second.index}`).not.toBe(`${first.phase.id}#${first.index}`);
  });

  it("does not advance on the work alone, only on the record of it", () => {
    // Rolling produces outcomes; it is recording the step that moves the flow.
    const state = reduce(kiln, [
      ...start,
      ev("UnitEntered"),
      ev("Rolled", { purpose: "check", dice: "d100", total: 40, values: [40], source: "physical" }),
      ev("OutcomeResolved", { table: "check", entryId: "check-kind", cause: "phase" }),
    ]);
    expect(nextStep(kiln, state)).toMatchObject({ index: 0 });
    expect(nextStep(kiln, state)!.phase.id).toBe("enter");
  });

  it("walks the whole first unit and then stops", () => {
    // Kiln Check and Constraint are both skipped on the first unit.
    const visited = walk([...start, ev("UnitEntered")]);
    expect(visited).toEqual(["enter#0", "declare#0", "work#0", "close#0"]);
  });

  it("includes the check and the constraint from the second unit on", () => {
    const visited = walk([
      ...start,
      ev("UnitEntered"),
      ev("UnitFinalized"),
      ev("UnitEntered"),
    ]);
    expect(visited).toEqual(["enter#0", "check#0", "declare#0", "constrain#0", "work#0", "close#0"]);
  });

  it("skips the check once the run-wide state says the game has lost you", () => {
    const visited = walk([
      ...start,
      ev("UnitEntered"),
      ev("UnitFinalized"),
      ev("UnitEntered"),
      ev("StateApplied", { state: "coldKiln" }),
    ]);
    expect(visited).not.toContain("check#0");
    expect(visited).toContain("constrain#0");
  });

  it("has nothing left once every phase is done", () => {
    let events = [...start, ev("UnitEntered")];
    for (let i = 0; i < 10; i++) {
      const state = reduce(kiln, events);
      const step = nextStep(kiln, state);
      if (!step) break;
      events = [...events, ...stepCompletionEvents(step.phase, step.index, state, NOW)];
    }
    expect(nextStep(kiln, reduce(kiln, events))).toBeNull();
  });

  it("closes a phase only when its last step is done", () => {
    const state = reduce(kiln, [...start, ev("UnitEntered")]);
    const phase = kiln.phases.find((p) => p.id === "close")!;
    const events = stepCompletionEvents(phase, 0, state, NOW);
    // `close` has a single step, so finishing it closes the phase too.
    expect(events.map((e) => e.t)).toEqual(["StepCompleted", "PhaseCompleted"]);
  });
});

/**
 * `RunView` and the live snapshot both need to know what a step must
 * honor: a rule drawn earlier in the unit, shown on the step so the
 * player is not asked to remember it. One function, so the run screen
 * and a watcher's page cannot drift on what "the game has already had
 * its say" means.
 */
describe("what a step must honor", () => {
  it("names the table only a declareSubject or manual step is constrained by", () => {
    const declareStep = kiln.phases.find((p) => p.id === "declare")!.steps[0]!;
    expect(constrainedByOf(declareStep)).toBe("form");
    const rollStep = kiln.phases.find((p) => p.id === "check")!.steps[0]!;
    expect(constrainedByOf(rollStep)).toBeUndefined();
  });

  it("lists every result on that table drawn this unit, in order, in the pack's own words", () => {
    // The demo pack's own manual step ("Throw it.") only *shows* the
    // Constraint table from its checklist; it does not declare
    // `constrainedBy` there. A small pack fragment stands in for a pack
    // that does, rather than editing the shipped one.
    const pack: Pack = {
      ...kiln,
      phases: [
        { id: "work", label: "Throw the Piece", steps: [{ kind: "manual", label: "Throw it.", constrainedBy: "constraint" }] },
      ],
    };
    const state = reduce(pack, [...start, ev("UnitEntered")]);
    const withOutcomes = {
      ...state,
      outcomes: [
        { unit: state.unit, table: "constraint", entryId: "con-thin", targetSubject: null, at: NOW },
        { unit: state.unit, table: "constraint", entryId: "con-timed", targetSubject: null, at: NOW },
        // A different unit's roll on the same table must not show.
        { unit: state.unit + 1, table: "constraint", entryId: "con-none", targetSubject: null, at: NOW },
      ],
    };
    const step = nextStep(pack, withOutcomes as typeof state)!;
    const tableId = constrainedByOf(step.step);
    expect(tableId).toBe("constraint");
    expect(constraintsFor(pack, withOutcomes as typeof state, tableId)).toEqual([
      kiln.tables.constraint!.entries.find((e) => e.id === "con-thin")!.text,
      kiln.tables.constraint!.entries.find((e) => e.id === "con-timed")!.text,
    ]);
  });

  it("is empty off a step with no constrainedBy table, and off no step at all", () => {
    const state = reduce(kiln, [...start, ev("UnitEntered")]);
    expect(constraintsFor(kiln, state, constrainedByOf(nextStep(kiln, state)!.step))).toEqual([]);
    expect(constraintsFor(kiln, state, undefined)).toEqual([]);
  });
});

describe("which phases a mode plays", () => {
  it("plays them all by default", () => {
    const state = reduce(kiln, [...start, ev("UnitEntered")]);
    expect(activePhases(kiln, state).map((p) => p.id)).toEqual([
      "enter",
      "check",
      "declare",
      "constrain",
      "work",
      "close",
    ]);
  });

  it("drops the phases a mode disables for that unit", () => {
    // Short Firing skips the check on its third and fifth stages.
    const short = reduce(kiln, [
      ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "short" }),
      ev("UnitEntered"),
      ev("UnitFinalized"),
      ev("UnitEntered"),
      ev("UnitFinalized"),
      ev("UnitEntered"),
    ]);
    expect(activePhases(kiln, short).map((p) => p.id)).not.toContain("check");
  });
});
