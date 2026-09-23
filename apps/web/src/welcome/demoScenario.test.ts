import { beforeAll, describe, expect, it } from "vitest";
import type { Pack } from "@runlog/rules-schema";
import {
  awardValue,
  checklistOf,
  clockOnPhase,
  entryTextOf,
  nextStep,
  reduce,
  selectEntry,
  snapshotOf,
  standings,
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
    expect(model.lines).toHaveLength(outcomeEvents.length);
    const rollsSeen = new Set<number>();
    model.lines.forEach((line, k) => {
      const p = line.provenance;
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
          expect(pack.modes[run.state.mode]!.moderated).toBeDefined();
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

  it.each(IDS)("%s reproduces the discovery rolls for generations 0 and 1", (id) => {
    for (const generation of [0, 1] as const) {
      const { run, model } = build(id, generation);
      expect(rolled(run, model)).toEqual(witnesses[id][generation]);
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
    expect(run.state.outcomes.map((o) => o.table)).toEqual(["curse", "objective", "blessing"]);
    expect(run.events.some((e) => e.t === "OutcomeResolved" && e.table === "displacement")).toBe(false);
    const started = run.events.findIndex((e) => e.t === "ClockStarted");
    expect(started).toBe(run.events.length - 1);
    const prefix = reduce(pack, run.events.slice(0, started));
    const clockEvent = run.events[started]!;
    expect(clockOnPhase(pack, prefix, "play", clockEvent.at, run.events.slice(0, started))).toEqual(clockEvent);
    const clock = run.snapshot.clocks.find((c) => c.id === "u1:unit")!;
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
    const entry = pack.tables.forfeits!.entries.find((e) => spin[0]!.t === "OutcomeResolved" && e.id === spin[0]!.entryId)!;
    expect(run.state.counters.deaths).toBe(0);
    expect(run.state.counters.forfeits).toBe(entry.grants?.length ? 1 : 0);
    const round = run.state.subjects.find((s) => s.unit === 3)!;
    expect(round.states).toEqual(entry.grants ?? []);
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
