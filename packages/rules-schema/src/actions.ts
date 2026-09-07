import { z } from "zod";
import { DiceExpr, Id, NumericBound, Predicate, TargetRef } from "./primitives.ts";

/**
 * The closed action vocabulary.
 *
 * This is the only way a pack expresses behavior. It is intentionally not
 * Turing-complete: there are no loops, no user-defined functions and no
 * expression strings. If a game needs something genuinely new, that is a
 * schema addition reviewed by a human, not a hole a pack author can climb
 * through.
 *
 * Most table entries need none of this. The overwhelming majority of results
 * in a game like this are prose constraints a person honors; only the ones
 * with mechanical follow-through ("after composing, roll d6") carry actions.
 */

/** A branch case: match a set of values, or a numeric range. */
export const BranchCase = z
  .object({
    in: z
      .array(z.number().int())
      .min(1)
      .optional()
      .describe("Match when the bound value is exactly one of these numbers."),
    is: NumericBound.optional().describe("Match when the bound value satisfies this comparison."),
    then: z
      .array(z.lazy(() => Action))
      .min(1)
      .describe("Actions to run when this case matches. The first matching case wins."),
  })
  .strict()
  .refine((c) => c.in !== undefined || c.is !== undefined, "a branch case needs `in` or `is`")
  .describe("One arm of a branch. Provide either `in` for exact values or `is` for a range.");

export type Action =
  /** Roll dice and bind the total to a name usable by later actions. */
  | { do: "roll"; dice: DiceExpr; into: string; label?: string }
  /** Roll on another table; `choose: "one"` means roll `times` and pick one. */
  | {
      do: "rollOn";
      table: Id;
      times?: number;
      timesFrom?: string;
      choose?: "one" | "all";
      into?: string;
    }
  | {
      do: "branch";
      on: string;
      cases: Array<{ in?: number[]; is?: NumericBound; then: Action[] }>;
      else?: Action[];
    }
  /** Ask the player something the engine cannot determine on its own. */
  | {
      do: "prompt";
      kind: "chooseSubject" | "chooseValue" | "chooseState" | "confirm" | "text";
      label: string;
      into?: string;
      options?: string[];
      eligibleOnly?: boolean;
    }
  /**
   * Choose which earlier subject a consequence lands on, using the pack's
   * declared targeting strategy, and bind it as `targetSubject`.
   *
   * This is deliberately explicit rather than implicit. An entry that reaches
   * backwards has to say so, which keeps "what got hit and why" auditable —
   * the derivation is shown to the player rather than happening off-screen.
   */
  | { do: "resolveTarget"; from?: "currentRoll" | "event" | "choice"; into?: string }
  | { do: "applyState"; state: Id; to: TargetRef }
  | { do: "removeState"; state: Id; to: TargetRef }
  | { do: "removeSubject"; to: TargetRef }
  /** Forbid future subjects of a declared type (by literal or by the target's). */
  | { do: "ban"; subjectType?: string; from?: TargetRef; label?: string }
  /** Queue additional mandatory units before the run may end. */
  | { do: "forceUnit"; count?: number }
  | { do: "extraRoll"; table: Id; count?: number; unit?: "current" | "next" }
  | { do: "rewind"; count?: number }
  | { do: "modCounter"; counter: Id; by?: number; set?: number; setFrom?: string }
  | { do: "modResource"; resource: Id; by?: number; set?: number; setFrom?: string }
  | { do: "grantCard"; deck: Id; count?: number }
  | { do: "discardCard"; deck: Id; count?: number }
  | { do: "startTimer"; minutes: number; label?: string }
  /** Start a stopwatch, shown ticking until the unit closes or somebody stops it. */
  | { do: "startStopwatch"; label?: string }
  /** A manual instruction shown to the player as a checkable obligation. */
  | { do: "note"; text: string; persistent?: boolean }
  | { do: "setFlag"; flag: Id; value?: boolean }
  /** Attempt to end the run (may be blocked by forced units or triggers). */
  | { do: "endRunAttempt" }
  /** Run nested actions only when the predicates hold. */
  | { do: "when"; all: Predicate[]; then: Action[]; else?: Action[] };

export const Action: z.ZodType<Action> = z.lazy(() =>
  z
    .discriminatedUnion("do", [
      z
        .object({
          do: z.literal("roll").describe("Roll dice and remember the total under a name."),
          dice: DiceExpr.describe("What to roll, e.g. d6."),
          into: z
            .string()
            .min(1)
            .describe("Name to bind the total to, so a later branch can test it."),
          label: z.string().optional().describe("Shown to the player when prompting for the roll."),
        })
        .strict()
        .describe("Roll dice and remember the total under a name."),
      z
        .object({
          do: z.literal("rollOn").describe("Roll on another table and resolve whatever comes up."),
          table: Id.describe("Id of the table to roll on."),
          times: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe("How many times to roll. Defaults to 1."),
          timesFrom: z
            .string()
            .min(1)
            .optional()
            .describe("Name a total bound earlier with `roll … into`; that many times, instead of `times`. How a pack rolls for how many to roll."),
          choose: z
            .enum(["one", "all"])
            .optional()
            .describe(
              "With times > 1: `one` lets the player pick a single result to apply, `all` applies every result. Defaults to `all`.",
            ),
          into: z.string().min(1).optional().describe("Name to bind the rolled total to."),
        })
        .strict()
        .describe("Roll on another table and resolve whatever comes up."),
      z
        .object({
          do: z.literal("branch").describe("Choose between action lists based on a value bound earlier."),
          on: z.string().min(1).describe("Name of a value bound earlier by roll or prompt."),
          cases: z.array(BranchCase).min(1).describe("Cases tested in order; the first match wins."),
          else: z
            .array(Action)
            .optional()
            .describe("Actions to run when no case matches."),
        })
        .strict()
        .describe("Choose between action lists based on a value bound earlier."),
      z
        .object({
          do: z.literal("prompt").describe("Put a question to the player and remember the answer."),
          kind: z
            .enum(["chooseSubject", "chooseValue", "chooseState", "confirm", "text"])
            .describe(
              "What kind of answer is wanted: a subject, one of `options`, a state, a yes/no, or free text.",
            ),
          label: z.string().min(1).describe("The question shown to the player."),
          into: z.string().min(1).optional().describe("Name to bind the answer to."),
          options: z
            .array(z.string())
            .optional()
            .describe("The choices offered, for kind `chooseValue`."),
          eligibleOnly: z
            .boolean()
            .optional()
            .describe(
              "For kind `chooseSubject`: restrict the list to currently targetable subjects.",
            ),
        })
        .strict()
        .describe("Put a question to the player and remember the answer."),
      z
        .object({
          do: z.literal("resolveTarget").describe("Pick which earlier subject a consequence lands on."),
          from: z
            .enum(["currentRoll", "event", "choice"])
            .default("currentRoll")
            .describe(
              "How to pick: `currentRoll` reads the roll that triggered this against the pack's targeting bands, `event` uses the fallback roll for consequences not tied to a band, `choice` lets the player decide.",
            ),
          into: z
            .string()
            .min(1)
            .optional()
            .describe("Name to bind the chosen subject to. Also always available as targetSubject."),
        })
        .strict()
        .describe(
          "Pick which earlier subject a consequence lands on, using the pack's targeting strategy. Required before any action that hits `targetSubject`.",
        ),
      z
        .object({
          do: z.literal("applyState").describe("Attach a persistent state to a subject or to the run."),
          state: Id.describe("Id of the declared state to attach."),
          to: TargetRef.describe("Who receives the state."),
        })
        .strict()
        .describe("Attach a persistent state to a subject or to the run."),
      z
        .object({
          do: z.literal("removeState").describe("Clear a persistent state."),
          state: Id.describe("Id of the state to clear."),
          to: TargetRef.describe("Who loses the state."),
        })
        .strict()
        .describe("Clear a persistent state."),
      z
        .object({
          do: z.literal("removeSubject").describe("Take a subject out of the run."),
          to: TargetRef.describe("Which subject leaves play."),
        })
        .strict()
        .describe(
          "Take a subject out of the run. Its unit still happened, but the subject plays no further part.",
        ),
      z
        .object({
          do: z.literal("ban").describe("Forbid declaring further subjects of a given type."),
          subjectType: z
            .string()
            .optional()
            .describe("A literal subject type to forbid, when it is known up front."),
          from: TargetRef.optional().describe(
            "Take the forbidden type from this subject's declared type instead of naming it.",
          ),
          label: z.string().optional().describe("How to describe the ban to the player."),
        })
        .strict()
        .describe("Forbid declaring further subjects of a given type for the rest of the run."),
      z
        .object({
          do: z.literal("forceUnit").describe("Queue mandatory extra units before the run may end."),
          count: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe("How many extra units to queue. Defaults to 1."),
        })
        .strict()
        .describe("Queue mandatory extra units; the run cannot end while any remain."),
      z
        .object({
          do: z.literal("rewind").describe("Send the player back: when this unit closes, the run enters an earlier unit again instead of the next one."),
          count: z.number().int().min(1).max(20).optional().describe("How many units back. Defaults to 1: the previous unit is played again. Never before the first."),
        })
        .strict()
        .describe("Send the player back a unit or more, played again from its start, at the close of the current one."),
      z
        .object({
          do: z.literal("extraRoll").describe("Owe extra rolls on a table's step: the step is rolled again until they are paid."),
          table: Id.describe("Id of the table whose step rolls again."),
          count: z.number().int().min(1).max(10).optional().describe("How many extra rolls. Defaults to 1."),
          unit: z
            .enum(["current", "next"])
            .optional()
            .describe("Which unit owes them: `next` (the default) for \"the next Room rolls two Mutations\", `current` when the step has not happened yet this unit."),
        })
        .strict()
        .describe("Owe extra rolls on a table's step, this unit or the next; the flow keeps the step open until they are made."),
      z
        .object({
          do: z.literal("modCounter").describe("Adjust a counter."),
          counter: Id.describe("Id of the counter to change."),
          by: z.number().int().optional().describe("Amount to add; negative subtracts."),
          set: z.number().int().optional().describe("Absolute value to set, overriding `by`."),
          setFrom: z
            .string()
            .min(1)
            .optional()
            .describe("Set it to a value bound earlier — a roll's total or a prompt's answer — by name. Overrides `by` and `set`."),
        })
        .strict()
        .describe("Adjust a counter."),
      z
        .object({
          do: z.literal("modResource").describe("Adjust a resource."),
          resource: Id.describe("Id of the resource to change."),
          by: z.number().int().optional().describe("Amount to add; negative spends."),
          set: z.number().int().optional().describe("Absolute value to set, overriding `by`."),
          setFrom: z
            .string()
            .min(1)
            .optional()
            .describe("Set it to a value bound earlier — a roll's total or a prompt's answer — by name. Overrides `by` and `set`."),
        })
        .strict()
        .describe("Adjust a resource, clamped to its declared min and max."),
      z
        .object({
          do: z.literal("grantCard").describe("Draw cards into the player's hand."),
          deck: Id.describe("Id of the deck to draw from."),
          count: z.number().int().min(1).optional().describe("How many to draw. Defaults to 1."),
        })
        .strict()
        .describe("Draw cards into the player's hand."),
      z
        .object({
          do: z.literal("discardCard").describe("Discard cards from hand without resolving them."),
          deck: Id.describe("Id of the deck the discarded card belongs to."),
          count: z.number().int().min(1).optional().describe("How many to discard. Defaults to 1."),
        })
        .strict()
        .describe("Discard cards from hand without resolving them."),
      z
        .object({
          do: z.literal("startTimer").describe("Start a countdown the player must work against."),
          minutes: z.number().positive().max(600).describe("Duration in minutes."),
          label: z.string().optional().describe("What the timer is for."),
        })
        .strict()
        .describe("Start a countdown the player must work against."),
      z
        .object({
          do: z.literal("note").describe("Give the player an instruction to carry out by hand."),
          text: z.string().min(1).describe("The instruction shown to the player."),
          persistent: z
            .boolean()
            .optional()
            .describe(
              "Keep it on screen for the rest of the run rather than clearing it once acknowledged.",
            ),
        })
        .strict()
        .describe(
          "Give the player an instruction to carry out by hand, tracked as an obligation they tick off. Use this for anything the engine cannot do itself.",
        ),
      z
        .object({
          do: z.literal("setFlag").describe("Set a boolean flag that predicates can later test."),
          flag: Id.describe("Name of the flag."),
          value: z.boolean().optional().describe("Value to set. Defaults to true."),
        })
        .strict()
        .describe("Set a boolean flag that predicates can later test."),
      z
        .object({ do: z.literal("endRunAttempt").describe("Try to end the run.") })
        .strict()
        .describe(
          "Try to end the run. It may be refused, by queued forced units or by a trigger that fires on the attempt.",
        ),
      z
        .object({
          do: z.literal("when").describe("Run actions conditionally on run state."),
          all: z.array(Predicate).min(1).describe("Every predicate must hold."),
          then: z.array(Action).min(1).describe("Actions to run when the conditions hold."),
          else: z.array(Action).optional().describe("Actions to run when they do not."),
        })
        .strict()
        .describe("Run actions conditionally on run state."),
    ])
    .describe(
      "One step of behavior. The vocabulary is closed on purpose: packs are data, never code.",
    ),
);

export const ActionList = z
  .array(Action)
  .describe("Actions run in order, top to bottom.");
