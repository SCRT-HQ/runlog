import type { Pack } from "@runlog/rules-schema";
import { subjectTitle, type RunState } from "@runlog/engine";

/**
 * What has landed on a subject: every result that reached back to it.
 *
 * A state a result applies shows as a chip on the board already. A result
 * that reaches a subject without applying one (a rule the player carries
 * out by hand, say) left no trace there, only a line in the log, and the
 * board read as if nothing had happened to the thing. These are those
 * results, so the board can wear them too.
 */
export interface Hit {
  table: string;
  text: string;
  unit: number;
}

export function hitsOn(pack: Pack, state: RunState, subjectId: number): Hit[] {
  return state.outcomes
    .filter((o) => o.targetSubject === subjectId)
    .map((o) => {
      const table = pack.tables[o.table];
      const entry = table?.entries.find((e) => e.id === o.entryId);
      return { table: table?.title ?? o.table, text: entry?.title ?? entry?.text ?? o.entryId, unit: o.unit };
    });
}

/** "hit Track 2 (bass)": the name of the thing a result reached, not its number. */
export function hitLabel(pack: Pack, state: RunState, subjectId: number): string {
  const subject = state.subjects.find((s) => s.id === subjectId);
  return `hit ${subject ? subjectTitle(pack, subject) : `#${subjectId}`}`;
}
