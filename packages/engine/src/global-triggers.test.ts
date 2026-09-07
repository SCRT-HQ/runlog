import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { globalTriggerKey, pendingGlobalTriggers } from "./global-triggers.ts";
import { executeGlobalTrigger } from "./execute.ts";
import { createRandom } from "./rng.ts";
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

const start = ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" });

/** A log that has entered `n` units. */
const through = (n: number, extra: RunEvent[] = []): RunEvent[] => [
  start,
  ...Array.from({ length: n }, () => ev("UnitEntered")),
  ...extra,
];

/**
 * Triggers the pack owns outright.
 *
 * These were declared in the schema from the beginning and nothing ever fired
 * them, which meant a pack could write its end-of-run reckoning, validate
 * clean, and simply never see it happen.
 */
describe("pack-level triggers", () => {
  it("does not fire an end-of-run trigger while the run is still going", () => {
    const state = reduce(kiln, through(2));
    expect(pendingGlobalTriggers(kiln, state).map((g) => g.label)).not.toContain("The Cooling");
  });

  it("comes due once the run is over", () => {
    const state = reduce(kiln, through(2, [ev("RunEnded", { ending: "kept" })]));
    const due = pendingGlobalTriggers(kiln, state);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ label: "The Cooling", on: "onRunEnd" });
  });

  it("stops coming due once it has fired", () => {
    const first = pendingGlobalTriggers(
      kiln,
      reduce(kiln, through(2, [ev("RunEnded", { ending: "kept" })])),
    )[0]!;
    const state = reduce(
      kiln,
      through(2, [ev("RunEnded", { ending: "kept" }), ev("TriggerFired", { key: first.key })]),
    );
    expect(pendingGlobalTriggers(kiln, state)).toEqual([]);
  });

  it("honors a `when` clause, so a conditional trigger waits its turn", () => {
    // The Kiln's halfway trigger is bound to Stage four specifically.
    const atThree = reduce(kiln, through(3));
    expect(pendingGlobalTriggers(kiln, atThree)).toEqual([]);

    const atFour = reduce(kiln, through(4));
    expect(pendingGlobalTriggers(kiln, atFour).map((g) => g.label)).toEqual(["Halfway heat"]);
  });

  /**
   * A per-unit trigger is keyed by its unit. Without that, one whose condition
   * stayed true would come due again on every single read.
   */
  it("keys a per-unit trigger by the unit and a run-level one by the run", () => {
    expect(globalTriggerKey(0, "onEnterUnit", 4)).toBe("global:0:u4");
    expect(globalTriggerKey(0, "onEnterUnit", 5)).toBe("global:0:u5");
    expect(globalTriggerKey(0, "onRunEnd", 4)).toBe("global:0");
    expect(globalTriggerKey(0, "onRunEnd", 9)).toBe("global:0");
  });

  it("runs the trigger's actions and records that it fired", () => {
    const state = reduce(kiln, through(2, [ev("RunEnded", { ending: "kept" })]));
    const due = pendingGlobalTriggers(kiln, state)[0]!;
    const result = executeGlobalTrigger(kiln, state, due.index, due.key, {
      answers: {},
      now: NOW,
      random: createRandom("cooling"),
    });

    expect(result.status).toBe("done");
    expect(result.events.some((e) => e.t === "Rolled" && e.purpose === "cooling")).toBe(true);
    expect(result.events.some((e) => e.t === "ObligationAdded")).toBe(true);
    expect(result.events.at(-1)).toMatchObject({ t: "TriggerFired", key: due.key });
  });

  it("asks the player for the roll when no random source is offered", () => {
    // Physical dice remain the default, right through to the last roll of the
    // run: the reckoning is the one people most want to roll themselves.
    const state = reduce(kiln, through(2, [ev("RunEnded", { ending: "kept" })]));
    const due = pendingGlobalTriggers(kiln, state)[0]!;
    const result = executeGlobalTrigger(kiln, state, due.index, due.key, { answers: {}, now: NOW });

    expect(result.status).toBe("awaiting");
    expect(result.request).toMatchObject({ kind: "roll", dice: "d10" });
    // Nothing was recorded, so an abandoned reckoning stays owed.
    expect(result.events).toEqual([]);
  });
});
