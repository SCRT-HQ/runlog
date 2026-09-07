import type { Mode, Pack } from "@runlog/rules-schema";
import type { Award, Contestant, RunState } from "./types.ts";

/**
 * Moderated play: one person runs the game, everyone else races it.
 *
 * The moderator holds the device. The contestants are a roster of names —
 * not accounts, because a stream's viewers and a room's friends rarely have
 * one — and every draw the flow makes is a challenge they all go for at
 * once. When somebody finishes, the moderator awards them the result, and
 * its points go on their score. Curses and boons land on everyone the way
 * a run-wide state always has; the only thing that is per person is the
 * score.
 *
 * What counts as a challenge is the pack's to say: a result with `points`
 * is one, a result without is an effect. So a target table scores and a
 * curse table does not, and the moderator's panel lists exactly the things
 * that can be won.
 */

export type Moderation = NonNullable<Mode["moderated"]>;

/** The moderated configuration of the mode being played, or null. */
export function moderation(pack: Pack, state: RunState | null): Moderation | null {
  const mode = pack.modes[state?.mode ?? pack.defaultMode];
  return mode?.moderated ?? null;
}

export interface Challenge {
  /** The outcome's position in the log, which is what an award names. */
  outcome: number;
  table: string;
  tableTitle: string;
  entryId: string;
  text: string;
  points: number;
  /**
   * What the challenge's own follow-up rolls said: the collection to
   * gather, the names to hunt, the item to find. A result that reads "a
   * collection" is a mechanic; which collection is what the row needs.
   */
  details: string[];
  /** Who has been awarded it so far, in order. */
  awards: Award[];
  /** Whether another contestant can still be awarded it under the mode's rule. */
  open: boolean;
}

/** The results of the current unit that carry points, with who has won them. */
export function challenges(pack: Pack, state: RunState): Challenge[] {
  const rule = moderation(pack, state);
  const out: Challenge[] = [];
  // Outside a moderated mode nothing is a challenge, points or not.
  if (!rule) return out;
  const entryOf = (o: RunState["outcomes"][number]) => pack.tables[o.table]?.entries.find((e) => e.id === o.entryId);
  const scores = (o: RunState["outcomes"][number]) => {
    const points = entryOf(o)?.points;
    return points !== undefined && points > 0;
  };
  state.outcomes.forEach((o, index) => {
    if (o.unit !== state.unit) return;
    const table = pack.tables[o.table];
    const entry = entryOf(o);
    if (!entry || !scores(o)) return;
    const awards = state.awards.filter((a) => a.outcome === index);
    const open = rule?.award === "everyone" ? awards.length < state.contestants.length : awards.length === 0;
    // The follow-ups: what the same block rolled right after this result
    // — the same moment, since a block commits as one — up to the next
    // result that scores, which is a challenge of its own.
    const details: string[] = [];
    for (let j = index + 1; j < state.outcomes.length; j++) {
      const next = state.outcomes[j]!;
      if (next.unit !== o.unit || next.at !== o.at || scores(next)) break;
      const e = entryOf(next);
      if (e) details.push(e.title ?? e.text);
    }
    out.push({
      outcome: index,
      table: o.table,
      tableTitle: table?.title ?? o.table,
      entryId: o.entryId,
      text: entry.title ?? entry.text,
      points: entry.points!,
      details,
      awards,
      open,
    });
  });
  return out;
}

/** What an award of this challenge to this contestant would be worth, or null if it cannot be made. */
export function awardValue(pack: Pack, state: RunState, outcome: number, contestant: string): number | null {
  const rule = moderation(pack, state);
  if (!rule) return null;
  const c = challenges(pack, state).find((ch) => ch.outcome === outcome);
  if (!c || !c.open) return null;
  if (!state.contestants.some((x) => x.id === contestant)) return null;
  if (c.awards.some((a) => a.contestant === contestant)) return null;
  const first = c.awards.length === 0;
  return c.points + (first ? (rule.firstBonus ?? 0) : 0);
}

export interface Standing {
  contestant: Contestant;
  points: number;
  wins: number;
  /** 1 for the leader; ties share a place. */
  place: number;
}

/** The scoreboard: everyone on the roster, most points first, ties sharing a place. */
export function standings(state: RunState): Standing[] {
  const rows = state.contestants.map((contestant) => {
    const mine = state.awards.filter((a) => a.contestant === contestant.id);
    return { contestant, points: mine.reduce((sum, a) => sum + a.points, 0), wins: mine.length, place: 0 };
  });
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.contestant.name.localeCompare(b.contestant.name));
  let place = 0;
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    place = prev && prev.points === row.points && prev.wins === row.wins ? place : i + 1;
    row.place = place;
  });
  return rows;
}
