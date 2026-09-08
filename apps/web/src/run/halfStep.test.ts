import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { executeTableRoll, reduce, type RunEvent } from "@runlog/engine";
import { clearHalfStep, loadHalfStep, outcomesAhead, saveHalfStep, toPending } from "./halfStep.ts";
import type { Pending } from "./useRun.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent => ({ t, at: NOW, ...props }) as RunEvent;
const log: RunEvent[] = [ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }), ev("UnitEntered")];

/**
 * A Kiln Check answered with a number that sends the player to the Form
 * table: the block stops again to ask for a d6, with the d100 and its line
 * already produced but not committed.
 */
function halfAnswered() {
  const state = reduce(kiln, log);
  const first = executeTableRoll(kiln, state, "check", { answers: {}, now: NOW, keyPrefix: "t" });
  if (first.status !== "awaiting" || !first.request) throw new Error("the check should ask for a roll");
  const key = first.request.key;
  const second = executeTableRoll(kiln, state, "check", { answers: { [key]: 30 }, now: NOW, keyPrefix: "t" });
  if (second.status !== "awaiting") throw new Error("a 30 should lead to the Form table");
  return { key, second };
}

describe("what a block has resolved ahead of the log", () => {
  it("shows the line the first roll landed on before the second is thrown", () => {
    const { second } = halfAnswered();
    const ahead = outcomesAhead(kiln, log, second.events);
    expect(ahead.map((o) => o.entryId)).toEqual(["check-kind"]);
  });

  it("is nothing when the block has produced nothing yet", () => {
    expect(outcomesAhead(kiln, log, [])).toEqual([]);
    expect(outcomesAhead(kiln, log, undefined)).toEqual([]);
  });
});

describe("a half-answered step kept on this device", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
  });

  const pendingOf = (): Pending => {
    const { key, second } = halfAnswered();
    return {
      kind: "table",
      label: "Kiln Check",
      tableId: "check",
      keyPrefix: "t",
      answers: { [key]: 30 },
      generated: [key],
      request: second.request!,
      partial: second.events,
      completes: { phase: kiln.phases[0]!, index: 1 },
    };
  };

  it("comes back with its answers, its step, and nothing it can regenerate", () => {
    saveHalfStep("run-1", log.length, pendingOf());
    const stored = loadHalfStep("run-1");
    expect(stored?.eventCount).toBe(log.length);
    expect(stored?.block.completes).toEqual({ phaseId: kiln.phases[0]!.id, index: 1 });
    expect(stored?.block).not.toHaveProperty("request");
    expect(stored?.block).not.toHaveProperty("partial");
    const back = toPending(kiln, stored!);
    expect(back?.answers).toEqual(pendingOf().answers);
    expect(back?.completes?.phase).toBe(kiln.phases[0]);
  });

  it("is dropped when the pack no longer has its phase", () => {
    saveHalfStep("run-1", log.length, pendingOf());
    const stored = loadHalfStep("run-1")!;
    stored.block.completes = { phaseId: "no-such-phase", index: 0 };
    expect(toPending(kiln, stored)).toBeNull();
  });

  it("belongs to one run, and clears", () => {
    saveHalfStep("run-1", log.length, pendingOf());
    expect(loadHalfStep("run-2")).toBeNull();
    clearHalfStep("run-1");
    expect(loadHalfStep("run-1")).toBeNull();
  });
});
