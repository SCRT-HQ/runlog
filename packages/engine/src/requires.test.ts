import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { executeActions, executeTableRoll } from "./execute.ts";
import type { RunEvent } from "./events.ts";

/**
 * The two reasons the dice are thrown again.
 *
 * A run says what it lacks, and a result that needs a lacked thing is
 * drawn again. And a result can say what must be true of the run for it
 * to mean anything: "back to where the last block started" has no
 * referent on the first block, and is not a result anybody can act on.
 */

const YAML = `
schemaVersion: 1
id: dev.runlog.test-gear
version: "0.0.1"
title: Gear
license: { id: CC0-1.0, redistributable: true }
capabilities: [deferredTriggers]
vocabulary:
  run: { one: Session, many: Sessions }
  unit: { one: Block, many: Blocks }
  subject: { one: Movement, many: Movements }
  finalize: Log
unit: { createsSubject: true, min: 1, max: 5 }
requires:
  - { id: barbell, label: A barbell, kind: equipment, optional: true }
  - { id: floor, label: A floor, kind: space }
tables:
  movement:
    resolution: lookup
    title: Movement
    roll: d4
    entries:
      - { id: squat, range: [1, 1], text: "Squat.", needs: [barbell] }
      - { id: press, range: [2, 2], text: "Press.", needs: [barbell] }
      - { id: pushup, range: [3, 3], text: "Push-up." }
      - { id: plank, range: [4, 4], text: "Plank." }
  place:
    resolution: lookup
    title: Place
    roll: d4
    entries:
      - { id: back, range: [1, 1], text: "Back to where the last block started.", requires: [{ unitIndex: { gte: 2 } }] }
      - { id: deeper, range: [2, 2], text: "Deeper than the last one went.", requires: [{ unitIndex: { gte: 2 } }] }
      - { id: here, range: [3, 3], text: "Wherever you are." }
      - { id: away, range: [4, 4], text: "Somewhere else." }
phases:
  - id: draw
    label: Draw
    steps:
      - kind: rollTable
        table: movement
      - kind: finalizeUnit
endings:
  - { id: done, label: Done }
modes:
  standard: { label: Standard }
defaultMode: standard
`;

function pack(): Pack {
  const r = loadPackText(YAML, "yaml");
  if (!r.ok) throw new Error(`the test pack does not load: ${JSON.stringify(r.diagnostics)}`);
  return r.pack;
}

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent => ({ t, at: NOW, ...props }) as RunEvent;
const opened = (p: Pack, lacks: string[]): RunEvent[] => [
  ev("RunStarted", { packId: p.id, packVersion: p.version, mode: "standard", ...(lacks.length ? { lacks } : {}) }),
  ev("UnitEntered"),
];

/** Dice that land on the given faces in order, then repeat the last. */
const faces = (...values: number[]) => {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)]!;
    i += 1;
    return (v - 0.5) / 4;
  };
};

describe("a run that lacks something", () => {
  it("remembers what it said it lacks", () => {
    const p = pack();
    expect(reduce(p, opened(p, ["barbell"])).lacks).toEqual(["barbell"]);
    expect(reduce(p, opened(p, [])).lacks).toEqual([]);
  });

  it("draws again past results that need it, and keeps the one it can do", () => {
    const p = pack();
    const state = reduce(p, opened(p, ["barbell"]));
    const result = executeTableRoll(p, state, "movement", { answers: {}, now: NOW, random: faces(1, 2, 3) });
    expect(result.status).toBe("done");
    const rolls = result.events.filter((e) => e.t === "Rolled");
    expect(rolls).toHaveLength(3);
    const outcome = result.events.find((e) => e.t === "OutcomeResolved");
    expect(outcome && outcome.t === "OutcomeResolved" ? outcome.entryId : null).toBe("pushup");
  });

  it("lands on the barbell result as usual when nothing is lacked", () => {
    const p = pack();
    const state = reduce(p, opened(p, []));
    const result = executeTableRoll(p, state, "movement", { answers: {}, now: NOW, random: faces(1) });
    const outcome = result.events.find((e) => e.t === "OutcomeResolved");
    expect(outcome && outcome.t === "OutcomeResolved" ? outcome.entryId : null).toBe("squat");
    expect(result.events.filter((e) => e.t === "Rolled")).toHaveLength(1);
  });

  it("applies to draws made by actions too", () => {
    const p = pack();
    const state = reduce(p, opened(p, ["barbell"]));
    const result = executeActions(p, state, [{ do: "rollOn", table: "movement", times: 2 }], {
      answers: {},
      now: NOW,
      random: faces(2, 4, 1, 1, 3),
    });
    const ids = result.events.filter((e) => e.t === "OutcomeResolved").map((e) => (e.t === "OutcomeResolved" ? e.entryId : ""));
    expect(ids).toEqual(["plank", "pushup"]);
  });
});

describe("a result that has nothing to refer to yet", () => {
  const first = (p: Pack) => reduce(p, opened(p, []));
  const second = (p: Pack) => reduce(p, [...opened(p, []), ev("UnitFinalized"), ev("UnitEntered")]);

  it("is drawn past on the first unit, and the one that lands is one that means something", () => {
    const p = pack();
    const result = executeTableRoll(p, first(p), "place", { answers: {}, now: NOW, random: faces(1, 2, 3) });
    expect(result.status).toBe("done");
    // Both backward-looking results came up and both were thrown again.
    expect(result.events.filter((e) => e.t === "Rolled")).toHaveLength(3);
    const outcome = result.events.find((e) => e.t === "OutcomeResolved");
    expect(outcome && outcome.t === "OutcomeResolved" ? outcome.entryId : null).toBe("here");
  });

  it("is drawn like any other once there is a unit behind it", () => {
    const p = pack();
    const state = second(p);
    expect(state.unit).toBe(2);
    const result = executeTableRoll(p, state, "place", { answers: {}, now: NOW, random: faces(1) });
    const outcome = result.events.find((e) => e.t === "OutcomeResolved");
    expect(outcome && outcome.t === "OutcomeResolved" ? outcome.entryId : null).toBe("back");
    expect(result.events.filter((e) => e.t === "Rolled")).toHaveLength(1);
  });

  it("does not throw again for a result that merely has no conditions", () => {
    const p = pack();
    const result = executeTableRoll(p, first(p), "place", { answers: {}, now: NOW, random: faces(4) });
    const outcome = result.events.find((e) => e.t === "OutcomeResolved");
    expect(outcome && outcome.t === "OutcomeResolved" ? outcome.entryId : null).toBe("away");
    expect(result.events.filter((e) => e.t === "Rolled")).toHaveLength(1);
  });

  it("gives up rather than rolling for ever, and says so in the log", () => {
    const p = pack();
    // Dice that land on a backward-looking result every single time.
    const result = executeTableRoll(p, first(p), "place", { answers: {}, now: NOW, random: faces(1) });
    expect(result.status).toBe("done");
    expect(result.events.filter((e) => e.t === "Rolled").length).toBeLessThanOrEqual(9);
    // The last one counts, even where the last one is the one it could
    // not get away from: a draw that never resolves is worse.
    const outcome = result.events.find((e) => e.t === "OutcomeResolved");
    expect(outcome && outcome.t === "OutcomeResolved" ? outcome.entryId : null).toBe("back");
  });
});
