import { describe, expect, it } from "vitest";
import { offerOf } from "./offer.ts";

const base = {
  seq: 42,
  live: true,
  settled: true,
  receipts: false,
  step: null,
  stepLabel: null,
  request: null,
  moves: [],
  canUndo: false,
  lastResult: null,
  owed: 0,
  due: [],
  suggestions: [],
  between: null,
  finishLabel: null,
  setups: [],
  commands: [],
  trackers: [],
  clock: null,
  autoRoll: false,
  ending: null,
};

const glaze = { id: "glaze", kind: "resource" as const, label: "Glaze", value: 3, max: 6 };
const calm = { id: "calm", kind: "counter" as const, label: "Calm streak", value: 2, max: null };

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

  // Task 20: the deck's Next used to go dim exactly where the page shows
  // the step's receipts, because the offer knew nothing of them. Now it
  // sees what the page shows: Carry on.
  it("offers carry-on for the receipts waiting to be read", () => {
    const offer = offerOf({ ...base, receipts: true, step: { kind: "rollTable" } as never, stepLabel: "Roll the Weather" });
    expect(offer.primary).toEqual({ id: "carry-on", label: "Carry on", kind: "receipt" });
    expect(offer.needsPage).toBeNull();
    expect(offer.presets).toEqual([]);
  });

  it("offers nothing for the receipts on a run that is not live", () => {
    const offer = offerOf({ ...base, live: false, receipts: true, step: { kind: "rollTable" } as never, stepLabel: "Roll" });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Open the run on the page");
  });

  /*
   * Task 16a: a key may put the run under one of the setups the page
   * would offer. They are handed in rather than worked out here, so all
   * this asks is that they reach the deck the way they were given.
   */
  it("carries the setups the run could be played under", () => {
    const offer = offerOf({ ...base, setups: [{ id: "com.example.setups.starter", title: "Starter" }] });
    expect(offer.setups).toEqual([{ id: "com.example.setups.starter", title: "Starter" }]);
  });

  it("offers no setup on a run that is not live", () => {
    const offer = offerOf({ ...base, live: false, setups: [{ id: "com.example.setups.starter", title: "Starter" }] });
    expect(offer.setups).toEqual([]);
  });

  /*
   * Task 28b: the same files again, as things to hand the tool once. A
   * list of their own, so a deck knows which ids either key may name.
   */
  it("carries the commands a key may hand the tool", () => {
    const offer = offerOf({ ...base, commands: [{ id: "com.example.setups.starter", title: "Starter" }] });
    expect(offer.commands).toEqual([{ id: "com.example.setups.starter", title: "Starter" }]);
  });

  it("offers no command on a run that is not live", () => {
    const offer = offerOf({ ...base, live: false, commands: [{ id: "com.example.setups.starter", title: "Starter" }] });
    expect(offer.commands).toEqual([]);
  });

  // Review finding: moves and undo escaped the live gate, and they are
  // the two a press can take without consulting the primary at all.
  it("offers no move and no undo on a run that is not live", () => {
    const offer = offerOf({
      ...base,
      live: false,
      moves: [{ id: "died", label: "Died" }],
      canUndo: true,
      lastResult: "A dry wind from the east.",
    });
    expect(offer.moves).toEqual([]);
    expect(offer.undo).toBeNull();
    expect(offer.needsPage).toBe("Open the run on the page");
  });

  it("will not close a unit with something owed", () => {
    const offer = offerOf({ ...base, step: { kind: "finalizeUnit" } as never, stepLabel: "Close Day 4", owed: 1 });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Something is owed; settle it on the page");
  });

  /*
   * Task 25: a counter threshold left pending was carried into the next
   * scene, out of the page's own closing button and out of a deck's Next.
   * What the game is owed is now the press rather than a dim key.
   */
  const overheating = { id: "calm#0", label: "The Kiln overheats: Roll d100", kind: "threshold" as const };

  it("offers what the game is owed, in the words of the page's own button", () => {
    const offer = offerOf({ ...base, due: [overheating], step: { kind: "finalizeUnit" } as never, stepLabel: "Close Day 4" });
    expect(offer.primary).toEqual({ id: "owed", label: "The Kiln overheats: Roll d100", kind: "threshold" });
    expect(offer.needsPage).toBeNull();
    expect(offer.presets).toEqual([]);
  });

  it("takes the first of them, and leaves the moves and the undo on offer", () => {
    const offer = offerOf({
      ...base,
      due: [overheating, { id: "g#0", label: "The Cooling: Roll d10", kind: "global" }],
      moves: [{ id: "died", label: "Died" }],
      canUndo: true,
      lastResult: "A dry wind from the east.",
    });
    expect(offer.primary).toMatchObject({ id: "owed", kind: "threshold" });
    expect(offer.moves).toEqual([{ id: "died", label: "Died" }]);
    expect(offer.undo).toEqual({ what: "A dry wind from the east." });
  });

  it("will not enter the next unit with something the game is owed", () => {
    const offer = offerOf({ ...base, due: [overheating], between: "Enter Day 5" });
    expect(offer.primary).toMatchObject({ id: "owed" });
  });

  it("will not enter the next unit with something owed", () => {
    const offer = offerOf({ ...base, between: "Enter Day 5", owed: 1 });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Something is owed; settle it on the page");
  });

  // The two carve-outs, kept as they were: a typed step still offers the
  // preset that answers it, and a step waiting on dice is still a throw
  // rather than a decision, whatever is owed elsewhere on the page.
  it("leaves a typed step its own preset with something owed", () => {
    const offer = offerOf({ ...base, step: { kind: "declareSubject" } as never, stepLabel: "Name the bowl", owed: 1 });
    expect(offer.presets).toEqual([{ kind: "declareSubject", label: "Name the bowl" }]);
  });

  it("still throws the dice a step is waiting on with something owed", () => {
    const offer = offerOf({
      ...base,
      settled: false,
      request: { kind: "roll", label: "Roll the Weather" },
      step: { kind: "rollTable" } as never,
      stepLabel: "Roll the Weather",
      owed: 1,
    });
    expect(offer.primary).toEqual({ id: "roll", label: "Roll the Weather", kind: "rollTable" });
  });

  /*
   * Fix round 1: firing a trigger begins a block of its own, and `begin`
   * writes over whatever was pending, so this press offered mid-throw
   * would have thrown the run's own dice request away.
   */
  it("offers the roll a step is waiting on before what the game is owed", () => {
    const offer = offerOf({
      ...base,
      due: [overheating],
      settled: false,
      request: { kind: "roll", label: "Roll the Weather" },
      step: { kind: "rollTable" } as never,
      stepLabel: "Roll the Weather",
    });
    expect(offer.primary).toEqual({ id: "roll", label: "Roll the Weather", kind: "rollTable" });
  });

  it("offers what the game is owed once the dice have landed", () => {
    const offer = offerOf({ ...base, due: [overheating], step: { kind: "rollTable" } as never, stepLabel: "Roll the Weather" });
    expect(offer.primary).toEqual({ id: "owed", label: "The Kiln overheats: Roll d100", kind: "threshold" });
  });

  it("offers nothing the game is owed on a run nobody is playing", () => {
    const offer = offerOf({ ...base, live: false, due: [overheating] });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Open the run on the page");
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

  // Live testing, 2026-09-14: the follow key died exactly at a roll step,
  // because an unsettled step was always sent back to the page. A pending
  // roll is nobody being asked to judge anything, only to throw dice, and a
  // deck can do that the same way the page's own "Roll for me" does.
  it("offers the roll when the page is waiting on one", () => {
    const offer = offerOf({
      ...base,
      settled: false,
      step: { kind: "rollTable" } as never,
      stepLabel: "Roll the Weather",
      request: { kind: "roll", label: "Draw a curse" },
    });
    expect(offer.primary).toEqual({ id: "roll", label: "Draw a curse", kind: "rollTable" });
    expect(offer.needsPage).toBeNull();
  });

  it("still sends an unsettled step back to the page when it is waiting on something else", () => {
    const offer = offerOf({
      ...base,
      settled: false,
      step: { kind: "declareSubject" } as never,
      stepLabel: "Name the bowl",
      request: { kind: "other" },
    });
    expect(offer.primary).toBeNull();
    expect(offer.needsPage).toBe("Name the bowl on the page");
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

  /*
   * Task 12: the list still needs reading, so the follow key still says so.
   * A named key the streamer chose to put there may carry the whole list
   * and the step's own button, which is what the preset is.
   */
  it("offers ticking the whole list and pressing Done on a manual checklist", () => {
    const offer = offerOf({
      ...base,
      step: { kind: "manual", checklist: [{ text: "Matches the roll" }, { text: "Signed it" }] } as never,
      stepLabel: "Sketch the room",
      finishLabel: "Done",
    });
    expect(offer.needsPage).toBe("Sketch the room on the page");
    expect(offer.presets).toEqual([{ kind: "checklist", label: "Tick everything and Done", items: 2 }]);
  });

  it("offers it on a closing step in the closing button's own words", () => {
    const offer = offerOf({
      ...base,
      step: { kind: "finalizeUnit", confirm: [{ text: "Honored the constraint" }] } as never,
      stepLabel: "Close Day 4",
      finishLabel: "Next Day 5",
    });
    expect(offer.needsPage).toBe("Close Day 4 on the page");
    expect(offer.presets).toEqual([{ kind: "checklist", label: "Tick everything and Next Day 5", items: 1 }]);
  });

  it("will not offer it with something owed", () => {
    const offer = offerOf({
      ...base,
      step: { kind: "manual", checklist: [{ text: "Matches the roll" }] } as never,
      stepLabel: "Sketch the room",
      finishLabel: "Done",
      owed: 1,
    });
    expect(offer.presets).toEqual([]);
  });

  // The page's own button is what the preset presses, so a step whose
  // button this device cannot name is not one a key may press blind.
  it("will not offer it without a button to press at the end", () => {
    const offer = offerOf({
      ...base,
      step: { kind: "manual", checklist: [{ text: "Matches the roll" }] } as never,
      stepLabel: "Sketch the room",
    });
    expect(offer.presets).toEqual([]);
  });

  it("counts only the points the step waits for", () => {
    const offer = offerOf({
      ...base,
      step: { kind: "manual", checklist: [{ text: "Matches the roll" }, { text: "Photograph it", optional: true }] } as never,
      stepLabel: "Sketch the room",
      finishLabel: "Done",
    });
    expect(offer.presets[0]).toMatchObject({ items: 1 });
  });
});

/*
 * Task 24a: the four things on the page that are not the step. Each is
 * handed in by the page, so all this asks of the offer is that it carries
 * them through while the run is being played and holds them back while it
 * is not -- the same live gate the moves, the undo and the setups are
 * under, for the same reason.
 */
describe("the dials, the clock, the dice and the ending", () => {
  it("carries the tallies and the dials the page shows", () => {
    const offer = offerOf({ ...base, trackers: [glaze, calm] });
    expect(offer.trackers).toEqual([glaze, calm]);
  });

  it("carries the clock the page's own buttons act on", () => {
    const offer = offerOf({ ...base, clock: { id: "u4:unit", label: "Day 4", status: "running" } });
    expect(offer.clock).toEqual({ id: "u4:unit", label: "Day 4", status: "running" });
  });

  it("says whether the app is throwing the dice", () => {
    expect(offerOf({ ...base, autoRoll: true }).autoRoll).toBe(true);
    expect(offerOf({ ...base }).autoRoll).toBe(false);
  });

  it("carries the ending in the words of the page's own button", () => {
    const offer = offerOf({ ...base, ending: { label: "Finish the firing" } });
    expect(offer.ending).toEqual({ label: "Finish the firing" });
  });

  it("offers none of the four on a run that is not live", () => {
    const offer = offerOf({
      ...base,
      live: false,
      trackers: [glaze, calm],
      clock: { id: "u4:unit", label: "Day 4", status: "running" },
      autoRoll: true,
      ending: { label: "Finish the firing" },
    });
    expect(offer.trackers).toEqual([]);
    expect(offer.clock).toBeNull();
    expect(offer.autoRoll).toBe(false);
    expect(offer.ending).toBeNull();
  });

  // The receipts of a step's own throws are a screen the page puts over
  // the step, not a run in another state: a dial is still a dial behind
  // it, and the run's Finish button is on that very screen.
  it("goes on offering them while the receipts wait to be read", () => {
    const offer = offerOf({
      ...base,
      receipts: true,
      trackers: [glaze],
      clock: { id: "u4:unit", label: "Day 4", status: "paused" },
      ending: { label: "Finish the firing" },
    });
    expect(offer.trackers).toEqual([glaze]);
    expect(offer.clock).toEqual({ id: "u4:unit", label: "Day 4", status: "paused" });
    expect(offer.ending).toEqual({ label: "Finish the firing" });
  });

  // And behind a step that is still asking something: a deck turning a
  // dial is not answering the step, so what the step wants does not
  // decide whether the dial may be turned.
  it("goes on offering them on a step that wants the page", () => {
    const offer = offerOf({
      ...base,
      step: { kind: "declareSubject" } as never,
      stepLabel: "Name the bowl",
      trackers: [calm],
      autoRoll: true,
    });
    expect(offer.needsPage).toBe("Name the bowl on the page");
    expect(offer.trackers).toEqual([calm]);
    expect(offer.autoRoll).toBe(true);
  });
});
