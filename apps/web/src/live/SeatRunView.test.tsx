// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SeatStrip } from "./SeatStrip.tsx";

/**
 * The strip a seated player presses, drawn from the offer the run's own
 * page published.
 */

afterEach(cleanup);

const offer = {
  seq: 4,
  primary: { id: "roll" as const, label: "Roll the kiln", kind: "rollTable" },
  moves: [{ id: "temper", label: "Temper it" }],
  undo: null,
  needsPage: null,
  presets: [],
  setups: [],
  commands: [],
  trackers: [{ id: "cracks", kind: "counter" as const, label: "Cracks", value: 2, max: null }],
  clock: null,
  autoRoll: false,
  ending: null,
};

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("the strip a seat presses", () => {
  it("draws the primary, the moves and the trackers from the offer", () => {
    render(<SeatStrip offer={offer} seating="table" held={true} note={null} onPress={() => {}} />);
    expect(button("Roll the kiln").disabled).toBe(false);
    expect(button("Temper it").disabled).toBe(false);
    expect(screen.getByText("Cracks")).toBeTruthy();
  });

  it("goes quiet while nobody has the run open", () => {
    render(<SeatStrip offer={offer} seating="table" held={false} note={null} onPress={() => {}} />);
    expect(button("Roll the kiln").disabled).toBe(true);
    expect(screen.getByText("Waiting for the run to be opened.")).toBeTruthy();
  });

  it("leaves the primary and the moves off a solo pack, and keeps the trackers", () => {
    render(<SeatStrip offer={offer} seating="solo" held={true} note={null} onPress={() => {}} />);
    expect(screen.queryByRole("button", { name: "Roll the kiln" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Temper it" })).toBeNull();
    expect(screen.getByText("Cracks")).toBeTruthy();
  });

  it("says what came back from the page", () => {
    render(<SeatStrip offer={offer} seating="table" held={true} note="That moved on." onPress={() => {}} />);
    expect(screen.getByText("That moved on.")).toBeTruthy();
  });

  it("waits with nothing to offer until the run's page has published one", () => {
    render(<SeatStrip offer={undefined} seating="table" held={true} note={null} onPress={() => {}} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("what a press says", () => {
  /** The offer with what a step is asking on it: a subject to name, and a list to tick. */
  const asking = {
    ...offer,
    presets: [
      { kind: "declareSubject", label: "Name it", suggestions: ["a bowl", "a jar"] },
      { kind: "checklist", label: "Tick them all", items: 3 },
    ],
  };

  it("names the primary and the move it was pressed for", () => {
    const pressed: unknown[] = [];
    render(<SeatStrip offer={offer} seating="table" held={true} note={null} onPress={(p) => pressed.push(p)} />);
    fireEvent.click(button("Roll the kiln"));
    fireEvent.click(button("Temper it"));
    expect(pressed).toEqual([{ press: "primary" }, { press: "move", move: "temper" }]);
  });

  it("carries the step's own answer: a subject, a list ticked, a tally moved", () => {
    const pressed: unknown[] = [];
    render(<SeatStrip offer={asking} seating="solo" held={true} note={null} onPress={(p) => pressed.push(p)} />);
    fireEvent.click(button("a jar"));
    fireEvent.click(button("Tick everything"));
    fireEvent.click(button("Cracks up one"));
    fireEvent.click(button("Cracks down one"));
    expect(pressed).toEqual([
      { press: "answer", answer: { subject: "a jar" } },
      { press: "answer", answer: { ticks: "all" } },
      { press: "answer", answer: { tracker: "cracks", by: 1 } },
      { press: "answer", answer: { tracker: "cracks", by: -1 } },
    ]);
  });

  it("names each end of a tally, since a minus and a plus alone say nothing", () => {
    render(<SeatStrip offer={offer} seating="table" held={true} note={null} onPress={() => {}} />);
    expect(button("Cracks up one").textContent).toBe("+");
    expect(button("Cracks down one").disabled).toBe(false);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("presses nothing while nobody holds the run", () => {
    const pressed: unknown[] = [];
    render(<SeatStrip offer={asking} seating="table" held={false} note={null} onPress={(p) => pressed.push(p)} />);
    for (const b of screen.getAllByRole("button")) fireEvent.click(b);
    expect(pressed).toEqual([]);
  });
});
