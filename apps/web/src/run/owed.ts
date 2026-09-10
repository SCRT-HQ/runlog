import { counterTriggerAsks, globalTriggerAsks, obligationAsks, type RunState } from "@runlog/engine";
import type { ChecklistItem, Pack } from "@runlog/rules-schema";
import { evidenceFor, pointOf, type Settling } from "./evidence.ts";

/**
 * What the button on an owed thing says.
 *
 * "Resolve" reads as confirming that something has already been seen to.
 * The queue is the other way round: the trigger has not run yet, and
 * pressing the button is how it runs. So the word is the move, and where
 * the move is a roll it names the dice, because a player deciding whether
 * to reach for real ones wants to know which.
 *
 * The reading comes from the engine, which looks at the actions rather
 * than running them; see obligationAsks. Shared by the page and the
 * floating remote so the two cannot come to say different things about
 * the same debt.
 */
export function words(asks: ReturnType<typeof obligationAsks>): string {
  if (!asks) return "Apply it";
  if (asks.kind === "choose") return "Choose";
  return asks.dice ? `Roll ${asks.dice}` : "Roll for it";
}

/** For a queued trigger: what settling it will ask for. */
export function settleWords(pack: Pack, obligation: { kind?: string; ref?: Parameters<typeof obligationAsks>[1]["ref"] }): string {
  return words(obligationAsks(pack, obligation));
}

/** For one of the pack's own triggers the player is being asked to fire. */
export function globalWords(pack: Pack, index: number): string {
  return words(globalTriggerAsks(pack, index));
}

/** One result, as a key the maps below are read by. */
const at = (table: string, entryId: string) => `${table}/${entryId}`;

/**
 * What the game still owes on each result it has drawn, and what it has
 * already paid.
 *
 * A result can be three things at once on the same screen: a rule that
 * binds the step, a box on the closing confirmation, and a trigger waiting
 * to run. They were three separate things to read and two of them asked
 * the player to say something about the third. This is what lets them be
 * one: everything keyed by the result it belongs to, so a rule can carry
 * the roll it is waiting for and a box can know that rolling it is the
 * honoring, not a promise about it.
 *
 * `true` where the trigger has run, `false` where it has not. A result the
 * pack hung nothing on is absent, and stays the player's word alone.
 */
export function owedOn(state: RunState | null): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const o of state?.obligations ?? []) {
    if (o.kind !== "trigger" || o.ref?.kind !== "tableEntry") continue;
    const key = at(o.ref.table, o.ref.entryId);
    // Unsettled wins: the same result drawn twice owes until both are paid.
    out.set(key, (out.get(key) ?? true) && o.resolved);
  }
  return out;
}

/** Whether the game still owes something on this result. */
export function stillOwed(owed: Map<string, boolean>, on: { table: string; entryId: string }): boolean {
  return owed.get(at(on.table, on.entryId)) === false;
}

/** Whether the game owed something on this result and has since paid it. */
export function settledOn(owed: Map<string, boolean>, on: { table: string; entryId: string }): boolean {
  return owed.get(at(on.table, on.entryId)) === true;
}

/**
 * Which boxes of a confirmation belong to which result.
 *
 * A rule can carry the tick that honors it, and the tick has to be the one
 * the confirmation was asking for or the step would wait on a box nobody
 * can see. Keyed the way `Checklist` keys its rows, because they are the
 * same rows. A result two points both show is ticked in both.
 */
export function boxesByResult(pack: Pack, state: RunState, items: ChecklistItem[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  items.map(pointOf).forEach((point, i) => {
    if (!point.shows) return;
    for (const row of evidenceFor(pack, state, point.shows)) {
      const key = at(row.table, row.entryId);
      out.set(key, [...(out.get(key) ?? []), `${i}:${row.key}`]);
    }
  });
  return out;
}

/**
 * What a closing step's confirmation should do about each result it lists.
 *
 * The whole decision in one place, and out of the view, so it can be read
 * against a real pack without a browser: which rows the game settles,
 * which the player must still answer, and which are already in front of
 * them as a rule the step is held to and so are not listed twice.
 */
export function settlingFor(
  pack: Pack,
  state: RunState,
  rules: Array<{ table: string; entryId: string }>,
  items: ChecklistItem[],
): Settling & { boxes: Map<string, string[]> } {
  const owed = owedOn(state);
  const asRules = new Set(rules.map((line) => at(line.table, line.entryId)));
  const boxes = boxesByResult(pack, state, items);
  const owing = (row: { table: string; entryId: string }) => stillOwed(owed, row);
  const settled = (row: { table: string; entryId: string }) => settledOn(owed, row);
  return {
    owing,
    settled,
    // A rule carries the tick that honors it, so the list can drop the row.
    answered: (row) => (boxes.get(at(row.table, row.entryId)) ?? []).length > 0,
    hidden: (row) => asRules.has(at(row.table, row.entryId)),
    boxes,
  };
}

/** For a counter's trigger that has come due. */
export function thresholdWords(pack: Pack, counter: string, index: number): string {
  return words(counterTriggerAsks(pack, counter, index));
}
