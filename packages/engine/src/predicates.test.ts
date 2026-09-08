import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { testPredicates } from "./execute.ts";
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

/** A run sitting in unit `n`. */
const atUnit = (n: number) => {
  const log: RunEvent[] = [
    ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
  ];
  for (let i = 1; i < n; i++) log.push(ev("UnitEntered"), ev("UnitFinalized"));
  if (n > 0) log.push(ev("UnitEntered"));
  return reduce(kiln, log);
};

const ctx = { answers: {}, now: NOW };

describe("combining predicates", () => {
  /**
   * The empty case is the whole reason this is tested separately.
   *
   * "All of nothing" is vacuously true, and reading an absent `skipWhen` that
   * way skipped every phase in the game — the flow simply never started. It is
   * the kind of bug that passes every unit test written about the predicates
   * themselves, because none of them thinks to pass an empty list.
   */
  describe("nothing to combine", () => {
    it("treats all-of-nothing as true", () => {
      const r = testPredicates(kiln, atUnit(1), undefined, ctx, "all");
      expect(r).toEqual({ status: "done", value: true });
    });

    it("treats any-of-nothing as false", () => {
      const r = testPredicates(kiln, atUnit(1), undefined, ctx, "any");
      expect(r).toEqual({ status: "done", value: false });
    });

    it("says the same for an empty list as for an absent one", () => {
      expect(testPredicates(kiln, atUnit(1), [], ctx, "any")).toEqual(
        testPredicates(kiln, atUnit(1), undefined, ctx, "any"),
      );
    });
  });

  describe("several reasons to skip", () => {
    // How the demo pack writes it: skip the check on the first unit, or once
    // the Kiln has gone cold. Either alone is sufficient.
    const skipWhen = kiln.phases.find((p) => p.id === "check")!.skipWhen!;

    it("skips on the first unit, when only that reason applies", () => {
      const r = testPredicates(kiln, atUnit(1), skipWhen, ctx, "any");
      expect(r).toEqual({ status: "done", value: true });
    });

    it("does not skip later, when no reason applies", () => {
      const r = testPredicates(kiln, atUnit(3), skipWhen, ctx, "any");
      expect(r).toEqual({ status: "done", value: false });
    });

    it("skips once the run-wide state applies, whatever the unit", () => {
      const cold = reduce(kiln, [
        ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
        ev("UnitEntered"),
        ev("UnitFinalized"),
        ev("UnitEntered"),
        ev("StateApplied", { state: "coldKiln" }),
      ]);
      expect(testPredicates(kiln, cold, skipWhen, ctx, "any")).toEqual({
        status: "done",
        value: true,
      });
    });

    it("would demand both reasons at once under all-semantics", () => {
      // Guards the distinction itself: if `any` and `all` ever agreed here,
      // the combiner is not being applied.
      expect(testPredicates(kiln, atUnit(1), skipWhen, ctx, "all")).toEqual({
        status: "done",
        value: false,
      });
    });
  });

  it("stops and asks when a clause needs the player's judgment", () => {
    const r = testPredicates(kiln, atUnit(2), [{ ask: "Is it dry yet?" }], ctx, "any");
    expect(r.status).toBe("awaiting");
  });
});

describe("bounds that compare against run state", () => {
  /**
   * A rule like "roll a d6 against the number of consequences you have
   * suffered" cannot be written with literals: the threshold is whatever the
   * run has accumulated. Transcribing a real rulebook is what surfaced this.
   */
  const withTally = (n: number) => {
    const log: RunEvent[] = [
      ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
      ev("UnitEntered"),
    ];
    for (let i = 0; i < n; i++) {
      log.push(ev("CounterChanged", { counter: "setbacksSuffered", by: 1 }));
    }
    return reduce(kiln, log);
  };

  it("passes when the value is at or under the counter", () => {
    const state = withTally(4);
    const r = testPredicates(
      kiln,
      state,
      [{ counter: "setbacksSuffered", is: { lteCounter: "setbacksSuffered" } }],
      ctx,
      "all",
    );
    expect(r).toEqual({ status: "done", value: true });
  });

  it("fails when the value is over the counter", () => {
    // unitIndex is 1; the tally is 0, so 1 is over it.
    const r = testPredicates(
      kiln,
      withTally(0),
      [{ unitIndex: { lteCounter: "setbacksSuffered" } }],
      ctx,
      "all",
    );
    expect(r).toEqual({ status: "done", value: false });
  });

  it("moves with the counter rather than being fixed at authoring time", () => {
    const bound = [{ unitIndex: { lteCounter: "setbacksSuffered" } }];
    expect(testPredicates(kiln, withTally(0), bound, ctx, "all")).toMatchObject({ value: false });
    expect(testPredicates(kiln, withTally(3), bound, ctx, "all")).toMatchObject({ value: true });
  });

  it("treats a missing counter as zero rather than throwing", () => {
    const r = testPredicates(
      kiln,
      withTally(0),
      [{ unitIndex: { gteCounter: "setbacksSuffered" } }],
      ctx,
      "all",
    );
    expect(r).toEqual({ status: "done", value: true });
  });
});

describe("reading a clock", () => {
  /**
   * `clockRan` and `clockRanOver` read live off the clock's own timestamps,
   * not a stored total, so a rule like "roll if the Block runs over by two
   * minutes" holds true the moment it becomes true rather than only once
   * someone stops the clock.
   */
  const CLOCK_YAML = `
schemaVersion: 1
id: dev.runlog.test-clock-predicates
version: "0.0.1"
title: Clocked Predicates
license: { id: CC0-1.0, redistributable: true }
capabilities: [timers, clockRules]
vocabulary:
  run: { one: Session, many: Sessions }
  unit: { one: Block, many: Blocks }
  subject: { one: Try, many: Tries }
  finalize: Close
unit:
  createsSubject: true
  min: 1
  max: 5
  clock: { kind: timer, minutes: 10, label: The Block }
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

  function clockPack(): Pack {
    const r = loadPackText(CLOCK_YAML, "yaml");
    if (!r.ok) throw new Error(`the test pack does not load: ${JSON.stringify(r.diagnostics)}`);
    return r.pack;
  }

  const T0 = Date.parse("2026-01-01T10:00:00.000Z");
  const at = (plusMs: number) => new Date(T0 + plusMs).toISOString();
  const evAt = (t: RunEvent["t"], when: number, props: Record<string, unknown> = {}): RunEvent =>
    ({ t, at: at(when), ...props }) as RunEvent;

  /**
   * `reduce` is a pure fold; it does not invent the unit's clock the way the
   * app does when it commits `UnitEntered`. Every fixture here starts it by
   * hand, the same event the app would have written alongside.
   */
  const opened = (p: Pack): RunEvent[] => [
    evAt("RunStarted", 0, { packId: p.id, packVersion: p.version, mode: "standard" }),
    evAt("UnitEntered", 0),
    evAt("ClockStarted", 0, { clock: "u1:unit", kind: "timer", label: "The Block", seconds: 600 }),
  ];

  it("reads the unit's own clock live while it is still running", () => {
    const p = clockPack();
    const state = reduce(p, opened(p));
    // The unit's clock starts at 0; three minutes on, it has run three.
    const threeIn = { answers: {}, now: at(3 * 60_000) };
    expect(testPredicates(p, state, [{ clockRan: "unit", is: { gte: 3 } }], threeIn, "all")).toEqual({
      status: "done",
      value: true,
    });
    expect(testPredicates(p, state, [{ clockRan: "unit", is: { gte: 4 } }], threeIn, "all")).toEqual({
      status: "done",
      value: false,
    });
  });

  it("matches the unit's own clock by its label too, and finds the same clock either way", () => {
    const p = clockPack();
    const state = reduce(p, opened(p));
    const twoIn = { answers: {}, now: at(2 * 60_000) };
    expect(testPredicates(p, state, [{ clockRan: "The Block", is: { gte: 2 } }], twoIn, "all")).toEqual(
      testPredicates(p, state, [{ clockRan: "unit", is: { gte: 2 } }], twoIn, "all"),
    );
  });

  it("keeps a stopped clock's final reading rather than the live one", () => {
    const p = clockPack();
    const state = reduce(p, [
      ...opened(p),
      evAt("ClockStopped", 5 * 60_000, { clock: "u1:unit", elapsedMs: 5 * 60_000 }),
    ]);
    // Long after it stopped, the reading is still the moment it was stopped.
    const wayLater = { answers: {}, now: at(60 * 60_000) };
    expect(testPredicates(p, state, [{ clockRan: "unit", is: { gte: 5, lte: 5 } }], wayLater, "all")).toEqual({
      status: "done",
      value: true,
    });
  });

  it("is false for a clock that does not exist in the current unit", () => {
    const p = clockPack();
    const state = reduce(p, opened(p));
    const now = { answers: {}, now: at(60_000) };
    expect(testPredicates(p, state, [{ clockRan: "No Such Clock", is: { gte: 0 } }], now, "all")).toEqual({
      status: "done",
      value: false,
    });
  });

  it("measures how far a timer has run past its length", () => {
    const p = clockPack();
    const state = reduce(p, opened(p));
    // The Block's timer is 10 minutes; at 12 minutes it is 2 over.
    const twelveIn = { answers: {}, now: at(12 * 60_000) };
    expect(
      testPredicates(p, state, [{ clockRanOver: "unit", is: { gte: 2 } }], twelveIn, "all"),
    ).toEqual({ status: "done", value: true });
    expect(
      testPredicates(p, state, [{ clockRanOver: "unit", is: { gte: 3 } }], twelveIn, "all"),
    ).toEqual({ status: "done", value: false });
  });

  it("never runs over for a stopwatch, which has no length to exceed", () => {
    const p = clockPack();
    const state = reduce(p, [
      ...opened(p),
      evAt("ClockStarted", 0, { clock: "extra", kind: "stopwatch", label: "Extra" }),
    ]);
    const anHourIn = { answers: {}, now: at(60 * 60_000) };
    expect(
      testPredicates(p, state, [{ clockRanOver: "Extra", is: { gte: 0 } }], anHourIn, "all"),
    ).toEqual({ status: "done", value: false });
  });

  it("finds a clock started mid-unit by its label, alongside the unit's own", () => {
    const p = clockPack();
    const state = reduce(p, [
      ...opened(p),
      evAt("ClockStarted", 60_000, { clock: "extra", kind: "stopwatch", label: "Extra" }),
    ]);
    // The unit's clock has run 4 minutes; the extra stopwatch, started a
    // minute later, has run 3.
    const fourIn = { answers: {}, now: at(4 * 60_000) };
    expect(testPredicates(p, state, [{ clockRan: "unit", is: { eq: 4 } }], fourIn, "all")).toEqual({
      status: "done",
      value: true,
    });
    expect(testPredicates(p, state, [{ clockRan: "Extra", is: { eq: 3 } }], fourIn, "all")).toEqual({
      status: "done",
      value: true,
    });
  });
});
