import { useMemo } from "react";
import type { ChecklistItem, Pack } from "@runlog/rules-schema";
import type { RunState } from "@runlog/engine";
import { allMade, evidenceFor, pointMade, pointOf, type Shown } from "./evidence.ts";

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
 */
export function Checklist({
  items,
  pack,
  state,
  ticked,
  onToggle,
}: {
  items: ChecklistItem[];
  pack: Pack;
  state: RunState;
  ticked: Set<string>;
  onToggle: (keys: string[], on: boolean, tally?: string) => void;
}) {
  const points = useMemo(() => items.map(pointOf), [items]);
  const evidence = useMemo(
    () => points.map((p) => (p.shows ? evidenceFor(pack, state, p.shows) : [])),
    [points, pack, state],
  );

  return (
    <ul className="checklist">
      {points.map((point, i) => {
        const shown: Shown[] = evidence[i] ?? [];
        if (point.shows && shown.length === 0) return null;
        const childKeys = shown.map((s) => `${i}:${s.key}`);
        const made = pointMade(i, shown, ticked);
        const toggle = (keys: string[], on: boolean) => onToggle(keys.filter((k) => ticked.has(k) !== on), on, point.tally);
        return (
          <li key={i}>
            <label>
              <input
                type="checkbox"
                checked={made}
                onChange={(e) => toggle(shown.length > 0 ? childKeys : [`${i}`], e.target.checked)}
              />
              <span>
                {point.text}
                {point.optional && <span className="chip skip">optional</span>}
              </span>
            </label>
            {shown.length > 0 && (
              <ul className="evidence">
                {shown.map((s) => {
                  const key = `${i}:${s.key}`;
                  return (
                    <li key={key}>
                      <label>
                        <input type="checkbox" checked={ticked.has(key)} onChange={(e) => toggle([key], e.target.checked)} />
                        <span>
                          <span className="where">{s.where}</span>
                          {s.text}
                        </span>
                      </label>
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
export function checklistDone(items: ChecklistItem[], pack: Pack, state: RunState, ticked: Set<string>): boolean {
  const points = items.map(pointOf);
  return allMade(
    points,
    points.map((p) => (p.shows ? evidenceFor(pack, state, p.shows) : [])),
    ticked,
  );
}
