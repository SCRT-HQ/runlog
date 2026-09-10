import type { Obligation, RollSource } from "./types.ts";

/**
 * The event log.
 *
 * A run *is* this list. State is derived by folding it, which is what buys
 * undo, exact replay, reproducible seeds, and an export that doubles as the
 * run log the player would otherwise keep on paper.
 *
 * Events describe what happened, never what should happen next. Anything that
 * looks like a decision belongs in the pack.
 */

interface Base {
  /** ISO timestamp. Runs may span days, so this is recorded per event. */
  at: string;
  /**
   * The event's own name, minted where it was made. What an `Undone` names,
   * and what lets a server that sees the same event twice keep it once.
   * Absent on logs from before ids; the app stamps those on first load.
   */
  id?: string;
  /**
   * The move this event was made in. A step's roll, its outcome and the
   * record of the step finishing land together, and an undo must void all
   * of them or none; this names the batch so it can. Absent on logs from
   * before it existed, which undo by the older rule of thumb instead.
   */
  move?: string;
  /**
   * Set by the server when the event is appended to a shared log: its place
   * in the order everyone replays, and who made it. Absent until then.
   */
  seq?: number;
  author?: string;
  /**
   * Who outside the table asked for the move this event belongs to, when
   * someone did: a chat command, a channel-point redeem, a button. The
   * host's device took it; this only says at whose asking.
   */
  askedBy?: { name?: string; via?: string };
}

export type RunEvent =
  | (Base & {
      t: "RunStarted";
      packId: string;
      packVersion: string;
      /**
       * What the run is called wherever it is stored. Absent on logs written
       * before runs had names; the app gives those one when it reads them.
       */
      runId?: string;
      mode: string;
      seed?: string;
      /** How many people are at the table. Absent means solo. */
      players?: number;
      /** Optional requirements (ids from the pack's `requires`) this run said it does not have. */
      lacks?: string[];
    })
  | (Base & { t: "UnitEntered" })
  | (Base & { t: "SubjectDeclared"; subjectType: string })
  /**
   * A subject renamed after the fact.
   *
   * Distinct from declaring one: the thing already exists and keeps its id and
   * its states, only what it is called changes. Recorded rather than edited in
   * place because the log is the run: a name fixed by hand and not written
   * down would be gone on the next reload.
   */
  | (Base & { t: "SubjectRenamed"; subject: number; name: string })
  /**
   * The run given a name of its own. A run is otherwise known by its pack and
   * its mode, which is fine for one and useless for the third winter set.
   * In the log rather than beside it, so the name travels with the run.
   */
  | (Base & { t: "RunRenamed"; name: string })
  | (Base & {
      t: "Rolled";
      /** What the roll was for: a table id, or a free-form label. */
      purpose: string;
      dice: string;
      total: number;
      /** Individual dice, so the log can show the working. */
      values: number[];
      source: RollSource;
    })
  | (Base & {
      t: "OutcomeResolved";
      table: string;
      entryId: string;
      cause: "phase" | "action" | "manual";
      /** Set when the outcome reached back to an earlier subject. */
      targetSubject?: number;
    })
  | (Base & { t: "StateApplied"; state: string; subject?: number })
  | (Base & { t: "StateRemoved"; state: string; subject?: number })
  | (Base & { t: "SubjectRemoved"; subject: number })
  | (Base & { t: "CounterChanged"; counter: string; by?: number; set?: number })
  | (Base & { t: "ResourceChanged"; resource: string; by?: number; set?: number })
  | (Base & { t: "FlagSet"; flag: string; value: boolean })
  | (Base & { t: "TypeBanned"; subjectType: string })
  | (Base & { t: "UnitForced"; count: number })
  /** A table owes extra rolls: in this unit, or the next. */
  | (Base & { t: "ExtraRollQueued"; table: string; count: number; unit: "current" | "next" })
  /** When this unit closes, the run goes back `count` units instead of forward one. */
  | (Base & { t: "RewindQueued"; count: number })
  /** One of those extra rolls was made; the step stays open while any remain. */
  | (Base & { t: "ExtraRollTaken"; table: string })
  | (Base & { t: "StepCompleted"; phase: string; step: number })
  /**
   * A box ticked or unticked on a step's checklist. `step` is `phaseId#index`,
   * `item` the box's key within it. Recorded so the ticks survive a reload
   * and so a box can carry a tally.
   */
  | (Base & { t: "Checked"; step: string; item: string; on: boolean })
  /**
   * A correction made by hand from the board: what follows it in the log
   * was typed by the player to fix something, not produced by play. Does
   * nothing itself; it marks the start of an undoable edit and says why.
   */
  | (Base & { t: "Corrected"; note: string })
  | (Base & { t: "PhaseCompleted"; phase: string })
  | (Base & { t: "UnitFinalized" })
  | (Base & { t: "JournalWritten"; unit: number; text: string })
  | (Base & { t: "CardDrawn"; deck: string; cardId: string })
  | (Base & { t: "CardPlayed"; deck: string; cardId: string })
  | (Base & { t: "CardDiscarded"; deck: string; cardId: string })
  | (Base & { t: "TriggerFired"; key: string })
  | (Base & {
      t: "ObligationAdded";
      obligation: Omit<Obligation, "resolved" | "unit">;
    })
  | (Base & { t: "ObligationResolved"; id: string })
  | (Base & { t: "RunEnded"; ending: string })
  /**
   * A clock, in four events. The log keeps the moments, not a running
   * number: what has elapsed is computed from them and the present, so a
   * reload and a second device see the same clock.
   */
  | (Base & { t: "ClockStarted"; clock: string; kind: "stopwatch" | "timer"; label: string; seconds?: number })
  | (Base & { t: "ClockPaused"; clock: string })
  | (Base & { t: "ClockResumed"; clock: string })
  | (Base & { t: "ClockStopped"; clock: string; elapsedMs: number; expired?: boolean })
  /** A contestant joins the roster of a moderated run. */
  | (Base & { t: "ContestantAdded"; contestant: string; name: string })
  | (Base & { t: "ContestantRemoved"; contestant: string })
  /** The moderator marks one contestant: spared from the curse, out of the region, whatever the pack names. */
  | (Base & { t: "ContestantStateApplied"; contestant: string; state: string })
  | (Base & { t: "ContestantStateRemoved"; contestant: string; state: string })
  /**
   * The moderator's word that a contestant completed a drawn result. Names
   * the outcome by its position in the log and carries the points it was
   * worth then, so the scoreboard reads the same after the pack changes.
   */
  | (Base & { t: "Awarded"; contestant: string; outcome: number; table: string; entryId: string; points: number })
  | (Base & { t: "AwardRevoked"; contestant: string; outcome: number })
  /**
   * Undo, as a record rather than an erasure. Names the events it voids;
   * the reducer folds neither this nor them. An event, because a log that
   * two people append to cannot have its tail cut off by one of them.
   */
  | (Base & { t: "Undone"; ids: string[] });

export type RunEventType = RunEvent["t"];

/** Narrow an event by type, for readable folds and filters. */
export function isEvent<T extends RunEventType>(
  event: RunEvent,
  type: T,
): event is Extract<RunEvent, { t: T }> {
  return event.t === type;
}
