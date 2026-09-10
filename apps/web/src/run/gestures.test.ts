import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { reduce, type RunEvent, type RunState } from "@runlog/engine";
import { lifecycleGestures, marksOf } from "./gestures.ts";

/**
 * The gestures exist for a listener that never sees the pack: a ticker on
 * a stream, a sound in an automation tool. So these tests check that what
 * travels is words and counts a stranger can use, and that nothing travels
 * for a move that unmade something.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const r = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!r.ok) throw new Error("could not load the demo pack");
const kiln = r.pack;

const opening: RunEvent[] = [
  { t: "RunStarted", at: "2026-01-01T00:00:00Z", id: "e1", runId: "r1", packId: kiln.id, packVersion: kiln.version, mode: "standard", players: 1 } as unknown as RunEvent,
  { t: "UnitEntered", at: "2026-01-01T00:00:01Z", id: "e2" } as unknown as RunEvent,
];
const NOW = Date.parse("2026-01-01T00:10:00Z");

describe("lifecycle gestures", () => {
  it("say nothing the first time, and nothing when nothing happened", () => {
    const state = reduce(kiln, opening);
    const before = marksOf(state, opening, NOW);
    expect(lifecycleGestures(kiln, state, opening, before, NOW)).toEqual([]);
  });

  it("tell a result in the pack's words, numbered like the snapshot's log, with the subject it hit by name", () => {
    const base = reduce(kiln, opening);
    const before = marksOf(base, opening, NOW);
    const entry = kiln.tables.form!.entries[0]!;
    const state: RunState = {
      ...base,
      subjects: [{ id: 1, name: "The tall one", type: "vase", states: [], unit: 1, finalized: false } as unknown as RunState["subjects"][number]],
      outcomes: [{ unit: 1, table: "form", entryId: entry.id, targetSubject: 1, at: "2026-01-01T00:00:02Z" } as RunState["outcomes"][number]],
    };
    const told = lifecycleGestures(kiln, state, opening, before, NOW);
    expect(told).toHaveLength(1);
    expect(told[0]).toEqual({
      kind: "outcome",
      data: { n: 1, unit: 1, table: kiln.tables.form!.title, text: entry.title ?? entry.text, subject: "The tall one" },
    });
    // The next reading starts from here: the same result is not told twice.
    expect(lifecycleGestures(kiln, state, opening, marksOf(state, opening, NOW), NOW)).toEqual([]);
  });

  it("say nothing for an undo: a count that went down is not news", () => {
    const base = reduce(kiln, opening);
    const entry = kiln.tables.form!.entries[0]!;
    const withOne: RunState = { ...base, outcomes: [{ unit: 1, table: "form", entryId: entry.id, targetSubject: null, at: "2026-01-01T00:00:02Z" } as RunState["outcomes"][number]] };
    const before = marksOf(withOne, opening, NOW);
    expect(lifecycleGestures(kiln, base, opening, before, NOW)).toEqual([]);
  });

  it("tell a unit closing with the count so far, and the run ending with its ending, in that order", () => {
    const base = reduce(kiln, opening);
    const before = marksOf(base, opening, NOW);
    const closed: RunEvent[] = [
      ...opening,
      { t: "UnitFinalized", at: "2026-01-01T00:05:00Z", id: "e3" } as unknown as RunEvent,
      { t: "RunEnded", at: "2026-01-01T00:05:01Z", id: "e4", ending: "Cooled" } as unknown as RunEvent,
    ];
    const state = reduce(kiln, closed);
    const told = lifecycleGestures(kiln, state, closed, before, NOW);
    expect(told.map((g) => g.kind)).toEqual(["unit-closed", "run-ended"]);
    expect(told[0]!.data).toEqual({ unit: 1, unitsDone: 1 });
    expect(told[1]!.data).toEqual({ ending: "Cooled", unitsDone: 1 });
  });

  it("tell a clock starting, pausing, resuming and stopping, once each", () => {
    const base = reduce(kiln, opening);
    const clock = (status: "running" | "paused" | "done", expired = false) =>
      ({ id: "u1:unit", kind: "timer", label: "Day 1", seconds: 600, unit: 1, status, startedAt: "2026-01-01T00:00:01Z", runningSince: status === "running" ? "2026-01-01T00:00:01Z" : null, elapsedMs: 0, expired }) as unknown as RunState["clocks"][number];
    const at = (...clocks: RunState["clocks"]) => ({ ...base, clocks }) as RunState;
    const said = (from: RunState, to: RunState) => lifecycleGestures(kiln, to, opening, marksOf(from, opening, NOW), NOW).map((g) => g.data);
    expect(said(base, at(clock("running")))).toEqual([{ clock: "u1:unit", label: "Day 1", kind: "timer", status: "started" }]);
    expect(said(at(clock("running")), at(clock("paused")))).toEqual([{ clock: "u1:unit", label: "Day 1", kind: "timer", status: "paused" }]);
    expect(said(at(clock("paused")), at(clock("running")))).toEqual([{ clock: "u1:unit", label: "Day 1", kind: "timer", status: "resumed" }]);
    expect(said(at(clock("running")), at(clock("done", true)))).toEqual([{ clock: "u1:unit", label: "Day 1", kind: "timer", status: "stopped", expired: true }]);
    // Still running, still paused, still done: nothing to say.
    expect(said(at(clock("running")), at(clock("running")))).toEqual([]);
    expect(said(at(clock("done")), at(clock("done")))).toEqual([]);
  });

  it("tell a tally moving by its label, with where it was, and keep a hidden one to the pack", () => {
    const base = reduce(kiln, opening);
    const before = marksOf(base, opening, NOW);
    const calm = kiln.counters!.calm!;
    const moved: RunState = { ...base, counters: { ...base.counters, calm: 3 } };
    expect(lifecycleGestures(kiln, moved, opening, before, NOW)).toEqual([{ kind: "counter", data: { counter: "calm", label: calm.label, value: 3, was: 0 } }]);
    // Sent back to zero: the fall is told too, since a reset is the news.
    expect(lifecycleGestures(kiln, base, opening, marksOf(moved, opening, NOW), NOW)).toEqual([{ kind: "counter", data: { counter: "calm", label: calm.label, value: 0, was: 3 } }]);
    const shy = { ...kiln, counters: { ...kiln.counters, calm: { ...calm, hidden: true } } };
    expect(lifecycleGestures(shy, moved, opening, before, NOW)).toEqual([]);
  });

  it("tell an award by the contestant's name and the result's words", () => {
    const base = reduce(kiln, opening);
    const entry = kiln.tables.form!.entries[0]!;
    const state: RunState = {
      ...base,
      contestants: [{ id: "c1", name: "Mira", states: [] }],
      outcomes: [{ unit: 1, table: "form", entryId: entry.id, targetSubject: null, at: "2026-01-01T00:00:02Z" } as RunState["outcomes"][number]],
      awards: [{ contestant: "c1", outcome: 0, table: "form", entryId: entry.id, points: 3, at: "2026-01-01T00:00:03Z" }],
    };
    const before = { ...marksOf(state, opening, NOW), awards: 0 };
    const told = lifecycleGestures(kiln, state, opening, before, NOW);
    expect(told).toEqual([{ kind: "award", data: { n: 1, contestant: "Mira", points: 3, table: kiln.tables.form!.title, text: entry.title ?? entry.text } }]);
  });
});
