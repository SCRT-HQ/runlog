import type { ChecklistItem, Pack } from "@runlog/rules-schema";
import type { RunState } from "@runlog/engine";

/**
 * What a point on a checklist is about.
 *
 * "The Constraint has been honored" is a promise the app cannot check, but
 * it can put the constraint in front of you while you make it. A point that
 * `shows` a table gets that table's results listed under it, the ones from
 * this unit, or the ones that reached this unit's subject, or all of them, 
 * each with a box of its own, so the promise is made about something you
 * are looking at rather than something you remember from the log.
 */

export interface Point {
  text: string;
  shows?: { table: string | string[]; scope: "unit" | "subject" | "run" };
  /** The step does not wait for this one. */
  optional?: boolean;
  /** Each ticked box adds one to this counter. */
  tally?: string;
}

export function pointOf(item: ChecklistItem): Point {
  if (typeof item === "string") return { text: item };
  return {
    text: item.text,
    ...(item.shows ? { shows: item.shows } : {}),
    ...(item.optional ? { optional: true } : {}),
    ...(item.tally ? { tally: item.tally } : {}),
  };
}

export interface Shown {
  /** Stable within a step: the outcome's position in the log. */
  key: string;
  /** Where it came from, in the referee's voice: the table, and who it hit. */
  where: string;
  /** What it said, in the author's. */
  text: string;
  /** Which result this is, so a caller can tell whether the game owes something on it. */
  table: string;
  entryId: string;
}

export function evidenceFor(pack: Pack, state: RunState, shows: NonNullable<Point["shows"]>): Shown[] {
  const tables = new Set(Array.isArray(shows.table) ? shows.table : [shows.table]);
  const subject = state.subjects.find((s) => s.unit === state.unit && !s.removed);
  const out: Shown[] = [];
  state.outcomes.forEach((o, i) => {
    if (!tables.has(o.table)) return;
    const table = pack.tables[o.table];
    if (shows.scope === "unit" && o.unit !== state.unit) return;
    if (shows.scope === "subject" && (!subject || o.targetSubject !== subject.id)) return;
    const entry = table?.entries.find((e) => e.id === o.entryId);
    const hit =
      o.targetSubject !== null ? ` - ${pack.vocabulary.subject.one.toLowerCase()} #${o.targetSubject}` : "";
    out.push({
      key: `o${i}`,
      where: `${pack.vocabulary.unit.one} ${o.unit}, ${table?.title ?? o.table}${hit}`,
      text: entry?.title ?? entry?.text ?? o.entryId,
      table: o.table,
      entryId: o.entryId,
    });
  });
  return out;
}

/**
 * Whether every point that must be made is made. A point with evidence
 * under it is made when every piece of evidence is ticked; a plain one by
 * its own box; one whose table produced nothing this unit has nothing to
 * promise and is not asked. Optional points are not waited for.
 */
/**
 * Whether a row is the game's to settle rather than the player's to
 * promise, and whether it has settled it.
 *
 * A result the pack hung a trigger on is honoured by the trigger running,
 * not by somebody saying it was: asking for a tick beside it is asking a
 * question that has an answer already. Absent, every row is the player's
 * word, which is what it always was.
 */
export interface Settling {
  owing: (s: Shown) => boolean;
  settled: (s: Shown) => boolean;
  /**
   * Rows the step already shows somewhere else, as a rule it is held to.
   * Not drawn again here, and still counted: the point waits for them,
   * they are simply asked about where they are rather than twice.
   */
  hidden?: (s: Shown) => boolean;
}

export function allMade(points: Point[], evidence: Shown[][], ticked: Set<string>, settling?: Settling): boolean {
  return points.every((p, i) => p.optional || pointMade(i, evidence[i] ?? [], ticked, p, settling));
}

export function pointMade(i: number, shown: Shown[], ticked: Set<string>, point?: Point, settling?: Settling): boolean {
  if (shown.length === 0) return point?.shows ? true : ticked.has(`${i}`);
  return shown.every((s) => rowMade(`${i}:${s.key}`, s, ticked, settling));
}

/** One row: settled by the game where the game owes it, ticked where it does not. */
export function rowMade(key: string, s: Shown, ticked: Set<string>, settling?: Settling): boolean {
  if (settling?.settled(s)) return true;
  if (settling?.owing(s)) return false;
  return ticked.has(key);
}
