import type { LiveSnapshot } from "../live/snapshot.ts";
import type { TickerLine } from "../widget/ticker.ts";

/** Public, representative run data used only by the local theme preview. */
export const THEME_PREVIEW_SNAPSHOT: LiveSnapshot = Object.freeze({
  v: 1,
  at: "2026-01-01T00:00:00Z",
  packId: "theme-preview",
  packTitle: "Theme preview",
  runName: "Studio table",
  mode: "Standard",
  words: { run: "Run", unit: "Round", units: "Rounds" },
  status: "active",
  ending: null,
  unit: 2,
  where: "Round 2 · Make the move",
  step: "Make the move",
  stepKind: "manual",
  phases: [
    { id: "prepare", label: "Prepare", state: "done" },
    { id: "move", label: "Make the move", state: "current" },
  ],
  constraints: ["Use the tool in your other hand."],
  quoted: true,
  standings: [
    { name: "Mira", points: 4, place: 1, states: ["Ready"] },
    { name: "Jon", points: 2, place: 2, states: [] },
  ],
  contestants: 2,
  subjects: [{ id: 1, name: "Example", type: "Subject", states: [], finalized: true }],
  counters: [{ id: "streak", label: "Streak", value: 3 }],
  resources: [{ id: "focus", label: "Focus", value: 4, max: 6, display: "boxes" }],
  clocks: [{ id: "clock", label: "Round clock", kind: "stopwatch", seconds: null, status: "paused", elapsedMs: 90_000, expired: false }],
  progress: { unitsDone: 1, elapsedMs: 90_000, timed: true },
  score: { label: "Rounds closed", text: "1 round", value: 1, better: "higher" },
  forcedUnits: 0,
  plannedUnits: null,
  log: [{ n: 3, unit: 2, where: "Round 2, Result", hit: null, text: "A useful result" }],
  unitResults: [{ table: "Result", text: "A useful result", hit: null }],
  latest: { where: "Round 2, Result", text: "A useful result" },
  race: {
    name: "Studio race",
    ended: false,
    racing: 2,
    standings: [
      { name: "Mira", place: 1, owner: false, line: "Round 2 · 1 done", elapsedMs: 90_000 },
      { name: "Jon", place: 2, owner: false, line: "Round 1 · 0 done", elapsedMs: 105_000 },
    ],
  },
} satisfies LiveSnapshot);

export const THEME_PREVIEW_LINES: readonly TickerLine[] = Object.freeze([
  { id: "result", kind: "outcome", mark: "Result", text: "A useful result" },
  { id: "roll", kind: "rolled", mark: "Rolled", text: "Mira rolled 14 on the check" },
]);
