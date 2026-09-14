import { describe, expect, it } from "vitest";
import { catalogFor } from "../control/catalog.ts";
import type { ProfileOp } from "../control/profile.ts";
import { tensionLine, tensionsIn } from "./repeats.ts";

/**
 * Combining two loadouts concatenates them and merges nothing, which is
 * right: two that hand over runes meant both lots. The cost is that two
 * which unlock every grace put the same line on the list twice, and the
 * second one does nothing.
 *
 * So the question each of these asks is whether repeating a thing
 * changes anything, and the answer is the operation's business rather
 * than this file's guess.
 */

const tool = catalogFor("TarnishedTool");
const op = (o: string, args: Record<string, unknown> = {}): ProfileOp => ({ op: o, args });
const found = (ops: ProfileOp[]) => tensionsIn(tool, ops);

describe("lines in tension", () => {
  it("says nothing about a list where everything is asked once", () => {
    expect(found([op("action.invoke", { action: "UnlockDlcMaps" }), op("action.invoke", { action: "UnlockGestures" })])).toEqual([]);
  });

  /** The case that prompted this: two loadouts that both open the map. */
  it("says when the same button is pressed twice", () => {
    const ops = [
      op("action.invoke", { action: "UnlockAllMainGameGraces" }),
      op("runes.give", { amount: 1000 }),
      op("action.invoke", { action: "UnlockAllMainGameGraces" }),
    ];
    expect(found(ops)).toEqual([{ kind: "repeated", at: 2, first: 0, what: "UnlockAllMainGameGraces" }]);
    expect(tensionLine(found(ops))).toContain("asking twice changes nothing");
  });

  /**
   * Additive is the whole reason this reports rather than resolves.
   * Two loadouts that each hand over runes meant both lots, and an
   * editor that quietly kept one would be taking a decision.
   */
  it("leaves alone the things that are meant to add up", () => {
    expect(found([op("runes.give", { amount: 50000 }), op("runes.give", { amount: 50000 })])).toEqual([]);
    expect(found([op("item.named", { name: "Golden Seed", quantity: 6 }), op("item.named", { name: "Golden Seed", quantity: 6 })])).toEqual(
      [],
    );
    expect(found([op("value.add", { name: "player.vigor", value: 5 }), op("value.add", { name: "player.vigor", value: 5 })])).toEqual([]);
    expect(found([op("item.give", { id: 1073750414 }), op("item.give", { id: 1073750414 })])).toEqual([]);
  });

  /**
   * Same switch, two answers. Not a duplicate: one of them is going to
   * win and the player should know which, because the order is the
   * order they picked the loadouts in and nothing on screen says so.
   */
  it("says when one thing is set to two different values", () => {
    const ops = [op("value.set", { name: "player.vigor", value: 40 }), op("value.set", { name: "player.vigor", value: 60 })];
    expect(found(ops)).toEqual([{ kind: "disagrees", at: 1, first: 0, what: "player.vigor" }]);
    expect(tensionLine(found(ops))).toContain("The last one is what holds.");
  });

  it("counts setting the same switch to the same thing as a repeat, not a disagreement", () => {
    const ops = [op("flag.set", { name: "world.noCutscenes", value: true }), op("flag.set", { name: "world.noCutscenes", value: true })];
    expect(found(ops)[0]?.kind).toBe("repeated");
  });

  it("tells a grace apart from the same name in another place", () => {
    const ops = [
      op("warp.grace", { name: "Gravesite Plain", area: "Gravesite Plain" }),
      op("warp.grace", { name: "Gravesite Plain", area: "Gravesite Plain" }),
    ];
    expect(found(ops)[0]?.kind).toBe("repeated");
    expect(found([op("warp.grace", { name: "Church of Elleh" }), op("warp.grace", { name: "Gravesite Plain" })])).toEqual([]);
  });

  it("says nothing about an operation no catalog knows, having nothing to say", () => {
    expect(found([op("future.thing", { name: "x" }), op("future.thing", { name: "x" })])).toEqual([]);
    expect(tensionLine([])).toBeNull();
  });

  it("puts both kinds in one sentence where a list has both", () => {
    const ops = [
      op("action.invoke", { action: "UnlockDlcMaps" }),
      op("action.invoke", { action: "UnlockDlcMaps" }),
      op("value.set", { name: "player.vigor", value: 40 }),
      op("value.set", { name: "player.vigor", value: 60 }),
    ];
    const line = tensionLine(found(ops));
    expect(line).toContain("UnlockDlcMaps");
    expect(line).toContain("player.vigor");
  });
});
