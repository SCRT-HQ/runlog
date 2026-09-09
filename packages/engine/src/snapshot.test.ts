import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import type { RunEvent } from "./events.ts";
import { clockNow, isSnapshot, raceOf, snapshotOf } from "./snapshot.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const r = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!r.ok) throw new Error("could not load the demo pack");
const kiln = r.pack;

const events: RunEvent[] = [
  { t: "RunStarted", at: "2026-01-01T00:00:00Z", id: "e1", runId: "r1", packId: kiln.id, packVersion: kiln.version, mode: "standard", seed: null, players: 1 } as unknown as RunEvent,
  { t: "UnitEntered", at: "2026-01-01T00:00:01Z", id: "e2" } as unknown as RunEvent,
];

describe("a live snapshot", () => {
  it("carries the state in labels and numbers, and the log's words where the license allows", () => {
    const state = reduce(kiln, events);
    const snap = snapshotOf(kiln, state, events, "2026-01-01T00:00:05Z");
    expect(snap.v).toBe(1);
    expect(snap.packTitle).toBe(kiln.title);
    expect(snap.unit).toBe(1);
    expect(snap.words.unit).toBe(kiln.vocabulary.unit.one);
    expect(snap.quoted).toBe(kiln.license.redistributable !== false);
    expect(snap.where).toBeTruthy();
    expect(snap.step).toBeTruthy();
    expect(snap.where).toContain(snap.step!);
    // The unit's phases, as the player's own screen lists them: one current, the rest to come or done.
    expect(snap.phases.length).toBeGreaterThan(0);
    expect(snap.phases.filter((p) => p.state === "current")).toHaveLength(1);
    expect(snap.phases.every((p) => ["done", "current", "skipped", "todo"].includes(p.state))).toBe(true);
    // What a phase produced this unit sits under it: the declared type under the phase that declares.
    expect(snap.phases.every((p) => p.results === undefined)).toBe(true);
    const declaredEvents = [...events, { t: "SubjectDeclared", at: "2026-01-01T00:00:02Z", id: "e3", subjectType: "A wide bowl" } as unknown as RunEvent];
    const declaredSnap = snapshotOf(kiln, reduce(kiln, declaredEvents), declaredEvents, "2026-01-01T00:00:05Z");
    const declaring = declaredSnap.phases.find((p) => (p.results ?? []).includes("A wide bowl"));
    expect(declaring).toBeDefined();
    expect(kiln.phases.find((p) => p.id === declaring!.id)?.steps.some((st) => st.kind === "declareSubject")).toBe(true);
    // A table no step rolls — one a roll set off, aimed at an earlier piece — sits under the phase whose roll led to it, named with its hit.
    const constrain = kiln.phases.find((p) => p.steps.some((st) => st.kind === "rollTable" && st.table === "constraint"))!;
    const chained: RunEvent[] = [
      ...events,
      { t: "UnitEntered", at: "2026-01-01T00:00:03Z", id: "e4" } as unknown as RunEvent,
      { t: "OutcomeResolved", at: "2026-01-01T00:00:04Z", id: "e5", table: "constraint", entryId: kiln.tables["constraint"]!.entries[0]!.id, cause: "phase" } as unknown as RunEvent,
      { t: "OutcomeResolved", at: "2026-01-01T00:00:05Z", id: "e6", table: "setback", entryId: kiln.tables["setback"]!.entries[0]!.id, cause: "action", targetSubject: 1 } as unknown as RunEvent,
    ];
    const chainedSnap = snapshotOf(kiln, reduce(kiln, chained), chained, "2026-01-01T00:00:06Z");
    const under = chainedSnap.phases.find((p) => p.id === constrain.id)!;
    expect(under.results).toHaveLength(2);
    expect(under.results![0]).not.toContain("Constraint:");
    expect(under.results![1]).toMatch(/^Setback — hit #1: /);
    expect(chainedSnap.phases.filter((p) => p.id !== constrain.id).every((p) => !(p.results ?? []).some((r) => r.startsWith("Setback")))).toBe(true);
    // Every unit so far, as what its phases produced: the first stage made nothing, the second the two results under the one phase.
    expect(chainedSnap.units?.map((u) => u.unit)).toEqual([1, 2]);
    expect(chainedSnap.units?.[0]?.phases).toEqual([]);
    expect(chainedSnap.units?.[1]?.phases.map((p) => p.id)).toEqual([constrain.id]);
    expect(chainedSnap.units?.[1]?.phases[0]?.results).toHaveLength(2);
    // The Long Kiln keeps no clock by stage, so its time is wall time since the start, and the snapshot says so.
    expect(chainedSnap.progress.timed).toBe(false);
    // Before the first unit there is nothing to list, and nowhere to be.
    const fresh = snapshotOf(kiln, reduce(kiln, [events[0]!]), [events[0]!], "2026-01-01T00:00:05Z");
    expect(fresh.unit).toBe(0);
    expect(fresh.where).toBeNull();
    expect(fresh.phases).toEqual([]);
    expect(isSnapshot(snap)).toBe(true);
    expect(isSnapshot({ v: 2 })).toBe(false);
  });

  it("carries a step's constraints, this unit's results in order, and the latest line, the way RunView reads them", () => {
    // Advance past "Enter the Stage" so the active step is "declareSubject",
    // whose `constrainedBy: form` the demo pack sets — the same table
    // `RunView`'s `Constraints` panel reads on that step.
    const past: RunEvent[] = [
      ...events,
      { t: "StepCompleted", at: "2026-01-01T00:00:02Z", phase: "enter", step: 0 } as unknown as RunEvent,
      { t: "PhaseCompleted", at: "2026-01-01T00:00:02Z", phase: "enter" } as unknown as RunEvent,
    ];
    const state = reduce(kiln, past);
    const withOutcome = {
      ...state,
      outcomes: [{ unit: 1, table: "form", entryId: "form-vase", targetSubject: null, at: "2026-01-01T00:00:02Z" }],
    };
    const snap = snapshotOf(kiln, withOutcome as typeof state, past, "2026-01-01T00:00:05Z");
    const line = kiln.tables.form!.entries.find((e) => e.id === "form-vase")!.text;
    expect(snap.stepKind).toBe("declareSubject");
    expect(snap.constraints).toEqual([line]);
    expect(snap.unitResults).toEqual([{ table: "Form", text: line, hit: null }]);
    expect(snap.latest).toEqual({ where: `${kiln.vocabulary.unit.one} 1, Form`, text: line });
    // No result on the current step's table yet: nothing to honor.
    expect(snapshotOf(kiln, state, past, "2026-01-01T00:00:05Z").constraints).toEqual([]);
    expect(snapshotOf(kiln, state, past, "2026-01-01T00:00:05Z").unitResults).toEqual([]);
    expect(snapshotOf(kiln, state, past, "2026-01-01T00:00:05Z").latest).toBeNull();
  });

  it("keeps a manual step's own results out of a later unit's constraints", () => {
    // Two units' worth of the same table: only this unit's rolls count.
    const past: RunEvent[] = [
      ...events,
      { t: "StepCompleted", at: "2026-01-01T00:00:02Z", phase: "enter", step: 0 } as unknown as RunEvent,
      { t: "PhaseCompleted", at: "2026-01-01T00:00:02Z", phase: "enter" } as unknown as RunEvent,
    ];
    const state = reduce(kiln, past);
    const withOutcomes = {
      ...state,
      outcomes: [
        { unit: 2, table: "form", entryId: "form-vase", targetSubject: null, at: "2026-01-01T00:00:02Z" },
        { unit: 1, table: "form", entryId: "form-cup", targetSubject: null, at: "2026-01-01T00:00:03Z" },
      ],
    };
    const snap = snapshotOf(kiln, withOutcomes as typeof state, past, "2026-01-01T00:00:05Z");
    expect(snap.constraints).toEqual([kiln.tables.form!.entries.find((e) => e.id === "form-cup")!.text]);
    expect(snap.unitResults).toHaveLength(1);
    expect(snap.unitResults![0]!.text).toBe(kiln.tables.form!.entries.find((e) => e.id === "form-cup")!.text);
  });

  it("still says what the dice drew for a pack marked not for redistribution, and only that", () => {
    // A watcher who saw "#x1" was watching numbers. The one line a roll
    // landed on is the run's; the pack's paper stays withheld (`quoted`).
    const closed = { ...kiln, license: { ...kiln.license, redistributable: false } };
    const state = reduce(closed, events);
    const tableId = Object.keys(closed.tables)[0]!;
    const entry = closed.tables[tableId]!.entries[0]!;
    const withOutcome = {
      ...state,
      outcomes: [
        { unit: 1, table: tableId, entryId: entry.id, targetSubject: null, at: "2026-01-01T00:00:02Z" },
        { unit: 1, table: tableId, entryId: "x-gone", targetSubject: null, at: "2026-01-01T00:00:03Z" },
      ],
    };
    const snap = snapshotOf(closed, withOutcome as typeof state, events, "2026-01-01T00:00:05Z");
    expect(snap.quoted).toBe(false);
    expect(snap.log[1]!.text).toBe(entry.title ?? entry.text);
    // An entry the pack no longer has falls back to its reference.
    expect(snap.log[0]!.text).toContain("#x-gone");
    // `unitResults` reads the drawn line the same way, oldest first, and is
    // no more gated by the license than the log is: only the pack's own
    // paper and tables stay behind `quoted`.
    expect(snap.unitResults).toEqual([
      { table: closed.tables[tableId]!.title, text: entry.title ?? entry.text, hit: null },
      { table: closed.tables[tableId]!.title, text: snap.log[0]!.text, hit: null },
    ]);
    expect(snap.latest).toEqual({ where: snap.log[0]!.where, text: snap.log[0]!.text });
  });

  it("carries the race leaderboard in words, when the run is in one", () => {
    const race = { meta: { name: "Friday" }, entries: [1, 2] };
    const standings = [
      { entry: { name: "Mira", progress: { unit: 3, unitsDone: 2, status: "active" as const, elapsedMs: 61_000 } }, place: 1, me: false },
      { entry: { progress: { unit: 1, unitsDone: 4, status: "ended" as const, ending: "out of wood", elapsedMs: 90_000 } }, place: 2, me: true },
      { entry: {}, place: 3, me: false },
    ];
    const snap = raceOf(race, standings, kiln.vocabulary.unit);
    expect(snap).toMatchObject({ name: "Friday", ended: false, racing: 2 });
    expect(snap?.standings.map((s) => s.line)).toEqual([`${kiln.vocabulary.unit.one} 3 · 2 done`, `finished · 4 ${kiln.vocabulary.unit.many.toLowerCase()} · out of wood`, "not started"]);
    expect(snap?.standings[1]).toMatchObject({ name: "You", owner: true });
    expect(raceOf(null, [], kiln.vocabulary.unit)).toBeUndefined();
    const state = reduce(kiln, events);
    expect(snapshotOf(kiln, state, events, "2026-01-01T00:00:05Z", { race: snap }).race?.name).toBe("Friday");
    expect(snapshotOf(kiln, state, events, "2026-01-01T00:00:05Z").race).toBeUndefined();
  });

  it("keeps a clock moving from the moment the snapshot was taken", () => {
    const clock = { id: "c", label: "Unit", kind: "stopwatch" as const, seconds: null, status: "running" as const, elapsedMs: 1000, expired: false };
    expect(clockNow(clock, "2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:03Z")).shown).toBe(4000);
    const timer = { ...clock, kind: "timer" as const, seconds: 10 };
    expect(clockNow(timer, "2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:03Z"))).toEqual({ shown: 6000, fraction: 0.6 });
    expect(clockNow({ ...timer, status: "paused" }, "2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:03Z")).shown).toBe(9000);
  });
});
