import { useEffect, useRef, useState } from "react";

/**
 * The planes of a run, on a phone.
 *
 * A wide screen puts what to do, what is true and what happened beside one
 * another, and the eye moves between them for nothing. A phone has room for
 * one of them, and stacking them made a run a page you scroll past your own
 * game to play: the step under four rows of chrome, the counters a thousand
 * pixels below the dice that move them.
 *
 * So the columns become planes, the unit's own list makes a fourth, and this
 * is the way between them. Four words in the app's own face on a rule, the
 * one you are on in celadon under an accent rule, which is the same selected
 * treatment the bar above gives the page you are on. Nothing on it is louder
 * than a word except the marks: one for a plane holding something you have
 * not seen.
 *
 * It draws nothing above 760px, where the columns are the columns.
 */

/** Which of the run's four planes a phone is showing. */
export type Pane = "now" | "unit" | "board" | "log";

/** What a plane is carrying, as one reading per thing that can move on it. */
export type Readings = Record<string, string | number | undefined>;

/**
 * Whether anything on a plane has moved since it was last shown.
 *
 * The same rule a folded panel keeps, asked of the plane rather than the
 * fold: while it is in front of the player what it says is taken as seen,
 * and while it is not, a reading that differs from the last seen one is
 * something new. Showing the plane clears the mark, because the thing is
 * now read.
 *
 * A reading heard for the first time is never news. The panels on a plane
 * arrive over the run's first moments, and a column turning up is not the
 * game happening behind it.
 */
export function useUnseen(readings: Readings, showing: boolean): boolean {
  const seen = useRef<Readings>({ ...readings });
  const [unseen, setUnseen] = useState(false);
  useEffect(() => {
    if (showing) {
      seen.current = { ...readings };
      setUnseen(false);
      return;
    }
    let moved = false;
    for (const [what, said] of Object.entries(readings)) {
      if (!(what in seen.current)) seen.current[what] = said;
      else if (seen.current[what] !== said) moved = true;
    }
    if (moved) setUnseen(true);
  }, [showing, readings]);
  return unseen;
}

export function RunRail({
  pane,
  onPane,
  waiting,
  news,
  unit,
  board,
}: {
  pane: Pane;
  onPane: (pane: Pane) => void;
  /** The game has asked for something: a roll, an answer, a receipt to read. */
  waiting: boolean;
  /** The planes holding something that landed while they were not the one showing. */
  news?: Partial<Record<Pane, boolean>>;
  /** The pack's word for a unit, which is what its own plane is called. */
  unit: string;
  /** What the side column is called in this pack's words, for its tab's title. */
  board: string;
}) {
  const tabs: { id: Pane; label: string; title: string }[] = [
    { id: "now", label: "Now", title: "The step you are on" },
    // The pack's own word, which may be two words and may be long. It is
    // clipped to its share of the row and stays whole in the title and in
    // the name the tab is read out by, so the short form is what is seen
    // and never what is read.
    { id: "unit", label: unit, title: `${unit} · Every phase of this one, what it produced, and where you are in it` },
    { id: "board", label: "Board", title: board },
    { id: "log", label: "Log", title: "Every roll, in order, and the way to take it out" },
  ];
  return (
    <nav className="runRail" aria-label="This run">
      {tabs.map((tab) => {
        const on = pane === tab.id;
        // Now's mark is the game waiting on you; every other plane's is
        // something having landed behind it. Neither is worth a mark on
        // the plane you are already looking at.
        const mark = !on && (tab.id === "now" ? waiting : Boolean(news?.[tab.id]));
        return (
          <button
            key={tab.id}
            type="button"
            className="railTab"
            title={tab.title}
            aria-current={on ? "true" : undefined}
            onClick={() => onPane(tab.id)}
          >
            <span className="railWord">{tab.label}</span>
            {mark && <span className="railMark" aria-hidden="true" />}
            {mark && <span className="visuallyHidden">{tab.id === "now" ? ", waiting on you" : ", something new"}</span>}
          </button>
        );
      })}
    </nav>
  );
}
