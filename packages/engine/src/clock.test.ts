import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { executeActions } from "./execute.ts";
import { clockOfUnit, deadlineOf, elapsedMs, formatClock, liveClocks, ranOutEvents, remainingMs, stopClocksEvents, unitClockStart } from "./clock.ts";
import type { RunEvent } from "./events.ts";

/**
 * Clocks: four events, and a time computed from their moments. Reload and
 * a second device see the same clock because nothing ticks in the log.
 */

const YAML = `
schemaVersion: 1
id: dev.runlog.test-clock
version: "0.0.1"
title: Clocked
license: { id: CC0-1.0, redistributable: true }
capabilities: [deferredTriggers, timers]
vocabulary:
  run: { one: Session, many: Sessions }
  unit: { one: Round, many: Rounds }
  subject: { one: Try, many: Tries }
  finalize: Close
unit:
  createsSubject: true
  min: 1
  max: 5
  clock: { kind: timer, minutes: 1 }
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
  timed: { label: Timed, clock: { kind: stopwatch, label: The round } }
  free: { label: Free, clock: { kind: timer, minutes: 2, auto: false } }
defaultMode: standard
`;

function pack(): Pack {
  const r = loadPackText(YAML, "yaml");
  if (!r.ok) throw new Error(`the test pack does not load: ${JSON.stringify(r.diagnostics)}`);
  return r.pack;
}

const T0 = Date.parse("2026-01-01T10:00:00.000Z");
const at = (plusMs: number) => new Date(T0 + plusMs).toISOString();
const ev = (t: RunEvent["t"], when: number, props: Record<string, unknown> = {}): RunEvent => ({ t, at: at(when), ...props }) as RunEvent;
const opened = (p: Pack, mode = "standard"): RunEvent[] => [ev("RunStarted", 0, { packId: p.id, packVersion: p.version, mode }), ev("UnitEntered", 0)];

describe("a clock in the log", () => {
  it("runs, pauses, resumes and stops, and its elapsed is the sum of the stretches", () => {
    const p = pack();
    const log = [
      ...opened(p),
      ev("ClockStarted", 0, { clock: "u1:unit", kind: "stopwatch", label: "Round 1" }),
      ev("ClockPaused", 10_000, { clock: "u1:unit" }),
      ev("ClockResumed", 25_000, { clock: "u1:unit" }),
    ];
    const state = reduce(p, log);
    const c = clockOfUnit(state, 1)!;
    expect(c.status).toBe("running");
    expect(elapsedMs(c, T0 + 30_000)).toBe(15_000);
    const stopped = reduce(p, [...log, ev("ClockStopped", 40_000, { clock: "u1:unit", elapsedMs: 25_000 })]);
    expect(clockOfUnit(stopped, 1)?.elapsedMs).toBe(25_000);
    expect(elapsedMs(clockOfUnit(stopped, 1)!, T0 + 99_000)).toBe(25_000);
    expect(liveClocks(stopped)).toHaveLength(0);
  });

  it("a timer knows what is left, and remembers that it ran out", () => {
    const p = pack();
    const state = reduce(p, [...opened(p), ev("ClockStarted", 0, { clock: "t", kind: "timer", label: "Rest", seconds: 60 })]);
    const c = state.clocks[0]!;
    expect(remainingMs(c, T0 + 45_000)).toBe(15_000);
    const out = reduce(p, [...opened(p), ev("ClockStarted", 0, { clock: "t", kind: "timer", label: "Rest", seconds: 60 }), ev("ClockStopped", 60_000, { clock: "t", elapsedMs: 60_000, expired: true })]);
    expect(out.clocks[0]?.expired).toBe(true);
  });

  it("stops every live clock when asked, with the elapsed written in", () => {
    const p = pack();
    const state = reduce(p, [
      ...opened(p),
      ev("ClockStarted", 0, { clock: "a", kind: "stopwatch", label: "A" }),
      ev("ClockStarted", 5_000, { clock: "b", kind: "timer", label: "B", seconds: 90 }),
      ev("ClockPaused", 8_000, { clock: "b" }),
    ]);
    const stops = stopClocksEvents(state, at(20_000));
    expect(stops.map((e) => (e.t === "ClockStopped" ? [e.clock, e.elapsedMs] : null))).toEqual([
      ["a", 20_000],
      ["b", 3_000],
    ]);
  });
});

describe("the unit's clock", () => {
  it("comes from the pack, or the mode, and only starts itself when auto", () => {
    const p = pack();
    const standard = unitClockStart(p, reduce(p, opened(p)), 1, at(0));
    expect(standard).toMatchObject({ t: "ClockStarted", clock: "u1:unit", kind: "timer", seconds: 60, label: "Round 1" });
    const timed = unitClockStart(p, reduce(p, opened(p, "timed")), 2, at(0));
    expect(timed).toMatchObject({ kind: "stopwatch", label: "The round" });
    expect(unitClockStart(p, reduce(p, opened(p, "free")), 1, at(0))).toBeNull();
  });

  it("starts by hand what the pack leaves to the player, and only then", () => {
    const p = pack();
    const state = reduce(p, opened(p, "free"));
    expect(unitClockStart(p, state, 1, at(0))).toBeNull();
    expect(unitClockStart(p, state, 1, at(0), true)).toMatchObject({ t: "ClockStarted", clock: "u1:unit", kind: "timer", seconds: 120 });
  });
});

describe("a timer running out", () => {
  it("is stopped as expired at the moment it ran out, whenever that is noticed", () => {
    const p = pack();
    const s = (n: number) => n * 1000;
    const started = reduce(p, [...opened(p), unitClockStart(p, null, 1, at(0))!]);
    // Sixty seconds long, started at zero: not yet at fifty-nine, up at sixty, and still just once when noticed late.
    expect(ranOutEvents(started, Date.parse(at(s(59))))).toEqual([]);
    expect(deadlineOf(started.clocks[0]!, Date.parse(at(s(30))))).toBe(Date.parse(at(s(60))));
    const late = ranOutEvents(started, Date.parse(at(s(600))));
    expect(late).toEqual([{ t: "ClockStopped", at: at(s(60)), clock: "u1:unit", elapsedMs: 60000, expired: true }]);
    // Paused, it has no deadline; stopped, it is not live and runs out of nothing.
    const paused = reduce(p, [...opened(p), unitClockStart(p, null, 1, at(0))!, { t: "ClockPaused", at: at(s(10)), clock: "u1:unit" }]);
    expect(deadlineOf(paused.clocks[0]!, Date.parse(at(s(10))))).toBeNull();
    expect(ranOutEvents(paused, Date.parse(at(s(600))))).toEqual([]);
    expect(ranOutEvents(reduce(p, [...opened(p), unitClockStart(p, null, 1, at(0))!, ...late]), Date.parse(at(s(900))))).toEqual([]);
  });
});

describe("clock actions", () => {
  it("startTimer and startStopwatch start clocks rather than leaving notes", () => {
    const p = pack();
    const state = reduce(p, opened(p));
    const result = executeActions(p, state, [{ do: "startTimer", minutes: 2, label: "Rest" }, { do: "startStopwatch" }], { answers: {}, now: at(0) });
    const started = result.events.filter((e) => e.t === "ClockStarted");
    expect(started).toHaveLength(2);
    expect(started[0]).toMatchObject({ kind: "timer", seconds: 120, label: "Rest" });
    expect(started[1]).toMatchObject({ kind: "stopwatch", label: "Stopwatch" });
    expect(result.events.some((e) => e.t === "ObligationAdded")).toBe(false);
  });
});

describe("the face", () => {
  it("formats minutes, seconds, hours and tenths", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClock(12_340, true)).toBe("0:12.3");
    expect(formatClock(-5)).toBe("0:00");
  });
});
