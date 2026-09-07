import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { pendingTriggers } from "./counters.ts";
import { executeCounterTrigger } from "./execute.ts";
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

/** A run in which `n` checks have passed without a setback. */
function afterQuietChecks(n: number, extra: RunEvent[] = []): RunEvent[] {
  const log: RunEvent[] = [start, ev("UnitEntered")];
  for (let i = 0; i < n; i++) log.push(ev("PhaseCompleted", { phase: "check" }));
  return [...log, ...extra];
}

describe("counter thresholds", () => {
  /**
   * The Kiln overheats after five calm Stages. Before this existed the counter
   * counted correctly and then nothing whatsoever happened, which is the worst
   * kind of bug: the number on screen was right, so it looked like it worked.
   */
  it("stays quiet below the threshold", () => {
    const state = reduce(kiln, afterQuietChecks(4));
    expect(state.counters.calm).toBe(4);
    expect(pendingTriggers(kiln, state)).toEqual([]);
  });

  it("comes due once the threshold is reached", () => {
    const state = reduce(kiln, afterQuietChecks(5));
    const due = pendingTriggers(kiln, state);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ counter: "calm", label: "The Kiln overheats", value: 5 });
  });

  it("stays due while the threshold still holds", () => {
    const state = reduce(kiln, afterQuietChecks(7));
    expect(pendingTriggers(kiln, state)).toHaveLength(1);
  });

  it("stops coming due once it has fired", () => {
    // A once-per-run trigger whose condition stays true would otherwise trip
    // on every single read.
    const fired = pendingTriggers(kiln, reduce(kiln, afterQuietChecks(5)))[0]!;
    const state = reduce(kiln, afterQuietChecks(7, [ev("TriggerFired", { key: fired.key })]));
    expect(state.counters.calm).toBe(7);
    expect(pendingTriggers(kiln, state)).toEqual([]);
  });

  it("does not come due again in a later unit, being once per run", () => {
    const fired = pendingTriggers(kiln, reduce(kiln, afterQuietChecks(5)))[0]!;
    const state = reduce(kiln, [
      ...afterQuietChecks(6, [ev("TriggerFired", { key: fired.key })]),
      ev("UnitFinalized"),
      ev("UnitEntered"),
      ev("PhaseCompleted", { phase: "check" }),
    ]);
    expect(pendingTriggers(kiln, state)).toEqual([]);
  });

  it("runs the trigger's actions and records that it fired", () => {
    const state = reduce(kiln, afterQuietChecks(5));
    const due = pendingTriggers(kiln, state)[0]!;
    // The overheat rolls on the strain table, which is a 2d6 bands roll.
    const result = executeCounterTrigger(kiln, state, due.counter, due.index, due.key, {
      answers: {},
      now: NOW,
    });
    expect(result.status).toBe("awaiting");
    expect(result.request).toMatchObject({ kind: "roll", dice: "2d6" });

    // Answer whatever it asks rather than guessing the key, which is an
    // internal detail of how the action tree is walked.
    const answers: Record<string, number> = {};
    let done = executeCounterTrigger(kiln, state, due.counter, due.index, due.key, {
      answers,
      now: NOW,
    });
    for (let guard = 0; guard < 5 && done.status === "awaiting"; guard++) {
      answers[done.request!.key] = 11;
      done = executeCounterTrigger(kiln, state, due.counter, due.index, due.key, {
        answers,
        now: NOW,
      });
    }
    expect(done.status).toBe("done");
    expect(done.events).toContainEqual(
      expect.objectContaining({ t: "OutcomeResolved", table: "strain" }),
    );
    expect(done.events.at(-1)).toMatchObject({ t: "TriggerFired", key: due.key });
  });

  it("is settled by the log, so replaying does not fire it twice", () => {
    const state = reduce(kiln, afterQuietChecks(5));
    const due = pendingTriggers(kiln, state)[0]!;
    const after = reduce(kiln, [...afterQuietChecks(5), ev("TriggerFired", { key: due.key })]);
    expect(pendingTriggers(kiln, after)).toEqual([]);
  });
});
