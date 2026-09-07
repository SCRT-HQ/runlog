import { describe, expect, it } from "vitest";
import { an } from "./describe.ts";

describe("a or an", () => {
  it("goes by the sound, not the letter", () => {
    expect(an("expedition")).toBe("an expedition");
    expect(an("Firing")).toBe("a Firing");
    expect(an("unit")).toBe("a unit");
    expect(an("hour")).toBe("an hour");
    expect(an("honest try")).toBe("an honest try");
    expect(an("one-off")).toBe("a one-off");
    expect(an("Expedition", true)).toBe("An Expedition");
    expect(an("run", true)).toBe("A run");
    expect(an("")).toBe("a ");
  });
});
