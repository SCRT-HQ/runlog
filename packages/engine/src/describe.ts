import type { Pack, Phase, Predicate } from "@runlog/rules-schema";

/**
 * Predicates, in prose.
 *
 * A pack says `skipWhen: [{ unitIndex: { gte: 2 } }]`; a player wants to know
 * why a room went gray. This turns the one into the other, in the pack's own
 * words — "from Room 2 on", not "unitIndex ≥ 2". Every predicate kind the
 * schema admits is covered, so a new kind is a compile error here rather than
 * a blank tooltip.
 */

type Bound = { eq?: number; gte?: number; lte?: number; gteCounter?: string; lteCounter?: string };

function counterName(pack: Pack, id: string): string {
  return pack.counters?.[id]?.label ?? id;
}

function bound(pack: Pack, b: Bound): string {
  if (b.eq !== undefined) return `is ${b.eq}`;
  const parts: string[] = [];
  if (b.gte !== undefined && b.lte !== undefined) return `is ${b.gte} to ${b.lte}`;
  if (b.gte !== undefined) parts.push(`is ${b.gte} or more`);
  if (b.lte !== undefined) parts.push(`is ${b.lte} or fewer`);
  if (b.gteCounter) parts.push(`is at least ${counterName(pack, b.gteCounter)}`);
  if (b.lteCounter) parts.push(`is at most ${counterName(pack, b.lteCounter)}`);
  return parts.join(" and ");
}

/** The unit number, said the way a player counts: "from Room 2 on". */
function unitBound(pack: Pack, b: Bound): string {
  const unit = pack.vocabulary.unit.one;
  if (b.eq !== undefined) return `in ${unit} ${b.eq}`;
  if (b.gte !== undefined && b.lte !== undefined) return `in ${unit}s ${b.gte} to ${b.lte}`;
  if (b.gte !== undefined) return b.gte === 2 ? `after the first ${unit.toLowerCase()}` : `from ${unit} ${b.gte} on`;
  if (b.lte !== undefined) return b.lte === 1 ? `during the first ${unit.toLowerCase()}` : `up to ${unit} ${b.lte}`;
  return `when the ${unit.toLowerCase()} number ${bound(pack, b)}`;
}

export function describePredicate(pack: Pack, p: Predicate): string {
  const v = pack.vocabulary;
  if ("ask" in p) return `you say yes to "${p.ask}"`;
  if ("unitIndex" in p) return unitBound(pack, p.unitIndex);
  if ("subjectCount" in p) return `the number of ${v.subject.many.toLowerCase()} ${bound(pack, p.subjectCount)}`;
  if ("eligibleTargets" in p) {
    return `the number of ${v.subject.many.toLowerCase()} in play ${bound(pack, p.eligibleTargets)}`;
  }
  if ("counter" in p) return `${counterName(pack, p.counter)} ${bound(pack, p.is)}`;
  if ("resource" in p) return `${pack.resources?.[p.resource]?.label ?? p.resource} ${bound(pack, p.is)}`;
  if ("flag" in p) return p.is === false ? `${p.flag} is off` : `${p.flag} is on`;
  if ("subjectHasState" in p) {
    const state = pack.states?.[p.subjectHasState]?.label ?? p.subjectHasState;
    const of = p.of ?? "thisSubject";
    const who =
      of === "run"
        ? `the ${v.run.one.toLowerCase()}`
        : of === "thisSubject"
          ? `this ${v.subject.one.toLowerCase()}`
          : of === "targetSubject"
            ? `the targeted ${v.subject.one.toLowerCase()}`
            : of === "allSubjects"
              ? `every ${v.subject.one.toLowerCase()}`
              : `every earlier ${v.subject.one.toLowerCase()}`;
    return `${who} is ${state}`;
  }
  if ("priorSubjectTagged" in p) return `an earlier ${v.subject.one.toLowerCase()} was ${p.priorSubjectTagged}`;
  if ("modeIs" in p) {
    const names = p.modeIs.map((id) => pack.modes[id]?.label ?? id);
    return `the mode is ${names.join(" or ")}`;
  }
  if ("phaseDone" in p) {
    return `${pack.phases.find((ph) => ph.id === p.phaseDone)?.label ?? p.phaseDone} is done`;
  }
  if ("not" in p) return `it is not the case that ${describePredicate(pack, p.not)}`;
  if ("allOf" in p) return p.allOf.map((q) => describePredicate(pack, q)).join(" and ");
  if ("anyOf" in p) return p.anyOf.map((q) => describePredicate(pack, q)).join(" or ");
  return "a condition holds";
}

/**
 * Why a phase is out of play, as a sentence for a tooltip. Any one reason in
 * `skipWhen` is enough, so they are joined with "or".
 */
export function describeSkip(pack: Pack, phase: Phase): string | null {
  const why = describeSkipReason(pack, phase);
  return why === null ? null : `${phase.label} is skipped ${why}.`;
}

/**
 * The reason alone, for a line under the phase's name: "after the first
 * stage". The sentence above is for a tooltip; a list has no room for it.
 */
export function describeSkipReason(pack: Pack, phase: Phase): string | null {
  const reasons = phase.skipWhen ?? [];
  if (reasons.length === 0) return null;
  return reasons.map((p) => describePredicate(pack, p)).join(", or ");
}
