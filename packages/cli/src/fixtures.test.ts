import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { readPath, runFixtures } from "./fixtures.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}
const kiln = loadPack("packs/demo/pack.yaml");

/** The same pack with its fixtures swapped for one written here. */
const withFixtures = (fixtures: Pack["fixtures"]): Pack => ({ ...kiln, fixtures });

describe("replaying a pack's own fixtures", () => {
  it("passes the ones the shipped pack carries", () => {
    // These were reported as "pending" for as long as the runner was a stub,
    // and one of them was wrong the whole time. A test runner that passes
    // because it does nothing is worse than none.
    const results = runFixtures(kiln);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.error).toBeUndefined();
      expect(result, `${result.name}: ${JSON.stringify(result.assertions)}`).toMatchObject({
        ok: true,
      });
    }
  });

  it("reports both sides of a failed assertion", () => {
    // "expected 1" with no "got" sends the author back to the app to find out
    // what actually happened, which is the thing this is meant to save them.
    const [result] = runFixtures(
      withFixtures([
        {
          name: "wrong on purpose",
          events: [{ t: "RunStarted" }, { t: "UnitEntered" }],
          expect: [{ path: "unit", equals: 99 }],
        },
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    expect(result!.assertions[0]).toMatchObject({ expected: 99, actual: 1, ok: false });
  });

  it("fills in the bookkeeping a fixture should not have to write", () => {
    // No packId, no version, no timestamps: an author writes what matters.
    const [result] = runFixtures(
      withFixtures([
        {
          name: "minimal",
          events: [{ t: "RunStarted" }, { t: "UnitEntered" }],
          expect: [
            { path: "packId", equals: kiln.id },
            { path: "packVersion", equals: kiln.version },
            { path: "mode", equals: kiln.defaultMode },
          ],
        },
      ]),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("uses the mode the fixture names", () => {
    const [result] = runFixtures(
      withFixtures([
        {
          name: "in short mode",
          mode: "short",
          events: [{ t: "RunStarted" }],
          expect: [{ path: "mode", equals: "short" }],
        },
      ]),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("treats a log the reducer refuses as a failure, not a crash", () => {
    const [result] = runFixtures(
      withFixtures([
        { name: "no start", events: [{ t: "UnitEntered" }], expect: [{ path: "unit", equals: 1 }] },
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    expect(result!.error).toContain("RunStarted");
  });

  it("does not let a type mismatch pass as a match", () => {
    // YAML makes it easy to write "1" where 1 was meant. A runner that
    // coerced would quietly bless the wrong assertion.
    const [result] = runFixtures(
      withFixtures([
        {
          name: "string against number",
          events: [{ t: "RunStarted" }, { t: "UnitEntered" }],
          expect: [{ path: "unit", equals: "1" }],
        },
      ]),
    );
    expect(result).toMatchObject({ ok: false });
  });
});

describe("reading a dotted path out of run state", () => {
  const state = {
    unit: 2,
    counters: { calm: 3 },
    subjects: [{ id: 1, type: "Bowl", states: ["sealed"] }, { id: 2, type: null }],
  };

  it("reads nested values", () => {
    expect(readPath(state, "counters.calm")).toBe(3);
    expect(readPath(state, "subjects.0.type")).toBe("Bowl");
    expect(readPath(state, "subjects.0.states.0")).toBe("sealed");
  });

  it("reads how many of something there are", () => {
    expect(readPath(state, "subjects.length")).toBe(2);
    expect(readPath(state, "subjects.0.states.length")).toBe(1);
  });

  it("gives undefined for a path that is not there, rather than throwing", () => {
    // A typo in a path should fail the assertion with a readable message, not
    // take the whole run down.
    expect(readPath(state, "counters.nope")).toBeUndefined();
    expect(readPath(state, "subjects.9.type")).toBeUndefined();
    expect(readPath(state, "unit.deeper.still")).toBeUndefined();
    expect(readPath(state, "subjects.notANumber")).toBeUndefined();
  });
});
