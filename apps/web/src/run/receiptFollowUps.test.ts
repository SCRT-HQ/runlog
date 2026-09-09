import { describe, expect, it, vi } from "vitest";
import type { RollReceipt } from "./Receipt.tsx";
import { receiptFollowUps } from "./receiptFollowUps.ts";

/**
 * Whether a settled receipt offers more than "Carry on": the page's
 * `<Receipt>` and the floating remote both decide this from the same rule,
 * computed once here so the two cannot disagree about when to offer it.
 */
const run = (over: Partial<{ canDrawAgain: boolean; autoRoll: boolean; seededRun: boolean; readOnly: boolean }> = {}) => ({
  canDrawAgain: false,
  autoRoll: false,
  seededRun: false,
  readOnly: false,
  drawAgain: vi.fn(),
  setAutoRoll: vi.fn(),
  ...over,
});

const receipt = (machineRolled: boolean): RollReceipt => ({
  dice: null,
  total: 4,
  label: null,
  notation: "d6",
  machineRolled,
  outcomes: [],
});

describe("receiptFollowUps", () => {
  it("offers nothing before the step is settled", () => {
    expect(receiptFollowUps(run({ canDrawAgain: true }), false, receipt(true))).toEqual({});
  });

  it("offers to draw again once settled, if the run allows it", () => {
    const followUps = receiptFollowUps(run({ canDrawAgain: true }), true, receipt(false));
    expect(followUps.onDrawAgain).toBeTypeOf("function");
    expect(followUps.onKeepRolling).toBeUndefined();
  });

  it("offers to keep rolling only after a roll the machine made, and not if it already rolls by itself", () => {
    expect(receiptFollowUps(run(), true, receipt(true)).onKeepRolling).toBeTypeOf("function");
    expect(receiptFollowUps(run(), true, receipt(false)).onKeepRolling).toBeUndefined();
    expect(receiptFollowUps(run({ autoRoll: true }), true, receipt(true)).onKeepRolling).toBeUndefined();
    expect(receiptFollowUps(run({ seededRun: true }), true, receipt(true)).onKeepRolling).toBeUndefined();
  });

  it("offers neither to a watcher", () => {
    const followUps = receiptFollowUps(run({ canDrawAgain: true, readOnly: true }), true, receipt(true));
    expect(followUps).toEqual({});
  });
});
