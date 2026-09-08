import { describe, expect, it } from "vitest";
import type { RunState } from "@runlog/engine";
import { ticksFor } from "./stepChecks.ts";

/**
 * `ticksFor` is what both the page's step card and the floating remote read
 * a step's ticked boxes from — lifted out so a change to how boxes are keyed
 * cannot happen in one place and not the other.
 */
const state = (checks: string[]) => ({ checks } as unknown as RunState);

describe("ticksFor", () => {
  it("reads back only this step's boxes, by their item key", () => {
    const ticked = ticksFor(state(["work#0|0", "work#0|1:o3", "close#0|0"]), "work#0");
    expect(ticked).toEqual(new Set(["0", "1:o3"]));
  });

  it("is empty when nothing on this step has been ticked", () => {
    expect(ticksFor(state(["close#0|0"]), "work#0")).toEqual(new Set());
  });

  it("does not confuse one step's key with a prefix of another's", () => {
    // "work#1" starts with "work#" the same as "work#10" would — the pipe
    // after the key is what keeps them apart.
    const ticked = ticksFor(state(["work#1|0", "work#10|0"]), "work#1");
    expect(ticked).toEqual(new Set(["0"]));
  });
});
