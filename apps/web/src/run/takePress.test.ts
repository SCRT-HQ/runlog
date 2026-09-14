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
});
