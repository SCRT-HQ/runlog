import { describe, expect, it, vi } from "vitest";
import { takePress } from "./takePress.ts";

const offer = {
  seq: 42,
  primary: { id: "roll" as const, label: "Roll", kind: "rollTable" },
  moves: [{ id: "died", label: "I died" }],
  undo: null,
  needsPage: null,
  presets: [],
};
const acts = () => ({ primary: vi.fn(), move: vi.fn(), undo: vi.fn(), answer: vi.fn() });

describe("takePress", () => {
  it("presses the primary and says so", () => {
    const act = acts();
    expect(takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen: new Map() }, act)).toEqual({
      ok: true,
    });
    expect(act.primary).toHaveBeenCalledTimes(1);
  });

  it("refuses a press drawn from an offer the run has moved past", () => {
    const act = acts();
    const out = takePress({ from: "d", run: "s1", seq: 41, ref: "r1", press: "primary" }, { seq: 42, offer, seen: new Map() }, act);
    expect(out).toEqual({ ok: false, say: "That moved on." });
    expect(act.primary).not.toHaveBeenCalled();
  });

  it("takes the same ref twice as one press", () => {
    const act = acts();
    const seen = new Map();
    takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen }, act);
    const again = takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen }, act);
    expect(again).toEqual({ ok: true });
    expect(act.primary).toHaveBeenCalledTimes(1);
  });

  // Review finding: seen is keyed by who pressed, not the ref alone, so two
  // decks racing for the same button each move it once.
  it("takes the same ref from two different decks as two presses", () => {
    const act = acts();
    const seen = new Map();
    const a = takePress({ from: "d1", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen }, act);
    const b = takePress({ from: "d2", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen }, act);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(act.primary).toHaveBeenCalledTimes(2);
  });

  // Review finding: an act that throws (a write raced by another device,
  // most likely) still settles a verdict and spends the ref, rather than
  // leaving the deck waiting on one that will never answer.
  it("settles a throw from an act as a press that failed, and spends the ref", () => {
    const act = {
      ...acts(),
      primary: vi.fn(() => {
        throw new Error("write conflict");
      }),
    };
    const seen = new Map();
    const out = takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen }, act);
    expect(out).toEqual({ ok: false, say: "That press failed." });
    const again = takePress({ from: "d", run: "s1", seq: 42, ref: "r1", press: "primary" }, { seq: 42, offer, seen }, act);
    expect(again).toEqual({ ok: false, say: "That press failed." });
    expect(act.primary).toHaveBeenCalledTimes(1);
  });

  it("refuses a move that is no longer on offer", () => {
    const act = acts();
    const out = takePress(
      { from: "d", run: "s1", seq: 42, ref: "r1", press: "move", move: "salvage" },
      { seq: 42, offer, seen: new Map() },
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
      { seq: 42, offer: blocked, seen: new Map() },
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
      { seq: 42, offer, seen: new Map() },
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
      { seq: 42, offer: asking, seen: new Map() },
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
      { seq: 42, offer: asking, seen: new Map() },
      act,
    );
    expect(out).toEqual({ ok: true });
    expect(act.answer).toHaveBeenCalledWith({ subject: "clay bowl" });
  });
});
