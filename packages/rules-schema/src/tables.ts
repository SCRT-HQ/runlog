import { z } from "zod";
import { Action } from "./actions.ts";
import { DiceExpr, Id, Predicate, TriggerPoint } from "./primitives.ts";

/**
 * Deferred behavior attached to a table entry.
 *
 * The reason this exists as data rather than being folded into `immediately`
 * is that a large share of results in these games fire *later*: "after
 * composing, roll d6", "upon finalizing, roll d6", "when you first declare the
 * run over". Those are exactly the rules people forget an hour into a session,
 * which is most of the value of a tracker.
 */
export const Trigger = z
  .object({
    on: TriggerPoint.describe("The lifecycle point at which this fires."),
    do: z.array(Action).min(1).describe("Actions to run, in order, when it fires."),
    when: z
      .array(Predicate)
      .optional()
      .describe("Only fire if every one of these still holds at trigger time."),
    label: z.string().optional().describe("How the pending obligation is described to the player."),
  })
  .strict()
  .describe(
    "Behavior attached to a result, optionally deferred to a later point in the unit or run.",
  );
export type Trigger = z.infer<typeof Trigger>;

const EntryBase = {
  id: Id.describe("Unique within this table. Referenced by saved runs, so avoid renaming."),
  title: z.string().optional().describe("Short heading, when the entry has a name of its own."),
  text: z
    .string()
    .min(1)
    .describe("The rules text shown to the player, verbatim. This is what they read and obey."),
  triggers: z.array(Trigger).optional().describe("Mechanical consequences of this result."),
  requires: z
    .array(Predicate)
    .optional()
    .describe(
      "Conditions that must ALL hold for this result to make sense. When one fails the app offers a re-roll. Note the asymmetry these games insist on: impossibility justifies a re-roll, difficulty never does.",
    ),
  grants: z
    .array(Id)
    .optional()
    .describe(
      "States applied to the relevant subject on resolution. Shorthand for an applyState trigger.",
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe("Free tags, for cross-referencing and for filtering results out in some modes."),
  points: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "What a contestant earns for completing this result in a moderated mode. A result with points is a challenge the moderator can award; one without is an effect that lands on everyone.",
    ),
  needs: z
    .array(Id)
    .optional()
    .describe(
      "Requirements this result depends on, by id from the pack's `requires`. A run that said it lacks one of them draws again instead of landing here — a barbell movement for someone without a barbell, an oven dish in a kitchen without one.",
    ),
};

/** An entry in a `lookup` table: owns a contiguous inclusive roll range. */
export const LookupEntry = z
  .object({
    ...EntryBase,
    range: z
      .tuple([
        z.number().int().min(1).describe("Lowest roll that selects this entry, inclusive."),
        z.number().int().min(1).describe("Highest roll that selects this entry, inclusive."),
      ])
      .refine(([lo, hi]) => lo <= hi, "range must be [low, high] with low <= high")
      .describe(
        "The inclusive roll range this entry owns. Across the table these must tile the dice range exactly, with no gaps and no overlaps.",
      ),
  })
  .strict()
  .describe("One result in a lookup table.");
export type LookupEntry = z.infer<typeof LookupEntry>;

/** An entry in a `bands` table: owns an open-ended numeric band of the total. */
export const BandEntry = z
  .object({
    ...EntryBase,
    gte: z.number().int().optional().describe("Lower bound of the band, inclusive. Omit for open."),
    lte: z.number().int().optional().describe("Upper bound of the band, inclusive. Omit for open."),
  })
  .strict()
  .refine((e) => e.gte !== undefined || e.lte !== undefined, "a band needs gte and/or lte")
  .describe("One outcome tier in a bands table, selected by comparing the rolled total.");
export type BandEntry = z.infer<typeof BandEntry>;

/**
 * An outcome in an `opposed` table, selected by how many challenge dice the
 * action total beat.
 */
export const OpposedOutcome = z
  .object({
    ...EntryBase,
    beats: z
      .number()
      .int()
      .min(0)
      .describe(
        "How many challenge dice the action total must strictly exceed to land here. Ties go to the challenge, which is what makes these games bite.",
      ),
  })
  .strict()
  .describe("One rung of an opposed roll's outcome ladder.");
export type OpposedOutcome = z.infer<typeof OpposedOutcome>;

/** An entry in a `keyed` table, selected by a non-numeric key such as a card's suit. */
export const KeyedEntry = z
  .object({
    ...EntryBase,
    key: z
      .string()
      .min(1)
      .describe(
        "The value that selects this entry, e.g. a suit (hearts) or a rank (A, 7, K). Compared case-insensitively.",
      ),
  })
  .strict()
  .describe("One result in a keyed table.");
export type KeyedEntry = z.infer<typeof KeyedEntry>;

/**
 * Resolution kinds, modeled as a discriminated union so that further kinds are
 * an additive change rather than a breaking one.
 *
 * - `lookup` — roll once, find the entry whose range contains the result.
 * - `bands`  — roll an expression, compare the total against thresholds.
 * - `opposed`— roll an action against several challenge dice and count how many
 *   it beat. Single-total comparison cannot express this, and a whole family of
 *   solo games is built on it.
 * - `keyed`  — selected by a name rather than a number, so a deck draw can
 *   resolve on a table.
 */
export const Table = z
  .discriminatedUnion("resolution", [
    z
      .object({
        resolution: z
          .literal("lookup")
          .describe("Roll once and find the entry whose range contains the result."),
        title: z.string().min(1).describe("Table name shown to the player."),
        description: z.string().optional().describe("When and why this table is consulted."),
        roll: DiceExpr.describe("What is rolled. Entries must cover its whole range."),
        entries: z.array(LookupEntry).min(1).describe("Results, each owning a roll range."),
      })
      .strict()
      .describe(
        "A range table: the familiar d100 form where every result owns a span of numbers.",
      ),
    z
      .object({
        resolution: z
          .literal("bands")
          .describe("Roll an expression and compare the total against open-ended thresholds."),
        title: z.string().min(1).describe("Table name shown to the player."),
        description: z.string().optional().describe("When and why this table is consulted."),
        roll: DiceExpr.describe("What is rolled, e.g. 2d10 or d6+2."),
        entries: z.array(BandEntry).min(1).describe("Outcome tiers, ordered however you like."),
      })
      .strict()
      .describe(
        "An outcome ladder: hit, partial, miss. Use when the total matters more than a lookup, as in move-resolution games.",
      ),
    z
      .object({
        resolution: z
          .literal("opposed")
          .describe("Roll an action total against several challenge dice and count how many it beat."),
        title: z.string().min(1).describe("Table name shown to the player."),
        description: z.string().optional().describe("When and why this table is consulted."),
        action: DiceExpr.describe("The action roll, e.g. d6 or d6+1."),
        addResource: Id.optional().describe(
          "Add this resource's current value to the action total, so a stat or standing can weigh on the roll.",
        ),
        challenge: z
          .object({
            dice: DiceExpr.describe("A single challenge die, e.g. d10."),
            count: z
              .number()
              .int()
              .min(1)
              .max(6)
              .describe("How many challenge dice are rolled. Each is compared separately."),
          })
          .strict()
          .describe("The opposition. These are compared individually, never summed."),
        entries: z
          .array(OpposedOutcome)
          .min(1)
          .describe("Outcomes, one for each possible number of challenge dice beaten."),
      })
      .strict()
      .describe(
        "An opposed roll: beat both challenge dice for a strong result, one for a mixed result, neither for a failure. A single total compared against thresholds cannot express this.",
      ),
    z
      .object({
        resolution: z
          .literal("keyed")
          .describe("Selected by a name rather than a number, such as a drawn card's suit."),
        title: z.string().min(1).describe("Table name shown to the player."),
        description: z.string().optional().describe("When and why this table is consulted."),
        entries: z.array(KeyedEntry).min(1).describe("Results, each owning a key."),
      })
      .strict()
      .describe(
        "A table addressed by name. This is what lets a deck draw resolve on a table, rather than pretending a card is a die roll.",
      ),
  ])
  .describe("A table the game rolls on, or otherwise consults.");
export type Table = z.infer<typeof Table>;

/** A card in a custom deck. Cards carry the same behavior surface as entries. */
export const Card = z
  .object({
    id: Id.describe("Unique within the deck."),
    title: z.string().min(1).describe("The card's name."),
    text: z.string().min(1).describe("What the card does, in the player's words."),
    triggers: z.array(Trigger).optional().describe("Mechanical effects of playing the card."),
    requires: z
      .array(Predicate)
      .optional()
      .describe("Conditions that must hold for the card to be playable."),
    tags: z.array(z.string()).optional().describe("Free tags, for filtering in some modes."),
  })
  .strict()
  .describe("A single card.");
export type Card = z.infer<typeof Card>;

/**
 * A deck is either an explicit list of cards, or a standard 52-card deck whose
 * draws resolve on a table keyed by rank or suit. The latter exists because a
 * whole family of solo journaling games is built on exactly that move.
 */
export const Deck = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("cards").describe("An explicit list of bespoke cards."),
        title: z.string().min(1).describe("Deck name shown to the player."),
        description: z.string().optional().describe("What this deck is for."),
        cards: z.array(Card).min(1).describe("Every card in the deck."),
        drawAtStart: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("How many cards are dealt when a run begins."),
        unique: z
          .boolean()
          .default(true)
          .describe("Whether two copies of the same card may exist at once."),
        carriesOver: z
          .boolean()
          .default(false)
          .describe("Whether unspent cards survive into the next run."),
      })
      .strict()
      .describe("A deck of cards you write yourself."),
    z
      .object({
        kind: z
          .literal("standard52")
          .describe("An ordinary playing-card deck, addressed by rank and suit."),
        title: z.string().min(1).describe("Deck name shown to the player."),
        description: z.string().optional().describe("What this deck is for."),
        includeJokers: z.boolean().default(false).describe("Whether to shuffle in two jokers."),
        drawAtStart: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("How many cards are dealt when a run begins."),
        resolveOn: Id.optional().describe(
          "Table consulted on each draw, if the draw should produce a prompt.",
        ),
        resolveBy: z
          .enum(["rank", "suit"])
          .default("rank")
          .describe("Whether the draw's rank or its suit selects the table entry."),
      })
      .strict()
      .describe(
        "A standard 52-card deck. Included because a whole family of solo journaling games is built on drawing from one.",
      ),
  ])
  .describe("A deck the game draws from.");
export type Deck = z.infer<typeof Deck>;
