import { z } from "zod";
import { Action } from "./actions.ts";
import { Deck, Table, Trigger } from "./tables.ts";
import { DiceExpr, EventSelector, Id, NumericBound, PackId, Predicate } from "./primitives.ts";

/** Current major version of the pack contract. */
export const SCHEMA_VERSION = 1 as const;

/**
 * Engine features a pack depends on. A pack declares these so an older app
 * refuses to load it with a useful message, rather than quietly misplaying
 * somebody's game, which is a far worse failure than not loading at all.
 */
export const Capability = z
  .enum([
    "deferredTriggers",
    "seededRuns",
    "decks",
    "standardDeck",
    "resources",
    "counters",
    "coopRoles",
    "backwardTargeting",
    "timers",
    "journal",
    "bandsResolution",
    "opposedResolution",
    "keyedResolution",
    "moderated",
    "clockRules",
  ])
  .describe("An engine feature this pack needs in order to play correctly.");
export type Capability = z.infer<typeof Capability>;

/**
 * The words this game uses. The UI renders these rather than any hardcoded
 * noun, which is what lets one engine host a beat-making dungeon, a writing
 * crawl and a training log without special-casing any of them.
 */
export const Vocabulary = z
  .object({
    run: z
      .object({
        one: z.string().describe("Singular, e.g. Run, Session, Firing."),
        many: z.string().describe("Plural form."),
      })
      .strict()
      .describe("What one whole play session is called."),
    unit: z
      .object({
        one: z.string().describe("Singular, e.g. Room, Stage, Scene, Set."),
        many: z.string().describe("Plural form."),
      })
      .strict()
      .describe("What one round of play is called."),
    subject: z
      .object({
        one: z.string().describe("Singular, e.g. Piece, Scene, Set, Track."),
        many: z.string().describe("Plural form."),
      })
      .strict()
      .describe("What the thing produced in a unit is called."),
    finalize: z
      .string()
      .default("Finalize")
      .describe("Verb for closing a unit, e.g. Finalize, Fire, Commit."),
    terms: z
      .record(z.string(), z.string())
      .optional()
      .describe("Overrides for other UI strings, keyed by the string's name."),
  })
  .strict()
  .describe(
    "The words this game uses. The interface speaks these rather than any built-in noun, which is what lets one engine host wholly different games.",
  );
export type Vocabulary = z.infer<typeof Vocabulary>;

/**
 * A persistent state that can attach to a subject or to the run.
 *
 * `semantics` is how a pack tells the engine what a state *means* mechanically.
 * Without it the engine would have to know that "Untargetable" excludes a track
 * from targeting, which would make the engine game-specific.
 */
export const StateDef = z
  .object({
    label: z.string().min(1).describe("Name shown to the player, e.g. Volume Fixed."),
    short: z
      .string()
      .max(8)
      .optional()
      .describe(
        "Compact form for embedding in the name of the thing itself, a file, a layer, a DAW track. Keep it very short, e.g. VF.",
      ),
    scope: z
      .enum(["subject", "run", "contestant"])
      .default("subject")
      .describe(
        "Whether this attaches to one subject, to the whole run, or, in moderated play, to one contestant on the roster, marked by the moderator: spared from a curse, disqualified, and so on.",
      ),
    until: z
      .enum(["unitEnd"])
      .optional()
      .describe("When the state lifts by itself. `unitEnd`: it is taken off everything it is on when the unit closes, a curse for this region, a cure for this region."),
    semantics: z
      .array(
        z.enum(["blocksEdit", "makesUntargetable", "excludesFromResult", "locksValue", "removesFromPlay"]),
      )
      .optional()
      .describe(
        "What this state means mechanically. Without it the engine would have to know what your state names mean, which is exactly what keeps an engine game-specific. `makesUntargetable` removes the subject from targeting; `excludesFromResult` leaves it in the run but out of the finished piece; `removesFromPlay` takes it out entirely.",
      ),
    group: Id.optional().describe(
      "States in the same group are mutually exclusive on one holder: applying one removes the others. Use it for outcomes that cannot both be true, like landed and missed.",
    ),
    description: z.string().optional().describe("Explanation shown to the player on hover."),
  })
  .strict()
  .describe("A persistent condition that sticks to a subject, or to the run, once applied.");
export type StateDef = z.infer<typeof StateDef>;

/**
 * A counter with declarative increment/reset rules and threshold triggers.
 *
 * This is what turns a rule of the form "five quiet turns in a row and the
 * game comes for you, and any setback resets the count" into pack data rather
 * than engine code. Hidden counters are where paper play breaks down: nobody
 * reliably tracks a streak across an evening.
 */
export const CounterDef = z
  .object({
    label: z.string().min(1).describe("Name shown to the player."),
    initial: z.number().int().default(0).describe("Value at the start of a run."),
    min: z.number().int().optional().describe("Floor. Values are clamped to it."),
    max: z.number().int().optional().describe("Ceiling. Values are clamped to it."),
    hidden: z
      .boolean()
      .default(false)
      .describe("Track it without showing it, for tension the player should feel but not read."),
    incrementOn: z.array(EventSelector).optional().describe("Events that add one."),
    resetOn: z.array(EventSelector).optional().describe("Events that return it to `initial`."),
    triggers: z
      .array(
        z
          .object({
            when: NumericBound.describe("The threshold at which this fires."),
            do: z.array(Action).min(1).describe("What happens when it fires."),
            oncePerRun: z
              .boolean()
              .default(false)
              .describe("Fire at most once per run, however often the threshold is met."),
            label: z.string().optional().describe("How the event is announced to the player."),
          })
          .strict()
          .describe("A threshold trigger."),
      )
      .optional()
      .describe("Consequences that fire when the counter reaches a value."),
  })
  .strict()
  .describe(
    "A running tally with declarative rules. This is what turns a mechanic like 'six quiet turns in a row provokes the game, and any consequence resets the count' into data rather than engine code.",
  );
export type CounterDef = z.infer<typeof CounterDef>;

/**
 * A numeric track the player fills in or spends down: progress clocks, word
 * counts, training volume, pantry stock. Unused by dungeon-shaped packs.
 */
export const ResourceDef = z
  .object({
    label: z.string().min(1).describe("Name shown to the player."),
    initial: z.number().int().default(0).describe("Value at the start of a run."),
    min: z.number().int().default(0).describe("Floor."),
    max: z.number().int().optional().describe("Ceiling."),
    step: z.number().int().min(1).default(1).describe("Increment used by the plus/minus controls."),
    display: z
      .enum(["boxes", "bar", "number"])
      .default("number")
      .describe("How to draw it: tick boxes, a filled bar, or a plain number."),
    description: z.string().optional().describe("What it represents and how it is spent."),
  })
  .strict()
  .describe(
    "A numeric track the player fills or spends: a progress clock, a word count, training volume, stock on hand.",
  );
export type ResourceDef = z.infer<typeof ResourceDef>;

/** One step within a phase. */
/**
 * A point the player ticks off, and, optionally, what to look at while
 * ticking it. `shows` names a table whose results this unit (or this subject,
 * or the whole run) are listed under the item, each with its own box: "the
 * Constraint has been honored" then means *this* constraint, in front of
 * you, rather than one remembered from the log.
 */
/** A clock a unit runs: a stopwatch that times it, or a timer that limits it. */
export const Clock = z
  .object({
    kind: z.enum(["stopwatch", "timer"]).describe("A stopwatch counts up from the start of the unit; a timer counts down from `minutes`."),
    minutes: z.number().positive().max(24 * 60).optional().describe("How long a timer runs. Required for a timer; ignored by a stopwatch."),
    label: z.string().optional().describe("What the clock is called on screen. Defaults to the unit's name and number."),
    auto: z
      .boolean()
      .default(true)
      .describe("Start it when the unit is entered and stop it when the unit closes. Off, the player starts it by hand; it still stops with the unit."),
  })
  .strict()
  .refine((c) => c.kind !== "timer" || c.minutes !== undefined, { message: "a timer needs minutes", path: ["minutes"] })
  .describe("A clock the unit runs: `stopwatch` to time it, `timer` with `minutes` to limit it. The time lands in the log when the unit closes.");
export type Clock = z.infer<typeof Clock>;

/**
 * Fields every scoring key shares, so a run always has something to beat next
 * time whichever one a pack picks.
 */
const ScoreCommon = {
  better: z
    .enum(["higher", "lower"])
    .optional()
    .describe(
      "Which way wins: a higher number or a lower one. Defaults to higher, except for time, which defaults to lower.",
    ),
  label: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Name shown beside the score. Defaults to the counter's or resource's own label, \"Units closed\" in the pack's own word for a unit, or \"Time\".",
    ),
  tiebreak: z
    .enum(["time", "units"])
    .optional()
    .describe(
      "A second key to settle a tie on the first: time (the shorter wins) or units closed (the greater wins).",
    ),
};

/**
 * How a run is scored, so a solo run has a number to beat next time.
 *
 * One of four keys, because a pack's own idea of doing well is always one of
 * a small number of shapes: a tally it already declared, a track it already
 * declared, how far the run got, or how fast. A mode's own `score` replaces
 * the pack's outright, the way a mode's own `clock` does, never merged with
 * it, so a variant that scores differently is never left un-declaring the
 * pack's key first.
 */
export const Score = z
  .union([
    z
      .object({ counter: Id.describe("The declared counter whose value is the score."), ...ScoreCommon })
      .strict()
      .describe("Score by a counter's value."),
    z
      .object({ resource: Id.describe("The declared resource whose value is the score."), ...ScoreCommon })
      .strict()
      .describe("Score by a resource's value."),
    z
      .object({ units: z.literal(true).describe("Marks this as scoring by how many units the run closed."), ...ScoreCommon })
      .strict()
      .describe("Score by how many units the run closed."),
    z
      .object({ time: z.literal(true).describe("Marks this as scoring by time taken."), ...ScoreCommon })
      .strict()
      .describe("Score by time taken: the unit clock where the pack runs one, wall time otherwise."),
  ])
  .describe(
    "How to score a run. With neither a mode's own `score` nor the pack's, a run still scores by units closed, tiebreak time: what a race already ranks by, so nothing that plays today loses a number to beat tomorrow.",
  );
export type Score = z.infer<typeof Score>;

/** Something a person needs before they can play: the game, a wheel, a kitchen. */
export const Requirement = z
  .object({
    id: Id.describe("Unique among requirements. Table entries name it in `needs`."),
    label: z.string().min(1).describe("What it is, in the words a person would use: Rocket League, a potter's wheel, an oven."),
    kind: z
      .enum(["game", "platform", "software", "equipment", "supplies", "space", "other"])
      .default("other")
      .describe("What sort of thing it is, so a marketplace can say 'needs a game' or 'needs equipment' at a glance."),
    optional: z
      .boolean()
      .default(false)
      .describe("Nice to have rather than needed. A player says at the start whether they have it, and results that `need` it are drawn again when they do not."),
    note: z.string().optional().describe("A line on where to get it, which version, or what will do instead."),
    url: z.string().url().optional().describe("Where to find it."),
  })
  .strict()
  .describe("A physical or software requirement: the game and the system to play it on, a mod or training pack, a wheel, a kitchen, supplies.");
export type Requirement = z.infer<typeof Requirement>;

export const ChecklistItem = z.union([
  z.string().min(1),
  z
    .object({
      text: z.string().min(1).describe("The point to tick off."),
      optional: z
        .boolean()
        .optional()
        .describe("May be left unticked: closing the unit does not wait for it. For boxes that record an outcome rather than promise one."),
      tally: Id.optional().describe(
        "Each box ticked under this point adds one to this counter, and unticking takes it back. With `shows`, one box per result; without, the point's own box.",
      ),
      shows: z
        .object({
          table: z
            .union([z.string(), z.array(z.string()).min(1)])
            .describe("Results from this table, or from any of these tables, are listed under the item."),
          scope: z
            .enum(["unit", "subject", "run"])
            .default("unit")
            .describe(
              "Which results: those rolled this unit, those that reached this unit's subject, or every one in the run. A point whose tables produced nothing in scope is not asked at all: nothing to promise, nothing to tick.",
            ),
        })
        .strict()
        .optional()
        .describe("What to look at while ticking this: a table's results, listed under the point with a box each."),
    })
    .strict()
    .describe("A point with the results it is about shown beneath it."),
]).describe("A point to tick off: plain text, or text with the table results it is about.");
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const Step = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("rollTable").describe("Roll on a table as part of the flow."),
        table: Id.describe("Id of the table to roll on."),
        label: z.string().optional().describe("Prompt shown with the roll."),
        into: z.string().optional().describe("Name to bind the rolled total to."),
        optional: z
          .boolean()
          .default(false)
          .describe("Let the player skip this roll rather than requiring it."),
        skipWhen: z
          .array(Predicate)
          .optional()
          .describe("Reasons to skip this step. Any one of them is enough."),
      })
      .strict()
      .describe("Roll on a table as part of the flow."),
    z
      .object({
        kind: z.literal("declareSubject").describe("Ask the player to commit to what they are about to make."),
        label: z.string().optional().describe("Prompt shown when asking."),
        constrainedBy: Id.optional().describe(
          "Table whose result, if rolled this unit, constrains what may be declared.",
        ),
        skipWhen: z
          .array(Predicate)
          .optional()
          .describe("Reasons to skip this step. Any one of them is enough."),
      })
      .strict()
      .describe("Ask the player to commit to what they are about to make."),
    z
      .object({
        kind: z.literal("manual").describe("A step the engine cannot perform or verify: the actual creative work."),
        label: z.string().min(1).describe("What the player is being asked to do."),
        description: z.string().optional().describe("Further guidance."),
        constrainedBy: Id.optional().describe(
          "Table whose results this unit, if any, the work must honor; they are shown on the step, so a rule drawn earlier in the unit is in front of the player while they do it.",
        ),
        checklist: z
          .array(ChecklistItem)
          .optional()
          .describe("Points the player ticks off before moving on, each optionally showing the results it is about."),
        closesUnit: z
          .boolean()
          .optional()
          .describe(
            "Finishing this step closes the unit as well: its checklist is the honor check, and its Done is the unit's close, with the choice of going on to the next unit or finishing the run. A flow with such a step needs no finalizeUnit step.",
          ),
      })
      .strict()
      .describe(
        "A step the engine cannot perform or verify, the actual creative work. It only tracks that you did it.",
      ),
    z
      .object({
        kind: z.literal("actions").describe("Run actions as part of the flow."),
        do: z.array(Action).min(1).describe("Actions to run at this point in the flow."),
        skipWhen: z
          .array(Predicate)
          .optional()
          .describe("Reasons to skip this step. Any one of them is enough."),
      })
      .strict()
      .describe("Run actions as part of the flow."),
    z
      .object({
        kind: z.literal("finalizeUnit").describe("Close the unit."),
        label: z.string().optional().describe("Label for the button that closes the unit."),
        confirm: z
          .array(ChecklistItem)
          .optional()
          .describe(
            "Statements the player must affirm before the unit closes. Use this for the honor check: the engine cannot tell whether a constraint was respected, but it can make you look at it.",
          ),
      })
      .strict()
      .describe("Close the unit. Every flow needs one of these somewhere, or a manual step that closes the unit."),
  ])
  .describe("One step within a phase.");
export type Step = z.infer<typeof Step>;

export const Phase = z
  .object({
    id: Id.describe("Unique among phases. Referenced by counters and mode overrides."),
    label: z.string().min(1).describe("Name shown to the player."),
    description: z.string().optional().describe("What happens in this phase."),
    steps: z.array(Step).min(1).describe("Steps performed in order."),
    skipWhen: z
      .array(Predicate)
      .optional()
      .describe("Reasons to skip this phase. Any one of them is enough: a list of two means skip if either applies. Omit it to always play the phase."),
  })
  .strict()
  .describe("One stage of the per-unit flow.");
export type Phase = z.infer<typeof Phase>;

/**
 * How the game picks a previously-completed subject to damage.
 *
 * `anchoredOffset` generalizes the "count N before the newest / N after the
 * oldest, wrapping around, skipping ineligible" scheme. Packs with no backward
 * damage at all simply omit this section.
 */
export const TargetingDef = z
  .discriminatedUnion("strategy", [
    z
      .object({ strategy: z.literal("none").describe("Nothing ever reaches backwards.") })
      .strict()
      .describe("Nothing ever reaches backwards. Most practice games are like this."),
    z
      .object({ strategy: z.literal("playerChoice").describe("The player always picks who suffers.") })
      .strict()
      .describe("The player always picks who suffers."),
    z
      .object({ strategy: z.literal("random").describe("Pick uniformly at random among eligible subjects.") })
      .strict()
      .describe("Pick uniformly at random among eligible subjects."),
    z.object({ strategy: z.literal("oldest").describe("Always hit the oldest eligible subject.") }).strict().describe("Always hit the oldest eligible."),
    z.object({ strategy: z.literal("newest").describe("Always hit the newest eligible subject.") }).strict().describe("Always hit the newest eligible."),
    z
      .object({
        strategy: z.literal("anchoredOffset").describe("Count a number of places from an anchor subject."),
        bands: z
          .array(
            z
              .object({
                range: z
                  .tuple([
                    z.number().int().describe("Lowest roll in this band, inclusive."),
                    z.number().int().describe("Highest roll in this band, inclusive."),
                  ])
                  .describe("The roll range that selects this band."),
                anchor: z
                  .enum(["newest", "oldest", "playerChoice"])
                  .describe("Which subject counting starts from."),
                direction: z
                  .enum(["before", "after"])
                  .optional()
                  .describe("Which way to count from the anchor. Required unless playerChoice."),
              })
              .strict()
              .describe("One band of the roll, mapping to an anchor and a direction."),
          )
          .min(1)
          .describe("How roll ranges map onto anchors and directions."),
        offsetFrom: z
          .enum(["onesDigit"])
          .default("onesDigit")
          .describe("How the step count is read out of the roll."),
        wraparound: z
          .boolean()
          .default(true)
          .describe("Wrap past the ends of the list rather than stopping."),
        skipIneligible: z
          .boolean()
          .default(true)
          .describe("Skip untargetable and incomplete subjects while counting."),
        eventFallback: z
          .object({
            roll: DiceExpr.describe("What to roll to pick a band."),
            tensOddBand: z
              .number()
              .int()
              .describe("Band to use when the tens digit is odd, given as the band's low value."),
            tensEvenBand: z
              .number()
              .int()
              .describe("Band to use when the tens digit is even, given as the band's low value."),
            missOn: z
              .number()
              .int()
              .optional()
              .describe("Roll on which the consequence misses entirely but still counts as having happened."),
          })
          .strict()
          .optional()
          .describe(
            "How to pick a target when the consequence was not triggered by a roll that already selects a band.",
          ),
      })
      .strict()
      .describe(
        "Count a number of places from an anchor subject. Generalizes the 'N before the newest, N after the oldest, wrapping, skipping the ineligible' scheme.",
      ),
  ])
  .describe("How the game decides which earlier subject a consequence lands on.");
export type TargetingDef = z.infer<typeof TargetingDef>;

export const JournalDef = z
  .object({
    enabled: z.boolean().default(true).describe("Offer a free-text note on each unit."),
    prompt: z.string().optional().describe("The question shown above the note field."),
    required: z.boolean().default(false).describe("Require a note before a unit can be closed."),
  })
  .strict()
  .describe(
    "Free-text notes attached to units. Essential for journaling games, and useful anywhere, since a log of rolls alone does not tell you what you actually made.",
  );

/** How a run may end, and the shapes an ending can take. */
export const EndingDef = z
  .object({
    id: Id.describe("Unique among endings."),
    label: z.string().min(1).describe("Name shown to the player."),
    text: z.string().optional().describe("What this ending asks of the player."),
    requires: z
      .array(Predicate)
      .optional()
      .describe("Conditions under which this ending is available."),
  })
  .strict()
  .describe("One way a run can finish.");

/**
 * A mode is a set of deltas over the base ruleset, not a separate ruleset.
 * Keeping it that way is what stops "Daily Run" and "Co-op" from forking the
 * engine into parallel code paths that drift.
 */
export const Mode = z
  .object({
    label: z.string().min(1).describe("Name shown when choosing how to play."),
    description: z.string().optional().describe("What is different about this mode."),
    disable: z
      .object({
        tables: z.array(Id).optional().describe("Tables not used in this mode."),
        decks: z.array(Id).optional().describe("Decks not used in this mode."),
        counters: z.array(Id).optional().describe("Counters not tracked in this mode."),
        phases: z.array(Id).optional().describe("Phases skipped entirely in this mode."),
      })
      .strict()
      .optional()
      .describe("Parts of the base ruleset this mode leaves out."),
    units: z
      .object({
        fixed: z.number().int().min(1).optional().describe("Exact number of units."),
        roll: DiceExpr.optional().describe("Roll to determine the number of units, e.g. d6+4."),
        min: z.number().int().min(1).optional().describe("Fewest units allowed."),
        max: z.number().int().min(1).optional().describe("Most units allowed."),
      })
      .strict()
      .optional()
      .describe("How long a run in this mode is. Omit to let the player stop whenever."),
    seeded: z
      .boolean()
      .default(false)
      .describe(
        "Pre-roll the whole run from a seed, so several people can attempt the identical sequence and compare results.",
      ),
    players: z
      .object({
        min: z.number().int().min(1).default(1).describe("Fewest players."),
        max: z.number().int().min(1).default(1).describe("Most players."),
        roles: z
          .array(
            z
              .object({
                id: Id.describe("Unique among roles."),
                label: z.string().describe("Name shown to the player."),
                description: z.string().optional().describe("What this role may and may not do."),
                acts: z
                  .boolean()
                  .default(false)
                  .describe("Whether this role takes the table's actions in a unit it holds: rolling, declaring, ticking, closing. Where no role declares it, any seat acts."),
              })
              .strict()
              .describe("One role a player can hold."),
          )
          .optional()
          .describe("The roles players take. One player holds each per unit."),
        rotate: z
          .enum(["none", "clockwise"])
          .default("none")
          .describe("Whether roles pass to the next player when a unit closes."),
      })
      .strict()
      .optional()
      .describe("Multi-player configuration. Omit for solo play."),
    perUnit: z
      .array(
        z
          .object({
            unit: z
              .union([
                z.number().int().min(1).describe("A specific unit number, counting from 1."),
                z.literal("all").describe("Every unit."),
              ])
              .describe("Which unit this override applies to."),
            skipPhases: z.array(Id).optional().describe("Phases skipped in this unit."),
            extra: z
              .array(Action)
              .optional()
              .describe("Extra actions run when this unit begins, after any skips are applied."),
          })
          .strict()
          .describe("An override for one unit."),
      )
      .optional()
      .describe(
        "Per-unit overrides, for modes with a fixed shape,'unit three always suffers a consequence', and the like.",
      ),
    clock: Clock.optional().describe("This mode's clock on every unit, instead of the pack's `unit.clock`."),
    score: Score.optional().describe("This mode's own score, instead of the pack's `score`."),
    moderated: z
      .object({
        contestants: z
          .object({
            min: z.number().int().min(1).default(2).describe("Fewest contestants."),
            max: z.number().int().min(1).default(10).describe("Most contestants."),
          })
          .strict()
          .default({ min: 2, max: 10 })
          .describe("How many people race. The moderator is not one of them."),
        award: z
          .enum(["first", "everyone"])
          .default("first")
          .describe("Whether only the first to finish a challenge scores it, or everyone who finishes does."),
        firstBonus: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Extra points for finishing first, on top of the result's own. Meaningful with `everyone`."),
      })
      .strict()
      .optional()
      .describe(
        "Moderated play: one person runs the game on the device, a roster of named contestants races every drawn result, and the moderator awards points. Results with `points` are the challenges; everything else lands on everyone.",
      ),
    notes: z.array(z.string()).optional().describe("Reminders shown to the player in this mode."),
  })
  .strict()
  .describe(
    "A set of deltas over the base ruleset. Keeping modes as deltas rather than separate rulesets is what stops them drifting apart as the pack evolves.",
  );
export type Mode = z.infer<typeof Mode>;


/**
 * Something the player may choose to do, rather than something the game does
 * to them.
 *
 * The format began with only two ways for anything to happen: a step in the
 * declared flow, or a consequence of a table result. Transcribing a real
 * rulebook made the omission obvious: spending a one-shot card, re-entering an
 * earlier unit to repair it, resampling everything and starting from the
 * wreckage. All are optional, all are gated, most are once per run, and none of
 * them is on a schedule. They are moves.
 */
export const MoveDef = z
  .object({
    label: z.string().min(1).describe("Name shown on the button."),
    description: z.string().optional().describe("What the move does, in the player's words."),
    available: z
      .array(Predicate)
      .optional()
      .describe(
        "Conditions that must ALL hold for the move to be offered. Omit to make it always available.",
      ),
    oncePerRun: z
      .boolean()
      .default(false)
      .describe("Whether the move is spent after a single use."),
    do: z.array(Action).min(1).describe("What happens when the player takes it."),
    finalizes: z
      .boolean()
      .optional()
      .describe(
        "Taking this move also closes the current unit: the rest of its flow is recorded as done and the unit is finalized. For moves that are outcomes, like landed or missed, so the player is not asked to close the unit a second time.",
      ),
    /** Where the move belongs in the interface. */
    when: z
      .enum(["anytime", "betweenUnits", "beforeEnding"])
      .default("anytime")
      .describe(
        "When the move is offered: at any point, only between units, or only when the player is deciding whether to stop.",
      ),
  })
  .strict()
  .describe("An optional move the player may choose to make.");
export type MoveDef = z.infer<typeof MoveDef>;

/**
 * One assertion a fixture checks once it has run: a dotted path into derived
 * run state and what is expected there, or a check on the fixture's own
 * bookkeeping.
 */
export const Expectation = z.union([
  z
    .object({
      path: z.string().min(1).describe("Dotted path into derived run state, e.g. counters.calm."),
      equals: z.unknown().describe("The value expected at that path."),
    })
    .strict()
    .describe("The value at this path must equal exactly this."),
  z
    .object({
      path: z.string().min(1).describe("Dotted path into derived run state, naming an array."),
      contains: z.unknown().describe("The array at this path must contain this value."),
    })
    .strict()
    .describe("The array at this path must contain this value, among others."),
  z
    .object({
      path: z.string().min(1).describe("Dotted path into derived run state, naming an array."),
      absent: z.unknown().describe("The array at this path must not contain this value."),
    })
    .strict()
    .describe("The array at this path must not contain this value."),
  z
    .object({
      requests: z
        .literal("answered")
        .describe(
          "Nothing the engine asked during a play fixture's script was left unanswered. Always true once a play fixture completes at all: spelled out here so a fixture can say so on purpose.",
        ),
    })
    .strict()
    .describe("Every request the engine made while playing was answered."),
]).describe("One assertion, checked after the fixture runs.");
export type Expectation = z.infer<typeof Expectation>;

/**
 * What a play fixture's `answers` map may hand back for one of the engine's
 * requests.
 */
const PlayAnswerValue = z.union([z.string(), z.number(), z.boolean()]);

/**
 * Answers for whatever the engine asks while a play step runs.
 *
 * A key is matched against a request in this order: the request's own
 * deterministic key first (for a nested roll or prompt copied out of a
 * failure message); failing that, a die notation such as "d100" or "d6",
 * matched to requests of that shape in the order they are asked; failing
 * that, a prompt kind such as "chooseSubject" or "confirm", matched the same
 * way. A list under one of the latter two answers successive asks of that
 * shape in order; a bare value answers only the first.
 */
const PlayAnswers = z
  .record(z.string(), z.union([PlayAnswerValue, z.array(PlayAnswerValue)]))
  .describe("Answers for the engine's requests while this step runs. See `play` for how a key is matched.");

/** One step of a play fixture's script. */
export const PlayStep = z.union([
  z
    .object({
      enter: z.number().int().min(1).describe("Enter the next unit; asserts it is this one."),
      answers: PlayAnswers.optional(),
    })
    .strict()
    .describe("Enter the next unit."),
  z
    .object({
      declare: z.string().min(1).describe("What to declare the current unit's subject as."),
      answers: PlayAnswers.optional(),
    })
    .strict()
    .describe("Declare the current unit's subject. The active step must be a declareSubject step."),
  z
    .object({
      step: z
        .string()
        .min(1)
        .describe('The active step: a phase id, or "phaseId#index" for a phase with more than one step. Must be the step the engine is actually waiting on.'),
      answers: PlayAnswers.optional(),
    })
    .strict()
    .describe(
      "Run the active step the way the app would: a rollTable step rolls (and rolls again for any extra roll still owed), an actions step runs its actions, a manual step is ticked and completed, and a finalizeUnit step finalizes the unit.",
    ),
  z
    .object({
      finalize: z.object({}).strict().describe("No fields; just marks this as the finalize step."),
      answers: PlayAnswers.optional(),
    })
    .strict()
    .describe("Finalize the current unit: any confirmations are ticked and the unit closes. The active step must be finalizeUnit."),
  z
    .object({
      move: z.string().min(1).describe("Id of the move to take."),
      answers: PlayAnswers.optional(),
    })
    .strict()
    .describe("Take a move."),
  z
    .object({
      settle: z.string().min(1).describe("The id or label of a due obligation."),
      answers: PlayAnswers.optional(),
    })
    .strict()
    .describe("Settle a due obligation."),
  z
    .object({
      tick: z.string().min(1).describe("The text of a checklist item on the active step."),
      answers: PlayAnswers.optional(),
    })
    .strict()
    .describe("Tick one checklist item on the active step, without completing it."),
]).describe("One step of a play fixture's script.");
export type PlayStep = z.infer<typeof PlayStep>;

/**
 * A conformance fixture, in one of two shapes.
 *
 * A **replay** fixture hands the reducer a hand-written event log and checks
 * the state that comes out. A **play** fixture instead drives the engine the
 * way the app does, entering units, rolling tables, taking moves, from a
 * short script, so the flow itself is exercised and not only the state a log
 * happens to produce.
 *
 * Shipping either inside the pack is how an author proves their own tables
 * behave, including the worked examples printed in their rulebook, without
 * those assertions having to live in this repo.
 */
export const Fixture = z.union([
  z
    .object({
      name: z.string().min(1).describe("What this fixture demonstrates."),
      mode: Id.optional().describe("Mode to replay in. Defaults to the pack's default mode."),
      seed: z.string().optional().describe("Seed, for fixtures that depend on generated rolls."),
      events: z.array(z.unknown()).describe("The run events to replay, in order."),
      expect: z.array(Expectation).min(1).describe("Assertions checked after the replay."),
    })
    .strict()
    .describe("Replay a hand-written event log and assert on the state it folds into."),
  z
    .object({
      name: z.string().min(1).describe("What this fixture demonstrates."),
      mode: Id.optional().describe("Mode to play in. Defaults to the pack's default mode."),
      seed: z.string().optional().describe("Seed. Unanswered rolls in the script are drawn from it."),
      players: z.number().int().min(1).optional().describe("How many people are playing."),
      play: z.array(PlayStep).min(1).describe("The script to play through: entering units, declaring subjects, rolling tables, taking moves."),
      expect: z.array(Expectation).min(1).describe("Assertions checked after the play-through."),
    })
    .strict()
    .describe("Play the pack through a script, entering units, rolling tables, taking moves, and assert on the state that comes out."),
]).describe(
  "A self-test shipped with the pack. This is how an author proves their tables behave, including the worked examples printed in their own rulebook, without those assertions living in the engine's repo.",
);
export type Fixture = z.infer<typeof Fixture>;

/**
 * Who this particular copy was issued to.
 *
 * A watermark, and honest about being one. It prevents nothing: a buyer can
 * still pass the file on, and the game plays exactly the same for whoever
 * receives it. What it changes is that the copy is no longer anonymous: a
 * leaked file, and every log exported from it, says whose it was.
 *
 * It works because it is *inside* the signed content. Edit the name out and
 * the signature stops matching, so the choice is between a copy that names you
 * and a copy that visibly is not the author's release. Stamped where the buyer
 * can see it, too: a deterrent nobody knows about deters nobody, and quietly
 * marking someone's file would be a thing done to them rather than told to
 * them.
 */
export const Issue = z
  .object({
    to: z
      .string()
      .min(1)
      .describe("Who this copy was issued to. Shown to them in the app and stamped into anything they export."),
    reference: z
      .string()
      .optional()
      .describe("The seller's own reference for the sale, e.g. an order id. Lets a leaked copy be traced without the name being the only link."),
    issuedAt: z.string().min(1).describe("When this copy was issued, ISO 8601."),
  })
  .strict()
  .describe(
    "Marks a copy as belonging to one buyer. Traceability, not protection: it stops nobody copying the pack, it only means a copy that travels says where it came from.",
  );
export type Issue = z.infer<typeof Issue>;

/**
 * Who produced this pack, provable.
 *
 * The public key travels with the pack, so a valid signature says "signed by
 * the holder of this key" and not "signed by any particular person". The app
 * shows the key's fingerprint so a reader can compare it against one the
 * author published.
 */
export const Signature = z
  .object({
    algorithm: z
      .literal("ecdsa-p256-sha256")
      .describe("How it was signed. One value for now; more can be added without breaking old packs."),
    publicKey: z
      .string()
      .min(1)
      .describe("The signer's public key, base64url SPKI. Check its fingerprint against one the author published."),
    value: z.string().min(1).describe("The signature itself, base64url."),
    signedAt: z.string().min(1).describe("When it was signed, ISO 8601."),
    signedBy: z
      .string()
      .optional()
      .describe("What the signer calls themselves. A claim carried by the pack, not proof of identity."),
  })
  .strict()
  .describe(
    "Proof that a pack's contents are unchanged since its author signed them. Not a restriction on copying.",
  );
export type Signature = z.infer<typeof Signature>;

/** The licenses a pack can be under: the common SPDX ids, and two for text of your own. */
export const LICENSE_IDS = [
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "CC-BY-ND-4.0",
  "CC-BY-NC-ND-4.0",
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "Unlicense",
  "OGL-1.0a",
  "ORC",
  "proprietary",
  "custom",
] as const;
export type LicenseId = (typeof LICENSE_IDS)[number];

/** What each license is, in a line, for a picker. */
export const LICENSE_LABELS: Record<LicenseId, string> = {
  "CC0-1.0": "CC0 - no rights reserved",
  "CC-BY-4.0": "CC BY 4.0, share and remix, with credit",
  "CC-BY-SA-4.0": "CC BY-SA 4.0, credit, same license on remixes",
  "CC-BY-NC-4.0": "CC BY-NC 4.0, credit, not commercially",
  "CC-BY-NC-SA-4.0": "CC BY-NC-SA 4.0, non-commercial, same license",
  "CC-BY-ND-4.0": "CC BY-ND 4.0, unchanged copies only, with credit",
  "CC-BY-NC-ND-4.0": "CC BY-NC-ND 4.0, unchanged, non-commercial copies",
  MIT: "MIT - do anything, keep the notice",
  "Apache-2.0": "Apache 2.0, MIT-like, with a patent grant",
  "BSD-3-Clause": "BSD 3-Clause, keep the notice, no endorsement",
  Unlicense: "Unlicense, public domain, no credit needed",
  "OGL-1.0a": "Open Game License 1.0a",
  ORC: "ORC - the Open RPG Creative license",
  proprietary: "Proprietary, all rights reserved; see the text",
  custom: "Custom - your own terms, given in full",
};

/** Licenses that allow changed copies at all, for the Designer's start-from and the remix notice. */
export const REMIXABLE_LICENSES: ReadonlySet<LicenseId> = new Set<LicenseId>([
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "Unlicense",
  "OGL-1.0a",
  "ORC",
]);

export const License = z
  .object({
    id: z
      .enum(LICENSE_IDS)
      .describe("The license, by SPDX identifier where one applies; `proprietary` or `custom` with the terms in `text`."),
    text: z
      .string()
      .max(40_000)
      .optional()
      .describe("The license or notice in full, shown with the pack and printed in its rulebook. Required for `proprietary` and `custom`; welcome on any."),
    redistributable: z
      .boolean()
      .describe(
        "Whether this pack's text may be included in exports meant for other people. When false the app shares roll results and references but never the rules prose, so a private transcription of a commercial rulebook stays private.",
      ),
    holder: z.string().optional().describe("Who holds the rights."),
    notice: z.string().optional().describe("Notice displayed alongside the pack."),
    url: z.string().url().optional().describe("Where to obtain or license the original."),
  })
  .strict()
  .describe("Licensing, and whether the app may share this pack's text.");

export const Pack = z
  .object({
    $schema: z
      .string()
      .optional()
      .describe("Path or URL to this schema, so your editor offers completions and validation."),
    schemaVersion: z
      .literal(SCHEMA_VERSION)
      .describe(
        "Major version of the pack contract. An engine that does not know this version refuses to load the pack rather than guessing at it.",
      ),
    id: PackId,
    version: z.string().min(1).describe("Version of this pack's content, e.g. 1.2.0."),
    title: z.string().min(1).describe("The game's name."),
    author: z.string().optional().describe("Who wrote the game."),
    description: z.string().optional().describe("One or two sentences on what the game is."),
    homepage: z.string().url().optional().describe("Where to find out more."),
    category: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe("What kind of thing this is, in a word or two, for a marketplace to group by: everyday, games, craft, fitness, cooking, writing…"),
    tags: z
      .array(z.string().min(1).max(40))
      .max(12)
      .optional()
      .describe("Free tags for a marketplace to filter by: the game it is for, the hobby, the shape of play. Short, and in the words a person would search for."),
    requires: z
      .array(Requirement)
      .max(20)
      .optional()
      .describe(
        "What a person needs before playing, shown in the marketplace and the rulebook: the game and a system that runs it, mods or training packs, a wheel, a kitchen, supplies. Mark the ones that are nice to have `optional`; results can `need` those and be drawn again for a player who lacks them.",
      ),
    license: License,
    capabilities: z
      .array(Capability)
      .default([])
      .describe(
        "Engine features this pack needs. Declaring them lets an older app refuse the pack with a clear message instead of misplaying it.",
      ),
    extends: PackId.optional().describe(
      "Base pack this one layers on, for house rules and variants.",
    ),

    vocabulary: Vocabulary,
    unit: z
      .object({
        clock: Clock.optional().describe("A clock every unit runs. A mode can set its own with `clock`."),
        intro: z
          .string()
          .optional()
          .describe("Said once, when the first unit is entered: the welcome that sets the stage for the whole run."),
        onEnter: z
          .string()
          .optional()
          .describe("Said every time a unit is entered, until its first step is done. `{n}` stands for the unit's number."),
        createsSubject: z
          .boolean()
          .default(true)
          .describe("Whether entering a unit produces a new subject."),
        min: z.number().int().min(1).default(1).describe("Fewest units in a run."),
        max: z.number().int().min(1).default(20).describe("Most units in a run."),
      })
      .strict()
      .default({ createsSubject: true, min: 1, max: 20 })
      .describe("How units behave in this game."),

    tables: z.record(Id, Table).default({}).describe("Tables the game rolls on, keyed by id."),
    decks: z.record(Id, Deck).optional().describe("Decks the game draws from, keyed by id."),
    states: z
      .record(Id, StateDef)
      .optional()
      .describe("Persistent states that can attach to subjects or the run, keyed by id."),
    counters: z.record(Id, CounterDef).optional().describe("Running tallies, keyed by id."),
    resources: z.record(Id, ResourceDef).optional().describe("Numeric tracks, keyed by id."),

    phases: z
      .array(Phase)
      .min(1)
      .describe("The per-unit flow, in order. At least one phase must close the unit."),
    moves: z
      .record(Id, MoveDef)
      .optional()
      .describe(
        "Optional moves the player may choose to make, keyed by id. Everything the player initiates rather than has done to them lives here.",
      ),
    targeting: TargetingDef.optional().describe(
      "How consequences pick an earlier subject. Omit for games where nothing reaches backwards.",
    ),
    journal: JournalDef.optional(),
    score: Score.optional().describe(
      "This run's score, so a solo run has a number to beat next time. A mode can set its own with `score`.",
    ),
    endings: z.array(EndingDef).optional().describe("The ways a run can finish."),
    triggers: z
      .array(Trigger)
      .optional()
      .describe("Global triggers not owned by any table entry, e.g. something that fires every unit."),

    modes: z.record(Id, Mode).describe("Ways to play, keyed by id. At least one is required."),
    defaultMode: Id.describe("Which mode is offered first. Must be a key of `modes`."),

    hierarchy: z
      .array(z.string())
      .optional()
      .describe(
        "Precedence for contradictory instructions, most specific first. Advisory only: the app shows it and lets the player rule, because these games want human judgment here.",
      ),

    fixtures: z.array(Fixture).optional().describe("Self-tests shipped with the pack."),

    issue: Issue.optional().describe(
      "Marks this copy as issued to one person. Covered by the signature, so removing it invalidates that.",
    ),

    signature: Signature.optional().describe(
      "Evidence of who produced this pack. Does not restrict copying, nothing can, since the app must read every word to play it, but proves the contents are unaltered since the author signed them.",
    ),
  })
  .strict()
  .describe(
    "A complete, self-contained description of a dice-driven creative-practice game. Packs are data, never code.",
  );
export type Pack = z.infer<typeof Pack>;
