import { describe, expect, it } from "vitest";
import { loadPackText, type Action, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { executeActions } from "./execute.ts";
import type { RunEvent } from "./events.ts";

/**
 * Marks on a contestant, states that lift with the unit, and a setting the
 * moderator chooses once: a counter set from a prompt and read by a draw.
 */

const YAML = `
schemaVersion: 1
id: dev.runlog.test-curses
version: "0.0.1"
title: Curses
license: { id: CC0-1.0, redistributable: true }
capabilities: [deferredTriggers, counters, moderated]
vocabulary:
  run: { one: Trial, many: Trials }
  unit: { one: Region, many: Regions }
  subject: { one: Target, many: Targets }
  finalize: Leave
unit: { createsSubject: true, min: 1, max: 5 }
states:
  rot: { label: Rot, scope: run, group: curse, until: unitEnd }
  frost: { label: Frost, scope: run, group: curse, until: unitEnd }
  spared: { label: Spared, scope: contestant, until: unitEnd }
  banned: { label: Banned, scope: contestant }
counters:
  perMatch: { label: Per match, initial: 0, min: 0, max: 6 }
tables:
  trick:
    resolution: lookup
    title: Trick
    roll: d2
    entries:
      - { id: a, range: [1, 1], text: "A.", points: 1 }
      - { id: b, range: [2, 2], text: "B.", points: 1 }
phases:
  - id: draw
    label: Draw
    steps:
      - kind: finalizeUnit
endings:
  - { id: done, label: Done }
modes:
  trial:
    label: Trial
    moderated: { contestants: { min: 2, max: 4 } }
defaultMode: trial
`;

function pack(): Pack {
  const r = loadPackText(YAML, "yaml");
  if (!r.ok) throw new Error(`the test pack does not load: ${JSON.stringify(r.diagnostics)}`);
  return r.pack;
}

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent => ({ t, at: NOW, ...props }) as RunEvent;
const opened = (p: Pack): RunEvent[] => [
  ev("RunStarted", { packId: p.id, packVersion: p.version, mode: "trial" }),
  ev("ContestantAdded", { contestant: "c1", name: "Ada" }),
  ev("ContestantAdded", { contestant: "c2", name: "Ben" }),
  ev("UnitEntered"),
];

describe("marks on a contestant", () => {
  it("are put on and taken off one person, and exclude within a group", () => {
    const p = pack();
    const state = reduce(p, [
      ...opened(p),
      ev("ContestantStateApplied", { contestant: "c1", state: "spared" }),
      ev("ContestantStateApplied", { contestant: "c1", state: "banned" }),
      ev("ContestantStateApplied", { contestant: "c2", state: "spared" }),
      ev("ContestantStateRemoved", { contestant: "c2", state: "spared" }),
    ]);
    expect(state.contestants.map((c) => c.states)).toEqual([["spared", "banned"], []]);
  });

  it("lift with the unit when the state says so, along with run-wide curses; others stay", () => {
    const p = pack();
    const state = reduce(p, [
      ...opened(p),
      ev("StateApplied", { state: "rot" }),
      ev("ContestantStateApplied", { contestant: "c1", state: "spared" }),
      ev("ContestantStateApplied", { contestant: "c1", state: "banned" }),
      ev("UnitFinalized"),
      ev("UnitEntered"),
    ]);
    expect(state.runStates).toEqual([]);
    expect(state.contestants[0]?.states).toEqual(["banned"]);
  });

  it("one curse replaces another on the run", () => {
    const p = pack();
    const state = reduce(p, [...opened(p), ev("StateApplied", { state: "rot" }), ev("StateApplied", { state: "frost" })]);
    expect(state.runStates).toEqual(["frost"]);
  });
});

describe("a setting chosen once", () => {
  it("a draw in the same step as the prompt that set the count sees the new count", () => {
    const p = pack();
    const state = reduce(p, opened(p));
    const actions: Action[] = [
      { do: "prompt", kind: "chooseValue", label: "How many?", options: ["1", "2", "3"], into: "n" },
      { do: "modCounter", counter: "perMatch", setFrom: "n" },
      { do: "rollOn", table: "trick", timesFrom: "perMatch" },
    ];
    const asked = executeActions(p, state, [...actions], { answers: {}, now: NOW, random: () => 0.1 });
    expect(asked.status).toBe("awaiting");
    const key = asked.status === "awaiting" && asked.request ? asked.request.key : "";
    const done = executeActions(p, state, [...actions], { answers: { [key]: "2" }, now: NOW, random: () => 0.1 });
    expect(done.status).toBe("done");
    expect(done.events.filter((e) => e.t === "OutcomeResolved")).toHaveLength(2);
  });

  it("a prompt's answer sets a counter, and a later draw reads its count from the counter", () => {
    const p = pack();
    const state = reduce(p, opened(p));
    const chosen = executeActions(
      p,
      state,
      [
        { do: "prompt", kind: "chooseValue", label: "How many?", options: ["1", "2", "3"], into: "n" },
        { do: "modCounter", counter: "perMatch", setFrom: "n" },
      ],
      { answers: { "u1:n": "3" }, now: NOW },
    );
    // The prompt's key is the executor's; find whichever answer it wanted.
    const answered = chosen.status === "awaiting" && chosen.request ? executeActions(p, state, [
      { do: "prompt", kind: "chooseValue", label: "How many?", options: ["1", "2", "3"], into: "n" },
      { do: "modCounter", counter: "perMatch", setFrom: "n" },
    ], { answers: { [chosen.request.key]: "3" }, now: NOW }) : chosen;
    expect(answered.status).toBe("done");
    const set = answered.events.find((e) => e.t === "CounterChanged");
    expect(set && set.t === "CounterChanged" ? set.set : null).toBe(3);

    const withCount = reduce(p, [...opened(p), ev("CounterChanged", { counter: "perMatch", set: 3 })]);
    const drawn = executeActions(p, withCount, [{ do: "rollOn", table: "trick", timesFrom: "perMatch" }], { answers: {}, now: NOW, random: () => 0.1 });
    expect(drawn.status).toBe("done");
    expect(drawn.events.filter((e) => e.t === "OutcomeResolved")).toHaveLength(3);
  });
});
