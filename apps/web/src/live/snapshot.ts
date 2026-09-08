import { modeDoc, summaryDoc, type Doc, type Pack } from "@runlog/rules-schema";
import { activePhases, clockOfUnit, constrainedByOf, constraintsFor, describeSkipReason, elapsedMs, formatScore, liveClocks, mayQuote, nextStep, phaseSkipped, progressOf, scoreOf, standings, subjectName, type RunEvent, type RunState } from "@runlog/engine";

/**
 * A run as anyone may see it: the state and the log, worded, with the
 * pack's own text only where its license lets the text travel.
 *
 * This is what a stranger with a live link gets, what a stream widget
 * draws, and what the owner's device writes to the server after each
 * move for a run whose pack may not be handed over. The engine's state is
 * not shipped as such: it names table entries and states by id, which
 * are meaningless without the pack, and a pack marked not for
 * redistribution must not follow. So the snapshot carries labels and
 * numbers, and for the log the words of the one entry each roll landed
 * on: that much is the run, not the pack. The pack's paper and its tables
 * whole travel only where they may be quoted.
 */
export interface LiveSnapshot {
  v: 1;
  at: string;
  packId: string;
  packTitle: string;
  runName: string | null;
  mode: string;
  /** The mode's id, for the paper about it; absent from snapshots written before it was carried. */
  modeId?: string;
  words: { run: string; unit: string; units: string };
  status: "active" | "ended";
  ending: string | null;
  unit: number;
  /** Where the flow is: the phase and step the run is waiting on. */
  where: string | null;
  /** The step in hand, on its own, and the unit's phases with where each stands: what the player's own screen lists. */
  step: string | null;
  /** The current step's `kind` — `"manual"`, `"declareSubject"`, and so on; null with no step. Absent from snapshots written before it was carried. */
  stepKind?: string | null;
  phases: Array<{ id: string; label: string; state: "done" | "current" | "skipped" | "todo"; why?: string }>;
  /**
   * A rule drawn earlier this unit that the current step must honor, in the
   * pack's own words — the same lines the player's own screen shows in
   * front of them while they work. Empty off a step with nothing to honor,
   * or one with no `constrainedBy` table. Absent from snapshots written
   * before it was carried.
   */
  constraints?: string[];
  /** The pack's text may be handed over whole here: its paper, its tables. The log carries the drawn entries' words either way. */
  quoted: boolean;
  standings: Array<{ name: string; points: number; place: number; states: string[] }>;
  contestants: number;
  subjects: Array<{ id: number; name: string; type: string | null; states: string[]; finalized: boolean }>;
  counters: Array<{ id: string; label: string; value: number }>;
  resources: Array<{ id: string; label: string; value: number; max?: number; display?: "boxes" | "bar" | "number" }>;
  clocks: Array<{ id: string; label: string; kind: "stopwatch" | "timer"; seconds: number | null; status: "running" | "paused" | "done"; elapsedMs: number; expired: boolean }>;
  progress: { unitsDone: number; elapsedMs: number };
  /** What the pack (or its mode) says this run scores, worded and ready to show. */
  score: { label: string; text: string; value: number; better: "higher" | "lower" };
  forcedUnits: number;
  /** Newest first, numbered from the start. */
  log: Array<{ n: number; unit: number; where: string; hit: number | null; text: string }>;
  /**
   * Every result rolled this unit, in the order the dice landed on them —
   * "this unit so far" for a watcher, and a table a manual step draws its
   * constraints from may be rolled more than once. Absent from snapshots
   * written before it was carried.
   */
  unitResults?: Array<{ table: string; text: string; hit: number | null }>;
  /** The most recent log line, for a widget that shows one thing rather than the whole log. Null with nothing rolled yet; absent from snapshots written before it was carried. */
  latest?: { where: string; text: string } | null;
  /** The race this run is in, as its owner's device last saw the leaderboard; absent outside a race. */
  race?: RaceSnapshot;
  /**
   * The paper a watcher may read: the pack's summary and the mode's, as
   * the summary tells them — the shape of the game, never a rule — so a
   * link to a pack that may not travel still says what is being played.
   * Written by the owner's device with the snapshot; the server reads no pack.
   */
  paper?: Paper;
}

export interface Paper {
  summary: Doc;
  mode: Doc | null;
}

const papers = new WeakMap<Pack, Map<string, Paper>>();

/** The summary and the mode's page, made once per pack and mode; the same object comes back after. */
export function paperOf(pack: Pack, modeId: string): Paper {
  let byMode = papers.get(pack);
  if (!byMode) {
    byMode = new Map();
    papers.set(pack, byMode);
  }
  let paper = byMode.get(modeId);
  if (!paper) {
    paper = { summary: summaryDoc(pack), mode: pack.modes[modeId] ? modeDoc(pack, modeId) : null };
    byMode.set(modeId, paper);
  }
  return paper;
}

export interface RaceSnapshot {
  name: string | null;
  ended: boolean;
  racing: number;
  standings: Array<{ name: string; place: number; owner: boolean; line: string; elapsedMs: number }>;
}

/**
 * The leaderboard as a snapshot carries it: names, places and a line
 * each in the pack's own words, so a viewer draws it without the pack.
 */
export function raceOf(
  race: { meta: { name?: string; endedAt?: string }; entries: readonly unknown[] } | null,
  standings: ReadonlyArray<{ entry: { name?: string; progress?: { unit: number; unitsDone: number; status: "active" | "ended"; ending?: string; elapsedMs: number } }; place: number; me: boolean }>,
  words: { one: string; many: string },
): RaceSnapshot | undefined {
  if (!race) return undefined;
  return {
    name: race.meta.name ?? null,
    ended: Boolean(race.meta.endedAt),
    racing: race.entries.length,
    standings: standings.map(({ entry, place, me }) => {
      const p = entry.progress;
      const line = !p
        ? "not started"
        : p.status === "ended"
          ? `finished · ${p.unitsDone} ${p.unitsDone === 1 ? words.one.toLowerCase() : words.many.toLowerCase()}${p.ending ? ` · ${p.ending}` : ""}`
          : `${words.one} ${p.unit} · ${p.unitsDone} done`;
      return { name: entry.name ?? (me ? "You" : "Someone"), place, owner: me, line, elapsedMs: p?.elapsedMs ?? 0 };
    }),
  };
}

const LOG_LINES = 60;

/**
 * The line the dice landed on, in the pack's words, whatever the license
 * says about the pack: a watcher who sees "#mut-071" is watching numbers.
 * What the dice drew is one line of one table; the tables themselves and
 * the pack's paper stay behind `quoted`.
 */
function entryTextOf(pack: Pack, o: RunState["outcomes"][number]): string {
  const table = pack.tables[o.table];
  const entry = table?.entries.find((e) => e.id === o.entryId);
  return entry?.title ?? entry?.text ?? `${table?.title ?? o.table} · #${o.entryId}`;
}

export function snapshotOf(pack: Pack, state: RunState, events: readonly RunEvent[], at: string = new Date().toISOString(), extra: { race?: RaceSnapshot | undefined } = {}): LiveSnapshot {
  const v = pack.vocabulary;
  const quoted = mayQuote(pack, "share");
  const now = Date.parse(at);
  const step = nextStep(pack, state);
  const stepLabel = step ? ("label" in step.step && step.step.label ? step.step.label : step.step.kind === "rollTable" ? (pack.tables[step.step.table]?.title ?? step.step.table) : step.phase.label) : null;
  const phases = state.unit > 0 && state.status !== "ended"
    ? activePhases(pack, state).map((phase) => {
        const done = state.phasesDone.includes(phase.id);
        const current = step?.phase.id === phase.id;
        const skipped = !done && !current && phaseSkipped(pack, state, phase);
        const why = skipped ? describeSkipReason(pack, phase) : null;
        return {
          id: phase.id,
          label: phase.label,
          state: done ? ("done" as const) : current ? ("current" as const) : skipped ? ("skipped" as const) : ("todo" as const),
          ...(why ? { why } : {}),
        };
      })
    : [];
  const stateLabel = (id: string) => pack.states?.[id]?.short ?? pack.states?.[id]?.label ?? id;
  const total = state.outcomes.length;
  const log = [...state.outcomes]
    .reverse()
    .slice(0, LOG_LINES)
    .map((o, i) => ({
      n: total - i,
      unit: o.unit,
      where: `${v.unit.one} ${o.unit}, ${pack.tables[o.table]?.title ?? o.table}`,
      hit: o.targetSubject,
      text: entryTextOf(pack, o),
    }));
  const latest = log[0] ? { where: log[0].where, text: log[0].text } : null;
  // Every result this unit, in the order the dice landed on them — a
  // table rolled twice (an extra roll owed) shows both, oldest first,
  // for "this unit so far" rather than the whole run's log.
  const unitResults = state.outcomes
    .filter((o) => o.unit === state.unit)
    .map((o) => ({ table: pack.tables[o.table]?.title ?? o.table, text: entryTextOf(pack, o), hit: o.targetSubject }));
  const constraints = step ? constraintsFor(pack, state, constrainedByOf(step.step)) : [];
  const unitClock = clockOfUnit(state, state.unit);
  const clocks = [...liveClocks(state), ...(unitClock?.status === "done" ? [unitClock] : [])].map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    seconds: c.seconds,
    status: c.status,
    elapsedMs: c.status === "done" ? (c.elapsedMs ?? 0) : elapsedMs(c, now),
    expired: c.expired,
  }));
  const progress = progressOf(state, events, now);
  const score = scoreOf(pack, state, events, now);
  return {
    v: 1,
    at,
    packId: pack.id,
    packTitle: pack.title,
    runName: state.name,
    mode: pack.modes[state.mode]?.label ?? state.mode,
    modeId: state.mode,
    words: { run: v.run.one, unit: v.unit.one, units: v.unit.many },
    status: state.status === "ended" ? "ended" : "active",
    ending: state.ending,
    unit: state.unit,
    where: step && stepLabel ? `${step.phase.label} · ${stepLabel}` : null,
    step: stepLabel,
    stepKind: step?.step.kind ?? null,
    phases,
    constraints,
    quoted,
    standings: standings(state).map((s) => ({ name: s.contestant.name, points: s.points, place: s.place, states: s.contestant.states.map(stateLabel) })),
    contestants: state.contestants.length,
    subjects: state.subjects.filter((s) => !s.removed).map((s) => ({ id: s.id, name: subjectName(pack, s), type: s.type, states: s.states.map(stateLabel), finalized: s.finalized })),
    counters: Object.entries(pack.counters ?? {})
      .filter(([, c]) => !c.hidden)
      .map(([id, c]) => ({ id, label: c.label, value: state.counters[id] ?? 0 })),
    resources: Object.entries(pack.resources ?? {}).map(([id, r]) => ({ id, label: r.label, value: state.resources[id] ?? r.initial, ...(r.max !== undefined ? { max: r.max } : {}), ...(r.display ? { display: r.display } : {}) })),
    clocks,
    progress: { unitsDone: progress.unitsDone, elapsedMs: progress.elapsedMs },
    score: { label: score.label, text: formatScore(score, pack), value: score.value, better: score.better },
    forcedUnits: state.forcedUnits,
    log,
    unitResults,
    latest,
    ...(extra.race ? { race: extra.race } : {}),
  };
}

/** What a snapshot from the server looks like enough to trust; the rest is defaults. */
export function isSnapshot(value: unknown): value is LiveSnapshot {
  return typeof value === "object" && value !== null && (value as { v?: unknown }).v === 1 && typeof (value as { packTitle?: unknown }).packTitle === "string";
}

/** A clock's face now, from where it stood when the snapshot was taken. */
export function clockNow(clock: LiveSnapshot["clocks"][number], at: string, now: number): { shown: number; fraction: number | null } {
  const since = clock.status === "running" ? Math.max(0, now - Date.parse(at)) : 0;
  const elapsed = clock.elapsedMs + since;
  if (clock.seconds !== null) {
    const left = Math.max(0, clock.seconds * 1000 - elapsed);
    return { shown: left, fraction: Math.max(0, Math.min(1, left / (clock.seconds * 1000))) };
  }
  return { shown: elapsed, fraction: null };
}
