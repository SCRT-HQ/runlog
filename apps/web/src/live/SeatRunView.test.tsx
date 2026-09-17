// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SeatStrip } from "./SeatStrip.tsx";
import { SeatRunView } from "./SeatRunView.tsx";
import type { Seat, SeatSnapshot } from "./useSeat.ts";
import type { Gesture } from "../sync/socket.ts";
import { AccountContext, type Account } from "../auth/Account.tsx";

/**
 * The strip a seated player presses, drawn from the offer the run's own
 * page published.
 */

vi.mock("../sync/useApi.ts", () => ({ useApi: () => null }));

const current = vi.hoisted(() => ({ seat: undefined as unknown as Seat }));
vi.mock("./useSeat.ts", () => ({ useSeat: () => current.seat }));

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

const snapshot: SeatSnapshot = {
  v: 1,
  at: "2026-09-16T00:00:00Z",
  packId: "com.example.kiln",
  packTitle: "The Long Kiln",
  runName: null,
  mode: "Standard",
  words: { run: "Firing", unit: "Stage", units: "Stages" },
  status: "active",
  ending: null,
  unit: 1,
  where: "Shape",
  step: "Throw the piece",
  phases: [],
  quoted: true,
  standings: [],
  contestants: 0,
  subjects: [],
  counters: [],
  resources: [],
  clocks: [],
  progress: { unitsDone: 0, elapsedMs: 0, timed: false },
  score: { label: "Stages closed", text: "0 stages", value: 0, better: "higher" },
  forcedUnits: 0,
  log: [],
  paper: { summary: { kind: "summary", layout: "book", title: "The Long Kiln", blocks: [] }, mode: null },
  offer,
};

/** Somebody signed in, since a seat is on an account and the page says so first. */
const me: Account = {
  status: "signed-in",
  user: { id: "user_ME" },
  signOut: () => {},
  getAccessToken: async () => "t",
} as unknown as Account;

/** The page, as whoever is sitting in the seat. */
const page = () =>
  render(
    <AccountContext.Provider value={me}>
      <SeatRunView id="01RUN" players={2} />
    </AccountContext.Provider>,
  );

/** The seat, with whatever the table has just said on it. */
const seated = (gesture: Gesture | null = null): Seat => ({
  view: {
    found: true,
    run: {
      id: "01RUN",
      packId: "com.example.kiln",
      packTitle: "The Long Kiln",
      name: null,
      seq: 1,
      updatedAt: "2026-09-16T00:00:00Z",
      endedAt: null,
    },
    snapshot: null,
    listing: null,
    reactions: [],
  },
  snapshot,
  held: true,
  note: null,
  stale: false,
  gesture,
  press: () => {},
});

/**
 * The page a seat opens: even holding a snapshot with the pack's own paper
 * on it, this page never draws a way to that paper. Docs, export and the
 * Designer belong to the device that holds the pack, and a seat never does.
 */
describe("what a seat's page never shows", () => {
  it("has no paper, no export and no way into the Designer", () => {
    current.seat = seated();
    page();
    expect(screen.queryByRole("button", { name: "Docs" })).toBeNull();
    expect(screen.queryByRole("button", { name: /export/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /create/i })).toBeNull();
  });
});

/**
 * Handing a setup out happens on the host's screen and lands on
 * everybody's game. A seat is playing the run rather than watching it,
 * so being re-equipped without a word is worse here than anywhere.
 */
describe("a handout, to whoever is seated", () => {
  it("says who handed out what", () => {
    current.seat = seated({
      t: "gesture",
      id: "01RUN",
      kind: "setup",
      data: { title: "Cleric" },
      from: "Mira",
      at: "2026-09-16T00:00:01Z",
    });
    page();
    expect(screen.getByRole("status").textContent).toBe("Mira handed out Cleric.");
  });

  it("says nothing for a gesture that is not one", () => {
    current.seat = seated({ t: "gesture", id: "01RUN", kind: "rolled", data: { total: 14 }, from: "Mira", at: "2026-09-16T00:00:01Z" });
    page();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
