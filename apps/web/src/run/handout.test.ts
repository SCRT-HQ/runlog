import { describe, expect, it } from "vitest";
import { handoutLine, handoutOf } from "./handout.ts";

/**
 * The press that re-equips everybody and, until now, told nobody.
 */

const credit = (id: string, title: string) => ({ id, version: "1.0.0", title });

describe("what a handout carries", () => {
  it("names the setup that was handed out, by title and by id", () => {
    expect(handoutOf({ from: [credit("com.example.setups.cleric", "Cleric")], ops: [] })).toEqual({
      title: "Cleric",
      id: "com.example.setups.cleric",
    });
  });

  it("names several the way the app says a list, and no single id", () => {
    expect(
      handoutOf({
        from: [credit("com.example.setups.cleric", "Cleric"), credit("com.example.setups.wretch", "Wretch")],
        ops: [],
      }),
    ).toEqual({ title: "Cleric and Wretch" });
  });

  it("has nothing to say about a run played under nothing", () => {
    expect(handoutOf(null)).toBeNull();
    expect(handoutOf({ from: [], ops: [] })).toBeNull();
  });
});

describe("what the table is told", () => {
  it("names who handed it out and what it was", () => {
    expect(handoutLine({ kind: "setup", data: { title: "Cleric", id: "com.example.setups.cleric" }, from: "Mira" })).toBe(
      "Mira handed out Cleric.",
    );
  });

  /** A member with no name on file leaves `from` off the line entirely. */
  it("says the host where the server had no name to stamp", () => {
    expect(handoutLine({ kind: "setup", data: { title: "Cleric" } })).toBe("The host handed out Cleric.");
  });

  it("says nothing for another kind of gesture, or for one carrying no title", () => {
    expect(handoutLine({ kind: "rolled", data: { total: 14 }, from: "Mira" })).toBeNull();
    expect(handoutLine({ kind: "setup", data: {}, from: "Mira" })).toBeNull();
    expect(handoutLine({ kind: "setup", data: { title: "  " }, from: "Mira" })).toBeNull();
    expect(handoutLine({ kind: "setup", data: { title: 7 }, from: "Mira" })).toBeNull();
  });
});
