import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "./load.ts";
import type { Pack } from "./pack.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function load(relative: string): Pack {
  const result = loadPackText(readFileSync(join(repoRoot, relative), "utf8"), "yaml");
  if (!result.ok) {
    throw new Error(
      `${relative} failed to load:\n${result.diagnostics
        .map((d) => `  [${d.level}] ${d.code} at ${d.path || "<root>"}: ${d.message}`)
        .join("\n")}`,
    );
  }
  expect(result.diagnostics, `${relative} should have no warnings`).toEqual([]);
  return result.pack;
}

/**
 * The generality guard.
 *
 * The claim this project rests on is that one engine can host structurally
 * different games without special-casing any of them. Three packs is the
 * cheapest way to keep that claim honest: a dungeon crawl, a journaling game
 * and a training log, all through the same loader with no code branching on
 * which is which.
 *
 * When a schema change breaks one of these, that is the signal to think again
 * - it means something genre-specific has crept into what is supposed to be a
 * general format.
 */
describe("one schema, three unrelated games", () => {
  const kiln = load("packs/demo/pack.yaml");
  const signal = load("packs/sketches/salt-and-signal.yaml");
  const ladder = load("packs/sketches/ladder-work.yaml");
  const all = [kiln, signal, ladder];

  it("loads every pack through the same validator", () => {
    expect(all.map((p) => p.title)).toEqual(["The Long Kiln", "Salt & Signal", "Ladder Work"]);
  });

  it("lets each game name the world in its own words", () => {
    // Nothing in the engine says "Room" or "Track". If these ever collapse to
    // a shared vocabulary, a genre assumption has leaked in.
    expect(all.map((p) => p.vocabulary.unit.one)).toEqual(["Stage", "Watch", "Block"]);
    expect(all.map((p) => p.vocabulary.subject.one)).toEqual(["Piece", "Entry", "Movement"]);
    expect(all.map((p) => p.vocabulary.finalize)).toEqual(["Fire", "Seal", "Log"]);
  });

  it("covers all four resolution kinds across the set", () => {
    const kinds = new Set(all.flatMap((p) => Object.values(p.tables).map((t) => t.resolution)));
    expect(kinds).toEqual(new Set(["lookup", "bands", "opposed", "keyed"]));
  });

  describe("Salt & Signal - the journaling case", () => {
    it("expresses an opposed roll, which a single total cannot", () => {
      const signalTable = signal.tables.signal!;
      expect(signalTable.resolution).toBe("opposed");
      if (signalTable.resolution !== "opposed") return;

      expect(signalTable.action).toBe("d6");
      expect(signalTable.challenge).toEqual({ dice: "d10", count: 2 });
      // A stat feeding into the roll: the reason `addResource` exists.
      expect(signalTable.addResource).toBe("nerve");
      // Every rung from beating neither die to beating both.
      expect(signalTable.entries.map((e) => e.beats).sort()).toEqual([0, 1, 2]);
    });

    it("resolves a card draw on a keyed table rather than faking a d13", () => {
      const deck = signal.decks!.tide!;
      expect(deck.kind).toBe("standard52");
      if (deck.kind !== "standard52") return;
      expect(deck.resolveBy).toBe("suit");

      const table = signal.tables[deck.resolveOn!]!;
      expect(table.resolution).toBe("keyed");
      if (table.resolution !== "keyed") return;
      expect(new Set(table.entries.map((e) => e.key))).toEqual(
        new Set(["hearts", "diamonds", "clubs", "spades"]),
      );
    });

    it("allows a resource to sit below zero", () => {
      expect(signal.resources!.nerve!.min).toBe(-3);
    });

    it("uses a targeting strategy that is not the anchored-offset one", () => {
      expect(signal.targeting?.strategy).toBe("playerChoice");
    });

    it("requires a journal entry, since that is the whole genre", () => {
      expect(signal.journal?.required).toBe(true);
    });
  });

  describe("Ladder Work - the training case", () => {
    it("omits targeting entirely, and that is legal", () => {
      // The proof that backward damage is a feature of one genre, not of the
      // engine. Nothing reaches back in a training log.
      expect(ladder.targeting).toBeUndefined();
    });

    it("omits decks and the journal entirely", () => {
      expect(ladder.decks).toBeUndefined();
      expect(ladder.journal).toBeUndefined();
    });

    it("treats timers as a core surface rather than a garnish", () => {
      // Counted with a loop rather than flatMap: `entries` has a different
      // element type per resolution kind, so the union does not flatten.
      let timers = 0;
      for (const table of Object.values(ladder.tables)) {
        for (const entry of table.entries) {
          for (const trigger of entry.triggers ?? []) {
            for (const action of trigger.do) {
              if (action.do === "startTimer") timers++;
            }
          }
        }
      }
      expect(timers).toBeGreaterThanOrEqual(4);
    });

    it("supports a counter the player is not shown", () => {
      expect(ladder.counters!.fatigue!.hidden).toBe(true);
    });

    it("supports a state with no mechanical meaning at all", () => {
      expect(ladder.states!.taxed!.semantics).toBeUndefined();
    });

    it("offers both a fixed-length and a rolled-length mode", () => {
      expect(ladder.modes.fixed!.units?.fixed).toBe(5);
      expect(ladder.modes.shared!.units?.roll).toBe("d4+3");
      expect(ladder.modes.shared!.seeded).toBe(true);
    });
  });

  it("keeps every pack redistributable, so all three can ship in this repo", () => {
    for (const pack of all) expect(pack.license.redistributable).toBe(true);
  });
});
