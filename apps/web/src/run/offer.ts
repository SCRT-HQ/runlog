import type { Step } from "@runlog/rules-schema";

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
  presets: Array<{ kind: string; label: string; suggestions?: string[] }>;
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
}

/** Steps a key can answer with one press, because they ask nothing first. */
const PRESSABLE: Record<string, "roll" | "carry-on" | "close" | "enter"> = {
  rollTable: "roll",
  finalizeUnit: "close",
};

/** Steps that take something typed, and the preset that covers each. */
const TYPED = new Set(["declareSubject"]);

export function offerOf(input: OfferInput): Offer {
  const moves = input.moves;
  const undo = input.canUndo && input.lastResult ? { what: input.lastResult } : null;
  const bare = { seq: input.seq, moves, undo, presets: [] as Offer["presets"] };

  if (!input.live) return { ...bare, primary: null, needsPage: "Open the run on the page" };
  if (!input.step) return { ...bare, primary: null, needsPage: null };

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

  // A manual step asks nothing on its own; it only asks something when it
  // carries a checklist to confirm. Empty, it is as bare a press as a roll.
  if (step.kind === "manual") {
    const items = step.checklist ?? [];
    if (items.length > 0) return { ...bare, primary: null, needsPage: `${label} on the page` };
    return { ...bare, primary: { id: "carry-on", label, kind }, needsPage: null };
  }

  // A finalizeUnit with confirmation items is the honor check: the same
  // kind of ask as a manual checklist, not a bare close.
  if (step.kind === "finalizeUnit" && (step.confirm ?? []).length > 0) return { ...bare, primary: null, needsPage: `${label} on the page` };

  if (input.owed > 0) return { ...bare, primary: null, needsPage: "Something is owed; settle it on the page" };

  const id = PRESSABLE[kind];
  if (!id) return { ...bare, primary: null, needsPage: `${label} on the page` };
  return { ...bare, primary: { id, label, kind }, needsPage: null };
}
