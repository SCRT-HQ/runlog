import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { playThrough } from "./play.ts";
import { agenda, answer, drive, type DriveAction, type DriveContext, type Pending } from "./drive.ts";
import { itemApplies, shownFor } from "./flow.ts";
import type { RunEvent } from "./events.ts";
import type { AnswerValue } from "./execute.ts";

/**
 * A Discord bot plays a run one button press at a time, in a Lambda that
 * forgets everything between two presses: it cannot hold a call stack open
 * the way `playThrough` (and the app, in memory) can while waiting on a
 * roll. `drive`/`answer` are the primitives that make that possible — each
 * call does one thing and either finishes or hands back a `Pending` plain
 * enough to survive a trip through DynamoDB. These tests drive the demo
 * pack the same worked example `play.test.ts` uses, but one action at a
 * time, the way the bot actually would.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}
const kiln = loadPack("packs/demo/pack.yaml");

const T = (n: number) => new Date(Date.parse("2026-01-01T00:00:00.000Z") + n * 1000).toISOString();

/**
 * Drive one action to completion under autoRoll, answering anything it still
 * asks with the first eligible/offered choice.
 *
 * A roll never awaits once `ctx.random` is set — `obtainRoll` bypasses the
 * request entirely — but the demo pack's Kiln Check can land on a result
 * that hands the *target* to the player by rule (`resolveTarget, from:
 * choice`), which no amount of auto-rolling can answer for itself. A real
 * bot would face the same interruption; this is the same loop it would run.
 */
function driveToCompletion(pack: Pack, events: readonly RunEvent[], action: DriveAction, ctx: DriveContext): RunEvent[] {
  let result = drive(pack, events, action, ctx);
  while (result.status === "awaiting") {
    const req = result.request;
    const value: AnswerValue = req.kind === "chooseTarget" ? req.eligible[0]! : req.kind === "prompt" ? (req.options?.[0] ?? true) : req.kind === "ask" ? true : 0;
    result = answer(pack, events, result.pending, req.key, value, ctx);
  }
  return result.events;
}

describe("agenda", () => {
  it("has nothing to offer before the first unit, and nothing once the run has ended", () => {
    // A caller deciding what button to show needs a menu even before there
    // is a run to speak of — the bot's very first message offers "enter",
    // not a crash because `nextStep` has no state to look at yet.
    expect(agenda(kiln, null, [])).toMatchObject({ phase: "setup", active: null, moves: [] });

    const opening = playThrough(kiln, []).events;
    const started = drive(kiln, opening, { enter: true }, { now: T(0) });
    if (started.status !== "done") throw new Error("enter never awaits");
    const ended = [...opening, ...started.events, { t: "RunEnded" as const, at: T(1), ending: "out" }];
    const endedState = reduce(kiln, ended);
    expect(agenda(kiln, endedState, ended).phase).toBe("ended");
  });

  it("names the active step and its checklist once a unit is entered", () => {
    const opening = playThrough(kiln, []).events;
    const started = drive(kiln, opening, { enter: true }, { now: T(0) });
    if (started.status !== "done") throw new Error("enter never awaits");
    const events = [...opening, ...started.events];
    const state = reduce(kiln, events);
    const a = agenda(kiln, state, events);
    // "Enter the Stage" is a manual step with no checklist of its own in the
    // demo pack, so the agenda should say so rather than inventing one.
    expect(a.phase).toBe("step");
    expect(a.active?.step.kind).toBe("manual");
    expect(a.checklist).toEqual([]);
    expect(a.canFinalize).toBe(false);
  });

  it("lists a rollTable step's own moves and due obligations, not a manual step's", () => {
    // Unit 2's "check" phase is a rollTable step (unit 1 skips it) — the
    // agenda for it should say `active.step.kind === "rollTable"` so a bot
    // knows to offer "roll" rather than a checklist or a declare button.
    const prefix = playThrough(kiln, [
      { enter: 1 },
      { step: "enter" },
      { declare: "Bowl" },
      { step: "work" },
      { finalize: {} },
      { enter: 2 },
      { step: "enter" },
    ]).events;
    const state = reduce(kiln, prefix);
    const a = agenda(kiln, state, prefix);
    expect(a.active?.step.kind).toBe("rollTable");
    expect(a.active).toMatchObject({ phase: { id: "check" } });
  });
});

describe("drive with autoRoll", () => {
  it("completes a table roll in one call, rolling from `createRandom()` rather than asking", () => {
    // With autoRoll on, `obtainRoll` never calls `need()` for this block at
    // all — the whole roll (and whatever it triggers, here a chained roll on
    // the Form table) resolves in the single call, no `answer` round trip.
    const prefix = playThrough(kiln, [
      { enter: 1 },
      { step: "enter" },
      { declare: "Bowl" },
      { step: "work" },
      { finalize: {} },
      { enter: 2 },
      { step: "enter" },
    ]).events;
    const events = driveToCompletion(kiln, prefix, { step: true }, { now: T(0), autoRoll: true });
    const rolled = events.filter((e) => e.t === "Rolled");
    expect(rolled.length).toBeGreaterThan(0);
    // Unseeded and auto-rolled: never "physical" (nobody answered by hand)
    // and never "seeded" (there is no seed here to roll from).
    expect(rolled.every((r) => r.t === "Rolled" && r.source === "rng")).toBe(true);
    expect(events.some((e) => e.t === "OutcomeResolved")).toBe(true);
    expect(events.some((e) => e.t === "StepCompleted" || e.t === "ExtraRollTaken")).toBe(true);
  });
});

describe("a seeded run", () => {
  it("rolls with source \"seeded\", and two runs from the same seed agree", () => {
    // "shared" is the demo pack's seeded mode; autoRoll turns rolling on the
    // same way a moderator's "roll for the table" setting would.
    const script = [
      { enter: 1 },
      { step: "enter" },
      { declare: "Bowl" },
      { step: "work" },
      { finalize: {} },
      { enter: 2 },
      { step: "enter" },
    ];
    const run = () => {
      const prefix = playThrough(kiln, script, { mode: "shared", seed: "drive-1" }).events;
      return driveToCompletion(kiln, prefix, { step: true }, { now: T(0), seed: "drive-1", autoRoll: true });
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    const rolled = a.filter((e) => e.t === "Rolled");
    expect(rolled.length).toBeGreaterThan(0);
    expect(rolled.every((r) => r.t === "Rolled" && r.source === "seeded")).toBe(true);
  });
});

describe("a block that awaits", () => {
  it("resumes from a Pending that survived a JSON round trip the same way it resumes from the live object", () => {
    // Pending sits in DynamoDB between two Lambda invocations, so it has to
    // be plain, serializable data. If any field were a class instance or
    // something JSON drops, a resume that went through a real HTTP round
    // trip would silently diverge from one answered in the same process —
    // exactly the kind of bug that would never show up in an in-memory test.
    const prefix = playThrough(kiln, [
      { enter: 1 },
      { step: "enter" },
      { declare: "Bowl" },
      { step: "work" },
      { finalize: {} },
    ]).events;
    // "breakOne" is a betweenUnits move that prompts chooseSubject — the
    // demo pack's example of a block that asks a real question rather than
    // just rolling dice.
    const state = reduce(kiln, prefix);
    expect(agenda(kiln, state, prefix).moves).toContain("breakOne");

    const started = drive(kiln, prefix, { move: "breakOne" }, { now: T(0) });
    expect(started.status).toBe("awaiting");
    if (started.status !== "awaiting") return;
    expect(started.request.kind).toBe("prompt");

    const roundTripped: Pending = JSON.parse(JSON.stringify(started.pending));
    const resumedFromRoundTrip = answer(kiln, prefix, roundTripped, started.request.key, 1, { now: T(1) });
    const resumedFromLive = answer(kiln, prefix, started.pending, started.request.key, 1, { now: T(1) });
    expect(resumedFromRoundTrip).toEqual(resumedFromLive);

    expect(resumedFromRoundTrip.status).toBe("done");
    if (resumedFromRoundTrip.status !== "done") return;
    const after = reduce(kiln, [...prefix, ...resumedFromRoundTrip.events]);
    expect(after.subjects.find((s) => s.id === 1)?.states).toContain("shattered");
  });
});

/**
 * Drive from wherever the flow is to the close of the current unit, taking
 * the first answer to everything: ticks every box that is asked, declares a
 * bowl, settles what is due, steps on. Stops at the finalize step.
 */
function toFinalize(events: RunEvent[], ctx: DriveContext): RunEvent[] {
  let log = events;
  for (let guard = 0; guard < 80; guard += 1) {
    const state = reduce(kiln, log);
    const a = agenda(kiln, state, log);
    if (!a.active || a.active.step.kind === "finalizeUnit") break;
    const unticked = a.checklist.find((c) => !c.on && !c.optional);
    const action: DriveAction = unticked ? { tick: { index: unticked.index, on: true } } : a.active.step.kind === "declareSubject" ? { declare: "A wide bowl" } : a.due[0] ? { settle: a.due[0].id } : { step: true };
    log = [...log, ...driveToCompletion(kiln, log, action, ctx)];
  }
  return log;
}

describe("a point that shows a table", () => {
  it("is not asked, and not waited for, in a unit where the table produced nothing; asked, and waited for, where it did", () => {
    const ctx: DriveContext = { now: T(0), seed: "confirm-test", autoRoll: true };
    // The demo's first stage draws no Constraint (that phase is skipped in
    // stage one), so the close asks nothing and closes at once.
    const first = toFinalize(playThrough(kiln, [{ enter: 1 }], { seed: "confirm-test" }).events, ctx);
    const one = agenda(kiln, reduce(kiln, first), first);
    expect(one.active?.step.kind).toBe("finalizeUnit");
    const confirm = one.active!.step.kind === "finalizeUnit" ? (one.active!.step.confirm ?? []) : [];
    expect(confirm).toHaveLength(2);
    expect(confirm.every((item) => !itemApplies(kiln, reduce(kiln, first), item))).toBe(true);
    expect(one.checklist).toEqual([]);
    const closed = drive(kiln, first, { finalize: true }, ctx);
    expect(closed.status).toBe("done");
    if (closed.status !== "done") return;
    // The second stage draws a Constraint, so "every Constraint has been
    // honored" is asked, listed with its results, and the close waits for it.
    const entered = drive(kiln, [...first, ...closed.events], { enter: true }, ctx);
    if (entered.status !== "done") throw new Error("enter never awaits");
    const second = toFinalize([...first, ...closed.events, ...entered.events], ctx);
    const state = reduce(kiln, second);
    const two = agenda(kiln, state, second);
    expect(two.active?.step.kind).toBe("finalizeUnit");
    expect(itemApplies(kiln, state, confirm[0]!)).toBe(true);
    expect(shownFor(kiln, state, confirm[0]!).length).toBeGreaterThan(0);
    expect(two.checklist.map((c) => c.index)).toEqual(confirm.map((item, index) => ({ item, index })).filter((x) => itemApplies(kiln, state, x.item)).map((x) => x.index));
    expect(two.checklist.some((c) => c.index === 0)).toBe(true);
    expect(() => drive(kiln, second, { finalize: true }, ctx)).toThrow(/confirmation/);
    let ticked = second;
    for (const c of two.checklist) ticked = [...ticked, ...driveToCompletion(kiln, ticked, { tick: { index: c.index, on: true } }, ctx)];
    const done = drive(kiln, ticked, { finalize: true }, ctx);
    expect(done.status).toBe("done");
    if (done.status === "done") expect(done.events.some((e) => e.t === "UnitFinalized")).toBe(true);
    // A plain point is always asked.
    expect(itemApplies(kiln, state, "A plain point")).toBe(true);
  });
});

describe("tick", () => {
  it("records one checklist box without needing every box ticked", () => {
    const prefix = playThrough(kiln, [{ enter: 1 }, { step: "enter" }, { declare: "Bowl" }]).events;
    const state = reduce(kiln, prefix);
    const before = agenda(kiln, state, prefix);
    expect(before.active?.step.kind).toBe("manual");
    // "Throw it" has two points, but the one that shows this stage's
    // Constraint has nothing to show in stage one and is not asked.
    expect(before.checklist).toHaveLength(1);
    expect(before.checklist[0]!.index).toBe(0);
    expect(before.checklist.every((c) => !c.on)).toBe(true);

    const result = drive(kiln, prefix, { tick: { index: 0, on: true } }, { now: T(0) });
    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    const after = agenda(kiln, reduce(kiln, [...prefix, ...result.events]), [...prefix, ...result.events]);
    expect(after.checklist[0]!.on).toBe(true);
    // Still on the same step: ticking one box does not advance the flow —
    // that is what a `{ step: true }` action, gated on every box being
    // ticked, is for.
    expect(after.active?.step.kind).toBe("manual");
  });
});

describe("finalize", () => {
  it("refuses until the confirm checklist is ticked, then closes the unit", () => {
    const prefix = playThrough(kiln, [{ enter: 1 }, { step: "enter" }, { declare: "Bowl" }, { step: "work" }]).events;
    const state = reduce(kiln, prefix);
    const a = agenda(kiln, state, prefix);
    expect(a.active?.step.kind).toBe("finalizeUnit");
    // Stage one drew nothing the close's confirm points are about, so
    // nothing is asked and nothing stands in the way; the gate itself is
    // proven in stage two, above.
    expect(a.canFinalize).toBe(true); // no due obligations block it, distinct from the checklist gate
    expect(a.checklist).toEqual([]);
    const events = prefix;
    const result = drive(kiln, events, { finalize: true }, { now: T(10) });
    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.events.some((e) => e.t === "UnitFinalized")).toBe(true);
    const after = reduce(kiln, [...events, ...result.events]);
    expect(after.phasesDone).toContain("close");
  });
});
