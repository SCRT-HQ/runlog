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
