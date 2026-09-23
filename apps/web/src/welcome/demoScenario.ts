import type { Pack } from "@runlog/rules-schema";
import {
  awardValue,
  checklistOf,
  clockNow,
  clockOnPhase,
  createRandom,
  entryTextOf,
  executeCounterTrigger,
  formatClock,
  nextStep,
  pendingTriggers,
  playThrough,
  randomFor,
  reduce,
  selectEntry,
  snapshotOf,
  standings,
  type LiveSnapshot,
  type PlayStep,
  type RunEvent,
  type RunState,
} from "@runlog/engine";
import { evidenceFor, pointOf } from "../run/evidence.ts";
import type { Persona, PersonaId } from "./personas.ts";

/**
 * The landing page's examples, played rather than written.
 *
 * Each persona's example is a short run of one bundled pack, driven through
 * the engine from a seed (`landing:<persona>:<generation>`) and a fixed
 * clock, then read back as one model the page renders. What the recipes
 * below hold is the script (which steps, which moves), the editorial names
 * a player would type (a round, an exercise, a match), and pools of
 * contestant names. Every word the pack owns, its titles, results, steps,
 * counters, clocks, comes out of the pack, the folded state, or the
 * snapshot, so the page cannot promise something the pack does not do.
 *
 * Nothing here reads storage, the network or a player's runs: the pack is
 * handed in, already loaded by `loadDemoPack`.
 */

/** The canonical run behind one landing example; pure and testable, not read by React. */
export interface GeneratedDemoRun {
  readonly personaId: PersonaId;
  readonly generation: number;
  readonly seed: string;
  readonly events: readonly RunEvent[];
  readonly state: RunState;
  readonly snapshot: LiveSnapshot;
}

export interface DemoProvenance {
  eventIndex: number;
  outcomeIndex: number;
  tableId: string;
  entryId: string;
  roll: { dice: string; total: number; eventIndex: number };
}

export interface DemoLine {
  id: string;
  where: string;
  roll: string;
  text: string;
  heat: boolean;
  provenance: DemoProvenance;
}

export type DemoWidget =
  | { kind: "scoreboard"; title: string; rows: Array<{ name: string; points: number; place: number }> }
  | { kind: "step"; title: string; text: string; constraints: string[] }
  | { kind: "trackers"; title: string; rows: Array<{ label: string; value: string }> }
  | { kind: "ticker"; title: string; lineId: string }
  | { kind: "clock"; title: string; value: string };

export interface DemoExample {
  personaId: PersonaId;
  generation: number;
  signature: string;
  packId: string;
  packTitle: string;
  modeId: string;
  modeLabel: string;
  at: string;
  participant: string | null;
  lines: DemoLine[];
  historyLineIds: string[];
  state: Array<{ label: string; value: string }>;
  widgets: DemoWidget[];
  widgetCaption: string;
}

/** What each recipe names in its pack, by id: checked against the pack by the tests, and the trackers it shows. */
export interface DemoReferences {
  steps: readonly string[];
  tables: readonly string[];
  moves: readonly string[];
  counters: readonly string[];
  resources: readonly string[];
}

export const DEMO_REFERENCES: Readonly<Record<PersonaId, DemoReferences>> = {
  streamer: {
    steps: ["open#0", "open#1", "play#0", "call#0"],
    tables: ["stakes", "forfeits"],
    moves: ["died"],
    counters: ["deaths", "streak", "forfeits"],
    resources: [],
  },
  dj: {
    steps: ["mix#1", "mix#4"],
    tables: ["clubStandard"],
    moves: [],
    counters: ["rounds"],
    resources: ["passes"],
  },
  learner: {
    steps: ["curve#0", "name#0", "focus#0", "focus#1", "work#0", "log#0"],
    tables: ["curveball", "focus"],
    moves: [],
    counters: ["drills", "cleanRun"],
    resources: ["focus"],
  },
  "elden-lord": {
    steps: ["meddle#0", "charge#0", "charge#4", "play#0", "close#0"],
    tables: ["curse", "objective", "blessing"],
    moves: ["settled", "died"],
    counters: ["scenes", "deaths"],
    resources: ["curses", "objectives"],
  },
  "rlcs-champion": {
    steps: ["draw#0", "draw#1", "play#0", "log#0"],
    tables: ["bronze"],
    moves: [],
    counters: ["landed"],
    resources: [],
  },
};

/** Which widgets each example shows, in order; any the snapshot leaves empty are dropped. */
const WIDGETS: Record<PersonaId, ReadonlyArray<DemoWidget["kind"]>> = {
  streamer: ["scoreboard", "ticker", "trackers", "clock"],
  dj: ["step", "trackers", "ticker", "clock"],
  learner: ["step", "trackers", "ticker", "clock"],
  "elden-lord": ["clock", "step", "trackers", "ticker"],
  "rlcs-champion": ["step", "trackers", "ticker"],
};

// Editorial names: what a player would type or call themselves. Never a
// pack's own words; the tests hold every one of these against the pack.
const ALIASES = ["Vex", "Nova", "Kestrel", "Juno", "Rook", "Moth", "Sable", "Tango", "Pixelwitch", "Lowkey"] as const;
const ROUNDS = ["The sewer stage", "The first boss", "The rooftop chase", "The water level", "The final lap", "The ice cave"] as const;
const LEARNERS = ["Alex", "Sam", "Jordan", "Casey", "Riley"] as const;
const EXERCISES = [
  "G major arpeggio, hands together",
  "Past tense verbs, out loud",
  "Two-minute gesture drawings",
  "Serve toss, twenty reps",
  "The opening eight bars",
  "Left hand, bars 5 to 9",
] as const;
const SCENES = ["The ruins by the gate", "A catacomb in the rain", "The bridge at dusk", "Whatever the patrol guards"] as const;
const MATCHES = ["Ranked 2s, solo queue", "Casual 3s with friends", "Ranked 1s, late night", "Tournament warmup"] as const;

const HISTORY_LINES = 4;

/** `count` distinct picks from a pool, from the names stream alone. */
function pick<T>(pool: readonly T[], count: number, random: () => number): T[] {
  const rest = [...pool];
  const out: T[] = [];
  for (let n = 0; n < count && rest.length > 0; n++) {
    const [chosen] = rest.splice(Math.floor(random() * rest.length), 1);
    out.push(chosen!);
  }
  return out;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Times for events added after the base play-through: one second past the
 * latest base event, one tick per committed batch. `final` is the moment the
 * snapshot is taken, never before the last event.
 */
function allocator(events: readonly RunEvent[]) {
  const latest = Math.max(...events.map((e) => Date.parse(e.at)));
  let cursor = latest + 1000;
  let last = latest;
  return {
    next(): string {
      last = cursor;
      cursor += 1000;
      return new Date(last).toISOString();
    },
    final(): string {
      return new Date(last).toISOString();
    },
  };
}

function activeRef(pack: Pack, state: RunState): string | null {
  const active = nextStep(pack, state);
  return active ? `${active.phase.id}#${active.index}` : null;
}

function expectAt(pack: Pack, state: RunState, ref: string, personaId: PersonaId): void {
  const at = activeRef(pack, state);
  if (at !== ref) throw new Error(`Demo ${personaId} expected to be at ${ref}, but the run is at ${at ?? "no step"}`);
}

interface Played {
  events: RunEvent[];
  /** When the snapshot is taken: the last event's time. */
  at: string;
}

/** The names stream: separate from the pack's rolls, so a name never moves a die. */
function namesFor(seed: string): () => number {
  return createRandom(`${seed}:names`);
}

/** The one learner, named first from the names stream; the recipe draws the same name before anything else. */
function learnerName(seed: string): string {
  return pick(LEARNERS, 1, namesFor(seed))[0]!;
}

type Recipe = (pack: Pack, ctx: { persona: Persona; seed: string; now: string; names: () => number }) => Played;

function play(pack: Pack, persona: Persona, seed: string, now: string, script: PlayStep[]) {
  return playThrough(pack, script, { mode: persona.modeId, seed, now });
}

const RECIPES: Record<PersonaId, Recipe> = {
  streamer(pack, { persona, seed, now, names }) {
    const aliases = pick(ALIASES, 3, names);
    const rounds = pick(ROUNDS, 3, names);
    const roster = aliases.map((name) => ({ id: `c-${slug(name)}`, name }));

    const script: PlayStep[] = [];
    rounds.forEach((subject, i) => {
      script.push({ enter: i + 1 }, { step: "open#0" }, { declare: subject });
      if (i < 2) script.push({ step: "play#0" }, { step: "call#0" });
    });
    script.push({ move: "died" }, { move: "died" }, { move: "died" });
    const base = play(pack, persona, seed, now, script).events;

    // The roster sits at the top of the log, and each stake is awarded the
    // moment it is drawn, checked against the run as it stood then.
    const started = base[0]!;
    const events: RunEvent[] = [
      started,
      ...roster.map((c): RunEvent => ({ t: "ContestantAdded", at: started.at, contestant: c.id, name: c.name })),
    ];
    let awarded = 0;
    for (const event of base.slice(1)) {
      events.push(event);
      if (event.t !== "OutcomeResolved" || event.table !== "stakes") continue;
      const prefix = reduce(pack, events);
      const outcome = prefix.outcomes.length - 1;
      const winner = roster[awarded % roster.length]!;
      const points = awardValue(pack, prefix, outcome, winner.id);
      if (points === null) throw new Error(`Demo streamer could not award outcome ${outcome} to ${winner.id}`);
      events.push({ t: "Awarded", at: event.at, contestant: winner.id, outcome, table: event.table, entryId: event.entryId, points });
      awarded++;
    }
    expectAt(pack, reduce(pack, events), "play#0", persona.id);

    const clock = allocator(events);
    const state = reduce(pack, events);
    const due = pendingTriggers(pack, state).find((t) => t.counter === "deaths");
    if (!due) throw new Error("Demo streamer expected the deaths threshold to be due");
    const spun = executeCounterTrigger(pack, state, "deaths", due.index, due.key, {
      answers: {},
      now: clock.next(),
      keyPrefix: due.key,
      random: randomFor(state, events, due.key, seed),
      seeded: true,
    });
    if (spun.status !== "done") throw new Error("Demo streamer's threshold asked for input");
    events.push(...spun.events);
    return { events, at: clock.final() };
  },

  dj(pack, { persona, seed, now }) {
    const script: PlayStep[] = [];
    for (let round = 1; round <= 3; round++) script.push({ enter: round }, { step: "mix#1" }, { step: "mix#4" });
    script.push({ enter: 4 }, { step: "mix#1" });
    const events = play(pack, persona, seed, now, script).events;
    return { events, at: allocator(events).final() };
  },

  learner(pack, { persona, seed, now, names }) {
    // The name comes first off the stream, so `learnerName` finds it again.
    pick(LEARNERS, 1, names);
    const [first, second] = pick(EXERCISES, 2, names);
    const script: PlayStep[] = [
      // Drill 1: the Curveball skips by rule.
      { enter: 1 },
      { declare: first! },
      { step: "focus#0" },
      { step: "focus#1" },
      { step: "work#0", answers: { confirm: true } },
      { step: "log#0" },
      // Drill 2: stops at the Drill itself.
      { enter: 2 },
      { step: "curve#0", answers: { chooseTarget: 1 } },
      { declare: second! },
      { step: "focus#0" },
      { step: "focus#1" },
    ];
    const result = play(pack, persona, seed, now, script);
    expectAt(pack, result.state, "work#0", persona.id);
    return { events: result.events, at: allocator(result.events).final() };
  },

  "elden-lord"(pack, { persona, seed, now, names }) {
    const [scene] = pick(SCENES, 1, names);
    const script: PlayStep[] = [
      { enter: 1 },
      { step: "meddle#0" },
      { step: "charge#0" },
      { declare: scene! },
      { move: "settled" },
      { move: "died" },
      { move: "died" },
    ];
    const result = play(pack, persona, seed, now, script);
    expectAt(pack, result.state, "play#0", persona.id);
    const events = [...result.events];
    const clock = allocator(events);
    const started = clockOnPhase(pack, result.state, "play", clock.next(), events);
    if (!started) throw new Error("Demo elden-lord expected a unit clock on reaching play");
    events.push(started);
    return { events, at: clock.final() };
  },

  "rlcs-champion"(pack, { persona, seed, now, names }) {
    const [match] = pick(MATCHES, 1, names);
    const result = play(pack, persona, seed, now, [{ enter: 1 }, { step: "draw#0" }, { declare: match! }]);
    const active = nextStep(pack, result.state);
    if (!active || `${active.phase.id}#${active.index}` !== "play#0") throw new Error("Demo rlcs-champion expected to be at play#0");
    // Tick the first Bronze mechanic shown, the way the checklist does: the
    // row's key, and the tally beside it.
    const items = checklistOf(active.step);
    const index = items.findIndex((item) => {
      const shows = pointOf(item).shows;
      return shows !== undefined && [shows.table].flat().includes("bronze");
    });
    const point = index >= 0 ? pointOf(items[index]!) : null;
    const shown = point?.shows ? evidenceFor(pack, result.state, point.shows)[0] : undefined;
    if (!point?.tally || !shown) throw new Error("Demo rlcs-champion found no Bronze row to tick");
    const events = [...result.events];
    const clock = allocator(events);
    const at = clock.next();
    events.push(
      { t: "Checked", at, step: "play#0", item: `${index}:${shown.key}`, on: true },
      { t: "CounterChanged", at, counter: point.tally, by: 1 },
    );
    return { events, at: clock.final() };
  },
};

/** Play one persona's recipe through the engine and fold it once. */
export function generateDemoRun(persona: Persona, pack: Pack, options: { generation: number; now: string }): GeneratedDemoRun {
  const seed = `landing:${persona.id}:${options.generation}`;
  const played = RECIPES[persona.id](pack, { persona, seed, now: options.now, names: namesFor(seed) });
  const state = reduce(pack, played.events);
  const snapshot = snapshotOf(pack, state, played.events, played.at);
  return { personaId: persona.id, generation: options.generation, seed, events: played.events, state, snapshot };
}

/** The roll each outcome resolved from: the earliest unused roll of its table in the same committed batch. */
function lineOf(pack: Pack, run: GeneratedDemoRun, used: Set<number>, eventIndex: number, outcomeIndex: number): DemoLine {
  const { events, state, snapshot } = run;
  const outcome = events[eventIndex]!;
  if (outcome.t !== "OutcomeResolved") throw new Error(`event ${eventIndex} is not an outcome`);
  let start = eventIndex;
  while (start > 0 && events[start - 1]!.at === outcome.at) start--;
  let rollIndex = -1;
  for (let j = start; j < eventIndex; j++) {
    const e = events[j]!;
    if (e.t === "Rolled" && e.purpose === outcome.table && !used.has(j)) {
      rollIndex = j;
      break;
    }
  }
  const roll = events[rollIndex];
  if (!roll || roll.t !== "Rolled") throw new Error(`no roll for the outcome at event ${eventIndex}`);
  used.add(rollIndex);
  const table = pack.tables[outcome.table];
  if (!table || selectEntry(table, roll.total)?.id !== outcome.entryId) {
    throw new Error(`${outcome.table} ${roll.total} does not land on ${outcome.entryId}`);
  }
  const folded = state.outcomes[outcomeIndex];
  if (!folded || folded.table !== outcome.table || folded.entryId !== outcome.entryId) {
    throw new Error(`outcome ${outcomeIndex} does not match event ${eventIndex}`);
  }
  const logged = snapshot.log.find((l) => l.n === outcomeIndex + 1);
  return {
    id: `outcome:${eventIndex}`,
    where: logged?.where ?? `${pack.vocabulary.unit.one} ${folded.unit}, ${table.title}`,
    roll: `${roll.dice} → ${roll.total}`,
    text: logged?.text ?? entryTextOf(pack, outcome),
    heat: false,
    provenance: {
      eventIndex,
      outcomeIndex,
      tableId: outcome.table,
      entryId: outcome.entryId,
      roll: { dice: roll.dice, total: roll.total, eventIndex: rollIndex },
    },
  };
}

function trackerRows(persona: Persona, snapshot: LiveSnapshot): Array<{ label: string; value: string }> {
  const refs = DEMO_REFERENCES[persona.id];
  const counters = refs.counters.flatMap((id) => {
    const c = snapshot.counters.find((x) => x.id === id);
    return c ? [{ label: c.label, value: String(c.value) }] : [];
  });
  const resources = refs.resources.flatMap((id) => {
    const r = snapshot.resources.find((x) => x.id === id);
    if (!r) return [];
    const value = r.max !== undefined && r.display !== "number" ? `${r.value}/${r.max}` : String(r.value);
    return [{ label: r.label, value }];
  });
  return [...counters, ...resources];
}

function widgetOf(
  kind: DemoWidget["kind"],
  pack: Pack,
  run: GeneratedDemoRun,
  lines: DemoLine[],
  rows: DemoExample["state"],
): DemoWidget | null {
  const { snapshot, state } = run;
  switch (kind) {
    case "scoreboard": {
      // Only a moderated mode keeps score by contestant, and only awards make one.
      if (!pack.modes[state.mode]?.moderated || state.awards.length === 0) return null;
      const board = standings(state).map((s) => ({ name: s.contestant.name, points: s.points, place: s.place }));
      return board.length > 0 ? { kind, title: snapshot.mode, rows: board } : null;
    }
    case "step": {
      if (!snapshot.step) return null;
      const phase = snapshot.phases.find((p) => p.state === "current");
      const constraints =
        snapshot.constraints && snapshot.constraints.length > 0 ? snapshot.constraints : (snapshot.unitResults ?? []).map((r) => r.text);
      return { kind, title: phase?.label ?? snapshot.where ?? snapshot.step, text: snapshot.step, constraints };
    }
    case "trackers":
      return rows.length > 0 ? { kind, title: snapshot.words.run, rows } : null;
    case "ticker": {
      const latest = lines[lines.length - 1];
      return latest ? { kind, title: latest.where, lineId: latest.id } : null;
    }
    case "clock": {
      const clock = snapshot.clocks[0];
      if (!clock) return null;
      const { shown } = clockNow(clock, snapshot.at, Date.parse(snapshot.at));
      return { kind, title: clock.label, value: formatClock(shown) };
    }
  }
}

/** Read one generated run as the model the page renders. Draws nothing new: everything is on the run. */
export function demoExampleOf(persona: Persona, pack: Pack, run: GeneratedDemoRun): DemoExample {
  const { events, state, snapshot } = run;
  const used = new Set<number>();
  const lines: DemoLine[] = [];
  events.forEach((e, i) => {
    if (e.t === "OutcomeResolved") lines.push(lineOf(pack, run, used, i, lines.length));
  });
  if (lines.length > 0) lines[lines.length - 1]!.heat = true;

  // Who is in it: the roster the log seated, or the one learner. Neither
  // is drawn again from the pack's rolls.
  const learner = persona.id === "learner" ? learnerName(run.seed) : null;
  const participant = {
    ids: learner ? [slug(learner)] : events.flatMap((e) => (e.t === "ContestantAdded" ? [e.contestant] : [])),
    name: learner,
  };
  const rows = trackerRows(persona, snapshot);
  const at = `${snapshot.words.unit} ${state.unit}`;
  const widgets = WIDGETS[persona.id].flatMap((kind) => {
    const w = widgetOf(kind, pack, run, lines, rows);
    return w ? [w] : [];
  });
  const signature = [lines.map((l) => `${l.provenance.tableId}:${l.provenance.entryId}`).join(","), participant.ids.join(",")].join("|");

  return {
    personaId: persona.id,
    generation: run.generation,
    signature,
    packId: pack.id,
    packTitle: snapshot.packTitle,
    modeId: state.mode,
    modeLabel: snapshot.mode,
    at,
    participant: participant.name,
    lines,
    historyLineIds: lines.slice(-HISTORY_LINES).map((l) => l.id),
    state: rows,
    widgets,
    widgetCaption: `${snapshot.packTitle} · ${snapshot.mode} · ${at}`,
  };
}

/** The one call the page makes: play the run, then read it. */
export function generateDemoExample(persona: Persona, pack: Pack, options: { generation: number; now: string }): DemoExample {
  return demoExampleOf(persona, pack, generateDemoRun(persona, pack, options));
}
