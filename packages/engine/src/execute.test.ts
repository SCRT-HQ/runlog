import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { createRandom } from "./rng.ts";
import {
  dueObligations,
  executeActions,
  executeObligation,
  executeTableRoll,
  openNotes,
  availableMoves,
  executeMove,
  type AnswerValue,
  type ExecResult,
} from "./execute.ts";
import type { RunEvent } from "./events.ts";
import type { RunState } from "./types.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}
const kiln = loadPack("packs/demo/pack.yaml");
const signal = loadPack("packs/sketches/salt-and-signal.yaml");

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent =>
  ({ t, at: NOW, ...props }) as RunEvent;

/** A run with `n` completed units, so there is something to reach back at. */
function runWith(n: number): RunState {
  const log: RunEvent[] = [
    ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
  ];
  for (let i = 1; i <= n; i++) {
    log.push(ev("UnitEntered"), ev("SubjectDeclared", { subjectType: `Piece ${i}` }), ev("UnitFinalized"));
  }
  log.push(ev("UnitEntered"));
  return reduce(kiln, log);
}

const ctx = (answers: Record<string, AnswerValue> = {}, random?: () => number) => ({
  answers,
  now: NOW,
  ...(random ? { random } : {}),
});

/** Keep answering until execution completes, so a test reads as one act. */
function runToCompletion(
  step: (answers: Record<string, AnswerValue>) => ExecResult,
  answer: (r: NonNullable<ExecResult["request"]>) => AnswerValue,
): ExecResult {
  const answers: Record<string, AnswerValue> = {};
  for (let guard = 0; guard < 20; guard++) {
    const result = step(answers);
    if (result.status === "done") return result;
    answers[result.request!.key] = answer(result.request!);
  }
  throw new Error("execution never completed");
}

describe("executing actions", () => {
  describe("interruptibility", () => {
    it("stops and asks for a roll when there is no random source", () => {
      // Physical dice are the default. The engine must ask rather than invent
      // fate on the player's behalf.
      const result = executeTableRoll(kiln, runWith(2), "check", ctx());
      expect(result.status).toBe("awaiting");
      expect(result.request).toMatchObject({ kind: "roll", dice: "d100", purpose: "check" });
    });

    it("commits nothing while it is still waiting", () => {
      const result = executeTableRoll(kiln, runWith(2), "check", ctx());
      // No outcome may be recorded before the question is answered.
      expect(result.events.some((e) => e.t === "OutcomeResolved")).toBe(false);
    });

    it("carries on once the answer is supplied", () => {
      const result = executeTableRoll(kiln, runWith(2), "check", ctx({ check: 5 }));
      expect(result.status).toBe("done");
      expect(result.events).toEqual([
        expect.objectContaining({ t: "Rolled", total: 5, source: "physical" }),
        expect.objectContaining({ t: "OutcomeResolved", entryId: "check-quiet" }),
      ]);
    });

    it("retraces the identical path when resumed", () => {
      // Resuming re-runs from the top, replaying answers. If that were not
      // faithful, a half-answered resolution could take a different branch the
      // second time and quietly contradict what the player was already told.
      const state = runWith(3);
      const answers = { check: 74, "check=74/t0/1#0": 3 };
      const a = executeTableRoll(kiln, state, "check", ctx(answers));
      const b = executeTableRoll(kiln, state, "check", ctx(answers));
      expect(a).toEqual(b);
      expect(a.status).toBe("done");
    });

    it("generates rolls instead of asking when given a random source", () => {
      const result = executeTableRoll(kiln, runWith(2), "check", ctx({}, createRandom("seed")));
      expect(result.status).toBe("done");
      expect(result.events[0]).toMatchObject({ t: "Rolled", source: "rng" });
    });
  });

  describe("triggers that fire now", () => {
    it("follows an entry that rolls on another table", () => {
      // Kiln Check 20–69 says: the Kiln dictates the form. Roll on Form.
      const result = executeTableRoll(
        kiln,
        runWith(1),
        "check",
        ctx({ check: 40, "check=40/t0/0#0": 3 }),
      );
      expect(result.status).toBe("done");
      const resolved = result.events.filter((e) => e.t === "OutcomeResolved");
      expect(resolved).toEqual([
        expect.objectContaining({ table: "check", entryId: "check-kind" }),
        expect.objectContaining({ table: "form", entryId: "form-plate" }),
      ]);
    });

    it("applies the states an entry grants", () => {
      const result = executeActions(
        kiln,
        runWith(2),
        [{ do: "applyState", state: "locked", to: "thisSubject" }],
        ctx(),
      );
      expect(result.events).toEqual([
        expect.objectContaining({ t: "StateApplied", state: "locked", subject: 3 }),
      ]);
    });

    it("routes a run-scoped state to the run", () => {
      const result = executeTableRoll(kiln, runWith(2), "check", ctx({ check: 100 }));
      expect(result.events).toContainEqual(
        expect.objectContaining({ t: "StateApplied", state: "coldKiln" }),
      );
      expect(result.events.find((e) => e.t === "StateApplied")).not.toHaveProperty("subject");
    });
  });

  describe("targeting inside an action list", () => {
    it("aims the consequence and lands it on the computed subject", () => {
      // A 74 against three eligible: anchor newest (id 3), four before it,
      // 4 % 3 = 1, so one before the newest -- id 2.
      const result = executeTableRoll(
        kiln,
        runWith(3),
        "check",
        ctx({ check: 74, "check=74/t0/1#0": 1 }),
      );
      expect(result.status).toBe("done");
      const setback = result.events.find(
        (e) => e.t === "OutcomeResolved" && e.table === "setback",
      );
      expect(setback).toMatchObject({ targetSubject: 2, entryId: "set-crack" });
      // The granted state lands on the target, not on the piece being made.
      expect(result.events).toContainEqual(
        expect.objectContaining({ t: "StateApplied", state: "locked", subject: 2 }),
      );
    });

    it("asks the player when the rules hand them the choice", () => {
      const result = executeTableRoll(kiln, runWith(3), "check", ctx({ check: 95 }));
      expect(result.status).toBe("awaiting");
      expect(result.request).toMatchObject({ kind: "chooseTarget", eligible: [1, 2, 3] });
    });

    it("honors the choice once made", () => {
      const result = executeTableRoll(
        kiln,
        runWith(3),
        "check",
        ctx({ check: 95, "check=95/t0/0": 1, "check=95/t0/1#0": 9 }),
      );
      expect(result.status).toBe("done");
      expect(result.events).toContainEqual(
        expect.objectContaining({ t: "OutcomeResolved", table: "setback", targetSubject: 1 }),
      );
    });
  });

  describe("deferred triggers become obligations", () => {
    it("queues rather than runs a trigger due later", () => {
      // Constraint 11 pushes the form to near-collapse and checks *after*
      // composing. Nothing should happen yet.
      const result = executeTableRoll(kiln, runWith(1), "constraint", ctx({ constraint: 11 }));
      expect(result.status).toBe("done");
      expect(result.events.some((e) => e.t === "Rolled" && e.dice === "d6")).toBe(false);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          t: "ObligationAdded",
          obligation: expect.objectContaining({ kind: "trigger", on: "afterWork" }),
        }),
      );
    });

    it("surfaces the obligation at the moment it comes due", () => {
      const state = reduce(kiln, [
        ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
        ev("UnitEntered"),
        ...executeTableRoll(kiln, runWith(0), "constraint", ctx({ constraint: 11 })).events,
      ]);
      expect(dueObligations(state, "afterWork")).toHaveLength(1);
      expect(dueObligations(state, "onFinalize")).toHaveLength(0);
    });

    it("runs the queued actions and marks the debt settled", () => {
      const base = runWith(1);
      const queued = executeTableRoll(kiln, base, "constraint", ctx({ constraint: 11 }));
      const state = reduce(kiln, [
        ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
        ev("UnitEntered"),
        ...queued.events,
      ]);
      const owed = dueObligations(state, "afterWork")[0]!;

      // A 6 collapses the form.
      const done = runToCompletion(
        (answers) => executeObligation(kiln, state, owed.id, ctx(answers)),
        () => 6,
      );
      expect(done.events).toContainEqual(
        expect.objectContaining({ t: "StateApplied", state: "shattered" }),
      );
      expect(done.events.at(-1)).toMatchObject({ t: "ObligationResolved", id: owed.id });
    });

    it("takes the other branch on a low roll", () => {
      const base = runWith(1);
      const queued = executeTableRoll(kiln, base, "constraint", ctx({ constraint: 11 }));
      const state = reduce(kiln, [
        ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
        ev("UnitEntered"),
        ...queued.events,
      ]);
      const owed = dueObligations(state, "afterWork")[0]!;
      const done = runToCompletion(
        (answers) => executeObligation(kiln, state, owed.id, ctx(answers)),
        () => 2,
      );
      expect(done.events.some((e) => e.t === "StateApplied")).toBe(false);
      expect(done.events).toContainEqual(
        expect.objectContaining({ t: "ObligationResolved", id: owed.id }),
      );
    });

    it("gives a queued trigger a stable id, so replaying cannot double the debt", () => {
      const state = runWith(1);
      const once = executeTableRoll(kiln, state, "constraint", ctx({ constraint: 11 }));
      const twice = executeTableRoll(kiln, state, "constraint", ctx({ constraint: 11 }));
      expect(once.events).toEqual(twice.events);

      const folded = reduce(kiln, [
        ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
        ev("UnitEntered"),
        ...once.events,
        ...twice.events,
      ]);
      expect(folded.obligations).toHaveLength(1);
    });
  });

  describe("notes", () => {
    it("records a manual instruction the player must tick off", () => {
      const result = executeActions(
        kiln,
        runWith(1),
        [{ do: "note", text: "Go and look at it in daylight." }],
        ctx(),
      );
      const state = reduce(kiln, [
        ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
        ev("UnitEntered"),
        ...result.events,
      ]);
      expect(openNotes(state)).toHaveLength(1);
      expect(openNotes(state)[0]!.text).toBe("Go and look at it in daylight.");
    });

    it("starts a clock for a timer; the app still cannot make you stop, but it can tell you when", () => {
      const result = executeActions(
        kiln,
        runWith(1),
        [{ do: "startTimer", minutes: 4, label: "Stage fires" }],
        ctx(),
      );
      expect(result.events[0]).toMatchObject({ t: "ClockStarted", kind: "timer", label: "Stage fires", seconds: 240 });
    });
  });

  describe("predicates", () => {
    it("asks the player about anything the engine cannot see", () => {
      const result = executeActions(
        kiln,
        runWith(2),
        [
          {
            do: "when",
            all: [{ ask: "Does this piece have a handle?" }],
            then: [{ do: "note", text: "Break the handle off." }],
          },
        ],
        ctx(),
      );
      expect(result.status).toBe("awaiting");
      expect(result.request).toMatchObject({ kind: "ask", question: "Does this piece have a handle?" });
    });

    it("takes the branch the answer selects", () => {
      const actions = [
        {
          do: "when" as const,
          all: [{ ask: "Does this piece have a handle?" }],
          then: [{ do: "note" as const, text: "Break the handle off." }],
          else: [{ do: "note" as const, text: "Leave it alone." }],
        },
      ];
      const yes = executeActions(kiln, runWith(2), actions, ctx({ "/0?0": true }));
      const no = executeActions(kiln, runWith(2), actions, ctx({ "/0?0": false }));
      expect(yes.events[0]).toMatchObject({ obligation: { text: "Break the handle off." } });
      expect(no.events[0]).toMatchObject({ obligation: { text: "Leave it alone." } });
    });

    it("reads run state without asking anyone", () => {
      const result = executeActions(
        kiln,
        runWith(4),
        [
          {
            do: "when",
            all: [{ eligibleTargets: { gte: 3 } }],
            then: [{ do: "note", text: "Plenty to lose." }],
          },
        ],
        ctx(),
      );
      expect(result.status).toBe("done");
      expect(result.events[0]).toMatchObject({ obligation: { text: "Plenty to lose." } });
    });
  });

  describe("opposed resolution", () => {
    it("counts how many challenge dice the action beat", () => {
      const state = reduce(signal, [
        ev("RunStarted", { packId: signal.id, packVersion: signal.version, mode: "standard" }),
        ev("UnitEntered"),
      ]);
      // Action 5 plus 1 Nerve is 6, against 3 and 4: beats both.
      const result = executeTableRoll(signal, state, "signal", {
        answers: { signala: 5, signalc0: 3, signalc1: 4 },
        now: NOW,
      });
      expect(result.status).toBe("done");
      expect(result.events).toContainEqual(
        expect.objectContaining({ t: "OutcomeResolved", entryId: "signal-strong" }),
      );
    });

    it("gives ties to the challenge", () => {
      const state = reduce(signal, [
        ev("RunStarted", { packId: signal.id, packVersion: signal.version, mode: "standard" }),
        ev("UnitEntered"),
      ]);
      // Action 5 plus 1 Nerve is 6, against 6 and 6: beats neither.
      const result = executeTableRoll(signal, state, "signal", {
        answers: { signala: 5, signalc0: 6, signalc1: 6 },
        now: NOW,
      });
      expect(result.events).toContainEqual(
        expect.objectContaining({ t: "OutcomeResolved", entryId: "signal-miss" }),
      );
    });
  });
});

describe("roll provenance", () => {
  /**
   * The log says how every number came about. A convenience button must not be
   * able to launder a generated roll into the record as a physical one — an
   * auditable log that quietly lies is worse than no log.
   */
  it("records a player-entered roll as physical", () => {
    const result = executeTableRoll(kiln, runWith(1), "check", ctx({ check: 5 }));
    expect(result.events[0]).toMatchObject({ t: "Rolled", total: 5, source: "physical" });
  });

  it("records a roll the app made as rng, even though the player supplied it", () => {
    const result = executeTableRoll(kiln, runWith(1), "check", {
      answers: { check: 5 },
      generatedAnswers: ["check"],
      now: NOW,
    });
    expect(result.events[0]).toMatchObject({ t: "Rolled", total: 5, source: "rng" });
  });

  it("marks only the rolls that were actually generated", () => {
    // The check was thrown by hand; the setback was not.
    const result = executeTableRoll(kiln, runWith(3), "check", {
      answers: { check: 74, "check=74/t0/1#0": 3 },
      generatedAnswers: ["check=74/t0/1#0"],
      now: NOW,
    });
    const rolls = result.events.filter((e) => e.t === "Rolled");
    expect(rolls.map((r) => (r as { source: string }).source)).toEqual(["physical", "rng"]);
  });
});

describe("moves the player chooses to make", () => {
  /**
   * Before these existed the format had only two ways for anything to happen:
   * a scheduled step, or a consequence of a table result. Transcribing a real
   * rulebook made the omission obvious — spending a one-shot card, re-entering
   * an earlier unit to repair it. All optional, all gated, none on a schedule.
   */
  it("offers nothing on the first unit, when the gate does not hold", () => {
    const available = availableMoves(kiln, runWith(0), "beforeEnding");
    expect(available.map((m) => m.id)).not.toContain("salvage");
  });

  it("offers the move once its conditions hold", () => {
    const available = availableMoves(kiln, runWith(3), "beforeEnding");
    expect(available.map((m) => m.id)).toContain("salvage");
  });

  it("keeps moves to the part of the flow they belong in", () => {
    const state = runWith(3);
    expect(availableMoves(kiln, state, "betweenUnits").map((m) => m.id)).toEqual(["breakOne"]);
    expect(availableMoves(kiln, state, "beforeEnding").map((m) => m.id)).toEqual(["salvage"]);
  });

  it("spends a once-per-run move", () => {
    const state = runWith(3);
    const taken = executeMove(kiln, state, "salvage", ctx({ "move:salvage/0": 6 }));
    expect(taken.status).toBe("done");
    const after = reduce(kiln, [
      ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
      ...taken.events,
    ]);
    expect(availableMoves(kiln, after, "beforeEnding").map((m) => m.id)).not.toContain("salvage");
  });

  it("compares the roll against what the run has accumulated, not a fixed number", () => {
    // Two Setbacks suffered, so a 2 succeeds and a 3 does not.
    const withTwo = reduce(kiln, [
      ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
      ev("UnitEntered"),
      ev("SubjectDeclared", { subjectType: "Bowl" }),
      ev("UnitFinalized"),
      ev("UnitEntered"),
      ev("CounterChanged", { counter: "setbacksSuffered", by: 2 }),
    ]);

    const succeeds = executeMove(kiln, withTwo, "salvage", ctx({ "move:salvage/0": 2 }));
    expect(succeeds.status).toBe("awaiting");
    expect(succeeds.request).toMatchObject({ kind: "prompt", promptKind: "chooseSubject" });

    const fails = executeMove(kiln, withTwo, "salvage", ctx({ "move:salvage/0": 3 }));
    expect(fails.status).toBe("done");
    expect(fails.events).toContainEqual(
      expect.objectContaining({
        t: "ObligationAdded",
        obligation: expect.objectContaining({ text: "The Kiln does not relent." }),
      }),
    );
  });

  it("runs a move's actions when taken", () => {
    const state = runWith(2);
    const taken = executeMove(kiln, state, "breakOne", ctx({ "move:breakOne/0": 1 }));
    expect(taken.status).toBe("done");
    expect(taken.events).toContainEqual(
      expect.objectContaining({ t: "StateApplied", state: "shattered", subject: 1 }),
    );
  });
});

/**
 * Which moves are offered, and how many times.
 *
 * Reported from play: a move appeared twice in the list between units. The
 * cause was asking for two placements with two calls and concatenating — an
 * `anytime` move belongs to every placement, so it came back once per call.
 * React had been warning about the duplicate key for a while and nobody had
 * read it.
 */
describe("moves offered at a point in the flow", () => {
  const packWithMoves = {
    ...kiln,
    moves: {
      always: { label: "Always", oncePerRun: false, when: "anytime" as const, do: [{ do: "note" as const, text: "x" }] },
      between: { label: "Between", oncePerRun: false, when: "betweenUnits" as const, do: [{ do: "note" as const, text: "x" }] },
      ending: { label: "Ending", oncePerRun: false, when: "beforeEnding" as const, do: [{ do: "note" as const, text: "x" }] },
    },
  };
  const state = reduce(packWithMoves, [
    ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard" }),
    ev("UnitEntered"),
  ]);

  it("offers an anytime move exactly once when several placements are open", () => {
    const ids = availableMoves(packWithMoves, state, ["betweenUnits", "beforeEnding"]).map(
      (m) => m.id,
    );
    expect(ids.filter((id) => id === "always")).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers every move belonging to any open placement", () => {
    const ids = availableMoves(packWithMoves, state, ["betweenUnits", "beforeEnding"]).map(
      (m) => m.id,
    );
    expect(new Set(ids)).toEqual(new Set(["always", "between", "ending"]));
  });

  it("keeps a placement's own moves out of the others", () => {
    const ids = availableMoves(packWithMoves, state, "anytime").map((m) => m.id);
    expect(ids).toEqual(["always"]);
  });

  it("still accepts a single placement", () => {
    const ids = availableMoves(packWithMoves, state, "beforeEnding").map((m) => m.id);
    expect(new Set(ids)).toEqual(new Set(["always", "ending"]));
  });
});
