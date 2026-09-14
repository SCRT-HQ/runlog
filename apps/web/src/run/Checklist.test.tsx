// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Pack } from "@runlog/rules-schema";
import type { RunState } from "@runlog/engine";
import { Checklist, checklistDone, ticksToFinish } from "./Checklist.tsx";
import type { Settling, Shown } from "./evidence.ts";

/**
 * A confirmation that lists what the unit drew, beside a rule the step is
 * already held to. The result is not listed twice, and it is not asked
 * about at all: the rule carries the move, and the point waits for it.
 */
const pack = {
  vocabulary: { unit: { one: "Room", many: "Rooms" }, subject: { one: "Track", many: "Tracks" }, run: { one: "Run", many: "Runs" } },
  tables: {
    mutation: {
      resolution: "lookup",
      title: "Mutation",
      roll: "d100",
      entries: [
        { id: "cull", range: [88, 88], text: "Upon finalizing, roll d6." },
        { id: "swap", range: [89, 89], text: "Swap two slices." },
      ],
    },
  },
} as unknown as Pack;

const state = {
  unit: 5,
  subjects: [],
  outcomes: [
    { unit: 5, table: "mutation", entryId: "cull", targetSubject: null },
    { unit: 5, table: "mutation", entryId: "swap", targetSubject: null },
  ],
} as unknown as RunState;

const items = [{ text: "Every Mutation on this Room has been honored.", shows: { table: "mutation", scope: "unit" } }] as never;

const settling = (over: Partial<Settling> = {}): Settling => ({
  owing: (s) => s.entryId === "cull",
  settled: () => false,
  ...over,
});

afterEach(cleanup);

describe("a confirmation beside the rules it repeats", () => {
  it("lists a result the step is not held to, and not one it is", () => {
    render(
      <Checklist
        items={items}
        pack={pack}
        state={state}
        ticked={new Set()}
        onToggle={() => {}}
        settling={settling({ hidden: (s) => s.entryId === "cull" })}
      />,
    );
    expect(screen.queryByText(/Upon finalizing/)).toBeNull();
    expect(screen.getByText(/Swap two slices/)).toBeTruthy();
  });

  it("draws no point at all where every result it lists is one the game settles", () => {
    const both = settling({ owing: () => true, hidden: () => true });
    const { container } = render(
      <Checklist items={items} pack={pack} state={state} ticked={new Set()} onToggle={() => {}} settling={both} />,
    );
    expect(container.querySelectorAll("li").length).toBe(0);
  });

  it("still waits for what it does not draw: the rule's move is what settles it", () => {
    const owing = settling({ owing: () => true, hidden: () => true });
    expect(checklistDone(items, pack, state, new Set(), owing)).toBe(false);
    const paid = settling({ owing: () => false, settled: () => true, hidden: () => true });
    expect(checklistDone(items, pack, state, new Set(), paid)).toBe(true);
  });

  /*
   * The bug this guard exists for. A rule the step is held to that the game
   * settles nothing on is honored by the player saying so, and the box is
   * the only place they can say it. Hiding it because its words appear
   * above left a step that could not be finished: nothing to tick, and a
   * button waiting on a tick.
   */
  /*
   * The rule carries the tick that honors it, so the confirmation drops
   * the row: one statement, one answer, whichever kind of answer it is.
   */
  it("drops a row whose rule carries the tick that honors it", () => {
    const onTheRule = { owing: () => false, settled: () => false, answered: () => true, hidden: () => true };
    const { container } = render(
      <Checklist items={items} pack={pack} state={state} ticked={new Set()} onToggle={() => {}} settling={onTheRule} />,
    );
    expect(container.querySelectorAll("li").length).toBe(0);
    // And the step still waits for it: the tick on the rule is the same tick.
    expect(checklistDone(items, pack, state, new Set(), onTheRule)).toBe(false);
    expect(checklistDone(items, pack, state, new Set(["0:o0", "0:o1"]), onTheRule)).toBe(true);
  });

  it("keeps the box for a rule the game settles nothing on, however it is shown elsewhere", () => {
    const nothingOwed = { owing: () => false, settled: () => false, hidden: () => true };
    render(<Checklist items={items} pack={pack} state={state} ticked={new Set()} onToggle={() => {}} settling={nothingOwed} />);
    expect(screen.getByText(/Upon finalizing/)).toBeTruthy();
    expect(screen.getByText(/Swap two slices/)).toBeTruthy();
    expect(checklistDone(items, pack, state, new Set(), nothingOwed)).toBe(false);
    expect(checklistDone(items, pack, state, new Set(["0:o0", "0:o1"]), nothingOwed)).toBe(true);
  });
});

/**
 * The keys a deck's one press would commit.
 *
 * Every case here is the page's own `tick` said back: a box a click would
 * write, in the shape `Checklist` gives its inputs. Where the two could
 * drift the test clicks the real box and compares.
 */
describe("ticksToFinish", () => {
  const plain = [{ text: "The Piece is different." }, { text: "The Constraint has been honored." }] as never;

  it("names every box a step still waits on, in one group", () => {
    expect(ticksToFinish(plain, pack, state, new Set())).toEqual([{ items: ["0", "1"] }]);
  });

  it("leaves a box that is already ticked alone", () => {
    expect(ticksToFinish(plain, pack, state, new Set(["0"]))).toEqual([{ items: ["1"] }]);
  });

  it("gives a point that moves a counter a group of its own, carrying the counter", () => {
    const tallied = [{ text: "The Piece is different." }, { text: "A setback was suffered.", tally: "setbacksSuffered" }] as never;
    expect(ticksToFinish(tallied, pack, state, new Set())).toEqual([{ items: ["0"] }, { items: ["1"], tally: "setbacksSuffered" }]);
  });

  // The step does not wait for an optional point, so neither does a press
  // that means "everything this is waiting on".
  it("never ticks an optional point", () => {
    const optional = [{ text: "The Piece is different." }, { text: "Photograph it.", optional: true }] as never;
    expect(ticksToFinish(optional, pack, state, new Set())).toEqual([{ items: ["0"] }]);
  });

  it("asks for nothing on a list that is already done", () => {
    expect(ticksToFinish(plain, pack, state, new Set(["0", "1"]))).toEqual([]);
  });

  it("names a point's evidence rather than the point, the way the page's own box does", () => {
    expect(ticksToFinish(items, pack, state, new Set())).toEqual([{ items: ["0:o0", "0:o1"] }]);
  });

  /*
   * Review finding: a row the list leaves out is ticked by the rule's own
   * box, and that box commits no tally. Counted in the point's group it
   * would move the counter further than any run of clicks could.
   */
  it("keeps a row the list leaves out away from the point's counter", () => {
    const tallied = [
      { text: "Every Mutation has been honored.", shows: { table: "mutation", scope: "unit" }, tally: "setbacksSuffered" },
    ] as never;
    const onTheRule = {
      owing: () => false,
      settled: () => false,
      answered: (s: Shown) => s.entryId === "cull",
      hidden: (s: Shown) => s.entryId === "cull",
    };
    expect(ticksToFinish(tallied, pack, state, new Set(), onTheRule)).toEqual([
      { items: ["0:o1"], tally: "setbacksSuffered" },
      { items: ["0:o0"] },
    ]);
  });

  it("commits what a click on the same box commits", () => {
    const committed: Array<[string[], boolean, string | undefined]> = [];
    render(
      <Checklist
        items={items}
        pack={pack}
        state={state}
        ticked={new Set()}
        onToggle={(keys, on, tally) => committed.push([keys, on, tally])}
      />,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(committed).toEqual([[["0:o0", "0:o1"], true, undefined]]);
    expect(ticksToFinish(items, pack, state, new Set())).toEqual([{ items: committed[0]![0] }]);
  });

  it("commits what a click commits where a rule carries one of the rows", () => {
    const tallied = [
      { text: "Every Mutation has been honored.", shows: { table: "mutation", scope: "unit" }, tally: "setbacksSuffered" },
    ] as never;
    const onTheRule = {
      owing: () => false,
      settled: () => false,
      answered: (s: Shown) => s.entryId === "cull",
      hidden: (s: Shown) => s.entryId === "cull",
    };
    const committed: Array<[string[], boolean, string | undefined]> = [];
    render(
      <Checklist
        items={tallied}
        pack={pack}
        state={state}
        ticked={new Set()}
        onToggle={(keys, on, tally) => committed.push([keys, on, tally])}
        settling={onTheRule}
      />,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    // The point's own box reaches only the row it draws, and carries the
    // counter; the row it does not draw is the Constraints panel's to tick,
    // and that box passes no tally at all.
    expect(committed).toEqual([[["0:o1"], true, "setbacksSuffered"]]);
    const groups = ticksToFinish(tallied, pack, state, new Set(), onTheRule);
    expect(groups[0]).toEqual({ items: committed[0]![0], tally: committed[0]![2] });
    expect(groups[1]).toEqual({ items: ["0:o0"] });
  });
});
