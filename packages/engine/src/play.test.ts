import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { drive, DriveError } from "./drive.ts";
import { playThrough, PlayError, type PlayStep } from "./play.ts";

/**
 * `playThrough` is what turns a fixture from "the log I hand-wrote folds into
 * the state I expected" into "the pack actually plays the way I think it
 * does": a table roll runs the table's own triggers, a declared subject
 * really has to be declared, and a finalize really has to be the active step.
 * These tests are the same worked example the demo pack's own fixture uses,
 * the Kiln Check chaining into the Form table, plus the two failure modes a
 * pack author needs from a headless player: an unanswered request names
 * itself, and a seeded run needs nobody at all.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}
const kiln = loadPack("packs/demo/pack.yaml");
const tarnished = loadPack("packs/sketches/elden-ring-tarnishedtool.yaml");

/** Enter, declare, throw and fire the first Stage: check and constrain are skipped on it. */
const firstStage: PlayStep[] = [{ enter: 1 }, { step: "enter" }, { declare: "Bowl" }, { step: "work" }, { finalize: {} }];

describe("playing a pack through", () => {
  it("chains a 30 on the Kiln Check into the Form table", () => {
    const result = playThrough(kiln, [...firstStage, { enter: 2 }, { step: "enter" }, { step: "check", answers: { d100: 30, d6: 4 } }]);

    expect(result.state.outcomes.map((o) => ({ table: o.table, entryId: o.entryId }))).toEqual([
      { table: "check", entryId: "check-kind" },
      { table: "form", entryId: "form-cup" },
    ]);
    // Both rolls are on the record, in the order they were asked.
    expect(result.requests.map((r) => ({ key: r.key, answer: r.answer, source: r.source }))).toEqual([
      { key: "check", answer: 30, source: "given" },
      { key: "check=30/t0/0#0", answer: 4, source: "given" },
    ]);
  });

  it("declares, throws and fires the first Stage", () => {
    const result = playThrough(kiln, firstStage);
    expect(result.state.unit).toBe(1);
    expect(result.state.subjects).toMatchObject([{ id: 1, type: "Bowl", finalized: true }]);
    expect(result.state.phasesDone).toEqual(["enter", "declare", "work", "close"]);
  });

  it("throws naming the request when a script gives the wrong key", () => {
    let error: unknown;
    try {
      playThrough(kiln, [...firstStage, { enter: 2 }, { step: "enter" }, { step: "check", answers: { checkTotal: 30 } }]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PlayError);
    const playError = error as PlayError;
    expect(playError.request).toMatchObject({ kind: "roll", key: "check", dice: "d100" });
    expect(playError.message).toContain('"check"');
    expect(playError.message).toContain("checkTotal");
  });

  it("needs no answers at all once seeded, and two plays of the same seed agree", () => {
    const script: PlayStep[] = [
      ...firstStage,
      { enter: 2 },
      { step: "enter" },
      { step: "check" },
      { declare: "Vase" },
      { step: "constrain" },
      { step: "work" },
      { finalize: {} },
    ];
    const a = playThrough(kiln, script, { seed: "long-kiln-1" });
    const b = playThrough(kiln, script, { seed: "long-kiln-1" });

    expect(a.events).toEqual(b.events);
    expect(a.state).toEqual(b.state);
    /*
     * Nothing was left to ask. The driver rolls from the seed itself, so
     * a seeded play never reaches the fallback below it that answers a
     * roll request on the seed's behalf -- it did while a run counted as
     * seeded only where its mode said so, and the demo pack's mode here
     * does not.
     */
    expect(a.requests).toEqual([]);
    const rolled = a.events.filter((e) => e.t === "Rolled");
    expect(rolled.length).toBeGreaterThan(0);
    expect(rolled.every((e) => e.source === "seeded")).toBe(true);
  });

  it("declares differently rolled Constraints for two different seeds", () => {
    const script: PlayStep[] = [
      ...firstStage,
      { enter: 2 },
      { step: "enter" },
      { step: "check" },
      { declare: "Vase" },
      { step: "constrain" },
    ];
    const a = playThrough(kiln, script, { seed: "seed-one" });
    const b = playThrough(kiln, script, { seed: "seed-two" });
    // Not a hard guarantee for any two seeds, but true for this pair, and
    // worth asserting so a change that ignores the seed entirely is caught.
    expect(a.events).not.toEqual(b.events);
  });
});

/**
 * A counter's threshold is owed, not taken: the reducer detects it and
 * somebody has to fire it, since firing means rolling. Until this step
 * existed a fixture could only assert the counter's value and then type
 * out by hand what firing would have produced, which proved nothing about
 * the trigger's own actions. `fire` presses the button the app shows.
 */
describe("firing a counter's threshold", () => {
  it("runs the trigger's actions and records that it fired", () => {
    const result = playThrough(tarnished, [{ enter: 1 }, { fire: "gear" }], { mode: "short", seed: "first-build" });
    // The first scene is in the first quarter of a six scene run, so the
    // build and the warp are the beginner ones.
    expect(result.state.outcomes.map((o) => o.table)).toEqual(["loadout-beginner", "warp-beginner"]);
    expect(result.state.firedOnce).toContain("counter:gear:0");
    expect(result.state.counters["gear"]).toBe(0);
    expect(result.events.at(-1)).toMatchObject({ t: "TriggerFired", key: "counter:gear:0" });
  });

  it("is named by the counter, the trigger's label, or its key", () => {
    for (const fire of ["gear", "Your first build", "counter:gear:0"]) {
      const result = playThrough(tarnished, [{ enter: 1 }, { fire }], { mode: "short", seed: "first-build" });
      expect(result.state.firedOnce).toContain("counter:gear:0");
    }
  });

  it("refuses a threshold that is not due, and says which ones are", () => {
    expect(() => playThrough(tarnished, [{ enter: 1 }, { fire: "wander" }], { mode: "short", seed: "x" })).toThrow(
      /no due counter threshold matching "wander".*Your first build/,
    );
  });

  it("is one drive action, for a caller driving a run a press at a time", () => {
    const opened = playThrough(tarnished, [{ enter: 1 }], { mode: "short", seed: "first-build" });
    expect(() => drive(tarnished, opened.events, { fire: "counter:gear:1:u1" }, { now: "2020-01-01T00:00:09.000Z" })).toThrow(DriveError);
    const fired = drive(
      tarnished,
      opened.events,
      { fire: "counter:gear:0" },
      { now: "2020-01-01T00:00:09.000Z", seed: "first-build", autoRoll: true },
    );
    expect(fired.status).toBe("done");
    if (fired.status === "done") expect(fired.events.at(-1)).toMatchObject({ t: "TriggerFired", key: "counter:gear:0" });
  });
});
