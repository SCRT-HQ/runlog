import { describe, expect, it, vi } from "vitest";
import type { Pack } from "@runlog/rules-schema";
import type { RunState } from "@runlog/engine";
import { takePress } from "./takePress.ts";
import type { Offer } from "./offer.ts";
import { seatingOf } from "./seats.ts";

const offer: Offer = {
  seq: 42,
  primary: { id: "roll" as const, label: "Roll", kind: "rollTable" },
  moves: [{ id: "died", label: "I died" }],
  undo: null,
  needsPage: null,
  presets: [],
  setups: [],
  commands: [],
  trackers: [],
  clock: null,
  autoRoll: false,
  ending: null,
};
const acts = () => ({
  primary: vi.fn(),
  move: vi.fn(),
  undo: vi.fn(),
  answer: vi.fn(),
  setup: vi.fn(),
  command: vi.fn(),
  tracker: vi.fn(),
  clock: vi.fn(),
  autoRoll: vi.fn(),
  finish: vi.fn(),
});

// The table every press below is taken against. A deck's press carries no
// seat and never reads it; a seated member's press does.
const members = [
  { sub: "owner", role: "owner" as const, joinedAt: "2026-09-01T00:00:00Z", name: "Mo" },
  { sub: "ada", role: "player" as const, joinedAt: "2026-09-02T00:00:00Z", name: "Ada" },
];
const packWith = (mode: Record<string, unknown>): Pack => ({ defaultMode: "m", modes: { m: mode } }) as unknown as Pack;
const state = (mode = "m", players = 2): RunState => ({ mode, players, unit: 1 }) as unknown as RunState;
const seating = seatingOf(packWith({ players: { min: 2, max: 4 } }), state(), members, "owner");

describe("takePress", () => {
  it("presses the primary and says so", () => {
    const act = acts();
    expect(
      takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen: new Map(), seating }, act),
    ).toEqual({
      ok: true,
    });
    expect(act.primary).toHaveBeenCalledTimes(1);
  });

  it("refuses a press drawn from an offer the run has moved past", () => {
    const act = acts();
    const out = takePress(
      { from: "d", run: "s1", seq: 41, ref: "r1", press: "primary" },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "That moved on." });
    expect(act.primary).not.toHaveBeenCalled();
  });

  it("takes the same ref twice as one press", () => {
    const act = acts();
    const seen = new Map();
    takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen, seating }, act);
    const again = takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen, seating }, act);
    expect(again).toEqual({ ok: true });
    expect(act.primary).toHaveBeenCalledTimes(1);
  });

  // Review finding: seen is keyed by who pressed, not the ref alone, so two
  // decks racing for the same button each move it once.
  it("takes the same ref from two different decks as two presses", () => {
    const act = acts();
    const seen = new Map();
    const a = takePress({ from: "d1", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen, seating }, act);
    const b = takePress({ from: "d2", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen, seating }, act);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(act.primary).toHaveBeenCalledTimes(2);
  });

  // Review finding: an act that throws (a write raced by another device,
  // most likely) still settles a verdict and spends the ref, rather than
  // leaving the deck waiting on one that will never answer.
  //
  // In the act's own words where it has any: a press the page has to
  // finish says why on the key rather than as a bare failure.
  it("settles a throw from an act as a press that failed, and spends the ref", () => {
    const act = {
      ...acts(),
      primary: vi.fn(() => {
        throw new Error("Something on the list needs the page.");
      }),
    };
    const seen = new Map();
    const out = takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen, seating }, act);
    expect(out).toEqual({ ok: false, say: "Something on the list needs the page." });
    const again = takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen, seating }, act);
    expect(again).toEqual({ ok: false, say: "Something on the list needs the page." });
    expect(act.primary).toHaveBeenCalledTimes(1);
  });

  it("falls back to its own words for a throw that carries none", () => {
    const act = {
      ...acts(),
      primary: vi.fn(() => {
        throw "nothing to say";
      }),
    };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "That press failed." });
  });

  /**
   * The game's word names no offer: a death happened when it happened,
   * and is read against what is on offer when it lands. It is stamped
   * with how it arrived, so the log says the game said it.
   */
  it("takes a press that names no offer, and stamps it with where it came from", () => {
    const act = acts();
    const out = takePress(
      { from: "tool", run: "s1", ref: "r1", press: "move", move: "died", via: "the game", seat: "Mo" },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: true });
    expect(act.move).toHaveBeenCalledWith("died", { name: "Mo", via: "the game" });
    // A hand on a key carries no stamp, and the act is called as before.
    const key = acts();
    takePress({ from: "d", run: "s1", seq: 42, ref: "r2", press: "move", move: "died" }, { seq: 42, offer, seen: new Map(), seating }, key);
    expect(key.move).toHaveBeenCalledWith("died", undefined);
  });

  it("refuses a move that is no longer on offer", () => {
    const act = acts();
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "move", move: "salvage" },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "That is not on offer." });
    expect(act.move).not.toHaveBeenCalled();
  });

  it("refuses the primary when the offer says the page is needed", () => {
    const act = acts();
    const blocked = { ...offer, primary: null, needsPage: "Name the bowl on the page" };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" },
      { seq: 42, offer: blocked, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "Name the bowl on the page" });
  });

  // Review finding: an answer used to be taken against any offer at all;
  // it is only ever on offer alongside a declareSubject preset.
  it("refuses an answer the run is not asking for", () => {
    const act = acts();
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { subject: "clay bowl" } },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "The run is not asking for that." });
    expect(act.answer).not.toHaveBeenCalled();
  });

  it("refuses a blank subject", () => {
    const act = acts();
    const asking = { ...offer, primary: null, presets: [{ kind: "declareSubject", label: "Name the bowl" }] };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { subject: "  " } },
      { seq: 42, offer: asking, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "That answer was empty." });
    expect(act.answer).not.toHaveBeenCalled();
  });

  it("presses a valid subject against a declareSubject preset", () => {
    const act = acts();
    const asking = { ...offer, primary: null, presets: [{ kind: "declareSubject", label: "Name the bowl" }] };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { subject: "clay bowl" } },
      { seq: 42, offer: asking, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: true });
    expect(act.answer).toHaveBeenCalledWith({ subject: "clay bowl" });
  });

  /*
   * Task 12: a named key may tick the whole list and press the step's own
   * button. Only where the offer says the run is asking a list, though --
   * the same rule the subject preset is held to.
   */
  it("ticks everything against a checklist preset", () => {
    const act = acts();
    const asking = { ...offer, primary: null, presets: [{ kind: "checklist", label: "Tick everything and Done", items: 2 }] };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { ticks: "all" } },
      { seq: 42, offer: asking, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: true });
    expect(act.answer).toHaveBeenCalledWith({ ticks: "all" });
  });

  /*
   * Task 16a: a key applies a setup. It is on offer whatever the step is
   * doing, because it is not an answer to the step -- it is the picker in
   * Settings and the button beside it, pressed from the deck.
   */
  it("applies a setup the run is offering", () => {
    const act = acts();
    const offering = { ...offer, setups: [{ id: "com.example.setups.starter", title: "Starter" }] };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { setup: "com.example.setups.starter" } },
      { seq: 42, offer: offering, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: true });
    expect(act.setup).toHaveBeenCalledWith("com.example.setups.starter");
  });

  it("refuses a setup this run is not offering", () => {
    const act = acts();
    const offering = { ...offer, setups: [{ id: "com.example.setups.starter", title: "Starter" }] };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { setup: "com.example.setups.other" } },
      { seq: 42, offer: offering, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "That setup is not here." });
    expect(act.setup).not.toHaveBeenCalled();
  });

  it("refuses a setup on a run that is offering none", () => {
    const act = acts();
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { setup: "com.example.setups.starter" } },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "That setup is not here." });
  });

  /*
   * Task 28b: a key hands the tool one file's operations and leaves the
   * run under whatever it was already playing. Checked against its own
   * list, and refused in its own words, so a deck can tell which of the
   * two keys it pressed was the one the run would not take.
   */
  it("hands over a command the run is offering", () => {
    const act = acts();
    const offering = { ...offer, commands: [{ id: "com.example.setups.starter", title: "Starter" }] };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { command: "com.example.setups.starter" } },
      { seq: 42, offer: offering, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: true });
    expect(act.command).toHaveBeenCalledWith("com.example.setups.starter");
    expect(act.setup).not.toHaveBeenCalled();
  });

  it("refuses a command this run is not offering", () => {
    const act = acts();
    const offering = { ...offer, commands: [{ id: "com.example.setups.starter", title: "Starter" }] };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { command: "com.example.setups.other" } },
      { seq: 42, offer: offering, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "That command is not here." });
    expect(act.command).not.toHaveBeenCalled();
  });

  it("says what a command threw, so a page with no socket can say so", () => {
    const act = acts();
    act.command.mockImplementation(() => {
      throw new Error("The run is not synced.");
    });
    const offering = { ...offer, commands: [{ id: "com.example.setups.starter", title: "Starter" }] };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { command: "com.example.setups.starter" } },
      { seq: 42, offer: offering, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "The run is not synced." });
  });

  it("refuses ticking everything where nothing is asking a list", () => {
    const act = acts();
    const asking = { ...offer, primary: null, presets: [{ kind: "declareSubject", label: "Name the bowl" }] };
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer: { ticks: "all" } },
      { seq: 42, offer: asking, seen: new Map(), seating },
      act,
    );
    expect(out).toEqual({ ok: false, say: "The run is not asking for that." });
    expect(act.answer).not.toHaveBeenCalled();
  });
});

/*
 * Task 24a: the four things on the page that are not the step. Each rides
 * in the answer, because that is the only field of a press the server
 * passes through, and each is checked against the offer the way a move is.
 */
describe("the dials, the clock, the dice and the ending", () => {
  const glaze = { id: "glaze", kind: "resource" as const, label: "Glaze", value: 3, max: 6 };
  const ticking = { id: "u4:unit", label: "Day 4", status: "running" as const };
  const press = (answer: Record<string, unknown>, at: typeof offer, act: ReturnType<typeof acts>) =>
    takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "answer", answer }, { seq: 42, offer: at, seen: new Map(), seating }, act);

  it("turns a dial by a step", () => {
    const act = acts();
    expect(press({ tracker: "glaze", by: -1 }, { ...offer, trackers: [glaze] }, act)).toEqual({ ok: true });
    expect(act.tracker).toHaveBeenCalledWith("glaze", { by: -1 });
  });

  it("turns a dial to a number", () => {
    const act = acts();
    expect(press({ tracker: "glaze", to: 5 }, { ...offer, trackers: [glaze] }, act)).toEqual({ ok: true });
    expect(act.tracker).toHaveBeenCalledWith("glaze", { to: 5 });
  });

  it("refuses a tracker the run is not offering", () => {
    const act = acts();
    expect(press({ tracker: "kiln", by: 1 }, { ...offer, trackers: [glaze] }, act)).toEqual({
      ok: false,
      say: "That tracker is not here.",
    });
    expect(act.tracker).not.toHaveBeenCalled();
  });

  // A tracker named with nothing to move it by is not a press: the run
  // will not guess which way a key meant to turn it.
  it("refuses a tracker with neither a step nor a number", () => {
    const act = acts();
    expect(press({ tracker: "glaze" }, { ...offer, trackers: [glaze] }, act)).toEqual({
      ok: false,
      say: "This run does not know that press.",
    });
    expect(act.tracker).not.toHaveBeenCalled();
  });

  it("pauses and stops the clock the run is offering", () => {
    const act = acts();
    expect(press({ clock: "u4:unit", do: "pause" }, { ...offer, clock: ticking }, act)).toEqual({ ok: true });
    expect(act.clock).toHaveBeenCalledWith("u4:unit", "pause");
    const stopping = acts();
    expect(press({ clock: "u4:unit", do: "stop" }, { ...offer, clock: ticking }, stopping)).toEqual({ ok: true });
    expect(stopping.clock).toHaveBeenCalledWith("u4:unit", "stop");
  });

  it("starts a paused clock again", () => {
    const act = acts();
    expect(press({ clock: "u4:unit", do: "resume" }, { ...offer, clock: { ...ticking, status: "paused" } }, act)).toEqual({ ok: true });
    expect(act.clock).toHaveBeenCalledWith("u4:unit", "resume");
  });

  it("refuses a clock the run is not offering", () => {
    const act = acts();
    expect(press({ clock: "u4:unit", do: "pause" }, offer, act)).toEqual({ ok: false, say: "That clock is not here." });
    expect(press({ clock: "u9:unit", do: "pause" }, { ...offer, clock: ticking }, act)).toEqual({
      ok: false,
      say: "That clock is not here.",
    });
    expect(act.clock).not.toHaveBeenCalled();
  });

  it("refuses pausing a clock that is already paused, and resuming one that is running", () => {
    const act = acts();
    expect(press({ clock: "u4:unit", do: "pause" }, { ...offer, clock: { ...ticking, status: "paused" } }, act)).toEqual({
      ok: false,
      say: "That clock is not running.",
    });
    expect(press({ clock: "u4:unit", do: "resume" }, { ...offer, clock: ticking }, act)).toEqual({
      ok: false,
      say: "That clock is not paused.",
    });
    expect(act.clock).not.toHaveBeenCalled();
  });

  // The page offers a running clock or a paused one and never a stopped
  // one, so this is the press that arrives from an offer read before the
  // timer ran out: it is told what happened rather than stopping it twice.
  it("refuses stopping a clock that has stopped", () => {
    const act = acts();
    expect(press({ clock: "u4:unit", do: "stop" }, { ...offer, clock: { ...ticking, status: "done" } }, act)).toEqual({
      ok: false,
      say: "That clock has stopped.",
    });
    expect(act.clock).not.toHaveBeenCalled();
  });

  it("sets the dice to roll themselves, and to what they already were", () => {
    const act = acts();
    expect(press({ autoRoll: true }, offer, act)).toEqual({ ok: true });
    expect(act.autoRoll).toHaveBeenCalledWith(true);
    const off = acts();
    expect(press({ autoRoll: false }, offer, off)).toEqual({ ok: true });
    expect(off.autoRoll).toHaveBeenCalledWith(false);
  });

  it("ends the run where the page would offer to", () => {
    const act = acts();
    expect(press({ finish: true }, { ...offer, ending: { label: "Finish the firing" } }, act)).toEqual({ ok: true });
    expect(act.finish).toHaveBeenCalledTimes(1);
  });

  it("refuses to end a run that is not at its ending", () => {
    const act = acts();
    expect(press({ finish: true }, offer, act)).toEqual({ ok: false, say: "The run cannot end here." });
    expect(act.finish).not.toHaveBeenCalled();
  });
});

describe("a press from a seat", () => {
  it("takes the primary from a seat at a table", () => {
    const act = acts();
    const verdict = takePress(
      { from: "seat1", run: "s1", seq: 42, ref: "a", press: "primary", seat: "Ada" },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(verdict).toEqual({ ok: true });
    expect(act.primary).toHaveBeenCalledTimes(1);
  });

  it("refuses one from somebody who is not at the table, before the offer is read", () => {
    const act = acts();
    const verdict = takePress(
      { from: "seat1", run: "s1", seq: 42, ref: "b", press: "primary", seat: "Nobody" },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(verdict).toEqual({ ok: false, say: "You are not at this table." });
    expect(act.primary).not.toHaveBeenCalled();
  });

  it("takes the primary from the account behind the seat's name", () => {
    const act = acts();
    const verdict = takePress(
      { from: "seat1", run: "s1", seq: 42, ref: "d", press: "primary", seat: "Ada", who: "ada" },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(verdict).toEqual({ ok: true });
    expect(act.primary).toHaveBeenCalledTimes(1);
  });

  it("refuses one whose account is not a member, whatever name it carries", () => {
    const act = acts();
    const verdict = takePress(
      { from: "seat1", run: "s1", seq: 42, ref: "e", press: "primary", seat: "Ada", who: "stranger" },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(verdict).toEqual({ ok: false, say: "You are not at this table." });
    expect(act.primary).not.toHaveBeenCalled();
  });

  // The gate is either field, not the name alone: a member with no name
  // on file sends an id and nothing else, and a stranger sending one must
  // still be turned away rather than waved through as a deck.
  it("refuses an account that is not a member when the press carries no name at all", () => {
    const act = acts();
    const verdict = takePress(
      { from: "seat1", run: "s1", seq: 42, ref: "f", press: "primary", who: "stranger" },
      { seq: 42, offer, seen: new Map(), seating },
      act,
    );
    expect(verdict).toEqual({ ok: false, say: "You are not at this table." });
    expect(act.primary).not.toHaveBeenCalled();
  });

  it("leaves a deck's press alone: no seat, no check", () => {
    const act = acts();
    const verdict = takePress(
      { from: "deck1", run: "s1", seq: 42, ref: "c", press: "undo" },
      { seq: 42, offer: { ...offer, undo: { what: "the roll" } }, seen: new Map(), seating },
      act,
    );
    expect(verdict).toEqual({ ok: true });
    expect(act.undo).toHaveBeenCalledTimes(1);
  });
});
