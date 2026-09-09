import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { compareScores, formatScore, scoreOf, type RunScore } from "./score.ts";
import type { RunEvent } from "./events.ts";
import type { RunState } from "./types.ts";

/**
 * Scoring: a pure read of a run against whatever the pack (or its mode) said
 * counts, so a solo run has a number to beat next time. No score declared is
 * not "no score", it is the same units-closed, tiebreak-time ranking a race
 * already uses, so nothing that plays today loses a number to beat tomorrow.
 */

const NO_SCORE_YAML = `
schemaVersion: 1
id: dev.runlog.test-score-fallback
version: "0.0.1"
title: Unscored
license: { id: CC0-1.0, redistributable: true }
capabilities: []
vocabulary:
  run: { one: Session, many: Sessions }
  unit: { one: Round, many: Rounds }
  subject: { one: Try, many: Tries }
  finalize: Close
unit: { min: 1, max: 10 }
tables: {}
phases:
  - id: go
    label: Go
    steps:
      - kind: finalizeUnit
endings:
  - { id: done, label: Done }
modes:
  standard: { label: Standard }
defaultMode: standard
`;

const SCORED_YAML = `
schemaVersion: 1
id: dev.runlog.test-score
version: "0.0.1"
title: Scored
license: { id: CC0-1.0, redistributable: true }
capabilities: [counters, resources, timers]
vocabulary:
  run: { one: Session, many: Sessions }
  unit: { one: Round, many: Rounds }
  subject: { one: Try, many: Tries }
  finalize: Close
unit: { min: 1, max: 10 }
tables: {}
counters:
  cleanBlocks:
    label: Clean Blocks
    initial: 0
    incrementOn:
      - { on: unitFinalized }
resources:
  words:
    label: Words
    initial: 0
    min: 0
phases:
  - id: go
    label: Go
    steps:
      - kind: finalizeUnit
endings:
  - { id: done, label: Done }
score: { counter: cleanBlocks, tiebreak: time }
modes:
  standard: { label: Standard }
  golf: { label: Golf, score: { counter: cleanBlocks, better: lower } }
  byWords: { label: By Words, score: { resource: words } }
  byUnits: { label: By Units, score: { units: true } }
  timed: { label: Timed, score: { time: true }, clock: { kind: stopwatch } }
defaultMode: standard
`;

function load(yaml: string): Pack {
  const r = loadPackText(yaml, "yaml");
  if (!r.ok) throw new Error(`the test pack does not load: ${JSON.stringify(r.diagnostics)}`);
  return r.pack;
}

const at = "2026-01-01T00:00:00.000Z";
const T0 = Date.parse(at);

/** A run state built by hand rather than reduced, so a test controls exactly the values scoreOf reads. */
const state = (over: Partial<RunState> = {}): RunState =>
  ({
    mode: "standard",
    status: "active",
    startedAt: at,
    updatedAt: at,
    unit: 1,
    counters: {},
    resources: {},
    clocks: [],
    ending: null,
    ...over,
  }) as RunState;

const ev = (t: RunEvent["t"], extra: Record<string, unknown> = {}): RunEvent => ({ t, at, ...extra }) as RunEvent;

describe("scoreOf", () => {
  it("falls back to units closed, tiebreak time, when nothing declares a score", () => {
    const p = load(NO_SCORE_YAML);
    const events = [ev("RunStarted"), ev("UnitEntered"), ev("UnitFinalized"), ev("UnitEntered")];
    const s = scoreOf(p, state({ unit: 2 }), events, T0 + 90_000);
    expect(s).toEqual({
      key: "units",
      value: 1,
      better: "higher",
      label: "Rounds closed",
      tiebreak: { key: "time", value: 90_000, better: "lower" },
    });
  });

  it("reads a counter key, honoring an explicit better: lower", () => {
    const p = load(SCORED_YAML);
    const s = scoreOf(p, state({ mode: "golf", counters: { cleanBlocks: 3 } }), [], T0);
    expect(s).toMatchObject({ key: "counter", value: 3, better: "lower", label: "Clean Blocks" });
    // golf's own score does not set a tiebreak, and a mode's score is not
    // merged with the pack's, so none is carried over from it either.
    expect(s.tiebreak).toBeUndefined();
  });

  it("reads a resource key, defaulting the label to the resource's own", () => {
    const p = load(SCORED_YAML);
    const s = scoreOf(p, state({ mode: "byWords", resources: { words: 1240 } }), [], T0);
    expect(s).toMatchObject({ key: "resource", value: 1240, better: "higher", label: "Words" });
  });

  it("reads units and time keys explicitly, without inventing a tiebreak neither one asked for", () => {
    const p = load(SCORED_YAML);
    const events = [ev("RunStarted"), ev("UnitEntered"), ev("UnitFinalized")];
    const units = scoreOf(p, state({ mode: "byUnits" }), events, T0 + 1_000);
    expect(units).toEqual({ key: "units", value: 1, better: "higher", label: "Rounds closed" });

    const timed = scoreOf(p, state({ mode: "timed" }), [], T0 + 65_000);
    expect(timed).toEqual({ key: "time", value: 65_000, better: "lower", label: "Time" });
  });

  it("lets a mode's own score override the pack's, rather than merging with it", () => {
    const p = load(SCORED_YAML);
    // standard does not override: falls through to the pack's own score.
    const std = scoreOf(p, state({ mode: "standard", counters: { cleanBlocks: 5 } }), [], T0);
    expect(std).toMatchObject({ key: "counter", value: 5, better: "higher" });
    expect(std.tiebreak).toMatchObject({ key: "time" });
    // golf replaces it outright: same counter, opposite direction, no tiebreak.
    const golf = scoreOf(p, state({ mode: "golf", counters: { cleanBlocks: 5 } }), [], T0);
    expect(golf).toMatchObject({ key: "counter", value: 5, better: "lower" });
    expect(golf.tiebreak).toBeUndefined();
  });
});

describe("compareScores", () => {
  const s = (over: Partial<RunScore>): RunScore => ({ key: "counter", value: 0, better: "higher", label: "X", ...over });

  it("puts the higher value first when higher is better, and the lower first when lower is", () => {
    expect(compareScores(s({ value: 5 }), s({ value: 3 }))).toBeLessThan(0);
    expect(compareScores(s({ value: 3 }), s({ value: 5 }))).toBeGreaterThan(0);
    expect(compareScores(s({ value: 3, better: "lower" }), s({ value: 5, better: "lower" }))).toBeLessThan(0);
  });

  it("calls it even on the primary key, with no tiebreak carried", () => {
    expect(compareScores(s({ value: 4 }), s({ value: 4 }))).toBe(0);
  });

  it("breaks a tie on the primary key using the tiebreak", () => {
    const withTime = (v: number) => s({ value: 10, tiebreak: { key: "time", value: v, better: "lower" } });
    expect(compareScores(withTime(1_000), withTime(2_000))).toBeLessThan(0);
    expect(compareScores(withTime(1_000), withTime(1_000))).toBe(0);
  });
});

describe("formatScore", () => {
  const p = load(SCORED_YAML);

  it("formats a counter as a bare number", () => {
    expect(formatScore({ key: "counter", value: 4, better: "higher", label: "Clean Blocks" }, p)).toBe("4");
  });

  it("formats a resource with its own label as the unit, thousands separated", () => {
    expect(formatScore({ key: "resource", value: 1240, better: "higher", label: "Words" }, p)).toBe("1,240 words");
  });

  it("formats the units fallback with the pack's own plural", () => {
    expect(formatScore({ key: "units", value: 4, better: "higher", label: "Rounds closed" }, p)).toBe("4 rounds");
  });

  it("formats time as a clock face", () => {
    expect(formatScore({ key: "time", value: 754_000, better: "lower", label: "Time" }, p)).toBe("12:34");
  });
});
