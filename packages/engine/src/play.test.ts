import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { playThrough, PlayError, type PlayStep } from "./play.ts";

/**
 * `playThrough` is what turns a fixture from "the log I hand-wrote folds into
 * the state I expected" into "the pack actually plays the way I think it
 * does": a table roll runs the table's own triggers, a declared subject
 * really has to be declared, and a finalize really has to be the active step.
 * These tests are the same worked example the demo pack's own fixture uses —
 * the Kiln Check chaining into the Form table — plus the two failure modes a
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

/** Enter, declare, throw and fire the first Stage — check and constrain are skipped on it. */
const firstStage: PlayStep[] = [
  { enter: 1 },
  { step: "enter" },
  { declare: "Bowl" },
  { step: "work" },
  { finalize: {} },
];

describe("playing a pack through", () => {
  it("chains a 30 on the Kiln Check into the Form table", () => {
    const result = playThrough(kiln, [
      ...firstStage,
      { enter: 2 },
      { step: "enter" },
      { step: "check", answers: { d100: 30, d6: 4 } },
    ]);

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
    // Every request in a seeded play with no script answers was rolled from the seed.
    expect(a.requests.every((r) => r.source === "seed")).toBe(true);
    expect(a.requests.length).toBeGreaterThan(0);
  });

  it("declares differently rolled Constraints for two different seeds", () => {
    const script: PlayStep[] = [...firstStage, { enter: 2 }, { step: "enter" }, { step: "check" }, { declare: "Vase" }, { step: "constrain" }];
    const a = playThrough(kiln, script, { seed: "seed-one" });
    const b = playThrough(kiln, script, { seed: "seed-two" });
    // Not a hard guarantee for any two seeds, but true for this pair, and
    // worth asserting so a change that ignores the seed entirely is caught.
    expect(a.events).not.toEqual(b.events);
  });
});
