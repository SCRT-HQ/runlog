import type { Pack, TargetingDef } from "@runlog/rules-schema";
import { eligibleTargets } from "./eligibility.ts";
import type { RunState } from "./types.ts";

/**
 * Deciding which earlier subject a consequence lands on.
 *
 * This is the highest-value piece of the engine, because it is the arithmetic
 * a person is worst at doing mid-session: count N places from an anchor,
 * wrapping around the ends, skipping anything ineligible, having first reduced
 * an offset that may exceed the number of candidates.
 *
 * Every result carries a derivation. That is not a nicety. The standing
 * objection to letting a computer decide these things is not that it gets them
 * wrong, it is that you cannot see how it decided, so you cannot own the
 * outcome. Showing the working answers that directly.
 */

export type TargetingOutcome =
  /** A subject was selected. */
  | "target"
  /** The rules hand the choice to the player. */
  | "playerChoice"
  /** The consequence triggered, but there is nothing it can land on. */
  | "noEligibleTargets"
  /** Counting ran off the end and the pack does not wrap. */
  | "noTarget"
  /** The roll falls in no declared band, so nothing should have been targeted. */
  | "outOfBand"
  /** The pack declares this roll a miss that still counts as having happened. */
  | "miss";

export interface TargetingDerivation {
  outcome: TargetingOutcome;
  /** Id of the chosen subject, when there is one. */
  targetSubject: number | null;
  /** Ids of every candidate, oldest first. */
  eligible: number[];
  /** The roll being interpreted, after any event-fallback mapping. */
  roll: number;
  /** The roll as originally made, when a fallback remapped it. */
  originalRoll?: number;
  band?: { range: [number, number]; anchor: string; direction?: string };
  anchorIndex?: number;
  rawOffset?: number;
  reducedOffset?: number;
  targetIndex?: number;
  /** Human-readable working, one line per step. */
  explain: string[];
}

export interface ResolveTargetingOptions {
  /** The roll that triggered this, where one applies. */
  roll?: number;
  /**
   * How the target is chosen: from the triggering roll, from the pack's
   * fallback mapping for consequences not tied to a band, or by the player.
   */
  from?: "currentRoll" | "event" | "choice";
  /** Used when the strategy is `random`. */
  random?: () => number;
}

const base = (roll: number, eligible: number[]): TargetingDerivation => ({
  outcome: "noTarget",
  targetSubject: null,
  eligible,
  roll,
  explain: [],
});

export function resolveTargeting(
  pack: Pack,
  state: RunState,
  options: ResolveTargetingOptions = {},
): TargetingDerivation {
  const candidates = eligibleTargets(pack, state);
  const ids = candidates.map((s) => s.id);
  const roll = options.roll ?? 0;
  const d = base(roll, ids);
  const targeting = pack.targeting;

  if (!targeting || targeting.strategy === "none") {
    d.outcome = "outOfBand";
    d.explain.push("This game has no targeting: nothing reaches backwards.");
    return d;
  }

  // A consequence with nothing to land on still counts as having happened.
  // Suppressing it here would quietly hand the player a reprieve the rules
  // never granted them.
  if (ids.length === 0) {
    d.outcome = "noEligibleTargets";
    d.explain.push("No eligible targets. The consequence still triggers, but affects nothing.");
    return d;
  }

  if (options.from === "choice" || targeting.strategy === "playerChoice") {
    d.outcome = "playerChoice";
    d.explain.push(`You choose which of the ${ids.length} eligible to hit.`);
    return d;
  }

  switch (targeting.strategy) {
    case "oldest":
      return pick(d, candidates, 0, "The oldest eligible.");
    case "newest":
      return pick(d, candidates, candidates.length - 1, "The newest eligible.");
    case "random": {
      const rnd = options.random ?? Math.random;
      const index = Math.floor(rnd() * candidates.length);
      return pick(d, candidates, index, `Chosen at random from ${ids.length} eligible.`);
    }
    case "anchoredOffset":
      return anchoredOffset(targeting, d, candidates, options);
  }
}

function pick(
  d: TargetingDerivation,
  candidates: Array<{ id: number }>,
  index: number,
  why: string,
): TargetingDerivation {
  const subject = candidates[index];
  d.targetIndex = index;
  d.outcome = subject ? "target" : "noTarget";
  d.targetSubject = subject?.id ?? null;
  d.explain.push(why);
  return d;
}

function anchoredOffset(
  targeting: Extract<TargetingDef, { strategy: "anchoredOffset" }>,
  d: TargetingDerivation,
  candidates: Array<{ id: number }>,
  options: ResolveTargetingOptions,
): TargetingDerivation {
  let roll = d.roll;

  // An "event" consequence was not triggered by a roll that already picks a
  // band, so the pack supplies a mapping from a fresh roll onto one.
  if (options.from === "event" && targeting.eventFallback) {
    const fb = targeting.eventFallback;
    d.originalRoll = roll;
    if (fb.missOn !== undefined && roll === fb.missOn) {
      d.outcome = "miss";
      d.explain.push(
        `Rolled ${roll}: a miss. It still counts as having been triggered.`,
      );
      return d;
    }
    const tens = Math.floor(roll / 10);
    const ones = roll % 10;
    const bandStart = tens % 2 === 1 ? fb.tensOddBand : fb.tensEvenBand;
    roll = bandStart + ones;
    d.roll = roll;
    d.explain.push(
      `Rolled ${d.originalRoll}: the tens digit ${tens} is ${tens % 2 === 1 ? "odd" : "even"}, ` +
        `so read it in the ${bandStart}s - treat as ${roll}.`,
    );
  }

  const found = targeting.bands.find((b) => roll >= b.range[0] && roll <= b.range[1]);
  if (!found) {
    d.outcome = "outOfBand";
    d.explain.push(`${roll} falls in no targeting band; nothing is targeted.`);
    return d;
  }
  d.band = { range: found.range, anchor: found.anchor, direction: found.direction };

  if (found.anchor === "playerChoice") {
    d.outcome = "playerChoice";
    d.explain.push(`${roll} is in ${found.range[0]}-${found.range[1]}: you choose the target.`);
    return d;
  }

  const n = candidates.length;
  const anchorIndex = found.anchor === "newest" ? n - 1 : 0;
  d.anchorIndex = anchorIndex;

  // Only one offset scheme exists so far; the field is declared so a second
  // can arrive without changing the shape of a pack.
  const rawOffset = roll % 10;
  d.rawOffset = rawOffset;

  d.explain.push(
    `${roll} is in ${found.range[0]}-${found.range[1]}: anchor on the ${found.anchor} ` +
      `of ${n} eligible, counting ${found.direction}.`,
  );

  // The shortcut these rules are usually written with: subtract the number of
  // candidates from the offset until you cannot any more. That is a modulo,
  // and stating it as one keeps the arithmetic honest at the boundaries.
  const offset = rawOffset % n;
  d.reducedOffset = offset;
  if (offset !== rawOffset) {
    d.explain.push(
      `Offset ${rawOffset} exceeds ${n} eligible, so reduce it: ${rawOffset} % ${n} = ${offset}.`,
    );
  } else if (rawOffset === 0) {
    d.explain.push("A ones digit of 0 targets the anchor itself.");
  }

  const raw = found.direction === "before" ? anchorIndex - offset : anchorIndex + offset;
  let index = raw;
  if (raw < 0 || raw >= n) {
    if (!targeting.wraparound) {
      d.outcome = "noTarget";
      d.explain.push(`Counting runs off the end and this game does not wrap. No target.`);
      return d;
    }
    index = ((raw % n) + n) % n;
    d.explain.push(`Counting wraps around the ends of the list.`);
  }

  d.targetIndex = index;
  const subject = candidates[index];
  d.targetSubject = subject?.id ?? null;
  d.outcome = subject ? "target" : "noTarget";
  d.explain.push(
    `Position ${index + 1} of ${n}${subject ? "" : ", which does not exist"}.`,
  );
  return d;
}
