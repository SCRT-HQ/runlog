import { useMemo, type ReactNode } from "react";
import type { ChecklistItem, Pack } from "@runlog/rules-schema";
import type { RunState } from "@runlog/engine";
import { allMade, evidenceFor, pointMade, pointOf, rowMade, type Settling, type Shown } from "./evidence.ts";

/**
 * Points to tick off, with their evidence under them.
 *
 * A point that shows a table's results lists them beneath it, each with a box
 * of its own; ticking them all ticks the point, and ticking the point ticks
 * them all. The parent's box is what the point reads as, the children are
 * what it is about. A point with nothing to show is a plain box.
 *
 * A point that shows a table the unit never rolled on is not shown at all:
 * there is nothing to make a promise about, and a box that must be ticked
 * beside "nothing on the table" is a box that teaches people to tick
 * without reading. An optional point is shown, and the step does not wait
 * for it. A point with a tally counts its ticks.
 *
 * The ticked set is the step's and lives in the log, so a reload keeps it.
 *
 * What the boxes are for used to be written out over every list: the app
 * cannot see the work, it only records that you did it. It is the premise
 * of the whole thing, said once in the guide and on the welcome page, and
 * printing it above every step read as a machine that did not trust the
 * person using it. The list carries it as its title instead, for whoever
 * wonders.
 */
export function Checklist({
  items,
  pack,
  state,
  ticked,
  onToggle,
  settling,
  action,
}: {
  items: ChecklistItem[];
  pack: Pack;
  state: RunState;
  ticked: Set<string>;
  onToggle: (keys: string[], on: boolean, tally?: string) => void;
  /** Which rows the game settles itself, and whether it has; see evidence.ts. */
  settling?: Settling;
  /** The move a row is waiting on, drawn on the row rather than in a panel of its own. */
  action?: (s: Shown) => ReactNode;
}) {
  const points = useMemo(() => items.map(pointOf), [items]);
  const evidence = useMemo(
    () => points.map((p) => (p.shows ? evidenceFor(pack, state, p.shows) : [])),
    [points, pack, state],
  );

  return (
    <ul className="checklist" title="Nothing here is checked by the app. It cannot see the work; ticking a box is your word, and the log keeps it.">
      {points.map((point, i) => {
        const shown: Shown[] = evidence[i] ?? [];
        if (point.shows && shown.length === 0) return null;
        // What is already in front of the player as a rule is not listed
        // again under a box; a point with nothing left to list has nothing
        // to ask, and the rule it stands for is doing the asking.
        //
        // Only where something can actually answer it, though: the game
        // settling it, or the rule carrying the tick that honours it. A row
        // nothing can answer stays on the screen whatever it is told,
        // because the alternative is a step that cannot be finished.
        const answerable = (s: Shown) => Boolean(settling && (settling.owing(s) || settling.settled(s) || settling.answered?.(s)));
        const listed = shown.filter((s) => !(settling?.hidden?.(s) && answerable(s)));
        if (point.shows && listed.length === 0) return null;
        // A row the game settles is not offered as a box to tick, and
        // ticking the point over it does not reach down to it.
        const mine = listed.filter((s) => !settling?.owing(s) && !settling?.settled(s));
        const childKeys = mine.map((s) => `${i}:${s.key}`);
        const made = pointMade(i, shown, ticked, point, settling);
        const toggle = (keys: string[], on: boolean) => onToggle(keys.filter((k) => ticked.has(k) !== on), on, point.tally);
        return (
          <li key={i}>
            <label>
              <input
                type="checkbox"
                checked={made}
                disabled={listed.length > 0 && childKeys.length === 0}
                onChange={(e) => toggle(shown.length > 0 ? childKeys : [`${i}`], e.target.checked)}
              />
              <span>
                {point.text}
                {point.optional && <span className="chip skip">optional</span>}
              </span>
            </label>
            {listed.length > 0 && (
              <ul className="evidence">
                {listed.map((s) => {
                  const key = `${i}:${s.key}`;
                  const theirs = Boolean(settling?.owing(s) || settling?.settled(s));
                  return (
                    <li key={key} className={theirs ? "settling" : ""}>
                      <label>
                        <input
                          type="checkbox"
                          checked={rowMade(key, s, ticked, settling)}
                          disabled={theirs}
                          title={theirs ? "The game settles this one: it is honoured by the roll it asks for, not by saying so." : undefined}
                          onChange={(e) => toggle([key], e.target.checked)}
                        />
                        <span>
                          <span className="where">{s.where}</span>
                          {s.text}
                        </span>
                      </label>
                      {settling?.owing(s) && action?.(s)}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Whether every point that must be made is made, for the button that waits on it. */
export function checklistDone(items: ChecklistItem[], pack: Pack, state: RunState, ticked: Set<string>, settling?: Settling): boolean {
  const points = items.map(pointOf);
  return allMade(
    points,
    points.map((p) => (p.shows ? evidenceFor(pack, state, p.shows) : [])),
    ticked,
    settling,
  );
}
