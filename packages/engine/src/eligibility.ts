import type { Pack } from "@runlog/rules-schema";
import type { RunState, Subject } from "./types.ts";

/**
 * Which subjects a consequence is allowed to land on.
 *
 * The engine does not know what "Untargetable" means, and must not: that would
 * make it specific to one game. Instead a pack declares each state's
 * `semantics`, and this reads them. A pack that never uses those semantics
 * simply never has anything excluded.
 */

const EXCLUDING = new Set(["makesUntargetable", "removesFromPlay"]);

/** True when a state, as this pack declares it, takes a subject off the board. */
export function stateExcludesFromTargeting(pack: Pack, stateId: string): boolean {
  const semantics = pack.states?.[stateId]?.semantics ?? [];
  return semantics.some((s) => EXCLUDING.has(s));
}

export function isEligibleTarget(pack: Pack, subject: Subject): boolean {
  if (!subject.finalized) return false;
  if (subject.removed) return false;
  return !subject.states.some((s) => stateExcludesFromTargeting(pack, s));
}

/**
 * Eligible subjects, oldest first.
 *
 * Order matters: the whole anchored-offset scheme is defined in terms of
 * counting along this list, and "the oldest" and "the newest" are its ends.
 */
export function eligibleTargets(pack: Pack, state: RunState): Subject[] {
  return state.subjects.filter((s) => isEligibleTarget(pack, s));
}

/** True when a state, as declared, stops the player editing a subject. */
export function isLocked(pack: Pack, subject: Subject): boolean {
  return subject.states.some((s) =>
    (pack.states?.[s]?.semantics ?? []).some((x) => x === "blocksEdit" || x === "locksValue"),
  );
}

/**
 * The label a player would write on the thing itself, a file name, a layer,
 * a track, so the board state survives outside the app.
 */
/** What a subject is called: its own name, or its noun and number. */
export function subjectName(pack: Pack, subject: Pick<Subject, "id" | "name">): string {
  return subject.name ?? `${pack.vocabulary.subject.one} ${subject.id}`;
}

/** The name with the declared type beside it, when the type says something the name does not. */
export function subjectTitle(pack: Pack, subject: Pick<Subject, "id" | "name" | "type">): string {
  const name = subjectName(pack, subject);
  return subject.type && subject.type !== name ? `${name} (${subject.type})` : name;
}

/** The state marks a subject carries, as the short forms a player writes on it. */
export function stateMarks(pack: Pack, subject: Pick<Subject, "states">): string[] {
  return subject.states.map((s) => pack.states?.[s]?.short ?? pack.states?.[s]?.label ?? s).filter(Boolean);
}

export function subjectLabel(pack: Pack, subject: Subject): string {
  const name = subjectTitle(pack, subject);
  const marks = stateMarks(pack, subject);
  return marks.length > 0 ? `${name} [${marks.join(" ")}]` : name;
}
