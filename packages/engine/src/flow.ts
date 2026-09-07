import type { Pack, Phase, Step } from "@runlog/rules-schema";
import { testPredicates } from "./execute.ts";
import type { RunEvent } from "./events.ts";
import type { RunState } from "./types.ts";

/**
 * Where the player is in a unit.
 *
 * This lives in the engine rather than the view because it is derived state,
 * not presentation: it is a pure function of the pack and the log. Keeping it
 * here means closing the laptop mid-unit and coming back tomorrow lands you in
 * the same place, and — more usefully — that the flow can be tested without
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
 * Whether a phase is out of play this unit — the same test `nextStep` uses
 * to walk past it, exposed so the flow can say so instead of just never
 * arriving there.
 */
export function phaseSkipped(pack: Pack, state: RunState, phase: Phase): boolean {
  return shouldSkip(pack, state, phase.skipWhen);
}

/**
 * The step the player is on, or null when the unit is finished.
 *
 * Every step must be recorded as completed for this to advance — which is the
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
