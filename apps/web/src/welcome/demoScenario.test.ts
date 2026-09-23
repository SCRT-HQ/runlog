import { beforeAll, describe, expect, it } from "vitest";
import type { Pack } from "@runlog/rules-schema";
import {
  awardValue,
  checklistOf,
  clockOnPhase,
  entryTextOf,
  nextStep,
  pendingTriggers,
  playThrough,
  reduce,
  selectEntry,
  snapshotOf,
  standings,
  type PlayStep,
  type RunEvent,
} from "@runlog/engine";
import { evidenceFor, pointOf } from "../run/evidence.ts";
import { loadDemoPack } from "./demoPacks.ts";
import { DEMO_REFERENCES, demoExampleOf, generateDemoExample, generateDemoRun, type GeneratedDemoRun } from "./demoScenario.ts";
import { PERSONAS, personaById, type PersonaId } from "./personas.ts";

/**
 * The landing examples are real runs: a pack from the repository, played
 * through the engine from a fixed seed and a fixed clock, then read back as
 * one model. These tests look at the run behind each model, the same object
 * `demoExampleOf` was handed, so a line on the page can be traced to the
 * exact events that produced it.
 */

const NOW = "2026-09-18T12:00:00.000Z";
const IDS: PersonaId[] = ["streamer", "dj", "learner", "elden-lord", "rlcs-champion"];
const packs = new Map<PersonaId, Pack>();

beforeAll(async () => {
  for (const id of IDS) packs.set(id, await loadDemoPack(id));
});

function build(id: PersonaId, generation = 0) {
  const persona = personaById(id);
  const pack = packs.get(id)!;
  const run = generateDemoRun(persona, pack, { generation, now: NOW });
  const model = demoExampleOf(persona, pack, run);
  return { persona, pack, run, model };
}

/** Each outcome in the log as table, the roll it was paired with, and the entry it resolved to. */
function rolled(run: GeneratedDemoRun, model: ReturnType<typeof demoExampleOf>): Array<[string, number, string]> {
  return model.lines.map((line) => {
    const outcome = run.events[line.provenance.eventIndex] as Extract<RunEvent, { t: "OutcomeResolved" }>;
    const roll = run.events[line.provenance.roll.eventIndex] as Extract<RunEvent, { t: "Rolled" }>;
    return [outcome.table, roll.total, outcome.entryId];
  });
}

/** A unit's outcomes on some tables, as table, the batch's roll of that table, and the entry, straight from the events. */
function unitRolls(run: GeneratedDemoRun, unit: number, tables: string[]): Array<[string, number, string]> {
  const out: Array<[string, number, string]> = [];
  let at = 0;
  run.events.forEach((e, i) => {
    if (e.t === "UnitEntered") at++;
    if (at !== unit || e.t !== "OutcomeResolved" || !tables.includes(e.table)) return;
    const roll = run.events.slice(0, i).findLast((r) => r.t === "Rolled" && r.purpose === e.table && r.at === e.at);
    out.push([e.table, roll?.t === "Rolled" ? roll.total : -1, e.entryId]);
  });
  return out;
}

/** Every string anywhere in a pack, for checking that recipe text is not pack text. */
function packStrings(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") into.add(value);
  else if (Array.isArray(value)) value.forEach((v) => packStrings(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => packStrings(v, into));
  return into;
}

describe("demo references", () => {
  it.each(IDS)("%s names only steps, tables, moves, counters and resources its pack has", (id) => {
    const persona = personaById(id);
    const pack = packs.get(id)!;
    const refs = DEMO_REFERENCES[id];
    expect(pack.modes[persona.modeId]).toBeDefined();
    for (const ref of refs.steps) {
      const [phaseId, index] = ref.split("#");
      const phase = pack.phases.find((p) => p.id === phaseId);
      expect(phase, ref).toBeDefined();
      expect(phase!.steps[Number(index)], ref).toBeDefined();
    }
    for (const table of refs.tables) expect(pack.tables[table], table).toBeDefined();
    for (const move of refs.moves) expect(pack.moves?.[move], move).toBeDefined();
    for (const counter of refs.counters) expect(pack.counters?.[counter], counter).toBeDefined();
    for (const resource of refs.resources) expect(pack.resources?.[resource], resource).toBeDefined();
  });

  it("covers the five personas in the page's order", () => {
    expect(PERSONAS.map((p) => p.id)).toEqual(IDS);
    expect(Object.keys(DEMO_REFERENCES).sort()).toEqual([...IDS].sort());
  });
});

describe("generated demo runs", () => {
  it.each(IDS)("%s is deterministic for a generation and a fixed clock", (id) => {
    const a = build(id, 0);
    const b = build(id, 0);
    expect(b.run).toEqual(a.run);
    expect(b.model).toEqual(a.model);
    expect(generateDemoExample(a.persona, a.pack, { generation: 0, now: NOW })).toEqual(a.model);
    expect(a.run.seed).toBe(`landing:${id}:0`);
    expect(a.run.personaId).toBe(id);
    expect(a.run.generation).toBe(0);
    const started = a.run.events[0]!;
    expect(started.t).toBe("RunStarted");
    expect(started.t === "RunStarted" && started.seed).toBe(`landing:${id}:0`);
    expect(started.t === "RunStarted" && started.mode).toBe(a.persona.modeId);
  });

  it.each(IDS)("%s differs between generation 0 and generation 1", (id) => {
    expect(build(id, 1).model.signature).not.toBe(build(id, 0).model.signature);
  });

  it.each(IDS)("%s carries its pack's and mode's own ids and words", (id) => {
    const { persona, pack, run, model } = build(id);
    expect(model.personaId).toBe(id);
    expect(model.generation).toBe(0);
    expect(model.packId).toBe(persona.packId);
    expect(model.packId).toBe(pack.id);
    expect(model.modeId).toBe(persona.modeId);
    expect(model.packTitle).toBe(pack.title);
    expect(model.modeLabel).toBe(pack.modes[persona.modeId]!.label);
    expect(model.at).toBe(`${pack.vocabulary.unit.one} ${run.state.unit}`);
    expect(run.snapshot.modeId).toBe(persona.modeId);
  });

  it.each(IDS)("%s keeps one state: the one folded from its own events", (id) => {
    const { pack, run } = build(id);
    expect(run.state).toEqual(reduce(pack, run.events));
    expect(run.snapshot).toEqual(snapshotOf(pack, run.state, run.events, run.snapshot.at));
  });

  it.each(IDS)("%s stamps every event from the fixed clock, never going backwards", (id) => {
    const { run } = build(id);
    const times = run.events.map((e) => Date.parse(e.at));
    expect(times[0]).toBe(Date.parse(NOW));
    times.forEach((t, i) => {
      if (i > 0) expect(t).toBeGreaterThanOrEqual(times[i - 1]!);
    });
    expect(Date.parse(run.snapshot.at)).toBeGreaterThanOrEqual(Math.max(...times));
  });

  it.each(IDS)("%s traces every line to a real outcome and the roll that made it", (id) => {
    const { pack, run, model } = build(id);
    expect(model.lines.length).toBeGreaterThan(0);
    const outcomeEvents = run.events.map((e, i) => [e, i] as const).filter(([e]) => e.t === "OutcomeResolved");
    // Elden shows its latest scene and its thresholds' lines; the rest show every line.
    if (id === "elden-lord") expect(model.lines.length).toBeLessThanOrEqual(outcomeEvents.length);
    else expect(model.lines).toHaveLength(outcomeEvents.length);
    const rollsSeen = new Set<number>();
    model.lines.forEach((line) => {
      const p = line.provenance;
      const k = outcomeEvents.findIndex(([, i]) => i === p.eventIndex);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(line.id).toBe(`outcome:${p.eventIndex}`);
      expect(p.outcomeIndex).toBe(k);
      const outcome = run.events[p.eventIndex]!;
      const roll = run.events[p.roll.eventIndex]!;
      expect(outcome.t).toBe("OutcomeResolved");
      expect(roll.t).toBe("Rolled");
      if (outcome.t !== "OutcomeResolved" || roll.t !== "Rolled") return;
      // Paired inside one committed batch, ahead of the outcome, once only.
      expect(p.roll.eventIndex).toBeLessThan(p.eventIndex);
      expect(roll.at).toBe(outcome.at);
      expect(rollsSeen.has(p.roll.eventIndex)).toBe(false);
      rollsSeen.add(p.roll.eventIndex);
      expect(roll.purpose).toBe(outcome.table);
      expect(p.tableId).toBe(outcome.table);
      expect(p.entryId).toBe(outcome.entryId);
      expect(p.roll).toEqual({ dice: roll.dice, total: roll.total, eventIndex: p.roll.eventIndex });
      const table = pack.tables[outcome.table]!;
      expect(table.entries.some((e) => e.id === outcome.entryId)).toBe(true);
      expect(selectEntry(table, roll.total)?.id).toBe(outcome.entryId);
      const state = run.state.outcomes[k]!;
      expect([state.table, state.entryId]).toEqual([outcome.table, outcome.entryId]);
      expect(line.text).toBe(entryTextOf(pack, outcome));
      expect(line.where).toBe(`${pack.vocabulary.unit.one} ${state.unit}, ${table.title}`);
      expect(line.roll).toBe(`${roll.dice} → ${roll.total}`);
      const logged = run.snapshot.log.find((l) => l.n === k + 1)!;
      expect([logged.where, logged.text]).toEqual([line.where, line.text]);
    });
  });

  it.each(IDS)("%s picks its history and ticker from the lines by identity", (id) => {
    const { model } = build(id);
    const ids = model.lines.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(model.historyLineIds.length).toBeGreaterThan(0);
    for (const lineId of model.historyLineIds) expect(ids).toContain(lineId);
    for (const widget of model.widgets) if (widget.kind === "ticker") expect(ids).toContain(widget.lineId);
    expect(model.lines.filter((l) => l.heat).length).toBeLessThanOrEqual(1);
  });

  it.each(IDS)("%s shows only widgets its snapshot populates", (id) => {
    const { pack, run, model } = build(id);
    for (const widget of model.widgets) {
      switch (widget.kind) {
        case "trackers": {
          expect(widget.rows.length).toBeGreaterThan(0);
          const known = [...run.snapshot.counters, ...run.snapshot.resources].map((r) => r.label);
          for (const row of widget.rows) expect(known).toContain(row.label);
          break;
        }
        case "clock":
          expect(run.snapshot.clocks.map((c) => c.label)).toContain(widget.title);
          break;
        case "step":
          expect(widget.text).toBe(run.snapshot.step);
          break;
        case "scoreboard":
          expect(Boolean(pack.modes[run.state.mode]!.moderated)).toBe(true);
          expect(widget.rows.length).toBeGreaterThan(0);
          break;
        case "ticker":
          break;
      }
    }
    expect(model.widgets.some((w) => w.kind === "clock")).toBe(run.snapshot.clocks.length > 0);
    expect(model.widgets.some((w) => w.kind === "trackers")).toBe(true);
  });

  it.each(IDS)("%s writes no recipe string that is the pack's own prose", (id) => {
    const { pack, run, model } = build(id);
    const prose = packStrings(pack);
    const editorial = [
      ...run.events.flatMap((e) => (e.t === "SubjectDeclared" ? [e.subjectType] : e.t === "ContestantAdded" ? [e.name] : [])),
      ...(model.participant ? [model.participant] : []),
    ];
    // Soundclash declares nothing: a Round there has no subject to name.
    if (id !== "dj") expect(editorial.length).toBeGreaterThan(0);
    for (const text of editorial) expect(prose.has(text), text).toBe(false);
  });

  it("only the moderated streamer has a scoreboard, a roster or standings", () => {
    for (const id of IDS) {
      const { run, model } = build(id);
      const board = model.widgets.some((w) => w.kind === "scoreboard");
      expect(board, id).toBe(id === "streamer");
      if (id === "streamer") continue;
      expect(run.state.contestants, id).toEqual([]);
      expect(run.state.awards, id).toEqual([]);
      expect(run.snapshot.standings, id).toEqual([]);
      expect(run.snapshot.contestants, id).toBe(0);
      expect(run.snapshot.race, id).toBeUndefined();
    }
  });

  it("names a learner, if at all, with one ordinary first name", () => {
    for (const generation of [0, 1, 2, 3]) {
      const { run, model } = build("learner", generation);
      expect(["Alex", "Sam", "Jordan", "Casey", "Riley"]).toContain(model.participant);
      expect(run.events.some((e) => e.t === "ContestantAdded")).toBe(false);
    }
  });
});

describe("seed witnesses", () => {
  const witnesses: Record<PersonaId, [Array<[string, number, string]>, Array<[string, number, string]>]> = {
    streamer: [
      [
        ["stakes", 1, "st-one"],
        ["stakes", 2, "st-one"],
        ["stakes", 6, "st-five"],
        ["forfeits", 2, "fo-offhand"],
      ],
      [
        ["stakes", 5, "st-three"],
        ["stakes", 3, "st-two"],
        ["stakes", 2, "st-one"],
        ["forfeits", 6, "fo-noheal"],
      ],
    ],
    dj: [
      [
        ["clubStandard", 8, "cs-08"],
        ["clubStandard", 19, "cs-19"],
        ["clubStandard", 2, "cs-02"],
        ["clubStandard", 7, "cs-07"],
      ],
      [
        ["clubStandard", 3, "cs-03"],
        ["clubStandard", 9, "cs-09"],
        ["clubStandard", 6, "cs-06"],
        ["clubStandard", 19, "cs-19"],
      ],
    ],
    learner: [
      [
        ["focus", 8, "f-teach"],
        ["curveball", 1, "cb-none"],
        ["focus", 9, "f-perform"],
      ],
      [
        ["focus", 10, "f-choice"],
        ["curveball", 3, "cb-none"],
        ["focus", 5, "f-loop"],
      ],
    ],
    "elden-lord": [
      [
        ["curse", 66, "cu-root"],
        ["objective", 38, "ob-patrol"],
        ["blessing", 22, "bl-stone"],
      ],
      [
        ["curse", 89, "cu-faithless"],
        ["objective", 20, "ob-knight"],
        ["blessing", 26, "bl-somber"],
      ],
    ],
    "rlcs-champion": [
      [
        ["bronze", 4, "b-slide"],
        ["bronze", 3, "b-pads"],
        ["bronze", 5, "b-jump"],
      ],
      [
        ["bronze", 2, "b-save"],
        ["bronze", 5, "b-jump"],
        ["bronze", 6, "b-rotate"],
      ],
    ],
  };

  it.each(IDS.filter((id) => id !== "elden-lord"))("%s reproduces the discovery rolls for generations 0 and 1", (id) => {
    for (const generation of [0, 1] as const) {
      const { run, model } = build(id, generation);
      expect(rolled(run, model)).toEqual(witnesses[id][generation]);
    }
  });

  it("elden-lord reproduces the discovery rolls for Scene 1's curse, objective and blessing", () => {
    // Its example now also fires the pack's thresholds and may play on past
    // Scene 1, so the witnesses are read from Scene 1's own events: the
    // first build fired at entry does not move the scene's own dice.
    for (const generation of [0, 1] as const) {
      const { run } = build("elden-lord", generation);
      const expected = witnesses["elden-lord"][generation].filter(([table]) => run.state.unit === 1 || table !== "blessing");
      expect(unitRolls(run, 1, ["curse", "objective", "blessing"])).toEqual(expected);
    }
  });
});

describe("solo recipes", () => {
  it("Soundclash closes three rounds and calls the fourth", () => {
    const { pack, run, model } = build("dj");
    expect(run.events.filter((e) => e.t === "UnitFinalized")).toHaveLength(3);
    expect(run.state.counters.rounds).toBe(3);
    expect(run.state.unit).toBe(4);
    expect(model.at).toBe(`${pack.vocabulary.unit.one} 4`);
    expect(run.state.outcomes.filter((o) => o.unit === 4)).toHaveLength(1);
  });

  it("Practice Room is in Drill 2 with one Drill logged and Focus spent by the engine", () => {
    const { pack, run } = build("learner");
    expect(run.state.unit).toBe(2);
    expect(run.state.counters.drills).toBe(1);
    expect(run.events.filter((e) => e.t === "UnitFinalized")).toHaveLength(1);
    // Drill 1 skipped its Curveball by rule; Drill 2 rolled one.
    expect(run.state.outcomes.filter((o) => o.table === "curveball").map((o) => o.unit)).toEqual([2]);
    const spent = run.events.reduce((sum, e) => (e.t === "ResourceChanged" && e.resource === "focus" ? sum + (e.by ?? 0) : sum), 0);
    expect(spent).toBe(-2);
    expect(run.state.resources.focus).toBe(pack.resources!.focus!.initial + spent);
    const active = nextStep(pack, run.state)!;
    expect(`${active.phase.id}#${active.index}`).toBe("work#0");
  });

  it("TarnishedTool draws a Curse, an Objective and a Blessing, and plays against its own ten-minute clock", () => {
    const { pack, run, model } = build("elden-lord");
    const scene = run.state.outcomes.filter((o) => o.unit === run.state.unit).map((o) => o.table);
    expect(scene.filter((t) => ["curse", "objective", "blessing"].includes(t))).toEqual(["curse", "objective", "blessing"]);
    const started = run.events.findIndex((e) => e.t === "ClockStarted");
    expect(started).toBe(run.events.length - 1);
    const prefix = reduce(pack, run.events.slice(0, started));
    const clockEvent = run.events[started]!;
    expect(clockOnPhase(pack, prefix, "play", clockEvent.at, run.events.slice(0, started))).toEqual(clockEvent);
    const clock = run.snapshot.clocks.find((c) => c.id === `u${run.state.unit}:unit`)!;
    expect(clock).toMatchObject({ kind: "timer", seconds: 600 });
    expect(run.state.counters.deaths).toBe(run.events.filter((e) => e.t === "CounterChanged" && e.counter === "deaths").length);
    expect(run.state.counters.deaths).toBeGreaterThan(0);
    const active = nextStep(pack, run.state)!;
    expect(`${active.phase.id}#${active.index}`).toBe("play#0");
    const widget = model.widgets.find((w) => w.kind === "clock");
    expect(widget).toEqual({ kind: "clock", title: clock.label, value: "10:00" });
    expect(build("elden-lord").model.widgets).toEqual(model.widgets);
  });

  it("Placement draws only Bronze, and the tally moves only beside its check", () => {
    const { pack, run } = build("rlcs-champion");
    const outcomes = run.events.filter((e) => e.t === "OutcomeResolved");
    expect(outcomes.length).toBe(3);
    expect(outcomes.every((e) => e.t === "OutcomeResolved" && e.table === "bronze")).toBe(true);
    expect(run.state.counters.landed).toBe(1);
    expect(run.state.counters.landed).toBeLessThan(5);
    expect(run.events.some((e) => e.t === "UnitFinalized")).toBe(false);
    const active = nextStep(pack, run.state)!;
    expect(`${active.phase.id}#${active.index}`).toBe("play#0");

    const checks = run.events.map((e, i) => [e, i] as const).filter(([e]) => e.t === "Checked");
    expect(checks).toHaveLength(1);
    const [check, at] = checks[0]!;
    const prefix = reduce(pack, run.events.slice(0, at));
    const items = checklistOf(nextStep(pack, prefix)!.step);
    const index = items.findIndex((item) => {
      const shows = pointOf(item).shows;
      return shows !== undefined && [shows.table].flat().includes("bronze");
    });
    expect(index).toBe(0);
    const first = evidenceFor(pack, prefix, pointOf(items[index]!).shows!)[0]!;
    expect(check).toMatchObject({ t: "Checked", step: "play#0", item: `${index}:${first.key}`, on: true });
    expect(first.key).toMatch(/^o\d+$/);
    const tallies = run.events.map((e, i) => [e, i] as const).filter(([e]) => e.t === "CounterChanged" && e.counter === "landed");
    expect(tallies.map(([, i]) => i)).toEqual([at + 1]);
    expect(tallies[0]![0]).toMatchObject({ by: 1, at: check.at });
  });
});

describe("the finalize step never carries a step widget", () => {
  /**
   * None of the five recipes' own generation-0 runs land on a finalize
   * step except the DJ's (Soundclash's one-press round-ender is the very
   * next thing to happen after Round 4's call). For the other three
   * personas that show a step widget, this plays a script by hand, up to
   * and including the step before the finalize step, so the model built
   * from it is the one case the bundled recipes never reach: the active
   * step *is* the pack's own finalize step.
   */
  function modelAtScript(id: PersonaId, script: PlayStep[]) {
    const persona = personaById(id);
    const pack = packs.get(id)!;
    const seed = `landing:${id}:finalize-probe`;
    const { events } = playThrough(pack, script, { mode: persona.modeId, seed, now: NOW });
    const state = reduce(pack, events);
    const at = events[events.length - 1]!.at;
    const snapshot = snapshotOf(pack, state, events, at);
    const run: GeneratedDemoRun = { personaId: id, generation: -1, seed, events, state, snapshot };
    return { model: demoExampleOf(persona, pack, run), state, pack };
  }

  it("dj: Round 4's call already leaves Soundclash's one-press finalize as the next step", () => {
    const { pack, run, model } = build("dj");
    expect(nextStep(pack, run.state)?.step.kind).toBe("finalizeUnit");
    expect(model.widgets.some((w) => w.kind === "step")).toBe(false);
    // The rest of the example is untouched: this is not "no widgets", just "no step widget".
    expect(model.widgets.some((w) => w.kind === "trackers")).toBe(true);
    expect(model.widgets.some((w) => w.kind === "ticker")).toBe(true);
  });

  it("learner: Drill 1 done up to its own Log carries no step widget", () => {
    const { model, state, pack } = modelAtScript("learner", [
      { enter: 1 },
      { declare: "A test exercise" },
      { step: "focus#0" },
      { step: "focus#1" },
      { step: "work#0", answers: { confirm: true } },
    ]);
    expect(nextStep(pack, state)?.step.kind).toBe("finalizeUnit");
    expect(model.widgets.some((w) => w.kind === "step")).toBe(false);
    expect(model.widgets.some((w) => w.kind === "trackers")).toBe(true);
  });

  it("elden-lord: Play done up to its own End the scene carries no step widget", () => {
    const { model, state, pack } = modelAtScript("elden-lord", [
      { enter: 1 },
      { step: "meddle#0" },
      { step: "charge#0" },
      { declare: "A test scene" },
      { move: "settled" },
      { move: "died" },
      { move: "died" },
      { step: "play#0" },
    ]);
    expect(nextStep(pack, state)?.step.kind).toBe("finalizeUnit");
    expect(model.widgets.some((w) => w.kind === "step")).toBe(false);
    expect(model.widgets.some((w) => w.kind === "trackers")).toBe(true);
  });

  it("rlcs-champion: Play done up to its own Log the match carries no step widget", () => {
    const { model, state, pack } = modelAtScript("rlcs-champion", [
      { enter: 1 },
      { step: "draw#0" },
      { declare: "A test match" },
      { step: "play#0" },
    ]);
    expect(nextStep(pack, state)?.step.kind).toBe("finalizeUnit");
    expect(model.widgets.some((w) => w.kind === "step")).toBe(false);
    expect(model.widgets.some((w) => w.kind === "trackers")).toBe(true);
  });
});

describe("the moderated streamer", () => {
  it("seats three distinct contestants straight after the run starts", () => {
    const { run, model } = build("streamer");
    const [started, ...rest] = run.events;
    const roster = rest.slice(0, 3);
    expect(roster.every((e) => e.t === "ContestantAdded" && e.at === started!.at)).toBe(true);
    expect(run.events.filter((e) => e.t === "ContestantAdded")).toHaveLength(3);
    expect(new Set(run.state.contestants.map((c) => c.id)).size).toBe(3);
    expect(new Set(run.state.contestants.map((c) => c.name)).size).toBe(3);
    const board = model.widgets.find((w) => w.kind === "scoreboard");
    expect(board && board.kind === "scoreboard" && board.rows.map((r) => r.name).sort()).toEqual(
      run.state.contestants.map((c) => c.name).sort(),
    );
  });

  it("awards each round's stake while that round is current, for what the engine says it is worth", () => {
    const { pack, run } = build("streamer");
    const awards = run.events.map((e, i) => [e, i] as const).filter(([e]) => e.t === "Awarded");
    expect(awards).toHaveLength(3);
    expect(new Set(awards.map(([e]) => e.t === "Awarded" && e.contestant)).size).toBe(3);
    for (const [award, i] of awards) {
      if (award.t !== "Awarded") continue;
      const before = run.events[i - 1]!;
      expect(before.t === "OutcomeResolved" && before.table).toBe("stakes");
      expect(award.at).toBe(before.at);
      const prefix = reduce(pack, run.events.slice(0, i));
      expect(award.outcome).toBe(prefix.outcomes.length - 1);
      expect([award.table, award.entryId]).toEqual([prefix.outcomes[award.outcome]!.table, prefix.outcomes[award.outcome]!.entryId]);
      expect(awardValue(pack, prefix, award.outcome, award.contestant)).toBe(award.points);
    }
  });

  it("builds the scoreboard from standings alone", () => {
    const { run, model } = build("streamer");
    const board = model.widgets.find((w) => w.kind === "scoreboard");
    expect(board).toBeDefined();
    const expected = standings(run.state).map((s) => ({ name: s.contestant.name, points: s.points, place: s.place }));
    expect(board!.kind === "scoreboard" && board!.rows).toEqual(expected);
    expect(expected.reduce((sum, r) => sum + r.points, 0)).toBe(run.state.awards.reduce((sum, a) => sum + a.points, 0));
  });

  it("spins the forfeit on the third death in Round 3, and the reducer does the rest", () => {
    const { pack, run, model } = build("streamer");
    expect(run.state.unit).toBe(3);
    expect(run.events.filter((e) => e.t === "CounterChanged" && e.counter === "deaths" && e.by === 1)).toHaveLength(3);
    const fired = run.events.findIndex((e) => e.t === "TriggerFired" && e.key === "counter:deaths:0:u3");
    expect(fired).toBeGreaterThan(0);
    const spin = run.events.filter((e) => e.t === "OutcomeResolved" && e.table === "forfeits");
    expect(spin).toHaveLength(1);
    // Read the spin from its own batch: the events the trigger committed.
    // Nothing writes `forfeits` directly; the reducer counts the states the
    // spin applied, so the tally is checked against those events.
    const batchAt = run.events[fired]!.at;
    const start = run.events.findIndex((e) => e.at === batchAt);
    const batch = run.events.slice(start, fired + 1);
    const applied = batch.flatMap((e) => (e.t === "StateApplied" ? [e.state] : []));
    const before = reduce(pack, run.events.slice(0, start));
    expect(before.counters.deaths).toBe(3);
    expect(batch.some((e) => e.t === "CounterChanged" && e.counter === "deaths" && e.set === 0)).toBe(true);
    expect(run.state.counters.deaths).toBe(0);
    expect(run.state.counters.forfeits).toBe((before.counters.forfeits ?? 0) + applied.length);
    const round = run.state.subjects.find((s) => s.unit === 3)!;
    expect(round.states).toEqual(applied);
    // Round 3 is still being played: the stake is out, the step is not done.
    const active = nextStep(pack, run.state)!;
    expect(`${active.phase.id}#${active.index}`).toBe("play#0");
    // The spin comes after every base event, one tick past the last of them.
    const base = run.events.slice(0, fired).filter((e) => e.at !== run.events[fired]!.at);
    expect(Date.parse(run.events[fired]!.at)).toBe(Math.max(...base.map((e) => Date.parse(e.at))) + 1000);
    const last = model.lines[model.lines.length - 1]!;
    expect(last.provenance.tableId).toBe("forfeits");
    expect(last.heat).toBe(true);
  });
});

describe("re-rolls", () => {
  it("pairs an outcome with the roll the engine kept, not one it threw again", () => {
    // Seed landing:elden-lord:24 draws an objective that cannot apply in
    // Scene 1, and the engine throws again: both rolls are in the log. The
    // example for generation 24 now plays past Scene 1, so the scene is
    // played here on its own and read by the same model builder.
    const persona = personaById("elden-lord");
    const pack = packs.get("elden-lord")!;
    const seed = "landing:elden-lord:24";
    const { events } = playThrough(
      pack,
      [{ enter: 1 }, { step: "meddle#0" }, { step: "charge#0" }, { declare: "A test scene" }, { move: "settled" }],
      { mode: persona.modeId, seed, now: NOW },
    );
    const state = reduce(pack, events);
    const snapshot = snapshotOf(pack, state, events, events[events.length - 1]!.at);
    const run: GeneratedDemoRun = { personaId: "elden-lord", generation: 24, seed, events, state, snapshot };
    const model = demoExampleOf(persona, pack, run);
    const line = model.lines.find((l) => l.provenance.tableId === "objective")!;
    const outcome = run.events[line.provenance.eventIndex]!;
    const table = pack.tables.objective!;
    const rolls = run.events
      .map((e, i) => [e, i] as const)
      .filter(([e]) => e.t === "Rolled" && e.purpose === "objective" && e.at === outcome.at);
    expect(rolls.length).toBeGreaterThan(1);
    const [kept] = rolls[rolls.length - 1]!;
    expect(kept.t === "Rolled" && line.provenance.roll.total).toBe(kept.t === "Rolled" && kept.total);
    expect(line.provenance.roll.eventIndex).toBe(rolls[rolls.length - 1]![1]);
    for (const [spent] of rolls.slice(0, -1)) {
      expect(spent.t === "Rolled" && selectEntry(table, spent.total)?.id).not.toBe(line.provenance.entryId);
    }
  });

  it.each(IDS)("%s generates generations 0 to 99 without throwing", (id) => {
    const persona = personaById(id);
    const pack = packs.get(id)!;
    for (let generation = 0; generation < 100; generation++) {
      expect(() => generateDemoExample(persona, pack, { generation, now: NOW }), `${id} ${generation}`).not.toThrow();
    }
  });
});

describe("the TarnishedTool stages", () => {
  /** Which stage a run reached, read from the thresholds its events fired. */
  function stageOf(events: readonly RunEvent[]): "opening" | "displacement" | "newBuild" {
    const keys = events.flatMap((e) => (e.t === "TriggerFired" ? [e.key] : []));
    if (keys.some((k) => k.startsWith("counter:gear:1:"))) return "newBuild";
    if (keys.some((k) => k.startsWith("counter:wander:0:"))) return "displacement";
    return "opening";
  }
  const runs = () => Array.from({ length: 100 }, (_, generation) => build("elden-lord", generation));

  it("reaches all three stages across generations 0 to 99, about half of them the opening", () => {
    const counts = { opening: 0, displacement: 0, newBuild: 0 };
    for (const { run } of runs()) counts[stageOf(run.events)]++;
    expect(counts.opening).toBeGreaterThan(30);
    expect(counts.opening).toBeLessThan(70);
    expect(counts.displacement).toBeGreaterThan(10);
    expect(counts.newBuild).toBeGreaterThan(10);
  });

  it("fires the first build in Scene 1 of every example, and leaves nothing due", () => {
    const pack = packs.get("elden-lord")!;
    for (const { run } of runs()) {
      const entered = run.events.findIndex((e) => e.t === "UnitEntered");
      const first = run.events.findIndex((e) => e.t === "TriggerFired" && e.key === "counter:gear:0");
      expect(first).toBeGreaterThan(entered);
      expect(run.events.slice(entered + 1, first).some((e) => e.t === "UnitEntered")).toBe(false);
      const batch = run.events.filter((e) => e.at === run.events[first]!.at);
      const tables = batch.flatMap((e) => (e.t === "OutcomeResolved" ? [e.table] : []));
      expect(tables.some((t) => t.startsWith("loadout-"))).toBe(true);
      expect(tables.some((t) => t.startsWith("warp-"))).toBe(true);
      expect(pendingTriggers(pack, reduce(pack, run.events))).toEqual([]);
    }
  });

  it("reaches a later build tier than the first, by the engine's reading of the run's length", () => {
    const tiers = new Set<string>();
    for (const { run } of runs()) {
      for (const e of run.events) if (e.t === "OutcomeResolved" && e.table.startsWith("loadout-")) tiers.add(e.table);
    }
    expect(tiers.size).toBeGreaterThan(1);
  });

  it("shows the warp and the build the run is on, with their provenance, beside the latest scene", () => {
    for (const { run, model } of runs()) {
      const stage = stageOf(run.events);
      const shownTables = model.lines.map((l) => l.provenance.tableId);
      expect(shownTables.some((t) => t.startsWith("loadout-"))).toBe(true);
      if (stage !== "opening") expect(shownTables).toContain("displacement");
      // The displacement shown is the one its threshold committed.
      for (const line of model.lines.filter((l) => l.provenance.tableId === "displacement")) {
        const batch = run.events.filter((e) => e.at === run.events[line.provenance.eventIndex]!.at);
        expect(batch.some((e) => e.t === "TriggerFired" && e.key.startsWith("counter:wander:0:"))).toBe(true);
      }
      for (const id of model.historyLineIds) expect(model.lines.map((l) => l.id)).toContain(id);
      const history = model.lines.filter((l) => model.historyLineIds.includes(l.id)).map((l) => l.provenance.tableId);
      if (stage !== "opening") expect(history).toContain("displacement");
      expect(history.some((t) => t.startsWith("loadout-"))).toBe(true);
    }
  });

  it("falls back to the nearest stage a shorter run can reach", () => {
    // The same pack with Solo capped at five scenes: a warp lands after
    // Scene 4 and Scene 5 can still be entered, but a second build (due on
    // entering Scene 6) cannot.
    const real = packs.get("elden-lord")!;
    const short: Pack = structuredClone(real);
    short.modes.solo!.units = { min: 3, max: 5 };
    const persona = personaById("elden-lord");
    const newBuilds = runs().filter(({ run }) => stageOf(run.events) === "newBuild");
    expect(newBuilds.length).toBeGreaterThan(0);
    for (const { run } of newBuilds.slice(0, 3)) {
      const shorter = generateDemoRun(persona, short, { generation: run.generation, now: NOW });
      expect(shorter.state.plannedUnits).toBe(5);
      expect(stageOf(shorter.events)).toBe("displacement");
      expect(shorter.state.unit).toBe(5);
    }
  });
});
