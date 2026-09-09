import { counterTriggerAsks, globalTriggerAsks, obligationAsks } from "@runlog/engine";
import type { Pack } from "@runlog/rules-schema";

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

/** For a counter's trigger that has come due. */
export function thresholdWords(pack: Pack, counter: string, index: number): string {
  return words(counterTriggerAsks(pack, counter, index));
}
