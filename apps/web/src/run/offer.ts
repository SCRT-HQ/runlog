import type { Step } from "@runlog/rules-schema";
import { checklistOf, closesUnit } from "@runlog/engine";
import { pointOf } from "./evidence.ts";

/**
 * What a deck may press, right now, in the pack's own words.
 *
 * The same reasoning as `snapshot.asks`: only a device holding the pack
 * and the log can say what is on offer, so it is published rather than
 * worked out by the server. Wider than `asks`, because a deck is the
 * owner pressing and may do what the page's own buttons do.
 *
 * Deliberately conservative, for the reason `handsFree.ts` gives: this
 * removes ceremony, never a decision. Anything the player is genuinely
 * being asked, anything owed, and anything typed stops here and says so.
 */
export interface Offer {
  seq: number;
  primary: { id: "roll" | "carry-on" | "close" | "enter"; label: string; kind: string } | null;
  moves: Array<{ id: string; label: string }>;
  undo: { what: string } | null;
  /** Why a deck cannot press this, in words a key face can carry. */
  needsPage: string | null;
  presets: Array<{ kind: string; label: string; suggestions?: string[]; items?: number }>;
}

export interface OfferInput {
  /** The snapshot this offer belongs to; a press carries it back. */
  seq: number;
  /** Active, editable, and actually started. */
  live: boolean;
  /** Nothing more is being asked of this step. */
  settled: boolean;
  step: Step | null;
  stepLabel: string | null;
  moves: Array<{ id: string; label: string }>;
  canUndo: boolean;
  lastResult: string | null;
  /** Obligations standing in the way. */
  owed: number;
  /** What the run would suggest for a subject, where it suggests anything. */
  suggestions: string[];
  /** What the page's between-units button says, or null when the run is not between units. */
  between: string | null;
  /**
   * What the step's own button says once every box is ticked, or null
   * where the step has no list. The preset presses that button, so it is
   * offered in the words the page uses for it.
   */
  finishLabel: string | null;
}

/**
 * Steps a key can answer with one press, because they ask nothing first.
 *
 * A step that closes the unit is not listed here: it is routed by
 * `closesUnit` below, the same way whichever kind it is, rather than by
 * its own kind.
 */
const PRESSABLE: Record<string, "roll" | "carry-on" | "close" | "enter"> = {
  rollTable: "roll",
};

/** Steps that take something typed, and the preset that covers each. */
const TYPED = new Set(["declareSubject"]);

export function offerOf(input: OfferInput): Offer {
  const moves = input.moves;
  const undo = input.canUndo && input.lastResult ? { what: input.lastResult } : null;
  const bare = { seq: input.seq, moves, undo, presets: [] as Offer["presets"] };

  if (!input.live) return { ...bare, primary: null, needsPage: "Open the run on the page" };
  if (!input.step) {
    if (input.between) return { ...bare, primary: { id: "enter", label: input.between, kind: "between" }, needsPage: null };
    return { ...bare, primary: null, needsPage: null };
  }

  const step = input.step;
  const kind = step.kind;
  const label = input.stepLabel ?? "";

  // An unsettled step is still being asked something, the same reasoning
  // `closesTheUnit` uses to refuse an unsettled unit: it is not yet a bare
  // press for a key to make.
  if (!input.settled) return { ...bare, primary: null, needsPage: `${label} on the page` };

  if (TYPED.has(kind))
    return {
      ...bare,
      primary: null,
      needsPage: `${label} on the page`,
      presets: [{ kind, label, ...(input.suggestions.length > 0 ? { suggestions: input.suggestions } : {}) }],
    };

  // Owed blocks every bare press but a typed step's own preset: the page
  // would refuse the same close or carry-on until it is settled, checked
  // once here rather than separately for every kind that reaches this far.
  if (input.owed > 0) return { ...bare, primary: null, needsPage: "Something is owed; settle it on the page" };

  /*
   * Ticking the whole list and pressing the step's own button, for a key
   * the streamer put there themselves.
   *
   * A preset, never the primary: `needsPage` stays, so the follow key goes
   * on saying the list is on the page. Pressing this one skips the reading,
   * which is a decision, and `handsFree.ts` gives the rule -- a decision is
   * skipped only where somebody chose to skip it.
   *
   * The count is what the step waits for, which is its points less the
   * optional ones. Not less the ones with nothing to show: that needs the
   * log and the pack, and this says what is on offer from the step alone.
   */
  const list = checklistOf(step);
  const ticking: Offer["presets"] =
    list.length > 0 && input.finishLabel
      ? [
          {
            kind: "checklist",
            label: `Tick everything and ${input.finishLabel}`,
            items: list.map(pointOf).filter((p) => !p.optional).length,
          },
        ]
      : [];

  // A step that closes the unit goes to the page's closing card, whichever
  // kind it is underneath: a finalizeUnit, or a manual step marked
  // closesUnit. Its own confirmation or checklist is the same kind of ask
  // as any other and sends it back to the page; empty, it is the one
  // press that writes the close, not a step's own carry-on.
  if (closesUnit(step)) {
    if (list.length > 0) return { ...bare, primary: null, needsPage: `${label} on the page`, presets: ticking };
    return { ...bare, primary: { id: "close", label, kind: step.kind }, needsPage: null };
  }

  // A manual step that does not close the unit asks nothing on its own; it
  // only asks something when it carries a checklist to confirm. Empty, it
  // is as bare a press as a roll.
  if (step.kind === "manual") {
    if (list.length > 0) return { ...bare, primary: null, needsPage: `${label} on the page`, presets: ticking };
    return { ...bare, primary: { id: "carry-on", label, kind }, needsPage: null };
  }

  const id = PRESSABLE[kind];
  if (!id) return { ...bare, primary: null, needsPage: `${label} on the page` };
  return { ...bare, primary: { id, label, kind }, needsPage: null };
}
