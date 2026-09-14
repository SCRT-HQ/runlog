import type { Step } from "@runlog/rules-schema";
import { closesUnit } from "@runlog/engine";

/**
 * The two decisions a hands-free unit turns on.
 *
 * `unit.handsFree` says a pack drops the presses that only ever meant "go".
 * Which presses those are is not the engine's business, it has never heard
 * of a receipt, and a headless caller driving the same run has no screen to
 * take a press from. So it is decided here, next to `receiptFollowUps`, and
 * for the same reason: the page, the floating remote and the popped-out
 * control panel all have to agree, and agreeing by being the same function
 * is cheaper than agreeing by being copied carefully.
 *
 * Both answers are deliberately conservative. Anything the player is
 * genuinely being asked, and anything the *game* still has to do, stops the
 * unit and waits to be pressed. Hands-free removes ceremony; it must never
 * remove a rule.
 */

/**
 * Whether a step can start itself: it asks the player nothing before it
 * runs, so the button on it says "go" and nothing else.
 *
 * Only table rolls, for now. A roll still puts its dice to the player where
 * the dice are theirs, which is a question the step asks *once running*, so
 * starting it for them costs nobody a decision. Every other kind either
 * takes something typed (`declareSubject`), something ticked (`manual`,
 * `finalizeUnit`), or runs actions that may reach the player (`actions`).
 */
export function startsItself(step: Step): boolean {
  return step.kind === "rollTable";
}

/**
 * Whether reading this result is also what closes the unit.
 *
 * True only when the result is settled, the unit is hands-free, and the one
 * thing standing between the player and the end of the unit is a closing
 * step with nothing to confirm. A confirmation, a checklist, an obligation
 * owed, a counter that has reached its threshold, a trigger the run has
 * arrived at, any of those and the answer is no: they are each a press, and
 * skipping one skips the rule behind it.
 */
export function closesTheUnit(run: {
  handsFree: boolean;
  /** Active, editable, and actually started. */
  live: boolean;
  /** Nothing more is being asked of this step. */
  settled: boolean;
  /** The step the player is on, or null between units. */
  step: Step | null;
  /** Obligations standing in the way of closing. */
  owed: number;
  /** Counter thresholds the game has reached and not yet fired. */
  thresholds: number;
  /** Top-level triggers due and not yet fired. */
  globals: number;
}): boolean {
  if (!run.handsFree || !run.live || !run.settled) return false;
  if (!run.step || !closesUnit(run.step)) return false;
  if (run.step.kind === "finalizeUnit" && (run.step.confirm ?? []).length > 0) return false;
  return run.owed === 0 && run.thresholds === 0 && run.globals === 0;
}
