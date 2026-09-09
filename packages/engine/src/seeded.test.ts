import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { createRandom, streamSeed } from "./rng.ts";
import { executeTableRoll } from "./execute.ts";
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

/**
 * A run in the shared mode which has entered `units` units, with `noise`
 * arbitrary extra events mixed in to stand for one player's own choices.
 */
function shared(seed: string, units: number, noise: RunEvent[] = []) {
  const log: RunEvent[] = [
    ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "shared", seed }),
  ];
  for (let i = 0; i < units; i++) {
    log.push(ev("UnitEntered"));
    log.push(...noise);
  }
  return reduce(kiln, log);
}

/** Roll the check table the way a seeded run would: from the stream, not by hand. */
function checkIn(seed: string, units: number, noise: RunEvent[] = []) {
  const state = shared(seed, units, noise);
  const result = executeTableRoll(kiln, state, "check", {
    answers: {},
    now: NOW,
    keyPrefix: "check",
    seeded: true,
    random: createRandom(streamSeed(seed, state.unit, "check", 0)),
  });
  const rolled = result.events.find((e) => e.t === "Rolled");
  return rolled as Extract<RunEvent, { t: "Rolled" }>;
}

/**
 * The promise a shared seed makes.
 *
 * Not "the same numbers in the same order", two people will always diverge in
 * what they choose, but "the same dungeon": whatever else happened, Stage
 * three holds the same thing for both of them.
 */
describe("seeded runs", () => {
  it("gives the same result to the same seed in the same unit", () => {
    expect(checkIn("long-kiln-42", 3).total).toBe(checkIn("long-kiln-42", 3).total);
  });

  it("gives different seeds different runs", () => {
    const a = [1, 2, 3, 4, 5].map((u) => checkIn("long-kiln-42", u).total);
    const b = [1, 2, 3, 4, 5].map((u) => checkIn("cold-tape-19", u).total);
    expect(a).not.toEqual(b);
  });

  it("holds the same result for a player whose run diverged", () => {
    // The whole point: one player wrote a journal entry, drew a Charm and
    // finalized differently, and still meets the same Stage three.
    const busy: RunEvent[] = [
      ev("JournalWritten", { unit: 1, text: "a tall one" }),
      ev("CardDrawn", { deck: "charms", cardId: "ch-steady" }),
      ev("StateApplied", { state: "sealed", subject: 1 }),
    ];
    expect(checkIn("long-kiln-42", 3, busy).total).toBe(checkIn("long-kiln-42", 3).total);
  });

  it("moves on between units, so the run is not one number repeated", () => {
    const totals = [1, 2, 3, 4, 5, 6].map((u) => checkIn("long-kiln-42", u).total);
    expect(new Set(totals).size).toBeGreaterThan(1);
  });

  it("separates repeats of the same roll within a unit", () => {
    const first = createRandom(streamSeed("long-kiln-42", 3, "check", 0))();
    const second = createRandom(streamSeed("long-kiln-42", 3, "check", 1))();
    expect(first).not.toBe(second);
  });

  it("records a seeded roll as seeded, not as the player's own", () => {
    // The log has to be honest about where fate came from, or a shared run
    // cannot be compared with anyone else's.
    expect(checkIn("long-kiln-42", 2).source).toBe("seeded");
  });
});
