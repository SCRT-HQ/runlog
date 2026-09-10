import { describe, expect, it } from "vitest";
import type { LiveSnapshot } from "../live/snapshot.ts";
import { lineOfGesture, tickerLines } from "./ticker.ts";

/**
 * A ticker has to be right in the two situations a scoreboard never
 * meets: it opens onto a run already in progress, and it is told the
 * same news twice, once by gesture and once by the snapshot that
 * follows. These pin both.
 */
const base: LiveSnapshot = {
  v: 1,
  at: "2026-01-01T00:00:00Z",
  packId: "kiln",
  packTitle: "The Long Kiln",
  runName: null,
  mode: "Standard",
  words: { run: "Firing", unit: "Stage", units: "Stages" },
  status: "active",
  ending: null,
  unit: 2,
  where: "Throw the Piece · Throw it.",
  step: "Throw it.",
  phases: [],
  quoted: true,
  standings: [],
  contestants: 0,
  subjects: [],
  counters: [],
  resources: [],
  clocks: [],
  progress: { unitsDone: 1, elapsedMs: 90_000, timed: true },
  score: { label: "Stages closed", text: "1 stage", value: 1, better: "higher" },
  forcedUnits: 0,
  log: [{ n: 3, unit: 2, where: "Stage 2, Form", hit: null, text: "A wide bowl" }],
};

describe("the ticker's lines", () => {
  it("say nothing for the first snapshot: what a widget opens onto is old news", () => {
    expect(tickerLines(null, base)).toEqual([]);
  });

  it("tell each result numbered past the last one seen, oldest first", () => {
    const next = { ...base, log: [{ n: 5, unit: 2, where: "Stage 2, Glaze", hit: null, text: "Celadon" }, { n: 4, unit: 2, where: "Stage 2, Form", hit: null, text: "A tall vase" }, ...base.log] };
    expect(tickerLines(base, next).map((l) => [l.id, l.text])).toEqual([
      ["o4", "A tall vase"],
      ["o5", "Celadon"],
    ]);
  });

  it("tell a unit closing, points moving, a clock stopping and the run ending, in words a stranger can read", () => {
    const prev = { ...base, standings: [{ name: "Mira", points: 4, place: 1, states: [] }], clocks: [{ id: "u2:unit", label: "Stage 2", kind: "timer" as const, seconds: 600, status: "running" as const, elapsedMs: 1000, expired: false }] };
    const next = {
      ...prev,
      unit: 3,
      status: "ended" as const,
      ending: "The Shelf",
      progress: { unitsDone: 2, elapsedMs: 100_000, timed: true },
      standings: [{ name: "Mira", points: 7, place: 1, states: [] }],
      clocks: [{ ...prev.clocks[0]!, status: "done" as const, expired: true }],
    };
    expect(tickerLines(prev, next).map((l) => [l.kind, l.text])).toEqual([
      ["award", "Mira +3 · 7"],
      ["clock", "Stage 2 stopped · time ran out"],
      ["unit-closed", "Stage 2 closed · 2 stages done"],
      ["run-ended", "The Shelf"],
    ]);
  });

  it("tell a tally moving in the pack's words: the value as it climbs, and where it came from when it falls", () => {
    const prev = { ...base, counters: [{ id: "deaths", label: "Deaths", value: 2 }, { id: "streak", label: "Rounds without a forfeit", value: 4 }] };
    const up = { ...prev, counters: [{ id: "deaths", label: "Deaths", value: 3 }, { id: "streak", label: "Rounds without a forfeit", value: 4 }] };
    expect(tickerLines(prev, up).map((l) => [l.id, l.kind, l.mark, l.text])).toEqual([["kdeaths:3", "counter", "Tally", "Deaths 3"]]);
    const back = { ...up, counters: [{ id: "deaths", label: "Deaths", value: 0 }, { id: "streak", label: "Rounds without a forfeit", value: 0 }] };
    expect(tickerLines(up, back).map((l) => l.text)).toEqual(["Deaths 3 → 0", "Rounds without a forfeit 4 → 0"]);
    // A tally the last snapshot did not carry is not news; neither is one that stayed put.
    expect(tickerLines(base, up)).toEqual([]);
    expect(tickerLines(up, up)).toEqual([]);
  });

  it("read a gesture into the same line the snapshot would make, so the news is told once", () => {
    const byGesture = lineOfGesture({ kind: "outcome", data: { n: 4, text: "A tall vase", subject: "Piece 2" }, at: "2026-01-01T00:01:00Z" });
    expect(byGesture).toMatchObject({ id: "o4", kind: "outcome", text: "A tall vase → Piece 2" });
    expect(lineOfGesture({ kind: "rolled", data: { total: 14, label: "Kiln Check" }, from: "Mira", at: "t" })?.text).toBe("Mira rolled 14 on Kiln Check");
    expect(lineOfGesture({ kind: "clock", data: { clock: "u2:unit", label: "Stage 2", status: "paused" }, at: "t" })).toMatchObject({ id: "cu2:unit:paused", text: "Stage 2 paused" });
    expect(lineOfGesture({ kind: "counter", data: { counter: "deaths", label: "Deaths", value: 3, was: 2 }, at: "t" })).toMatchObject({ id: "kdeaths:3", kind: "counter", text: "Deaths 3" });
    expect(lineOfGesture({ kind: "counter", data: { counter: "deaths", label: "Deaths", value: 0, was: 3 }, at: "t" })).toMatchObject({ id: "kdeaths:0", text: "Deaths 3 → 0" });
    expect(lineOfGesture({ kind: "unit-closed", data: { unit: 2, unitsDone: 2 }, at: "t" })).toMatchObject({ id: "u2" });
    expect(lineOfGesture({ kind: "run-ended", data: { ending: "The Shelf" }, at: "t" })).toMatchObject({ id: "end", text: "The Shelf" });
  });

  it("ignore a kind it does not know, and a gesture missing what the line needs", () => {
    expect(lineOfGesture({ kind: "waved", data: { emoji: "🔥" }, at: "t" })).toBeNull();
    expect(lineOfGesture({ kind: "outcome", data: { n: 4 }, at: "t" })).toBeNull();
    expect(lineOfGesture({ kind: "rolled", data: {}, at: "t" })).toBeNull();
    expect(lineOfGesture({ kind: "counter", data: { counter: "deaths", label: "Deaths", value: 3 }, at: "t" })).toBeNull();
  });
});
