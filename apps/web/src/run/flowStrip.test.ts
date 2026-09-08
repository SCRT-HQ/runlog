import { describe, expect, it } from "vitest";
import type { Phase } from "@runlog/rules-schema";
import { flowStrip } from "./flowStrip.ts";

const phase = (id: string, label: string): Phase => ({ id, label, steps: [{ kind: "manual", label }] });
const phases = [phase("enter", "Enter the Stage"), phase("check", "Kiln Check"), phase("form", "Declare the form"), phase("fire", "Fire")];

describe("the stepper as one line", () => {
  it("says where the unit is up to and what is next", () => {
    const strip = flowStrip(phases, { phase: phases[1]! }, () => false);
    expect(strip).toEqual({ index: 2, total: 4, label: "Kiln Check", next: "Declare the form" });
  });

  it("skips over phases out of play when naming what is next", () => {
    const strip = flowStrip(phases, { phase: phases[1]! }, (p) => p.id === "form");
    expect(strip?.next).toBe("Fire");
  });

  it("has nothing to say at the end of the unit, or between units", () => {
    expect(flowStrip(phases, { phase: phases[3]! }, () => false)?.next).toBeNull();
    expect(flowStrip(phases, null, () => false)).toBeNull();
  });
});
