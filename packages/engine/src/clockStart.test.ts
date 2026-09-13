import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { clockOnPhase, unitClockStart } from "./clock.ts";
import type { RunEvent } from "./events.ts";

/**
 * When a unit's clock starts, and how long it runs.
 *
 * A unit that draws before it plays should not be spending the playing
 * time on the drawing, and ten minutes is a guess about somebody else's
 * evening. Both are the pack's to say and the player's to change.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}: ${JSON.stringify(r.diagnostics)}`);
  return r.pack;
}
const interference = loadPack("packs/sketches/elden-ring-interference.yaml");
const kiln = loadPack("packs/demo/pack.yaml");

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent => ({ t, at: NOW, ...props }) as RunEvent;
const opened = (dial?: number) =>
  reduce(interference, [
    ev("RunStarted", { packId: interference.id, packVersion: interference.version, mode: "solo" }),
    ...(dial === undefined ? [] : [ev("ResourceChanged", { resource: "minutes", set: dial })]),
    ev("UnitEntered"),
  ]);

describe("a clock that waits for a phase", () => {
  it("does not start with the unit", () => {
    expect(unitClockStart(interference, opened(), 1, NOW)).toBeNull();
  });

  it("starts when the flow reaches that phase, and not at the ones before it", () => {
    const state = opened();
    expect(clockOnPhase(interference, state, "meddle", NOW)).toBeNull();
    expect(clockOnPhase(interference, state, "charge", NOW)).toBeNull();
    const start = clockOnPhase(interference, state, "play", NOW);
    expect(start?.t).toBe("ClockStarted");
    expect(start && start.t === "ClockStarted" ? start.clock : null).toBe("u1:unit");
  });

  it("does not start it twice, however many times it is asked", () => {
    const state = opened();
    const first = clockOnPhase(interference, state, "play", NOW)!;
    const after = reduce(interference, [
      ev("RunStarted", { packId: interference.id, packVersion: interference.version, mode: "solo" }),
      ev("UnitEntered"),
      first,
    ]);
    expect(clockOnPhase(interference, after, "play", NOW)).toBeNull();
  });

  it("leaves a pack whose clock starts with its unit exactly as it was", () => {
    const state = reduce(kiln, [ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }), ev("UnitEntered")]);
    expect(clockOnPhase(kiln, state, kiln.phases[0]!.id, NOW)).toBeNull();
  });
});

describe("how long the timer runs", () => {
  const secondsAt = (dial?: number) => {
    const start = clockOnPhase(interference, opened(dial), "play", NOW);
    return start && start.t === "ClockStarted" ? start.seconds : null;
  };

  it("is what the pack says, until somebody turns the dial", () => {
    expect(secondsAt()).toBe(10 * 60);
  });

  it("is what the dial says, once they have", () => {
    expect(secondsAt(25)).toBe(25 * 60);
    expect(secondsAt(2)).toBe(2 * 60);
  });

  it("is read when it starts, so turning it does not change the one running", () => {
    // The dial moves after the clock is started; the started clock keeps
    // the seconds it was given, because they are in the event.
    const start = clockOnPhase(interference, opened(10), "play", NOW)!;
    const after = reduce(interference, [
      ev("RunStarted", { packId: interference.id, packVersion: interference.version, mode: "solo" }),
      ev("UnitEntered"),
      start,
      ev("ResourceChanged", { resource: "minutes", set: 40 }),
    ]);
    expect(after.clocks[0]?.seconds).toBe(10 * 60);
  });
});
