import { z } from "zod";

/**
 * Shared leaf types used across the pack format.
 *
 * Everything here is deliberately data-only. A pack is downloaded from a
 * stranger and evaluated on the player's machine, so nothing in the format may
 * express arbitrary computation: no expressions to `eval`, no code strings.
 * Behavior is expressed with a closed vocabulary (see `actions.ts`).
 *
 * Note the `.describe()` calls throughout. They are not decoration: they are
 * the only thing that reaches the emitted JSON Schema, and therefore the only
 * documentation a pack author sees when their editor offers completions. A
 * field without one is a field nobody can discover.
 */

/** Stable identifier for a table, deck, state, counter, phase, entry, ... */
export const Id = z
  .string()
  .min(1)
  .max(64)
  // Case-insensitivity is spelled out rather than expressed with the /i flag:
  // JSON Schema emission drops regex flags, which would publish a pattern
  // stricter than the one enforced at runtime and light up an author's editor
  // over ids that actually load fine.
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "ids must start alphanumeric and contain only letters, digits, dot, dash or underscore",
  )
  .describe(
    "A stable identifier, unique within its collection. Letters, digits, dot, dash and underscore; must start with a letter or digit. Ids appear in saved runs, so renaming one breaks existing logs.",
  );
export type Id = z.infer<typeof Id>;

/** Reverse-DNS-ish pack identifier, e.g. `com.example.my-game`. */
export const PackId = z
  .string()
  .min(3)
  .max(128)
  .regex(
    /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/,
    "expected a reverse-DNS style id, e.g. com.example.my-game",
  )
  .describe(
    "Globally unique pack identifier in reverse-DNS form, e.g. com.example.my-game. Use a domain you control so two packs never collide in a player's library.",
  );

/**
 * A dice expression: `d100`, `2d10`, `d6+3`, `3d6-1`.
 *
 * Kept deliberately narrow. Anything more exotic (keep-highest, exploding dice)
 * is a schema addition, not a hole for arbitrary syntax.
 */
export const DiceExpr = z
  .string()
  .regex(
    /^([1-9]\d*)?d([1-9]\d*)([+-]\d+)?$/,
    "expected a dice expression such as d100, 2d10 or d6+3",
  )
  .describe(
    "A dice expression: d100, 2d10, d6+3, 3d6-1. The count defaults to 1. Determines the range a lookup table must cover.",
  );
export type DiceExpr = z.infer<typeof DiceExpr>;

/**
 * Who an action applies to.
 *
 * `subject` is the pack's word for the thing a unit produces: a layer in a
 * drawing game, a scene in a writing game, a set in a training log.
 */
export const TargetRef = z
  .union([
    z.literal("thisSubject").describe("The subject being made in the current unit."),
    z
      .literal("targetSubject")
      .describe("The subject picked by the most recent resolveTarget action."),
    z.literal("allSubjects").describe("Every subject in the run, including the current one."),
    z
      .literal("allPriorSubjects")
      .describe("Every completed subject, excluding the one in the current unit."),
    z.literal("run").describe("The run itself, for run-scoped states and flags."),
    z
      .object({
        var: Id.describe("Name a previous prompt or resolveTarget bound the subject to."),
      })
      .strict()
      .describe("A subject chosen earlier in this action list and stored under a name."),
  ])
  .describe("Which subject, or subjects, an action applies to.");
export type TargetRef = z.infer<typeof TargetRef>;

/** Numeric comparison used by predicates and counter thresholds. */
export const NumericBound = z
  .object({
    eq: z.number().int().optional().describe("Matches only this exact value."),
    gte: z.number().int().optional().describe("Matches values greater than or equal to this."),
    lte: z.number().int().optional().describe("Matches values less than or equal to this."),
    gteCounter: Id.optional().describe(
      "Matches values greater than or equal to this counter's current value.",
    ),
    lteCounter: Id.optional().describe(
      "Matches values less than or equal to this counter's current value. This is what lets a roll be compared against something the run has accumulated, rather than a fixed number.",
    ),
  })
  .strict()
  .refine(
    (v) =>
      v.eq !== undefined ||
      v.gte !== undefined ||
      v.lte !== undefined ||
      v.gteCounter !== undefined ||
      v.lteCounter !== undefined,
    "a numeric bound needs at least one bound",
  )
  .describe(
    "A numeric comparison. Combine gte and lte for a closed range, or eq for an exact match. The `Counter` variants compare against a counter's current value instead of a literal, which is how a roll is measured against what the run has accumulated.",
  );
export type NumericBound = z.infer<typeof NumericBound>;

/**
 * Predicates the engine can evaluate against run state.
 *
 * Note `ask`: the engine models units, subjects, states and counters, it does
 * NOT model the work itself. It cannot know whether a scene has dialogue in
 * it, or whether a track has effects on it. Rather than pretend, a pack asks
 * the player. This keeps the format honest and, not coincidentally, keeps it
 * general across domains.
 */
export type Predicate =
  | { ask: string }
  | { unitIndex: NumericBound }
  | { subjectCount: NumericBound }
  | { eligibleTargets: NumericBound }
  | { counter: Id; is: NumericBound }
  | { resource: Id; is: NumericBound }
  | { clockRan: string; is: NumericBound }
  | { clockRanOver: string; is: NumericBound }
  | { flag: Id; is?: boolean }
  | { subjectHasState: Id; of?: TargetRef }
  | { priorSubjectTagged: string }
  | { modeIs: Id[] }
  | { phaseDone: Id }
  | { not: Predicate }
  | { allOf: Predicate[] }
  | { anyOf: Predicate[] };

export const Predicate: z.ZodType<Predicate> = z.lazy(() =>
  z
    .union([
      z
        .object({
          ask: z
            .string()
            .min(1)
            .describe("The yes/no question to put to the player, phrased so that yes means true."),
        })
        .strict()
        .describe(
          "Ask the player. Use this for anything about the work itself, which the engine cannot inspect, whether a scene has dialogue, whether a track has effects, whether a lift felt heavy. Being honest about this is what keeps the format domain-agnostic.",
        ),
      z
        .object({ unitIndex: NumericBound })
        .strict()
        .describe("Tests the current unit's number, counting from 1."),
      z
        .object({ subjectCount: NumericBound })
        .strict()
        .describe("Tests how many subjects exist, including removed ones."),
      z
        .object({ eligibleTargets: NumericBound })
        .strict()
        .describe(
          "Tests how many subjects are currently targetable: completed, still in play, and not made untargetable by a state.",
        ),
      z
        .object({
          counter: Id.describe("Which declared counter to read."),
          is: NumericBound.describe("The comparison the counter's value must satisfy."),
        })
        .strict()
        .describe("Tests a counter's current value."),
      z
        .object({
          resource: Id.describe("Which declared resource to read."),
          is: NumericBound.describe("The comparison the resource's value must satisfy."),
        })
        .strict()
        .describe("Tests a resource's current value."),
      z
        .object({
          clockRan: z
            .string()
            .min(1)
            .describe("`unit` for the current unit's own clock, or a clock's label."),
          is: NumericBound.describe(
            "The comparison, in minutes, the clock's live elapsed time must satisfy.",
          ),
        })
        .strict()
        .describe(
          "Tests how long a clock has run, live: while it is still going and after it has stopped. Works for a stopwatch or a timer. False if no such clock exists in the current unit.",
        ),
      z
        .object({
          clockRanOver: z
            .string()
            .min(1)
            .describe("`unit` for the current unit's own clock, or a clock's label."),
          is: NumericBound.describe(
            "The comparison, in minutes, the timer's overrun must satisfy.",
          ),
        })
        .strict()
        .describe(
          "Tests how far a timer has run past its length, in minutes. False for a stopwatch, and false if no such clock exists in the current unit.",
        ),
      z
        .object({
          flag: Id.describe("Which flag to read."),
          is: z.boolean().optional().describe("Expected value. Defaults to true."),
        })
        .strict()
        .describe("Tests a boolean flag set by a setFlag action."),
      z
        .object({
          subjectHasState: Id.describe("Which declared state to look for."),
          of: TargetRef.optional().describe("Whose state to check. Defaults to thisSubject."),
        })
        .strict()
        .describe("Tests whether a subject, or the run, currently carries a state."),
      z
        .object({
          priorSubjectTagged: z
            .string()
            .min(1)
            .describe("The tag to search for among completed subjects."),
        })
        .strict()
        .describe(
          "Tests whether any earlier subject was created from an entry carrying this tag, for results that only make sense once something of a given kind exists.",
        ),
      z
        .object({ modeIs: z.array(Id).min(1).describe("Mode ids in which this holds true.") })
        .strict()
        .describe("Tests which mode the run is being played in."),
      z
        .object({ phaseDone: Id.describe("Id of a phase in the flow.") })
        .strict()
        .describe(
          "True once the named phase has been completed in the current unit. This is how a move that records an outcome is kept off the screen until there is something to have an outcome about.",
        ),
      z.object({ not: Predicate }).strict().describe("True when the inner predicate is false."),
      z
        .object({ allOf: z.array(Predicate).min(1) })
        .strict()
        .describe("True only when every listed predicate holds."),
      z
        .object({ anyOf: z.array(Predicate).min(1) })
        .strict()
        .describe("True when at least one listed predicate holds."),
    ])
    .describe("A condition evaluated against run state, or a question put to the player."),
);

/**
 * Engine-level events a counter or trigger can hook. Deliberately domain
 * neutral: a pack composes meaning out of these, and names the result in its
 * own language. The engine never learns what any particular game calls a roll.
 */
export const EventSelector = z
  .union([
    z
      .object({ on: z.literal("runStarted").describe("Fires once, when a run begins.") })
      .strict()
      .describe("Fires once, when a run begins."),
    z
      .object({ on: z.literal("runEnded").describe("Fires once, when a run is finished.") })
      .strict()
      .describe("Fires once, when a run is finished and an ending is chosen."),
    z
      .object({ on: z.literal("unitEntered").describe("Fires each time a new unit begins.") })
      .strict()
      .describe("Fires each time a new unit begins."),
    z
      .object({ on: z.literal("unitFinalized").describe("Fires each time a unit is closed.") })
      .strict()
      .describe("Fires each time a unit is closed."),
    z
      .object({
        on: z.literal("phaseCompleted").describe("Fires when a named phase finishes within a unit."),
        phase: Id.describe("The id of the phase whose completion fires this."),
      })
      .strict()
      .describe("Fires when a named phase finishes within a unit."),
    z
      .object({
        on: z.literal("tableRolled").describe("Fires when dice are rolled against a table."),
        table: Id.describe("The id of the table being rolled on."),
      })
      .strict()
      .describe("Fires when dice are rolled against a table, whatever the result."),
    z
      .object({
        on: z.literal("outcomeResolved").describe("Fires when an entry from a table is put into play."),
        table: Id.describe("The id of the table the resolved entry belongs to."),
        cause: z
          .enum(["any", "phase", "action", "manual"])
          .default("any")
          .describe(
            "Narrows how the entry came into play: from a scheduled phase step, from another entry's action, entered by hand, or any of these. This is what lets a counter distinguish consequences the player triggered from ones that arrived some other way.",
          ),
      })
      .strict()
      .describe("Fires when an entry from a table is actually put into play."),
    z
      .object({
        on: z.literal("stateApplied").describe("Fires when a persistent state is attached."),
        state: Id.describe("The id of the state being applied."),
      })
      .strict()
      .describe("Fires when a persistent state is attached to a subject or to the run."),
  ])
  .describe(
    "An engine-level occurrence a counter or trigger can hook. These are deliberately domain-neutral; a pack composes meaning out of them.",
  );
export type EventSelector = z.infer<typeof EventSelector>;

/** Lifecycle points at which a table entry's deferred behavior can fire. */
export const TriggerPoint = z
  .enum([
    "immediately",
    "onEnterUnit",
    "onDeclareSubject",
    "afterWork",
    "onFinalize",
    "onDeclareRunOver",
    "onRunEnd",
    "onTimerExpired",
  ])
  .describe(
    "When a trigger fires. `immediately` lands on resolution; the rest reach forward in time, which is precisely where a player forgets a rule an hour into a session. `afterWork` fires once the player has done the unit's actual work, the part the engine cannot see or verify, but before the unit closes. `onTimerExpired` fires when the timer runs out.",
  );
export type TriggerPoint = z.infer<typeof TriggerPoint>;
