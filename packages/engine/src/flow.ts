import type { ChecklistItem, Pack, Phase, Step } from "@runlog/rules-schema";
import { dueObligations, testPredicates } from "./execute.ts";
import type { RunEvent } from "./events.ts";
import type { Obligation, RunState } from "./types.ts";

/**
 * Where the player is in a unit.
 *
 * This lives in the engine rather than the view because it is derived state,
 * not presentation: it is a pure function of the pack and the log. Keeping it
 * here means closing the laptop mid-unit and coming back tomorrow lands you in
 * the same place, and, more usefully, that the flow can be tested without
 * rendering anything.
 */

export interface ActiveStep {
  phase: Phase;
  step: Step;
  index: number;
}

/** The phases this mode actually plays, in order. */
export function activePhases(pack: Pack, state: RunState | null): Phase[] {
  const mode = pack.modes[state?.mode ?? pack.defaultMode];
  const disabled = new Set(mode?.disable?.phases ?? []);
  for (const u of mode?.perUnit ?? []) {
    if (u.unit === "all" || u.unit === (state?.unit ?? 0)) {
      for (const id of u.skipPhases ?? []) disabled.add(id);
    }
  }
  return pack.phases.filter((p) => !disabled.has(p.id));
}

/** True when a `skipWhen` list says to skip. Any one reason is enough. */
function shouldSkip(pack: Pack, state: RunState, when: Parameters<typeof testPredicates>[2]) {
  const result = testPredicates(pack, state, when, { answers: {}, now: "" }, "any");
  // A clause needing the player's judgment never silently skips.
  return result.status === "done" && result.value;
}

/**
 * Whether a phase is out of play this unit: the same test `nextStep` uses
 * to walk past it, exposed so the flow can say so instead of just never
 * arriving there.
 */
export function phaseSkipped(pack: Pack, state: RunState, phase: Phase): boolean {
  return shouldSkip(pack, state, phase.skipWhen);
}

/**
 * The step the player is on, or null when the unit is finished.
 *
 * Every step must be recorded as completed for this to advance, which is the
 * whole contract. A step that runs work but never records itself leaves the
 * flow pinned in place while the log fills up behind it, which reads to the
 * player as the game refusing to move.
 */
export function nextStep(pack: Pack, state: RunState | null): ActiveStep | null {
  if (!state || state.unit === 0 || state.status === "ended") return null;

  for (const phase of activePhases(pack, state)) {
    if (state.phasesDone.includes(phase.id)) continue;
    if (shouldSkip(pack, state, phase.skipWhen)) continue;

    for (let index = 0; index < phase.steps.length; index++) {
      if (state.stepsDone.includes(`${phase.id}#${index}`)) continue;
      const step = phase.steps[index]!;
      if ("skipWhen" in step && shouldSkip(pack, state, step.skipWhen)) continue;
      return { phase, step, index };
    }
  }
  return null;
}

/** The table a step names as constraining it, when its kind carries one. */
export function constrainedByOf(step: Step): string | undefined {
  return step.kind === "declareSubject" || step.kind === "manual" ? step.constrainedBy : undefined;
}

/** A checklist point's own text, whether it is a bare string or an object with more on it. */
export function itemText(item: ChecklistItem): string {
  return typeof item === "string" ? item : item.text;
}

/** A point marked optional does not have to be ticked for the step it is on to count as done. */
export function itemOptional(item: ChecklistItem): boolean {
  return typeof item !== "string" && Boolean(item.optional);
}

/** The checklist or confirm points that gate a step, for whichever kind carries them. */
/**
 * What the pack says on entering the unit in hand: its welcome, once, on
 * the first unit, and its word for every unit, with the number filled in.
 * Said until the unit's first step is done, and nothing after; empty for
 * a pack that says nothing, or before the first unit.
 */
export function entryWords(pack: Pack, state: RunState): string[] {
  if (state.unit < 1 || state.status === "ended" || state.stepsDone.length > 0) return [];
  const out: string[] = [];
  if (state.unit === 1 && pack.unit.intro?.trim()) out.push(pack.unit.intro.trim());
  if (pack.unit.onEnter?.trim()) out.push(pack.unit.onEnter.trim().replace(/\{n\}/g, String(state.unit)));
  return out;
}

/** Whether finishing this step closes the unit: a finalizeUnit step, or a manual step that says it does. */
export function closesUnit(step: Step): boolean {
  return step.kind === "finalizeUnit" || (step.kind === "manual" && step.closesUnit === true);
}

export function checklistOf(step: Step): ChecklistItem[] {
  if (step.kind === "manual") return step.checklist ?? [];
  if (step.kind === "finalizeUnit") return step.confirm ?? [];
  return [];
}

/**
 * The results a checklist point is about: those of the table (or tables)
 * it `shows`, in its scope: this unit's, those that reached this unit's
 * subject, or the whole run's. Empty for a point that shows nothing.
 */
export function shownFor(pack: Pack, state: RunState, item: ChecklistItem): RunState["outcomes"] {
  if (typeof item === "string" || !item.shows) return [];
  const shows = item.shows;
  const tables = new Set(Array.isArray(shows.table) ? shows.table : [shows.table]);
  const subject = state.subjects.find((s) => s.unit === state.unit && !s.removed);
  return state.outcomes.filter((o) => {
    if (!tables.has(o.table) || !pack.tables[o.table]) return false;
    if (shows.scope === "unit") return o.unit === state.unit;
    if (shows.scope === "subject") return Boolean(subject) && o.targetSubject === subject!.id;
    return true;
  });
}

/**
 * Whether a checklist point is asked at all: a point that shows a table's
 * results has nothing to promise when the table produced none in scope, 
 * "every constraint was honored" in a unit that drew no constraint, and
 * is neither listed nor waited for. A plain point is always asked.
 */
export function itemApplies(pack: Pack, state: RunState, item: ChecklistItem): boolean {
  return typeof item === "string" || !item.shows || shownFor(pack, state, item).length > 0;
}

/**
 * What a table has said this unit, for a step that must honor it: every
 * result on that table since the unit began, in order, so a unit that
 * rolled twice (an extra roll owed) shows both.
 */
export function constraintsFor(pack: Pack, state: RunState, tableId?: string): string[] {
  if (!tableId) return [];
  const table = pack.tables[tableId];
  return state.outcomes
    .filter((o) => o.unit === state.unit && o.table === tableId)
    .map((o) => table?.entries.find((e) => e.id === o.entryId))
    .map((entry) => entry?.title ?? entry?.text ?? null)
    .filter((line): line is string => line !== null);
}

/**
 * The events that close the current unit from wherever the flow is: every
 * remaining step and phase recorded as done, then the unit finalized.
 *
 * For a move that *is* the unit's outcome. Once the player has said "it
 * landed", asking them to also press the close button is a second question
 * with only one answer; this records the answer they already gave.
 */
export function closeUnitEvents(pack: Pack, state: RunState, at: string): RunEvent[] {
  const events: RunEvent[] = [];
  for (const phase of activePhases(pack, state)) {
    if (state.phasesDone.includes(phase.id)) continue;
    if (shouldSkip(pack, state, phase.skipWhen)) continue;
    phase.steps.forEach((_, index) => {
      if (!state.stepsDone.includes(`${phase.id}#${index}`)) {
        events.push({ t: "StepCompleted", at, phase: phase.id, step: index });
      }
    });
    events.push({ t: "PhaseCompleted", at, phase: phase.id });
  }
  events.push({ t: "UnitFinalized", at });
  return events;
}

/**
 * The events that record a step as done, closing its phase if it was the last.
 *
 * Returned rather than committed so a caller can append them to whatever the
 * step itself produced, and land the whole move in the log as one piece.
 */
export function stepCompletionEvents(
  phase: Phase,
  index: number,
  state: RunState,
  at: string,
): RunEvent[] {
  // A table step that owes more rolls this unit is not done: one roll is
  // taken off what is owed and the step stays where it is.
  const step = phase.steps[index];
  if (step?.kind === "rollTable" && (state.extraRolls[step.table] ?? 0) > 0) {
    return [{ t: "ExtraRollTaken", at, table: step.table }];
  }
  const events: RunEvent[] = [{ t: "StepCompleted", at, phase: phase.id, step: index }];

  const done = new Set(
    state.stepsDone
      .filter((k) => k.startsWith(`${phase.id}#`))
      .map((k) => Number(k.slice(phase.id.length + 1))),
  );
  done.add(index);

  if (phase.steps.every((_, i) => done.has(i))) {
    events.push({ t: "PhaseCompleted", at, phase: phase.id });
  }
  return events;
}

/**
 * Obligations due right now, by the same lifecycle points the app checks.
 *
 * Lives here rather than beside `dueObligations` because it needs `nextStep`
 * and `activePhases` too, it is the gate that turns "what point are we at"
 * into "what does that make due", which both `drive`'s agenda and a
 * headless `playThrough` need to answer identically.
 */
export function currentlyDue(pack: Pack, state: RunState): Obligation[] {
  const reached: string[] = ["immediately", "onEnterUnit"];
  if (state.subjects.some((s) => s.unit === state.unit && s.type)) reached.push("onDeclareSubject");
  const manualDone = activePhases(pack, state).every((p) =>
    p.steps.every((s, i) => s.kind !== "manual" || state.stepsDone.includes(`${p.id}#${i}`)),
  );
  if (manualDone) reached.push("afterWork");
  const next = nextStep(pack, state);
  if (next && closesUnit(next.step)) reached.push("onFinalize");
  // A clock that already expired this unit makes an onTimerExpired obligation
  // due immediately, even one queued afterward -- the bell already rang.
  if (state.clocks.some((c) => c.unit === state.unit && c.status === "done" && c.expired)) {
    reached.push("onTimerExpired");
  }
  return reached.flatMap((point) => dueObligations(state, point));
}
