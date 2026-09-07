import { describe, expect, it } from "vitest";
import { effectiveEvents, type RunEvent } from "@runlog/engine";
import { drawAgainEvents, drawIsLast } from "./redraw.ts";

const at = "2026-09-06T12:00:00.000Z";
const started: RunEvent = { t: "RunStarted", at, id: "e0", packId: "p", packVersion: "1", runId: "r", mode: "standard" };
const entered: RunEvent = { t: "UnitEntered", at, id: "e1" };
const rolled: RunEvent = { t: "Rolled", at, id: "e2", purpose: "u1:twist", dice: "d6", total: 4, values: [4], source: "physical" };
const resolved: RunEvent = { t: "OutcomeResolved", at, id: "e3", table: "twist", entryId: "t4", cause: "phase" };
const done: RunEvent = { t: "StepCompleted", at, id: "e4", phase: "draw", step: 0 };

describe("drawing again", () => {
  it("unmakes exactly the draw's events and says why", () => {
    const events = drawAgainEvents({ ids: ["e2", "e3", "e4"] }, at, " no partner today ");
    expect(events).toEqual([
      { t: "Undone", at, ids: ["e2", "e3", "e4"] },
      { t: "Corrected", at, note: "drew again: no partner today" },
    ]);
    const log = [started, entered, rolled, resolved, done, ...events];
    const live = effectiveEvents(log).map((e) => e.id);
    expect(live).toEqual(["e0", "e1", undefined]);
    expect(effectiveEvents(log).at(-1)?.t).toBe("Corrected");
  });

  it("needs no reason", () => {
    expect(drawAgainEvents({ ids: ["e2"] }, at)[1]).toMatchObject({ note: "drew again" });
    expect(drawAgainEvents({ ids: ["e2"] }, at, "   ")[1]).toMatchObject({ note: "drew again" });
  });

  it("is offered only while the draw is the last thing that happened", () => {
    const draw = { ids: ["e2", "e3", "e4"] };
    expect(drawIsLast([started, entered, rolled, resolved, done], draw)).toBe(true);
    // Something since.
    const checked: RunEvent = { t: "Checked", at, id: "e5", step: "do#0", item: "x", on: true };
    expect(drawIsLast([started, entered, rolled, resolved, done, checked], draw)).toBe(false);
    // Already undone.
    expect(drawIsLast([started, entered, rolled, resolved, done, { t: "Undone", at, id: "e6", ids: draw.ids }], draw)).toBe(false);
    expect(drawIsLast([started, entered], draw)).toBe(false);
    expect(drawIsLast([started, entered, rolled], null)).toBe(false);
  });
});
