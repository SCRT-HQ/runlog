import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, Pack, Phase } from "@runlog/rules-schema";
import { ulid } from "../storage/ids.ts";
import { syncBus } from "../sync/bus.ts";
import { reconcile, stampIds } from "../sync/log.ts";
import { NEW_RUN } from "./active.ts";
import { deviceRunStore, type RunStore } from "./store.ts";
import { drawAgainEvents, drawIsLast, type LastDraw } from "./redraw.ts";
import { clearHalfStep, loadHalfStep, outcomesAhead, saveHalfStep, toPending } from "./halfStep.ts";
import { rollsForMeByDefault } from "./pace.ts";
import {
  canEndRun,
  createRandom,
  dueObligations,
  executeActions,
  executeObligation,
  executeCounterTrigger,
  executeGlobalTrigger,
  executeMove,
  executeTableRoll,
  availableMoves,
  pendingTriggers,
  pendingGlobalTriggers,
  rolesForUnit,
  streamSeed,
  nextStep,
  activePhases as activePhasesOf,
  reduce,
  nextUnit,
  stepCompletionEvents,
  closeUnitEvents,
  moderation,
  challenges,
  standings,
  awardValue,
  unitClockStart,
  unitClockFor,
  stopClocksEvents,
  elapsedMs,
  type ActiveStep,
  type AnswerValue,
  type ExecResult,
  type InputRequest,
  type RunEvent,
  type RunState,
  undoableIds,
} from "@runlog/engine";

export type { ActiveStep };

import type { StoredRun } from "../storage/db.ts";

/**
 * The run store.
 *
 * A run is its event log; everything on screen is a fold over it. That gives
 * undo for free, survives a reload without a bespoke save format, and means
 * the thing exported at the end is the same object the app was reading all
 * along.
 *
 * Interruptible execution shows up here as `pending`: a block of work that has
 * begun, may be waiting on the player, and commits to the log only once it
 * finishes. Nothing half-resolved ever reaches history.
 */

export interface Pending {
  /** What kind of work is in flight, for the label and for resuming it. */
  kind: "table" | "actions" | "obligation" | "move" | "counterTrigger" | "globalTrigger";
  label: string;
  tableId?: string;
  actions?: Action[];
  obligationId?: string;
  moveId?: string;
  trigger?: { counter: string; index: number; key: string };
  global?: { index: number; key: string };
  keyPrefix: string;
  answers: Record<string, AnswerValue>;
  /** Keys the app rolled on the player's behalf, kept out of the physical count. */
  generated: string[];
  request?: InputRequest;
  /**
   * The events the block has produced so far, uncommitted. What the answers
   * given already did, for the receipt that shows between two questions.
   */
  partial?: RunEvent[];
  /**
   * The step this work belongs to, recorded as done when it completes.
   *
   * Without this a roll would run, commit its events and leave the flow exactly
   * where it was — the log fills up while the game appears to refuse to move.
   */
  completes?: { phase: Phase; index: number };
  /** A move that is the unit's outcome: when it completes, the unit closes with it. */
  closesUnit?: boolean;
}

/**
 * @param store Where the log lives. The device by default; a memory store
 * for a run that is only a trial, which writes nothing and syncs nothing.
 */
export function useRun(pack: Pack, store: RunStore = deviceRunStore) {
  const { runsFor, loadRun, currentRun, saveRun, forgetRun, takeLegacyRun, clearLegacyRun, activeRunFor, setActiveRunFor, setLastActive, forgetActive } = store;
  const [events, setEvents] = useState<RunEvent[]>([]);
  /**
   * Reading from IndexedDB is asynchronous, so there is a moment before the
   * saved run arrives. Showing setup during it would offer to start a new run
   * over the top of one already in progress.
   */
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [seed, setSeed] = useState("");
  /** Off by default: the dice belong to the player unless they say otherwise, on this device or in this run. */
  const [autoRoll, setAutoRoll] = useState(() => rollsForMeByDefault());

  /**
   * What this run is called in storage. Held in a ref as well as state: the
   * writers below run inside `setEvents` updaters, where a stale closure
   * would happily save a new run under an old name.
   */
  const [runId, setRunId] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  /** Fields the record carries besides the log — a race it belongs to — set when a run starts and written with every save. */
  const extrasRef = useRef<Pick<StoredRun, "raceId">>({});
  /** Every run of this pack still here, newest first, for the picker. */
  const [runList, setRunList] = useState<StoredRun[]>([]);
  const refreshList = useCallback(
    () =>
      runsFor(pack.id).then((all) => {
        const live = all.filter((r) => !r.deletedAt);
        live.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        setRunList(live);
      }),
    [pack.id, runsFor],
  );
  /**
   * True while the player has asked for a fresh run and not started it
   * yet: a run arriving from elsewhere must not fill the empty setup.
   */
  const choosingRef = useRef(false);
  const name = (id: string | null) => {
    if (id !== runIdRef.current) extrasRef.current = {};
    runIdRef.current = id;
    setRunId(id);
  };

  useEffect(() => {
    let live = true;
    setHydrated(false);
    setEvents([]);
    void (async () => {
      // A run saved before storage moved should not vanish with the move.
      const legacy = takeLegacyRun(pack.id);
      if (legacy) {
        await saveRun(legacy);
        clearLegacyRun(pack.id);
      }
      // The run this device has open for this pack, if it chose one and
      // it is still here; otherwise the newest, which becomes the open one.
      const chosen = activeRunFor(pack.id);
      // The library asked for a fresh one: setup, and nothing else.
      if (chosen === NEW_RUN) {
        choosingRef.current = true;
        name(null);
        setEvents([]);
        setHydrated(true);
        void refreshList();
        return;
      }
      const kept = chosen ? await loadRun(chosen) : null;
      const saved = kept && !kept.deletedAt ? kept : await currentRun(pack.id);
      if (!live) return;
      name(saved?.runId ?? null);
      setActiveRunFor(pack.id, saved?.runId ?? null);
      void refreshList();
      // A log from before ids gets them now, the same way on every device,
      // and is written back so the next pass can send it.
      let log = (saved?.events as RunEvent[]) ?? [];
      if (saved) {
        const stamped = await stampIds(saved.runId, log);
        if (!live) return;
        if (stamped !== log) {
          log = stamped;
          await saveRun({ ...saved, events: stamped });
        }
      }
      setEvents(log);
      setHydrated(true);
    })();
    return () => {
      live = false;
    };
  }, [pack.id, refreshList, store]);

  const started = events.length > 0;
  const state: RunState | null = useMemo(
    () => (started ? reduce(pack, events) : null),
    [pack, events, started],
  );

  const now = () => new Date().toISOString();

  /**
   * The one way a log reaches storage. Every write is the whole log, under
   * the run's name, stamped now — which is the unit sync will move later.
   */
  const persist = useCallback(
    (log: RunEvent[], at = new Date().toISOString()) => {
      const id = runIdRef.current;
      if (!id) return;
      // Storage may hold numbers from a sync pass this view has not seen;
      // what is written is the numbered part as stored, then this view's
      // unnumbered events after it. Nothing the server ordered is lost.
      void loadRun(id)
        .then((stored) =>
          saveRun({
            ...(stored ?? {}),
            ...extrasRef.current,
            runId: id,
            packId: pack.id,
            packVersion: pack.version,
            packTitle: pack.title,
            events: stored ? reconcile(stored.events as RunEvent[], log) : log,
            updatedAt: at,
          }),
        )
        .then(() => {
          setLastActive({ packId: pack.id, runId: id });
          store.changed(id);
          void refreshList();
        });
    },
    [pack, refreshList, store],
  );

  /**
   * A run that arrived from another device replaces this one if it is the
   * same run. Whole-log, like `loadEvents`; anything half-done here is
   * dropped, because the log is the truth and a pull mid-move is rare.
   *
   * A device with no run for this pack yet takes whatever arrived, which
   * is how a second device picks up where the first one was: the first
   * pass after sign-in lands here, and the pack opens on the run in play.
   */
  useEffect(() => {
    if (!store.keeps) return;
    return syncBus.subscribe((news) => {
        if (news.t !== "pulled" || news.kind !== "run") return;
        void refreshList();
        const id = runIdRef.current;
        if (id && !news.ids.includes(id)) return;
        if (!id && choosingRef.current) return;
        void currentRun(pack.id).then((saved) => {
          if (!saved || saved.runId !== id) {
            name(saved?.runId ?? null);
            setEvents((saved?.events as RunEvent[]) ?? []);
          } else {
            setEvents(saved.events as RunEvent[]);
          }
          if (saved) setActiveRunFor(pack.id, saved.runId);
          setPending(null);
        });
      });
  }, [pack.id, refreshList, store]);

  const commit = useCallback(
    (next: RunEvent[]): RunEvent[] => {
      // Named here, once, where they are made: the id is what a shared log
      // keeps each event once by, and what an undo names.
      const named = next.map((e) => (e.id ? e : { ...e, id: ulid() }));
      setEvents((prev) => {
        const merged = [...prev, ...named];
        persist(merged);
        return merged;
      });
      return named;
    },
    [persist],
  );

  /**
   * The last draw, so it can be drawn again: the block that made it, and
   * the ids of everything it committed. Cleared by anything that is not a
   * draw; `drawIsLast` is the check that nothing has happened since.
   */
  const lastDraw = useRef<(LastDraw & { block: Omit<Pending, "answers" | "generated" | "request"> }) | null>(null);
  /** A block waiting to run once the log has taken the undo of the draw before it. */
  const [redraw, setRedraw] = useState<Omit<Pending, "answers" | "generated" | "request"> | null>(null);

  const runSeed = state?.seed ?? seed;

  /**
   * A shared run rolls its own dice.
   *
   * The point of a seeded mode is that several people meet the identical
   * sequence, and they cannot if any of them is entering numbers from the dice
   * on their own desk. So a seed overrides the auto-roll preference rather
   * than sitting alongside it.
   */
  const seededRun =
    runSeed !== "" && Boolean(pack.modes[state?.mode ?? pack.defaultMode]?.seeded);

  const randomSource = useCallback(
    (keyPrefix: string) => {
      if (seededRun && runSeed) {
        // Addressed by where in the game the roll falls rather than by how far
        // down the log it is, so two players whose runs diverge still meet the
        // same dungeon.
        const unit = state?.unit ?? 0;
        const before = events.filter(
          (e) => e.t === "Rolled" && e.purpose === keyPrefix && unitOf(events, e) === unit,
        ).length;
        return createRandom(streamSeed(runSeed, unit, keyPrefix, before));
      }
      if (!autoRoll) return undefined;
      return runSeed ? createRandom(`${runSeed}:${events.length}`) : Math.random;
    },
    [autoRoll, runSeed, events, state, seededRun],
  );

  /* ---------------------------------------------------------------- *
   * Running a block of work, and resuming it when the player answers
   * ---------------------------------------------------------------- */

  const runPending = useCallback(
    (p: Pending, answers: Record<string, AnswerValue>, generated = p.generated): void => {
      if (!state) return;
      const random = randomSource(p.keyPrefix);
      const ctx = {
        answers,
        generatedAnswers: generated,
        now: now(),
        keyPrefix: p.keyPrefix,
        ...(random ? { random, seeded: seededRun } : {}),
      };

      let result: ExecResult;
      if (p.kind === "table") result = executeTableRoll(pack, state, p.tableId!, ctx);
      else if (p.kind === "obligation") result = executeObligation(pack, state, p.obligationId!, ctx);
      else if (p.kind === "move") result = executeMove(pack, state, p.moveId!, ctx);
      else if (p.kind === "counterTrigger") {
        const t = p.trigger!;
        result = executeCounterTrigger(pack, state, t.counter, t.index, t.key, ctx);
      } else if (p.kind === "globalTrigger") {
        const g = p.global!;
        result = executeGlobalTrigger(pack, state, g.index, g.key, ctx);
      } else result = executeActions(pack, state, p.actions ?? [], ctx);

      if (result.status === "awaiting") {
        setPending({
          ...p,
          answers,
          generated,
          partial: result.events,
          ...(result.request ? { request: result.request } : {}),
        });
        return;
      }
      // Only a completed block reaches the log — and it lands together with
      // the record of the step finishing, so the two cannot come apart.
      const done = p.completes
        ? stepCompletionEvents(p.completes.phase, p.completes.index, state, now())
        : p.closesUnit
          ? [...stopClocksEvents(state, now()), ...closeUnitEvents(pack, state, now())]
          : [];
      const named = commit([...result.events, ...done]);
      setPending(null);
      if (p.kind === "table") {
        const { answers: _a, generated: _g, request: _r, ...block } = p;
        lastDraw.current = { ids: named.map((e) => e.id).filter((id): id is string => typeof id === "string"), block };
      } else {
        lastDraw.current = null;
      }
    },
    [pack, state, commit, randomSource, seededRun],
  );

  const begin = useCallback(
    (p: Omit<Pending, "answers" | "generated">) =>
      runPending({ ...p, answers: {}, generated: [] }, {}, []),
    [runPending],
  );

  const answer = useCallback(
    (key: string, value: AnswerValue, machineRolled = false) => {
      if (!pending) return;
      const generated = machineRolled ? [...pending.generated, key] : pending.generated;
      runPending(pending, { ...pending.answers, [key]: value }, generated);
    },
    [pending, runPending],
  );

  const abandonPending = useCallback(() => setPending(null), []);

  /* ---------------------------------------------------------------- *
   * The flow through a unit
   * ---------------------------------------------------------------- */

  const activePhases = useMemo(() => activePhasesOf(pack, state), [pack, state]);

  /**
   * The step the player is on, derived from the log rather than held here, so
   * a reload lands exactly where it left off.
   */
  const activeStep = useMemo(() => nextStep(pack, state), [pack, state]);

  /** Record a step as done, closing its phase if it was the last one. */
  const completeStep = useCallback(
    (phase: Phase, index: number, extra: RunEvent[] = []) => {
      if (!state) return;
      commit([...extra, ...stepCompletionEvents(phase, index, state, now())]);
    },
    [commit, state],
  );

  /* ---------------------------------------------------------------- *
   * Player-facing commands
   * ---------------------------------------------------------------- */

  const startRun = useCallback(
    (mode: string, startSeed: string, players = 1, runName = "", contestants: string[] = [], lacks: string[] = [], extras: Pick<StoredRun, "raceId"> = {}): string => {
      const at = now();
      // Named before it is written, and the name goes into the first event
      // too, so the log says what it is wherever it is read back.
      const id = ulid();
      name(id);
      extrasRef.current = extras;
      choosingRef.current = false;
      setActiveRunFor(pack.id, id);
      const first: RunEvent[] = [
        {
          t: "RunStarted",
          at,
          packId: pack.id,
          packVersion: pack.version,
          runId: id,
          mode,
          ...(startSeed ? { seed: startSeed } : {}),
          ...(players > 1 ? { players } : {}),
          ...(lacks.length > 0 ? { lacks } : {}),
        },
      ];
      // Opening draws, where the pack deals a hand at the start.
      for (const [deckId, deck] of Object.entries(pack.decks ?? {})) {
        if (deck.kind !== "cards" || deck.drawAtStart < 1) continue;
        const rng = startSeed ? createRandom(`${startSeed}:deal`) : Math.random;
        const pool = [...deck.cards];
        for (let n = 0; n < deck.drawAtStart && pool.length > 0; n++) {
          const [card] = pool.splice(Math.floor(rng() * pool.length), 1);
          if (card) first.push({ t: "CardDrawn", at, deck: deckId, cardId: card.id });
        }
      }
      // A name, when one was given: in the log, so it travels with the run.
      if (runName.trim()) first.push({ t: "RunRenamed", at, name: runName.trim() });
      // The roster of a moderated run: names, in the log, so the scoreboard
      // travels with it.
      contestants
        .map((n) => n.trim())
        .filter(Boolean)
        .forEach((n, i) => first.push({ t: "ContestantAdded", at, contestant: `c${i + 1}`, name: n }));
      const named = first.map((e) => ({ ...e, id: ulid() }));
      setEvents(named);
      persist(named, at);
      setSeed(startSeed);
      return id;
    },
    [pack, persist, store],
  );

  const enterUnit = useCallback(() => {
    const at = now();
    // The unit's clock starts with it, when the pack or the mode runs one.
    const clock = unitClockStart(pack, state, nextUnit(state), at);
    commit([{ t: "UnitEntered", at }, ...(clock ? [clock] : [])]);
  }, [commit, pack, state]);

  const declareSubject = useCallback(
    (phase: Phase, index: number, subjectType: string) =>
      completeStep(phase, index, [{ t: "SubjectDeclared", at: now(), subjectType }]),
    [completeStep],
  );

  const finalizeUnit = useCallback(
    (phase: Phase, index: number) => {
      const at = now();
      // Every live clock stops with the unit, its time written in.
      completeStep(phase, index, [...(state ? stopClocksEvents(state, at) : []), { t: "UnitFinalized", at }]);
    },
    [completeStep, state],
  );

  /* ---- clocks: start by hand, pause, resume, stop ---- */

  const startUnitClock = useCallback(() => {
    if (!state) return;
    const config = unitClockFor(pack, state);
    if (!config) return;
    commit([
      {
        t: "ClockStarted",
        at: now(),
        clock: `u${state.unit}:unit`,
        kind: config.kind,
        label: config.label ?? `${pack.vocabulary.unit.one} ${state.unit}`,
        ...(config.kind === "timer" && config.minutes ? { seconds: Math.round(config.minutes * 60) } : {}),
      },
    ]);
  }, [commit, pack, state]);

  const pauseClock = useCallback((clock: string) => commit([{ t: "ClockPaused", at: now(), clock }]), [commit]);
  const resumeClock = useCallback((clock: string) => commit([{ t: "ClockResumed", at: now(), clock }]), [commit]);
  const stopClock = useCallback(
    (clock: string, expired = false) => {
      const c = state?.clocks.find((x) => x.id === clock);
      if (!c || c.status === "done") return;
      const at = now();
      commit([{ t: "ClockStopped", at, clock, elapsedMs: expired && c.seconds !== null ? c.seconds * 1000 : elapsedMs(c, Date.parse(at)), ...(expired ? { expired: true } : {}) }]);
    },
    [commit, state],
  );

  /** Correct what a subject is called, keeping its id, states and history. */
  /** Call the run something. Empty clears the name. */
  const renameRun = useCallback(
    (runName: string) => commit([{ t: "RunRenamed", at: now(), name: runName }]),
    [commit],
  );

  const renameSubject = useCallback(
    (subject: number, name: string) =>
      commit([{ t: "SubjectRenamed", at: now(), subject, name }]),
    [commit],
  );

  const writeJournal = useCallback(
    (unit: number, text: string) => commit([{ t: "JournalWritten", at: now(), unit, text }]),
    [commit],
  );

  const endRun = useCallback(
    (ending: string) => commit([{ t: "RunEnded", at: now(), ending }]),
    [commit],
  );

  /** Moves offered at this point in the flow. */
  const moves = useMemo(() => {
    if (!state || state.status === "ended") return [];
    // Ending moves are offered alongside the between-units ones, because that
    // is the one moment the player is deciding whether to stop. Asked for in a
    // single call: two calls counted every `anytime` move twice.
    return availableMoves(pack, state, activeStep ? "anytime" : ["betweenUnits", "beforeEnding"]);
  }, [pack, state, activeStep]);

  const takeMove = useCallback(
    (id: string, label: string) =>
      begin({
        kind: "move",
        moveId: id,
        keyPrefix: `move:${id}`,
        label,
        ...(pack.moves?.[id]?.finalizes ? { closesUnit: true } : {}),
      }),
    [begin, pack],
  );

  /* ---- moderated play: the roster, the challenges, the awards ---- */

  const moderated = useMemo(() => moderation(pack, state), [pack, state]);
  const challengeList = useMemo(() => (state && moderated ? challenges(pack, state) : []), [pack, state, moderated]);
  const standingsList = useMemo(() => (state ? standings(state) : []), [state]);

  /** The moderator's word: this contestant finished this drawn result. */
  const award = useCallback(
    (contestant: string, outcome: number) => {
      if (!state) return;
      const value = awardValue(pack, state, outcome, contestant);
      const o = state.outcomes[outcome];
      if (value === null || !o) return;
      commit([{ t: "Awarded", at: now(), contestant, outcome, table: o.table, entryId: o.entryId, points: value }]);
    },
    [pack, state, commit],
  );

  const revokeAward = useCallback(
    (contestant: string, outcome: number) => {
      const at = now();
      const who = state?.contestants.find((c) => c.id === contestant)?.name ?? contestant;
      commit([
        { t: "Corrected", at, note: `took an award back from ${who}` },
        { t: "AwardRevoked", at, contestant, outcome },
      ]);
    },
    [state, commit],
  );

  /**
   * Move a challenge's award to somebody else, in one piece: the old awards
   * taken back as a correction and the new one made, at the result's points
   * plus whatever the mode gives the first.
   */
  const reassignAward = useCallback(
    (outcome: number, contestant: string) => {
      if (!state || !moderated) return;
      const o = state.outcomes[outcome];
      const entry = o ? pack.tables[o.table]?.entries.find((e) => e.id === o.entryId) : undefined;
      const points = entry?.points ?? 0;
      if (!o || !entry || points <= 0 || !state.contestants.some((c) => c.id === contestant)) return;
      const at = now();
      const prior = state.awards.filter((a) => a.outcome === outcome);
      commit([
        { t: "Corrected", at, note: `moved the award for ${entry.title ?? entry.text}` },
        ...prior.map((a): RunEvent => ({ t: "AwardRevoked", at, contestant: a.contestant, outcome })),
        { t: "Awarded", at, contestant, outcome, table: o.table, entryId: o.entryId, points: points + (moderated.firstBonus ?? 0) },
      ]);
    },
    [pack, state, moderated, commit],
  );

  const addContestant = useCallback(
    (contestantName: string) => {
      const trimmed = contestantName.trim();
      if (!trimmed) return;
      commit([{ t: "ContestantAdded", at: now(), contestant: `c${ulid().slice(-8).toLowerCase()}`, name: trimmed }]);
    },
    [commit],
  );

  /** The moderator marks a contestant — spared, out, whatever the pack names — or unmarks them. */
  const markContestant = useCallback(
    (contestant: string, stateId: string, on: boolean) =>
      commit([on ? { t: "ContestantStateApplied", at: now(), contestant, state: stateId } : { t: "ContestantStateRemoved", at: now(), contestant, state: stateId }]),
    [commit],
  );

  const removeContestant = useCallback(
    (contestant: string) => commit([{ t: "ContestantRemoved", at: now(), contestant }]),
    [commit],
  );

  /**
   * Tick or untick boxes on a step. In the log, so a reload keeps them; with
   * a tally, each box moves the counter by one and back.
   */
  const check = useCallback(
    (step: string, items: string[], on: boolean, tally?: string) => {
      if (items.length === 0) return;
      const at = now();
      const ticks: RunEvent[] = items.map((item) => ({ t: "Checked", at, step, item, on }));
      const counted: RunEvent[] = tally ? [{ t: "CounterChanged", at, counter: tally, by: on ? items.length : -items.length }] : [];
      commit([...ticks, ...counted]);
    },
    [commit],
  );

  /** Put a state on an earlier subject, or take one off: a correction, marked as one. */
  const correctState = useCallback(
    (subject: number, stateId: string, on: boolean) => {
      const at = now();
      const label = pack.states?.[stateId]?.label ?? stateId;
      commit([
        { t: "Corrected", at, note: `${on ? "marked" : "unmarked"} #${subject} ${label}` },
        on ? { t: "StateApplied", at, state: stateId, subject } : { t: "StateRemoved", at, state: stateId, subject },
      ]);
    },
    [commit, pack],
  );

  /** Move a tally by hand, when what was recorded was not what happened. */
  const nudgeCounter = useCallback(
    (counter: string, by: number) => {
      const at = now();
      commit([
        { t: "Corrected", at, note: `${pack.counters?.[counter]?.label ?? counter} ${by > 0 ? "+" : ""}${by}` },
        { t: "CounterChanged", at, counter, by },
      ]);
    },
    [commit, pack],
  );

  /** Counter thresholds that have come due and not yet fired. */
  const thresholds = useMemo(() => (state ? pendingTriggers(pack, state) : []), [pack, state]);

  const fireThreshold = useCallback(
    (t: { counter: string; index: number; key: string; label: string }) =>
      begin({
        kind: "counterTrigger",
        trigger: { counter: t.counter, index: t.index, key: t.key },
        keyPrefix: t.key,
        label: t.label,
      }),
    [begin],
  );

  /**
   * The pack's own triggers that have come due — what the game does of its own
   * accord rather than in answer to a roll. The end-of-run reckoning lives
   * here, which is why it outlives the run ending.
   */
  const globals = useMemo(() => (state ? pendingGlobalTriggers(pack, state) : []), [pack, state]);

  const fireGlobal = useCallback(
    (g: { index: number; key: string; label: string }) =>
      begin({
        kind: "globalTrigger",
        global: { index: g.index, key: g.key },
        keyPrefix: g.key,
        label: g.label,
      }),
    [begin],
  );

  /** Who holds which role this unit, for modes played by more than one person. */
  const roles = useMemo(() => rolesForUnit(pack, state), [pack, state]);

  const resolveObligation = useCallback(
    (id: string, label: string) =>
      begin({ kind: "obligation", obligationId: id, keyPrefix: `ob:${id}`, label }),
    [begin],
  );

  /**
   * Undo the last player-visible move.
   *
   * Not by dropping its events: the log may be shared, and another player
   * may have built on it since. An `Undone` naming the move's events goes
   * on the end instead, and the reducer folds neither it nor them. From the
   * player's side it is the same undo; from the log's side nothing is lost.
   */
  const undo = useCallback(() => {
    setEvents((prev) => {
      const ids = undoableIds(prev, isBoundary);
      if (ids.length === 0) return prev;
      const next: RunEvent[] = [...prev, { t: "Undone", at: now(), id: ulid(), ids }];
      persist(next);
      return next;
    });
    setPending(null);
  }, [persist]);

  /** Whether there is a move to undo: something after the start that still counts. */
  const canUndo = useMemo(() => undoableIds(events, isBoundary).length > 0, [events]);

  /**
   * Draw again: the last draw unmade, with a note saying why, and the same
   * block run once more. Not in a seeded run, where a skipped draw would
   * put this device's dice out of step with everyone else's.
   */
  const canDrawAgain = useMemo(
    () => !seededRun && drawIsLast(events, lastDraw.current) && (pending === null || pending.kind !== "table"),
    [events, seededRun, pending],
  );
  const drawAgain = useCallback(
    (reason?: string) => {
      const draw = lastDraw.current;
      if (!draw || !canDrawAgain) return;
      lastDraw.current = null;
      commit(drawAgainEvents(draw, now(), reason));
      setPending(null);
      setRedraw(draw.block);
    },
    [canDrawAgain, commit],
  );
  // The block runs against the state the undo produced, which exists only
  // after the log has changed hands: hence a step later, not at once.
  useEffect(() => {
    if (!redraw || !state) return;
    setRedraw(null);
    begin(redraw);
  }, [redraw, state, begin]);

  /** The open run's record, as storage has it: who is in it, and what this account may do. */
  const record = useMemo(() => runList.find((r) => r.runId === runId) ?? null, [runList, runId]);
  /** A viewer watches. Every move is shown; none can be made. */
  const readOnly = record?.role === "viewer";

  /**
   * A step half answered comes back with the run.
   *
   * Declared before the writer below on purpose: effects run in order, and
   * the stored step must be read before an empty `pending` clears it.
   */
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || !state || !runId || pending || readOnly || !store.keeps || restoredFor.current === runId) return;
    restoredFor.current = runId;
    const stored = loadHalfStep(runId);
    if (!stored) return;
    const p = stored.eventCount === events.length ? toPending(pack, stored) : null;
    if (!p) {
      clearHalfStep(runId);
      return;
    }
    runPending(p, p.answers, p.generated);
  }, [hydrated, state, runId, pending, readOnly, events.length, pack, runPending, store.keeps]);

  useEffect(() => {
    if (!hydrated || !runId || !store.keeps) return;
    if (pending) saveHalfStep(runId, events.length, pending);
    else clearHalfStep(runId);
  }, [hydrated, pending, runId, events.length, store.keeps]);

  /** What the block in flight has resolved so far, ahead of the log. */
  const pendingOutcomes = useMemo(() => outcomesAhead(pack, events, pending?.partial), [pack, events, pending?.partial]);

  /**
   * Replace the run with one read back from a saved archive.
   *
   * A whole-log replacement rather than a merge: the log is the run, so half
   * of one and half of another would not be a run at all. The archive is a
   * backup, not an identity: the run keeps the name it has here, or gets one
   * if this pack had no run yet, whatever the archive's first event says.
   */
  const loadEvents = useCallback(
    (next: RunEvent[]) => {
      // Always a run of its own: an archive dropped into a shared log would
      // be somebody else's history spliced into everyone's. Ids come with
      // the archive where it had them; the rest are stamped as on load.
      const id = ulid();
      name(id);
      setPending(null);
      void stampIds(id, next).then((stamped) => {
        setEvents(stamped);
        persist(stamped);
      });
    },
    [persist],
  );

  const discard = useCallback(() => {
    // A tombstone rather than a delete, so a device that synced this run can
    // be told it is gone. Storage purges it once that has happened.
    if (runIdRef.current) {
      forgetActive(pack.id, runIdRef.current);
      void forgetRun(runIdRef.current).then(() => refreshList());
    }
    clearLegacyRun(pack.id);
    name(null);
    setEvents([]);
    setPending(null);
  }, [pack, refreshList, store]);

  /**
   * Open another run of this pack on this device. The one that was open
   * stays where it is, in the list, for coming back to.
   */
  const switchRun = useCallback(
    (id: string) => {
      void loadRun(id).then((saved) => {
        if (!saved || saved.deletedAt) return;
        choosingRef.current = false;
        name(saved.runId);
        setActiveRunFor(pack.id, saved.runId);
        setLastActive({ packId: pack.id, runId: saved.runId });
        setEvents(saved.events as RunEvent[]);
        setPending(null);
      });
    },
    [pack.id, store],
  );

  /**
   * Ask for a fresh run without touching the one that is open: setup shows,
   * and the open run stays in the list until the new one starts.
   */
  const beginAnother = useCallback(() => {
    choosingRef.current = true;
    name(null);
    setActiveRunFor(pack.id, NEW_RUN);
    setEvents([]);
    setPending(null);
  }, [pack.id, store]);

  /** Back out of "another": the newest run of the pack is open again. */
  const cancelAnother = useCallback(() => {
    choosingRef.current = false;
    void currentRun(pack.id).then((saved) => {
      if (!saved) return;
      name(saved.runId);
      setActiveRunFor(pack.id, saved.runId);
      setEvents(saved.events as RunEvent[]);
    });
  }, [pack.id, store]);

  /* ---------------------------------------------------------------- *
   * Derived helpers for the view
   * ---------------------------------------------------------------- */

  /** Which deferred triggers are due right now, given where the player is. */
  const due = useMemo(() => {
    if (!state) return [];
    const reached: string[] = ["immediately", "onEnterUnit"];
    if (state.subjects.some((s) => s.unit === state.unit && s.type)) reached.push("onDeclareSubject");
    // The work is done once every manual step of the unit has been ticked off.
    const manualDone = activePhases.every((p) =>
      p.steps.every((s, i) => s.kind !== "manual" || state.stepsDone.includes(`${p.id}#${i}`)),
    );
    if (manualDone) reached.push("afterWork");
    // A clock that already expired this unit makes an onTimerExpired
    // obligation due immediately, even one queued afterward -- the bell
    // already rang.
    if (state.clocks.some((c) => c.unit === state.unit && c.status === "done" && c.expired)) {
      reached.push("onTimerExpired");
    }
    return reached.flatMap((point) => dueObligations(state, point));
  }, [state, activePhases]);

  const notes = useMemo(
    () => (state ? state.obligations.filter((o) => !o.resolved && o.kind === "note") : []),
    [state],
  );

  /** Finalizing is blocked while the unit still owes something. */
  const blockingObligations = useMemo(() => {
    if (!state) return [];
    return [...due, ...dueObligations(state, "onFinalize")].filter((o) => !o.resolved);
  }, [state, due]);

  return {
    // state
    events,
    state,
    started,
    hydrated,
    runId,
    pending,
    pendingOutcomes,
    activeStep,
    activePhases,
    due,
    notes,
    moves,
    thresholds,
    globals,
    roles,
    blockingObligations,
    seed,
    autoRoll,
    seededRun,
    canEnd: state ? canEndRun(state) : { ok: false, reason: "not started" },

    // settings
    setSeed,
    setAutoRoll,

    // commands
    startRun,
    enterUnit,
    begin,
    answer,
    abandonPending,
    completeStep,
    declareSubject,
    renameSubject,
    startUnitClock,
    pauseClock,
    resumeClock,
    stopClock,
    moderated,
    challenges: challengeList,
    standings: standingsList,
    award,
    revokeAward,
    reassignAward,
    addContestant,
    removeContestant,
    markContestant,
    check,
    correctState,
    nudgeCounter,
    renameRun,
    finalizeUnit,
    writeJournal,
    resolveObligation,
    takeMove,
    fireThreshold,
    fireGlobal,
    endRun,
    undo,
    canUndo,
    drawAgain,
    canDrawAgain,
    discard,
    loadEvents,
    runList,
    record,
    readOnly,
    switchRun,
    beginAnother,
    cancelAnother,
  };
}

/**
 * Which unit an event happened in.
 *
 * Events carry no unit stamp of their own, so it is counted from the
 * `UnitEntered` markers ahead of them in the log.
 */
function unitOf(events: RunEvent[], event: RunEvent): number {
  let seen = 0;
  for (const e of events) {
    if (e.t === "UnitEntered") seen += 1;
    if (e === event) return seen;
  }
  return -1;
}

/** Events that begin a player-visible move, used as undo boundaries. */
function isBoundary(e: RunEvent): boolean {
  return (
    e.t === "UnitEntered" ||
    e.t === "StepCompleted" ||
    e.t === "SubjectRenamed" ||
    e.t === "Checked" ||
    e.t === "Corrected" ||
    e.t === "ClockStarted" ||
    e.t === "ClockPaused" ||
    e.t === "ClockResumed" ||
    e.t === "ClockStopped" ||
    e.t === "Awarded" ||
    e.t === "ContestantAdded" ||
    e.t === "ContestantRemoved" ||
    e.t === "ContestantStateApplied" ||
    e.t === "ContestantStateRemoved" ||
    e.t === "Rolled" ||
    e.t === "ObligationResolved" ||
    e.t === "JournalWritten" ||
    e.t === "RunEnded"
  );
}
