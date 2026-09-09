import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import type { StoredRun } from "../storage/db.ts";
import { bestOf, placeOf, scoresOf } from "./scores.ts";

/**
 * scoresOf turns the runs a device already has into what a player wants to
 * see: which of them counted, and how they stack up. Every run here goes
 * through the real reducer: a fixture built by hand would not exercise the
 * one thing this helper adds, which is deciding what to do when a log will
 * not reduce at all.
 */

const YAML = `
schemaVersion: 1
id: dev.runlog.test-scores
version: "0.0.1"
title: Scored
license: { id: CC0-1.0, redistributable: true }
capabilities: [counters, timers]
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
defaultMode: standard
`;

function load(): Pack {
  const r = loadPackText(YAML, "yaml");
  if (!r.ok) throw new Error(`the test pack does not load: ${JSON.stringify(r.diagnostics)}`);
  return r.pack;
}

const at = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], extra: Record<string, unknown> = {}): RunEvent => ({ t, at, ...extra }) as RunEvent;

/** `finalizes` units of a mode, each one bumping cleanBlocks by one, then optionally ends the run. */
function runOf(
  runId: string,
  mode: string,
  finalizes: number,
  { ended = true, name }: { ended?: boolean; name?: string } = {},
): StoredRun {
  const events: RunEvent[] = [ev("RunStarted", { packId: "dev.runlog.test-scores", packVersion: "0.0.1", mode })];
  if (name) events.push(ev("RunRenamed", { name }));
  for (let i = 0; i < finalizes; i++) {
    events.push(ev("UnitEntered"), ev("UnitFinalized"));
  }
  if (ended) events.push(ev("RunEnded", { ending: "done" }));
  return {
    runId,
    packId: "dev.runlog.test-scores",
    packVersion: "0.0.1",
    events,
    updatedAt: at,
  };
}

describe("scoresOf", () => {
  it("orders best first even when the pack's key is lower-is-better", () => {
    const pack = load();
    const runs = [runOf("worse", "golf", 3), runOf("best", "golf", 1), runOf("middle", "golf", 2)];
    const scored = scoresOf(pack, runs, Date.now());
    expect(scored.map((s) => s.runId)).toEqual(["best", "middle", "worse"]);
    expect(bestOf(scored)?.runId).toBe("best");
  });

  it("shares a place between runs that tie, the way the scoreboard does", () => {
    const pack = load();
    const runs = [runOf("a", "golf", 2), runOf("b", "golf", 2), runOf("c", "golf", 5)];
    const scored = scoresOf(pack, runs, Date.now());
    expect(placeOf(scored, "a")).toBe(1);
    expect(placeOf(scored, "b")).toBe(1);
    expect(placeOf(scored, "c")).toBe(3);
  });

  it("skips a run that has not ended yet: it has no number to beat", () => {
    const pack = load();
    const runs = [runOf("done", "standard", 2), runOf("live", "standard", 1, { ended: false })];
    const scored = scoresOf(pack, runs, Date.now());
    expect(scored.map((s) => s.runId)).toEqual(["done"]);
    expect(placeOf(scored, "live")).toBeNull();
  });

  it("skips a log the reducer cannot make sense of, rather than showing it wrong", () => {
    const pack = load();
    const broken: StoredRun = {
      runId: "broken",
      packId: "dev.runlog.test-scores",
      packVersion: "0.0.1",
      events: [],
      updatedAt: at,
    };
    const scored = scoresOf(pack, [runOf("done", "standard", 1), broken], Date.now());
    expect(scored.map((s) => s.runId)).toEqual(["done"]);
  });

  it("carries the run's name and text label for a wrap-up line", () => {
    const pack = load();
    const runs = [runOf("named", "standard", 4, { name: "Tuesday night" })];
    const scored = scoresOf(pack, runs, Date.now());
    expect(scored[0]).toMatchObject({ name: "Tuesday night", text: "4" });
  });
});
