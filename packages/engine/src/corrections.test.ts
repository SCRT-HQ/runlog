import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { closeUnitEvents, nextStep } from "./flow.ts";
import { availableMoves, executeActions, executeMove } from "./execute.ts";
import type { RunEvent } from "./events.ts";

/**
 * The pieces added so a player can record an outcome and fix a mistake: a
 * move that closes the unit, a move kept off the screen until its phase has
 * been played, states that exclude one another, ticks that live in the log
 * and count, and a draw whose count is rolled.
 */

const YAML = `
schemaVersion: 1
id: dev.runlog.test-outcomes
version: "0.0.1"
title: Outcomes
license: { id: CC0-1.0, redistributable: true }
capabilities: [deferredTriggers, counters]
vocabulary:
  run: { one: Run, many: Runs }
  unit: { one: Round, many: Rounds }
  subject: { one: Try, many: Tries }
  finalize: Close
unit: { createsSubject: true, min: 1, max: 5 }
states:
  landed: { label: Landed, scope: subject, group: outcome }
  missed: { label: Missed, scope: subject, group: outcome }
  starred: { label: Starred, scope: subject }
counters:
  landed: { label: Landed, initial: 0, min: 0 }
tables:
  trick:
    resolution: lookup
    title: Trick
    roll: d4
    entries:
      - { id: t1, range: [1, 1], text: "One." }
      - { id: t2, range: [2, 2], text: "Two." }
      - { id: t3, range: [3, 3], text: "Three." }
      - { id: t4, range: [4, 4], text: "Four." }
moves:
  itLanded:
    label: It landed
    finalizes: true
    available: [{ phaseDone: play }]
    do:
      - { do: applyState, state: landed, to: thisSubject }
      - { do: modCounter, counter: landed, by: 1 }
  itMissed:
    label: Not this time
    finalizes: true
    available: [{ phaseDone: play }]
    do:
      - { do: applyState, state: missed, to: thisSubject }
phases:
  - id: draw
    label: Draw
    steps:
      - kind: rollTable
        table: trick
      - kind: declareSubject
  - id: play
    label: Play
    steps:
      - kind: manual
        label: Go for it.
        checklist:
          - { text: "Landed:", shows: { table: trick, scope: unit }, optional: true, tally: landed }
  - id: close
    label: Close
    steps:
      - kind: finalizeUnit
endings:
  - { id: done, label: Done }
modes:
  standard: { label: Standard, units: { min: 1, max: 5 } }
defaultMode: standard
`;

function pack(): Pack {
  const r = loadPackText(YAML, "yaml");
  if (!r.ok) throw new Error(`the test pack does not load: ${JSON.stringify(r.diagnostics)}`);
  return r.pack;
}

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent => ({ t, at: NOW, ...props }) as RunEvent;
const opened = (p: Pack): RunEvent[] => [
  ev("RunStarted", { packId: p.id, packVersion: p.version, mode: "standard" }),
  ev("UnitEntered"),
  ev("Rolled", { purpose: "trick", dice: "d4", total: 2, values: [2], source: "app" }),
  ev("OutcomeResolved", { table: "trick", entryId: "t2", cause: "phase" }),
  ev("StepCompleted", { phase: "draw", step: 0 }),
  ev("SubjectDeclared", { subjectType: "A flip" }),
  ev("StepCompleted", { phase: "draw", step: 1 }),
  ev("PhaseCompleted", { phase: "draw" }),
];

describe("a move that is the unit's outcome", () => {
  it("is not offered until its phase has been played", () => {
    const p = pack();
    const before = reduce(p, opened(p));
    expect(availableMoves(p, before).map((m) => m.id)).toEqual([]);
    const after = reduce(p, [...opened(p), ev("StepCompleted", { phase: "play", step: 0 }), ev("PhaseCompleted", { phase: "play" })]);
    expect(availableMoves(p, after).map((m) => m.id)).toEqual(["itLanded", "itMissed"]);
  });

  it("closes the unit: the rest of the flow is recorded done and nothing is left to press", () => {
    const p = pack();
    const log = [...opened(p), ev("StepCompleted", { phase: "play", step: 0 }), ev("PhaseCompleted", { phase: "play" })];
    const state = reduce(p, log);
    expect(nextStep(p, state)?.step.kind).toBe("finalizeUnit");
    const moved = executeMove(p, state, "itLanded", { answers: {}, now: NOW });
    expect(moved.status).toBe("done");
    const closed = reduce(p, [...log, ...moved.events, ...closeUnitEvents(p, state, NOW)]);
    expect(nextStep(p, closed)).toBeNull();
    expect(closed.subjects[0]?.finalized).toBe(true);
    expect(closed.subjects[0]?.states).toEqual(["landed"]);
    expect(closed.counters["landed"]).toBe(1);
  });
});

describe("states that exclude one another", () => {
  it("applying one of a group takes the others off the same subject, and leaves the rest", () => {
    const p = pack();
    const state = reduce(p, [
      ...opened(p),
      ev("StateApplied", { state: "starred", subject: 1 }),
      ev("StateApplied", { state: "landed", subject: 1 }),
      ev("StateApplied", { state: "missed", subject: 1 }),
    ]);
    expect(state.subjects[0]?.states).toEqual(["starred", "missed"]);
  });

  it("a correction from the board reads as ordinary state events after a marker", () => {
    const p = pack();
    const state = reduce(p, [
      ...opened(p),
      ev("StateApplied", { state: "missed", subject: 1 }),
      ev("Corrected", { note: "marked #1 Landed" }),
      ev("StateApplied", { state: "landed", subject: 1 }),
    ]);
    expect(state.subjects[0]?.states).toEqual(["landed"]);
  });
});

describe("ticks in the log", () => {
  it("are kept per unit and cleared when the next begins", () => {
    const p = pack();
    const ticked = reduce(p, [...opened(p), ev("Checked", { step: "play#0", item: "0:o0", on: true })]);
    expect(ticked.checks).toEqual(["play#0|0:o0"]);
    const unticked = reduce(p, [...opened(p), ev("Checked", { step: "play#0", item: "0:o0", on: true }), ev("Checked", { step: "play#0", item: "0:o0", on: false })]);
    expect(unticked.checks).toEqual([]);
    const next = reduce(p, [...opened(p), ev("Checked", { step: "play#0", item: "0:o0", on: true }), ev("UnitFinalized"), ev("UnitEntered")]);
    expect(next.checks).toEqual([]);
  });
});

describe("a draw whose count is rolled", () => {
  it("rolls on the table as many times as the earlier roll said", () => {
    const p = pack();
    const state = reduce(p, opened(p));
    const result = executeActions(
      p,
      state,
      [
        { do: "roll", dice: "d4", into: "count" },
        { do: "rollOn", table: "trick", timesFrom: "count" },
      ],
      { answers: {}, now: NOW, random: () => 0.99 },
    );
    expect(result.status).toBe("done");
    const outcomes = result.events.filter((e) => e.t === "OutcomeResolved");
    // 0.99 on a d4 is a 4: four draws.
    expect(outcomes).toHaveLength(4);
  });
});
