import type { SetupGroup } from "@runlog/rules-schema";
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
  primary: { id: "roll" | "carry-on" | "close" | "enter" | "owed"; label: string; kind: string } | null;
  moves: Array<{ id: string; label: string }>;
  undo: { what: string } | null;
  /** Why a deck cannot press this, in words a key face can carry. */
  needsPage: string | null;
  presets: Array<{ kind: string; label: string; suggestions?: string[]; items?: number }>;
  /**
   * The setups a key may apply to this run, by id, title and kind.
   *
   * The kind travels because a deck cannot work it out for itself: a
   * setup reaches one as a title, and a key set to cycle the loadouts
   * alone has to know which of forty titles those are. It used to be
   * read off a `Warp` prefix on the title, which was a guess about how
   * somebody had chosen to name a file rather than something the file
   * said.
   */
  setups: Array<{ id: string; title: string; group: SetupGroup }>;
  /**
   * The same list again, as things a key may hand the tool once.
   *
   * A field of its own rather than a flag on `setups`, because a deck
   * lays both kinds of key out from what it is given: an apply key and a
   * command key for the same file are two faces, and a deck should not
   * have to guess which of the two a title is good for.
   */
  commands: Array<{ id: string; title: string; group: SetupGroup }>;
  /** The tallies and the dials, as the Trackers panel lists them. */
  trackers: Array<{ id: string; kind: "counter" | "resource"; label: string; value: number; max: number | null }>;
  /** The clock the page's Pause, Resume and Stop act on, where one is ticking. */
  clock: { id: string; label: string; status: "running" | "paused" | "done" } | null;
  /** Whether the app is throwing the dice itself. */
  autoRoll: boolean;
  /** The ending the page would offer, in the words of its own button. */
  ending: { label: string } | null;
}

export interface OfferInput {
  /** The snapshot this offer belongs to; a press carries it back. */
  seq: number;
  /** Active, editable, and actually started. */
  live: boolean;
  /** Nothing more is being asked of this step. */
  settled: boolean;
  /** The step's own receipts are waiting to be read, and nothing more is asked. */
  receipts: boolean;
  step: Step | null;
  stepLabel: string | null;
  /** What the engine is waiting on, when it is waiting on anything at all. */
  request: { kind: "roll"; label: string } | { kind: "other" } | null;
  moves: Array<{ id: string; label: string }>;
  canUndo: boolean;
  lastResult: string | null;
  /** Obligations standing in the way. */
  owed: number;
  /**
   * What the *game* is owed: a counter that has crossed its threshold, a
   * trigger the run has arrived at, each with the key that fires it and the
   * words the page's own button carries.
   *
   * Handed in rather than worked out here, for the reason the trackers are:
   * naming a trigger takes the pack, and this function is given what is on
   * offer rather than the pack to read it from.
   */
  due: Array<{ id: string; label: string; kind: "threshold" | "global" }>;
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
  /**
   * The setups this run could hand out, in the words the picker uses.
   *
   * Worked out by the page rather than here: a setup is written against
   * the tool a run is talking to, and finding those means reading the
   * shipped profiles and the shelf, neither of which this function has.
   */
  setups: Array<{ id: string; title: string; group: SetupGroup }>;
  /**
   * The same setups again, offered as commands. Handed in beside them
   * rather than copied from them here, because what a page has to hand
   * the tool is the file's own operations, and this function is given
   * titles and ids alone.
   */
  commands: Array<{ id: string; title: string; group: SetupGroup }>;
  /**
   * Every tally and every dial the run keeps, worked out by the page for
   * the reason the setups are: which of them the page draws depends on the
   * pack and on who is at the table, and the panel that draws them is the
   * one home for that.
   */
  trackers: Offer["trackers"];
  /** The clock the page's own buttons act on, or null while none is. */
  clock: Offer["clock"];
  /** Whether this device is throwing the dice for the player. */
  autoRoll: boolean;
  /** What the page's Finish button says, where the page is showing one. */
  ending: Offer["ending"];
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
  const bare = {
    seq: input.seq,
    moves,
    undo,
    presets: [] as Offer["presets"],
    setups: input.setups,
    commands: input.commands,
    trackers: input.trackers,
    clock: input.clock,
    autoRoll: input.autoRoll,
    ending: input.ending,
  };

  // A run nobody is playing -- not started, read-only, ended -- offers
  // nothing at all, moves and undo included. They used to ride out on
  // `bare`, and `takePress` reads only those two fields when it takes a
  // move or an undo, so a deck could move a run the page itself would not
  // let anyone touch. The setups go with them: what a finished run was
  // played under is a record of what happened, and a key that could
  // rewrite it from another room is worse than no key.
  //
  // The commands go with them. Nothing they do is written to the run, but
  // a run nobody is playing has no tool to hand them to that anybody at
  // this table asked for.
  //
  // The dials, the clock, the dice setting and the ending are held back for
  // the same reason, and held back rather than merely refused: a key face
  // drawn from an offer should go dim on a run nobody is playing rather
  // than show a tally somebody can press and be told no.
  if (!input.live)
    return {
      ...bare,
      moves: [],
      undo: null,
      setups: [],
      commands: [],
      trackers: [],
      clock: null,
      autoRoll: false,
      ending: null,
      primary: null,
      needsPage: "Open the run on the page",
    };

  // The receipts of the step's own throws sit on the page, waiting to be
  // read, before anything about the step itself -- what it is, whether it
  // closes the unit -- comes into it. No presets: the checklist and the
  // between-units button are both still behind this same screen.
  if (input.receipts) return { ...bare, primary: { id: "carry-on", label: "Carry on", kind: "receipt" }, needsPage: null };

  // What the game is owed is the press, ahead of anything that would carry
  // the run forward. A counter threshold left pending rode into the next
  // scene in a live run, out of the page's own closing card and out of a
  // deck's Next, because neither door counted it. So the Next key offers
  // the panel's own button rather than going dim: the one press that
  // settles it is the one on the key. Moves, undo and the dials stay on
  // offer, the way the page leaves them on screen beside it.
  //
  // Settled only, so a throw already asked for is answered first, by the
  // roll branch further down. Firing a trigger begins a block of its own,
  // and `begin` writes over whatever was pending: offered mid-throw, this
  // press would throw the run's own dice request away.
  if (input.settled && input.due.length > 0) {
    const first = input.due[0]!;
    return { ...bare, primary: { id: "owed", label: first.label, kind: first.kind }, needsPage: null };
  }

  // What the player owes stops the same doors, checked here rather than
  // after the step's own kind: entering the next unit carries the debt
  // into it, and the between-units button below used to walk straight
  // past this. A step still waiting on dice is left to the branch that
  // handles it -- nobody is being asked to judge anything mid-throw --
  // and a typed step keeps its preset, which answers the step rather than
  // moving the run on.
  if (input.owed > 0 && input.settled && !(input.step && TYPED.has(input.step.kind)))
    return { ...bare, primary: null, needsPage: "Something is owed; settle it on the page" };

  if (!input.step) {
    if (input.between) return { ...bare, primary: { id: "enter", label: input.between, kind: "between" }, needsPage: null };
    return { ...bare, primary: null, needsPage: null };
  }

  const step = input.step;
  const kind = step.kind;
  const label = input.stepLabel ?? "";

  // An unsettled step is still being asked something, the same reasoning
  // `closesTheUnit` uses to refuse an unsettled unit: it is not yet a bare
  // press for a key to make. A pending roll is the one exception: nobody is
  // being asked to judge anything, only to throw dice, and a deck can throw
  // them the same way the page's own "Roll for me" does.
  if (!input.settled) {
    if (input.request?.kind === "roll")
      return { ...bare, primary: { id: "roll", label: input.request.label, kind: "rollTable" }, needsPage: null };
    return { ...bare, primary: null, needsPage: `${label} on the page` };
  }

  if (TYPED.has(kind))
    return {
      ...bare,
      primary: null,
      needsPage: `${label} on the page`,
      presets: [{ kind, label, ...(input.suggestions.length > 0 ? { suggestions: input.suggestions } : {}) }],
    };

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
