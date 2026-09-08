import type { Phase } from "@runlog/rules-schema";

/**
 * The stepper as one line, for a phone.
 *
 * At a phone's width the margin's list of phases took a column the step card
 * needed for its keypad. The list folds into a strip that says where the
 * unit is up to and what comes next; a tap opens the full list. What the
 * strip says is worked out here, where a test can reach it.
 */
export interface FlowStrip {
  /** The current phase's place among the unit's phases, from one. */
  index: number;
  total: number;
  label: string;
  /** The next phase still in play, if there is one. */
  next: string | null;
}

export function flowStrip(
  phases: Phase[],
  current: { phase: Phase } | null,
  skipped: (phase: Phase) => boolean,
): FlowStrip | null {
  if (!current) return null;
  const at = phases.findIndex((p) => p.id === current.phase.id);
  if (at < 0) return null;
  const next = phases.slice(at + 1).find((p) => !skipped(p));
  return { index: at + 1, total: phases.length, label: current.phase.label, next: next?.label ?? null };
}
