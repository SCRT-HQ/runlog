import { describe, expect, it } from "vitest";
import { offerOf } from "./offer.ts";

const base = {
  seq: 42,
  live: true,
  settled: true,
  step: null,
  stepLabel: null,
  moves: [],
  canUndo: false,
  lastResult: null,
  owed: 0,
  suggestions: [],
  between: null,
};

describe("offerOf", () => {
  it("offers the roll when a table is waiting", () => {
    const offer = offerOf({ ...base, step: { kind: "rollTable" } as never, stepLabel: "Roll the Weather" });
    expect(offer.primary).toEqual({ id: "roll", label: "Roll the Weather", kind: "rollTable" });
    expect(offer.needsPage).toBeNull();
  });

  it("sends a step that needs typing back to the page", () => {
    const offer = offerOf({ ...base, step: { kind: "declareSubject" } as never, stepLabel: "Name the bowl" });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Name the bowl on the page");
    expect(offer.presets).toEqual([{ kind: "declareSubject", label: "Name the bowl" }]);
  });

  it("names what undo would take back", () => {
    const offer = offerOf({ ...base, canUndo: true, lastResult: "A dry wind from the east." });
    expect(offer.undo).toEqual({ what: "A dry wind from the east." });
  });

  it("offers nothing on a run that is not live", () => {
    const offer = offerOf({ ...base, live: false, step: { kind: "rollTable" } as never, stepLabel: "Roll" });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Open the run on the page");
  });

  it("will not close a unit with something owed", () => {
    const offer = offerOf({ ...base, step: { kind: "finalizeUnit" } as never, stepLabel: "Close Day 4", owed: 1 });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Something is owed; settle it on the page");
  });

  // Controller ruling: a manual step with nothing to confirm asks nothing,
  // so a key can carry it on the same as a table roll.
  it("offers carry-on for a manual step with nothing to confirm", () => {
    const offer = offerOf({ ...base, step: { kind: "manual" } as never, stepLabel: "Sketch the room" });
    expect(offer.primary).toEqual({ id: "carry-on", label: "Sketch the room", kind: "manual" });
    expect(offer.needsPage).toBeNull();
  });

  // Controller ruling: a manual step with a checklist is genuinely asking
  // something, so it goes back to the page like declareSubject does.
  it("sends a manual step with a checklist back to the page", () => {
    const offer = offerOf({
      ...base,
      step: { kind: "manual", checklist: [{ text: "Matches the roll" }] } as never,
      stepLabel: "Sketch the room",
    });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Sketch the room on the page");
  });

  // Controller ruling: a finalizeUnit with confirmation items is the same
  // kind of ask as manual's checklist, not a bare close.
  it("sends a finalizeUnit with confirmation items back to the page", () => {
    const offer = offerOf({
      ...base,
      step: { kind: "finalizeUnit", confirm: [{ text: "Honored the constraint" }] } as never,
      stepLabel: "Close Day 4",
    });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Close Day 4 on the page");
  });

  // Review finding: a manual step marked closesUnit is routed to the page's
  // ClosingStep, whose button writes the close, not a step's own carry-on.
  it("offers the close, not carry-on, for a manual step that closes the unit", () => {
    const offer = offerOf({
      ...base,
      step: { kind: "manual", closesUnit: true } as never,
      stepLabel: "Close Day 4",
    });
    expect(offer.primary).toEqual({ id: "close", label: "Close Day 4", kind: "manual" });
    expect(offer.needsPage).toBeNull();
  });

  // Review finding: owed used to be checked after the manual branch had
  // already returned, so a closing manual step skipped it entirely.
  it("will not close a unit-closing manual step with something owed", () => {
    const offer = offerOf({
      ...base,
      step: { kind: "manual", closesUnit: true } as never,
      stepLabel: "Close Day 4",
      owed: 1,
    });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Something is owed; settle it on the page");
  });

  // Self-review: settled is a declared input; an unsettled step is not
  // pressable, the same way closesTheUnit refuses an unsettled unit.
  it("will not offer a step that is not yet settled", () => {
    const offer = offerOf({ ...base, settled: false, step: { kind: "rollTable" } as never, stepLabel: "Roll the Weather" });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Roll the Weather on the page");
  });

  // Controller ruling: between units, the page's own button is the primary
  // press too, in its own words.
  it("offers the page's between-units button as the primary", () => {
    const offer = offerOf({ ...base, between: "Enter Day 5" });
    expect(offer.primary).toEqual({ id: "enter", label: "Enter Day 5", kind: "between" });
    expect(offer.needsPage).toBeNull();
  });

  it("offers nothing between units when the page has no between-units button", () => {
    const offer = offerOf({ ...base, between: null });
    expect(offer.primary).toBeNull();
  });
});
