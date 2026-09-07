import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { awardValue, challenges, moderation, standings } from "./moderated.ts";
import type { RunEvent } from "./events.ts";

/**
 * Moderated play: a roster races the drawn results, the moderator awards
 * them, points add up. The pack says which results are challenges by giving
 * them points; the mode says whether the first to finish scores or everyone.
 */

const YAML = `
schemaVersion: 1
id: dev.runlog.test-race
version: "0.0.1"
title: Race
license: { id: CC0-1.0, redistributable: true }
capabilities: [deferredTriggers, moderated]
vocabulary:
  run: { one: Race, many: Races }
  unit: { one: Heat, many: Heats }
  subject: { one: Set, many: Sets }
  finalize: Close
unit: { createsSubject: true, min: 1, max: 5 }
tables:
  trick:
    resolution: lookup
    title: Trick
    roll: d2
    entries:
      - { id: easy, range: [1, 1], text: "Easy.", points: 1 }
      - { id: hard, range: [2, 2], text: "Hard.", points: 3 }
  curse:
    resolution: lookup
    title: Curse
    roll: d1
    entries:
      - { id: c1, range: [1, 1], text: "Everyone suffers." }
phases:
  - id: draw
    label: Draw
    steps:
      - kind: rollTable
        table: trick
      - kind: finalizeUnit
endings:
  - { id: done, label: Done }
modes:
  first:
    label: First wins
    moderated: { contestants: { min: 2, max: 4 } }
  everyone:
    label: Everyone scores
    moderated: { award: everyone, firstBonus: 2 }
  solo:
    label: Solo
defaultMode: first
`;

function pack(): Pack {
  const r = loadPackText(YAML, "yaml");
  if (!r.ok) throw new Error(`the test pack does not load: ${JSON.stringify(r.diagnostics)}`);
  return r.pack;
}

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent => ({ t, at: NOW, ...props }) as RunEvent;
const opened = (p: Pack, mode: string): RunEvent[] => [
  ev("RunStarted", { packId: p.id, packVersion: p.version, mode }),
  ev("ContestantAdded", { contestant: "c1", name: "Ada" }),
  ev("ContestantAdded", { contestant: "c2", name: "Ben" }),
  ev("ContestantAdded", { contestant: "c3", name: "Cy" }),
  ev("UnitEntered"),
  ev("OutcomeResolved", { table: "curse", entryId: "c1", cause: "action" }),
  ev("OutcomeResolved", { table: "trick", entryId: "hard", cause: "phase" }),
  ev("OutcomeResolved", { table: "trick", entryId: "easy", cause: "phase" }),
];

describe("what can be won", () => {
  it("lists the current unit's results that carry points, and not the effects", () => {
    const p = pack();
    const state = reduce(p, opened(p, "first"));
    expect(moderation(p, state)?.award).toBe("first");
    const list = challenges(p, state);
    expect(list.map((c) => [c.outcome, c.entryId, c.points, c.open])).toEqual([
      [1, "hard", 3, true],
      [2, "easy", 1, true],
    ]);
    expect(state.contestants.map((c) => c.name)).toEqual(["Ada", "Ben", "Cy"]);
  });

  it("carries what a challenge's own follow-up rolls said, and not what came before or after it", () => {
    const p = pack();
    const log = [
      ...opened(p, "first").slice(0, 5),
      ev("OutcomeResolved", { table: "curse", entryId: "c1", cause: "action" }),
      // A challenge and, in the same block, what it drew.
      ev("OutcomeResolved", { table: "trick", entryId: "hard", cause: "phase" }),
      ev("OutcomeResolved", { table: "curse", entryId: "c1", cause: "action" }),
      // Another block, later: its own challenge with nothing after it.
      ev("OutcomeResolved", { table: "trick", entryId: "easy", cause: "phase", at: "2026-01-01T00:05:00.000Z" }),
    ];
    const list = challenges(p, reduce(p, log));
    expect(list.map((c) => [c.entryId, c.details])).toEqual([
      ["hard", ["Everyone suffers."]],
      ["easy", []],
    ]);
  });

  it("is nothing in a mode that is not moderated, and nothing from an earlier unit", () => {
    const p = pack();
    expect(challenges(p, reduce(p, opened(p, "solo")))).toHaveLength(0);
    const later = reduce(p, [...opened(p, "first"), ev("UnitFinalized"), ev("UnitEntered")]);
    expect(challenges(p, later)).toHaveLength(0);
  });
});

describe("awarding", () => {
  it("first wins: the first award closes the challenge and the value is the entry's points", () => {
    const p = pack();
    const before = reduce(p, opened(p, "first"));
    expect(awardValue(p, before, 1, "c1")).toBe(3);
    const after = reduce(p, [...opened(p, "first"), ev("Awarded", { contestant: "c1", outcome: 1, table: "trick", entryId: "hard", points: 3 })]);
    expect(challenges(p, after).find((c) => c.outcome === 1)?.open).toBe(false);
    expect(awardValue(p, after, 1, "c2")).toBeNull();
    expect(awardValue(p, after, 2, "c2")).toBe(1);
  });

  it("everyone scores: each contestant once, the first with the bonus", () => {
    const p = pack();
    const log = [...opened(p, "everyone"), ev("Awarded", { contestant: "c1", outcome: 1, table: "trick", entryId: "hard", points: 5 })];
    const state = reduce(p, log);
    expect(challenges(p, state).find((c) => c.outcome === 1)?.open).toBe(true);
    expect(awardValue(p, state, 1, "c1")).toBeNull();
    expect(awardValue(p, state, 1, "c2")).toBe(3);
    const full = reduce(p, [
      ...log,
      ev("Awarded", { contestant: "c2", outcome: 1, table: "trick", entryId: "hard", points: 3 }),
      ev("Awarded", { contestant: "c3", outcome: 1, table: "trick", entryId: "hard", points: 3 }),
    ]);
    expect(challenges(p, full).find((c) => c.outcome === 1)?.open).toBe(false);
  });

  it("refuses a name that is not on the roster, and a revoked award comes back open", () => {
    const p = pack();
    const state = reduce(p, opened(p, "first"));
    expect(awardValue(p, state, 1, "nobody")).toBeNull();
    const revoked = reduce(p, [
      ...opened(p, "first"),
      ev("Awarded", { contestant: "c1", outcome: 1, table: "trick", entryId: "hard", points: 3 }),
      ev("Corrected", { note: "took an award back from Ada" }),
      ev("AwardRevoked", { contestant: "c1", outcome: 1 }),
    ]);
    expect(revoked.awards).toHaveLength(0);
    expect(challenges(p, revoked).find((c) => c.outcome === 1)?.open).toBe(true);
  });
});

describe("the scoreboard", () => {
  it("sums awards, orders by points then wins, and lets ties share a place", () => {
    const p = pack();
    const state = reduce(p, [
      ...opened(p, "everyone"),
      ev("Awarded", { contestant: "c2", outcome: 1, table: "trick", entryId: "hard", points: 5 }),
      ev("Awarded", { contestant: "c1", outcome: 1, table: "trick", entryId: "hard", points: 3 }),
      ev("Awarded", { contestant: "c3", outcome: 2, table: "trick", entryId: "easy", points: 3 }),
      ev("Awarded", { contestant: "c3", outcome: 1, table: "trick", entryId: "hard", points: 0 }),
    ]);
    expect(standings(state).map((s) => [s.contestant.name, s.points, s.wins, s.place])).toEqual([
      ["Ben", 5, 1, 1],
      ["Cy", 3, 2, 2],
      ["Ada", 3, 1, 3],
    ]);
  });

  it("drops someone taken off the roster, awards and all", () => {
    const p = pack();
    const state = reduce(p, [
      ...opened(p, "first"),
      ev("Awarded", { contestant: "c1", outcome: 1, table: "trick", entryId: "hard", points: 3 }),
      ev("ContestantRemoved", { contestant: "c1" }),
    ]);
    expect(standings(state).map((s) => s.contestant.name)).toEqual(["Ben", "Cy"]);
  });
});
