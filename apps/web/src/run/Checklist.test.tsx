// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Pack } from "@runlog/rules-schema";
import type { RunState } from "@runlog/engine";
import { Checklist, checklistDone } from "./Checklist.tsx";
import type { Settling } from "./evidence.ts";

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
      <Checklist items={items} pack={pack} state={state} ticked={new Set()} onToggle={() => {}} settling={settling({ hidden: (s) => s.entryId === "cull" })} />,
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
