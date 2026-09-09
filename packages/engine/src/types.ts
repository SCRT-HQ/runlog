import type { Pack, TriggerPoint } from "@runlog/rules-schema";

/**
 * Derived run state.
 *
 * Nothing here is authored or stored directly: every field is a fold over the
 * event log. That is what makes undo, replay and export trustworthy, there is
 * exactly one source of truth, and it is the list of things that happened.
 */

/** How a roll's value came to be, recorded so a log can be audited later. */
export type RollSource = "physical" | "rng" | "seeded";

export interface Subject {
  /** 1-based, assigned in creation order. Stable for the life of the run. */
  id: number;
  /** The unit this subject was made in. */
  unit: number;
  /** What the player declared it to be, once they have. */
  type: string | null;
  /**
   * What the player calls it, if they gave it a name. Without one it is
   * known by its noun and number ("Track 3"), which never changes: the
   * number is the id, so naming Track 1 does not make the next one Track 1.
   */
  name: string | null;
  /** Ids of states currently attached. */
  states: string[];
  /** True once its unit has been closed. */
  finalized: boolean;
  /** True once a game effect took it out of play entirely. */
  removed: boolean;
  createdAt: string;
}

/**
 * Where a deferred trigger came from, so its actions can be looked up again
 * when it falls due.
 *
 * A reference rather than a copy of the actions: the log stays small and
 * readable, and it records which pack version it was played against, so
 * behavior is reproducible without embedding rules text in every save.
 */
export type TriggerRef =
  | { kind: "tableEntry"; table: string; entryId: string; index: number }
  | { kind: "card"; deck: string; cardId: string; index: number }
  | { kind: "counter"; counter: string; index: number };

/**
 * Something the player still owes the game.
 *
 * This is the queue that makes a tracker worth having. "After composing, roll
 * d6." "Upon finalizing, roll d6." "When you first declare the run over…" On
 * paper these are forgotten an hour later; here they resurface at the exact
 * moment they come due.
 */
export interface Obligation {
  id: string;
  /** A note is ticked off by hand; a trigger runs actions when it falls due. */
  kind: "note" | "trigger";
  text: string;
  /** For triggers: the lifecycle point at which this becomes due. */
  on?: TriggerPoint;
  ref?: TriggerRef;
  /** The subject this was aimed at, when it reached backwards. */
  targetSubject?: number | null;
  /** The unit it was incurred in. */
  unit: number;
  resolved: boolean;
  /** Keeps a persistent note on screen for the rest of the run. */
  persistent?: boolean;
}

/**
 * Something the engine needs from the player before it can carry on.
 *
 * Execution is interruptible by design: a pack can ask for a die roll the
 * player wants to make with real dice, or for a judgment the engine has no
 * way to make on its own.
 */
export type InputRequest =
  /** A die roll. Physical dice are the default, so this is usually a question. */
  | { kind: "roll"; key: string; dice: string; label?: string; purpose: string }
  /** A choice or a piece of text. */
  | {
      kind: "prompt";
      key: string;
      promptKind: "chooseSubject" | "chooseValue" | "chooseState" | "confirm" | "text";
      label: string;
      options?: string[];
      eligibleOnly?: boolean;
    }
  /** A yes/no judgment about the work itself, which the engine cannot see. */
  | { kind: "ask"; key: string; question: string }
  /** Which earlier subject a consequence lands on, when the rules defer to the player. */
  | { kind: "chooseTarget"; key: string; label: string; eligible: number[] };

/** One resolved table result, kept so the log can be read back as a story. */
export interface ResolvedOutcome {
  unit: number;
  table: string;
  entryId: string;
  /** Which subject it landed on, when it reached backwards. */
  targetSubject: number | null;
  at: string;
}

/** A stopwatch or timer, as the log has it. What has elapsed is computed from these moments. */
export interface Clock {
  id: string;
  kind: "stopwatch" | "timer";
  label: string;
  /** A timer's length; null for a stopwatch. */
  seconds: number | null;
  /** The unit it was started in. */
  unit: number;
  status: "running" | "paused" | "done";
  startedAt: string;
  /** When it last started running, while it is running. */
  runningSince: string | null;
  /** Time run before the current stretch, in milliseconds. */
  accumulatedMs: number;
  /** The final time, once stopped. */
  elapsedMs: number | null;
  /** A timer that ran out, rather than being stopped. */
  expired: boolean;
}

/** Someone racing in a moderated run: a name on the roster, not an account. */
export interface Contestant {
  id: string;
  name: string;
  /** Contestant-scoped states the moderator has put on them. */
  states: string[];
}

/** A challenge won: which result, by whom, for how much. */
export interface Award {
  contestant: string;
  /** The outcome's position in `outcomes`. */
  outcome: number;
  table: string;
  entryId: string;
  points: number;
  at: string;
}

export interface RunState {
  packId: string;
  packVersion: string;
  mode: string;
  seed: string | null;
  /** What the player called this run, if they did. */
  name: string | null;
  /**
   * How many people are playing. One unless the mode says otherwise; recorded
   * because role rotation cannot be recomputed without it.
   */
  players: number;

  status: "active" | "ended";
  startedAt: string;
  /**
   * Timestamp of the most recent event. A run is not assumed to happen in one
   * sitting: a training log might span days, and the log should say so.
   */
  updatedAt: string;

  /** Current unit number, 1-based. 0 before the first unit is entered. */
  unit: number;
  /** Phases completed within the current unit. */
  phasesDone: string[];
  /** Steps completed within the current unit, as `phaseId#index`. */
  stepsDone: string[];
  /**
   * Boxes ticked in the current unit, as `phaseId#index|key`. In the log
   * rather than in the view, so a reload keeps them and a tick can count.
   */
  checks: string[];

  subjects: Subject[];
  /** Run-scoped states, e.g. "the game has lost track of you". */
  runStates: string[];

  counters: Record<string, number>;
  resources: Record<string, number>;
  flags: Record<string, boolean>;

  /** Mandatory extra units queued; the run cannot end while any remain. */
  forcedUnits: number;
  /** Extra rolls owed on a table's step this unit, by table id: "this Stage rolls two Setbacks". */
  extraRolls: Record<string, number>;
  /** Extra rolls owed in the next unit, moved into `extraRolls` when it is entered. */
  extraRollsNext: Record<string, number>;
  /** How many units back the run goes when this one closes; 0 is forward as usual. */
  rewindNext: number;
  /** How many times the run has been sent back. */
  rewinds: number;
  /** Subject types that may no longer be declared. */
  bannedTypes: string[];

  /** Free-text entries, keyed by unit number. */
  journal: Record<number, string>;
  /** Cards currently held. */
  hand: Array<{ deck: string; cardId: string }>;

  /** Every table result resolved so far, in order. */
  outcomes: ResolvedOutcome[];
  /** Deferred triggers and manual instructions still owed. */
  obligations: Obligation[];
  /** Once-per-run trigger keys that have already fired. */
  firedOnce: string[];

  /** Optional requirements the run said it lacks; results that need one are drawn again. */
  lacks: string[];
  /** Every clock started this run, stopped or not. */
  clocks: Clock[];
  /** The roster, in a moderated run. Empty otherwise. */
  contestants: Contestant[];
  /** Every challenge awarded, in order. Scores are their sums. */
  awards: Award[];

  ending: string | null;
}

/** Everything the reducer needs besides the events themselves. */
export interface EngineContext {
  pack: Pack;
}
