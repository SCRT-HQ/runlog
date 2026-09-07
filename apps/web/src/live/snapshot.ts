import type { Pack } from "@runlog/rules-schema";
import { activePhases, clockOfUnit, elapsedMs, liveClocks, mayQuote, nextStep, phaseSkipped, progressOf, standings, type RunEvent, type RunState } from "@runlog/engine";

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
 * numbers, and for the log the entry's words where they may be quoted
 * and its reference where they may not — the same line the export draws.
 */
export interface LiveSnapshot {
  v: 1;
  at: string;
  packId: string;
  packTitle: string;
  runName: string | null;
  mode: string;
  words: { run: string; unit: string; units: string };
  status: "active" | "ended";
  ending: string | null;
  unit: number;
  /** Where the flow is: the phase and step the run is waiting on. */
  where: string | null;
  /** The step in hand, on its own, and the unit's phases with where each stands: what the player's own screen lists. */
  step: string | null;
  phases: Array<{ id: string; label: string; state: "done" | "current" | "skipped" | "todo" }>;
  /** The pack's text may be quoted here: the log carries entries' words. */
  quoted: boolean;
  standings: Array<{ name: string; points: number; place: number; states: string[] }>;
  contestants: number;
  subjects: Array<{ id: number; type: string | null; states: string[]; finalized: boolean }>;
  counters: Array<{ id: string; label: string; value: number }>;
  resources: Array<{ id: string; label: string; value: number; max?: number; display?: "boxes" | "bar" | "number" }>;
  clocks: Array<{ id: string; label: string; kind: "stopwatch" | "timer"; seconds: number | null; status: "running" | "paused" | "done"; elapsedMs: number; expired: boolean }>;
  progress: { unitsDone: number; elapsedMs: number };
  forcedUnits: number;
  /** Newest first, numbered from the start. */
  log: Array<{ n: number; unit: number; where: string; hit: number | null; text: string }>;
  /** The race this run is in, as its owner's device last saw the leaderboard; absent outside a race. */
  race?: RaceSnapshot;
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
        return { id: phase.id, label: phase.label, state: done ? ("done" as const) : current ? ("current" as const) : phaseSkipped(pack, state, phase) ? ("skipped" as const) : ("todo" as const) };
      })
    : [];
  const stateLabel = (id: string) => pack.states?.[id]?.short ?? pack.states?.[id]?.label ?? id;
  const total = state.outcomes.length;
  const log = [...state.outcomes]
    .reverse()
    .slice(0, LOG_LINES)
    .map((o, i) => {
      const table = pack.tables[o.table];
      const entry = table?.entries.find((e) => e.id === o.entryId);
      return {
        n: total - i,
        unit: o.unit,
        where: `${v.unit.one} ${o.unit}, ${table?.title ?? o.table}`,
        hit: o.targetSubject,
        text: quoted ? (entry?.title ?? entry?.text ?? o.entryId) : `${table?.title ?? o.table} · #${o.entryId}`,
      };
    });
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
  return {
    v: 1,
    at,
    packId: pack.id,
    packTitle: pack.title,
    runName: state.name,
    mode: pack.modes[state.mode]?.label ?? state.mode,
    words: { run: v.run.one, unit: v.unit.one, units: v.unit.many },
    status: state.status === "ended" ? "ended" : "active",
    ending: state.ending,
    unit: state.unit,
    where: step && stepLabel ? `${step.phase.label} · ${stepLabel}` : null,
    step: stepLabel,
    phases,
    quoted,
    standings: standings(state).map((s) => ({ name: s.contestant.name, points: s.points, place: s.place, states: s.contestant.states.map(stateLabel) })),
    contestants: state.contestants.length,
    subjects: state.subjects.filter((s) => !s.removed).map((s) => ({ id: s.id, type: s.type, states: s.states.map(stateLabel), finalized: s.finalized })),
    counters: Object.entries(pack.counters ?? {})
      .filter(([, c]) => !c.hidden)
      .map(([id, c]) => ({ id, label: c.label, value: state.counters[id] ?? 0 })),
    resources: Object.entries(pack.resources ?? {}).map(([id, r]) => ({ id, label: r.label, value: state.resources[id] ?? r.initial, ...(r.max !== undefined ? { max: r.max } : {}), ...(r.display ? { display: r.display } : {}) })),
    clocks,
    progress: { unitsDone: progress.unitsDone, elapsedMs: progress.elapsedMs },
    forcedUnits: state.forcedUnits,
    log,
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
