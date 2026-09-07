import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { parsePack } from "@runlog/rules-schema";
import type { RunEvent } from "./events.ts";
import { effectiveEvents, undoableIds, voidedIds } from "./log.ts";
import { reduce } from "./reduce.ts";
import { renderLog } from "./export.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const kilnSrc = readFileSync(join(repoRoot, "packs", "demo", "pack.yaml"), "utf8");
const kiln = (() => {
  const r = parsePack(YAML.parse(kilnSrc));
  if (!r.ok) throw new Error("demo pack did not parse");
  return r.pack;
})();

const at = "2026-01-01T00:00:00Z";
const started: RunEvent = { t: "RunStarted", at, id: "e0", packId: kiln.id, packVersion: kiln.version, mode: kiln.defaultMode };
const enter = (id: string): RunEvent => ({ t: "UnitEntered", at, id });
const journal = (id: string, unit: number, text: string): RunEvent => ({ t: "JournalWritten", at, id, unit, text });
const boundary = (e: RunEvent) => e.t === "UnitEntered" || e.t === "JournalWritten";

/**
 * Undo as an event. The log never shrinks; what counts does.
 */
describe("the effective log", () => {
  it("is the log itself when nothing was undone", () => {
    const log = [started, enter("e1"), journal("e2", 1, "a cup")];
    expect(effectiveEvents(log)).toEqual(log);
    expect(voidedIds(log).size).toBe(0);
  });

  it("drops what an Undone names, and the Undone itself", () => {
    const log = [started, enter("e1"), journal("e2", 1, "a cup"), { t: "Undone", at, id: "u1", ids: ["e2"] } as RunEvent];
    expect(effectiveEvents(log).map((e) => e.id)).toEqual(["e0", "e1"]);
    expect(reduce(kiln, log).journal[1]).toBeUndefined();
    expect(reduce(kiln, log).unit).toBe(1);
  });

  it("names the last move for the next undo, from its boundary to the end", () => {
    const log = [started, enter("e1"), journal("e2", 1, "a cup"), journal("e3", 1, "a bowl")];
    expect(undoableIds(log, boundary)).toEqual(["e3"]);
    const undone = [...log, { t: "Undone", at, id: "u1", ids: ["e3"] } as RunEvent];
    expect(undoableIds(undone, boundary)).toEqual(["e2"]);
    expect(undoableIds([started], boundary)).toEqual([]);
  });

  it("refuses to undo by event where the move has no ids", () => {
    const legacy: RunEvent[] = [started, { t: "UnitEntered", at }, { t: "JournalWritten", at, unit: 1, text: "old" }];
    expect(undoableIds(legacy, boundary)).toEqual([]);
  });

  it("leaves another player's later move standing when mine is undone", () => {
    // Two people appended; the server ordered them. Undoing mine names
    // only mine, so theirs is untouched wherever it landed.
    const log = [started, enter("e1"), journal("mine", 1, "mine"), journal("theirs", 1, "theirs"), { t: "Undone", at, id: "u1", ids: ["mine"] } as RunEvent];
    expect(reduce(kiln, log).journal[1]).toBe("theirs");
  });

  it("exports what counts, not what was said", () => {
    const log = [started, enter("e1"), journal("e2", 1, "a cup"), { t: "Undone", at, id: "u1", ids: ["e2"] } as RunEvent, journal("e3", 1, "a bowl")];
    const md = renderLog(kiln, log, { audience: "self" });
    expect(md).toContain("a bowl");
    expect(md).not.toContain("a cup");
  });
});
