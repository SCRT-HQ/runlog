import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce, type RunEvent } from "@runlog/engine";
import type { StoredRun } from "../storage/db.ts";
import { Scores } from "./RunView.tsx";
import type { useRun } from "./useRun.ts";

/**
 * The Scores panel at first paint: what it says about the run that just
 * ended, next to what came before it. Static markup, so nothing here reads
 * storage: the runs it compares are handed in directly.
 */

const YAML = `
schemaVersion: 1
id: dev.runlog.test-scores-panel
version: "0.0.1"
title: Scored
license: { id: CC0-1.0, redistributable: true }
capabilities: [counters]
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
score: { counter: cleanBlocks }
modes:
  standard: { label: Standard }
defaultMode: standard
`;

function load(): Pack {
  const r = loadPackText(YAML, "yaml");
  if (!r.ok) throw new Error(`the test pack does not load: ${JSON.stringify(r.diagnostics)}`);
  return r.pack;
}

const at = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], extra: Record<string, unknown> = {}): RunEvent => ({ t, at, ...extra }) as RunEvent;

/** A run that closes `finalizes` units, each worth one clean block, and ends. */
function logOf(finalizes: number, name?: string): RunEvent[] {
  const events: RunEvent[] = [ev("RunStarted", { packId: "dev.runlog.test-scores-panel", packVersion: "0.0.1", mode: "standard" })];
  if (name) events.push(ev("RunRenamed", { name }));
  for (let i = 0; i < finalizes; i++) events.push(ev("UnitEntered"), ev("UnitFinalized"));
  events.push(ev("RunEnded", { ending: "done" }));
  return events;
}

function storedOf(runId: string, finalizes: number, name: string): StoredRun {
  return {
    runId,
    packId: "dev.runlog.test-scores-panel",
    packVersion: "0.0.1",
    events: logOf(finalizes, name),
    updatedAt: at,
  };
}

/** Two past runs the open run is measured against: 2 clean blocks, and 5. */
const past = [storedOf("past-low", 2, "Low run"), storedOf("past-high", 5, "High run")];

function panel(myFinalizes: number, runList: StoredRun[] = past) {
  const pack = load();
  const events = logOf(myFinalizes);
  const state = reduce(pack, events);
  const run = { runId: "this-run", events, runList } as unknown as ReturnType<typeof useRun>;
  return renderToStaticMarkup(<Scores pack={pack} run={run} state={state} />);
}

describe("the Scores panel", () => {
  it("shows the open run's score as this run, with its place among the rest", () => {
    const html = panel(3);
    expect(html).toContain("Scores");
    expect(html).toContain("this run");
    expect(html).toContain("2nd of 3");
    expect(html).not.toContain("a new best");
  });

  it("says a new best when the open run beats every past run", () => {
    const html = panel(10);
    expect(html).toContain("1st of 3");
    expect(html).toContain("a new best");
  });

  it("lists past runs by place and score, best first", () => {
    const html = panel(3);
    expect(html).toContain("High run");
    expect(html).toContain("Low run");
    expect(html.indexOf("High run")).toBeLessThan(html.indexOf("Low run"));
  });
});
