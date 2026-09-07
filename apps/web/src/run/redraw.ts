import { effectiveEvents, type RunEvent } from "@runlog/engine";

/**
 * Drawing again.
 *
 * A table sometimes hands out something that cannot be done today: the
 * mechanic needs a partner who is not here, the twist wants an ingredient
 * the pantry lacks. The pack's requirements catch the cases it foresaw;
 * this is for the rest. The draw is unmade the way anything is unmade —
 * an `Undone` naming its events — and a `Corrected` marker says why, so
 * the log reads "drew again: no partner" rather than showing a roll that
 * quietly vanished. Then the same block runs once more.
 *
 * Not for a seeded run: everyone at the same seed meets the same
 * sequence, and a draw skipped on one device would shift every roll after
 * it out of step with the others.
 */

/** What the last draw was, so it can be voided exactly and begun again. */
export interface LastDraw {
  /** The ids of everything the draw committed: the roll, its outcomes, the step's completion. */
  ids: string[];
}

/** The events that unmake a draw and say so. */
export function drawAgainEvents(draw: LastDraw, at: string, reason?: string): RunEvent[] {
  const why = reason?.trim();
  return [
    { t: "Undone", at, ids: draw.ids },
    { t: "Corrected", at, note: why ? `drew again: ${why}` : "drew again" },
  ];
}

/**
 * Whether the draw is still the last thing that happened. Anything since —
 * a check, a move, an undo — and it is history, and the button goes away
 * rather than reaching back past someone else's move.
 */
export function drawIsLast(events: readonly RunEvent[], draw: LastDraw | null): boolean {
  if (!draw || draw.ids.length === 0) return false;
  const live = effectiveEvents(events);
  if (live.length < draw.ids.length) return false;
  const tail = live.slice(-draw.ids.length).map((e) => e.id);
  return draw.ids.every((id, i) => tail[i] === id);
}
