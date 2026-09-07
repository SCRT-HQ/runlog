import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { reduce, type RunEvent } from "@runlog/engine";
import { clockNow, isSnapshot, raceOf, snapshotOf } from "./snapshot.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
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
    // Before the first unit there is nothing to list, and nowhere to be.
    const fresh = snapshotOf(kiln, reduce(kiln, [events[0]!]), [events[0]!], "2026-01-01T00:00:05Z");
    expect(fresh.unit).toBe(0);
    expect(fresh.where).toBeNull();
    expect(fresh.phases).toEqual([]);
    expect(isSnapshot(snap)).toBe(true);
    expect(isSnapshot({ v: 2 })).toBe(false);
  });

  it("names entries by reference, not words, for a pack marked not for redistribution", () => {
    const closed = { ...kiln, license: { ...kiln.license, redistributable: false } };
    const state = reduce(closed, events);
    const withOutcome = { ...state, outcomes: [{ unit: 1, table: Object.keys(closed.tables)[0]!, entryId: "x1", targetSubject: null, at: "2026-01-01T00:00:02Z" }] };
    const snap = snapshotOf(closed, withOutcome as typeof state, events, "2026-01-01T00:00:05Z");
    expect(snap.quoted).toBe(false);
    expect(snap.log[0]!.text).toContain("#x1");
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
