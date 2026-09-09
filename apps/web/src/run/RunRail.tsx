/**
 * The three planes of a run, on a phone.
 *
 * A wide screen puts what to do, what is true and what happened beside one
 * another, and the eye moves between them for nothing. A phone has room for
 * one of the three, and stacking them made a run a page you scroll past your
 * own game to play: the step under four rows of chrome, the counters a
 * thousand pixels below the dice that move them.
 *
 * So the three columns become three planes and this is the way between them.
 * Three words in the referee's face on a rule, the one you are on marked in
 * celadon, which is what celadon means everywhere else here: the current
 * thing. Nothing on it is louder than a word except one mark, on Now, for
 * when the game is waiting on you and you are reading something else.
 *
 * It draws nothing above 760px, where the columns are the columns.
 */

/** Which of the run's four planes a phone is showing. */
export type Pane = "now" | "unit" | "board" | "log";

export function RunRail({
  pane,
  onPane,
  waiting,
  unit,
  board,
}: {
  pane: Pane;
  onPane: (pane: Pane) => void;
  /** The game has asked for something: a roll, an answer, a receipt to read. */
  waiting: boolean;
  /** The pack's word for a unit, which is what its own plane is called. */
  unit: string;
  /** What the side column is called in this pack's words, for its tab's title. */
  board: string;
}) {
  const tabs: { id: Pane; label: string; title: string }[] = [
    { id: "now", label: "Now", title: "The step you are on" },
    { id: "unit", label: unit, title: "Every phase of this one, what it produced, and where you are in it" },
    { id: "board", label: "Board", title: board },
    { id: "log", label: "Log", title: "Every roll, in order, and the way to take it out" },
  ];
  return (
    <nav className="runRail" aria-label="This run">
      {tabs.map((tab) => {
        const on = pane === tab.id;
        const mark = tab.id === "now" && waiting && !on;
        return (
          <button
            key={tab.id}
            type="button"
            className="railTab"
            title={tab.title}
            aria-current={on ? "true" : undefined}
            onClick={() => onPane(tab.id)}
          >
            {tab.label}
            {mark && <span className="railMark" aria-hidden="true" />}
            {mark && <span className="visuallyHidden">, waiting on you</span>}
          </button>
        );
      })}
    </nav>
  );
}
