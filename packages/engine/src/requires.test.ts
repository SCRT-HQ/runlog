import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { executeActions, executeTableRoll } from "./execute.ts";
import type { RunEvent } from "./events.ts";

/**
 * What a pack needs in the world: a run says what it lacks, and a result
 * that needs a lacked thing is drawn again.
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
    const result = executeActions(p, state, [{ do: "rollOn", table: "movement", times: 2 }], { answers: {}, now: NOW, random: faces(2, 4, 1, 1, 3) });
    const ids = result.events.filter((e) => e.t === "OutcomeResolved").map((e) => (e.t === "OutcomeResolved" ? e.entryId : ""));
    expect(ids).toEqual(["plank", "pushup"]);
  });
});
