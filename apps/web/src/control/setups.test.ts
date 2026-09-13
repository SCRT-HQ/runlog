import { describe, expect, it } from "vitest";
import type { Setup } from "@runlog/rules-schema";
import { chose, chosenFrom, forTool, shippedSetups, withChosen } from "./setups.ts";
import type { ControlProfile } from "./profile.ts";

/**
 * Setups, from the files on the shelf to the frame a tool is sent.
 *
 * The interesting claims are at the two ends. At one end, every setup
 * this repository ships has to be readable by the app, not only by the
 * validator the CLI runs. At the other, a setup has to reach a tool
 * through the field that was already there, without the server having
 * learned a second way to be told what a run starts under.
 */

const setup = (over: Partial<Setup> = {}): Setup => ({
  kind: "setup",
  schemaVersion: 1,
  id: "com.example.setups.one",
  version: "1.0.0",
  title: "One",
  tool: "TarnishedTool",
  ops: [{ op: "flag.set", args: { name: "player.noRoll", value: true } }],
  ...over,
});

describe("the setups we ship", () => {
  it("all load, because a shelf with a hole in it is a bug here, not there", async () => {
    const all = await shippedSetups();
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.title, `${s.id} should have a title`).toBeTruthy();
      expect(s.tool, `${s.id} should name its tool`).toBeTruthy();
      expect(s.ops.length, `${s.id} should do something`).toBeGreaterThan(0);
    }
  });

  it("are offered by tool rather than by pack, which is why they are their own document", async () => {
    const all = await shippedSetups();
    expect(forTool(all, "TarnishedTool").length).toBeGreaterThan(0);
    // Case is how a tool spells its own name, not a thing to fail over.
    expect(forTool(all, "tarnishedtool").length).toBe(forTool(all, "TarnishedTool").length);
    expect(forTool(all, "SomeOtherTool")).toEqual([]);
    // A run talking to anything that listens is offered nothing: an op
    // meant for one game reaching another moves somebody for no reason.
    expect(forTool(all, undefined)).toEqual([]);
  });
});

describe("what a run keeps", () => {
  it("copies the operations rather than pointing at the file they came from", () => {
    const original = setup();
    const kept = chose(original);
    original.ops[0]!.args = { name: "changed" };
    expect(kept.ops[0]?.args).toEqual({ name: "player.noRoll", value: true });
    expect(kept).toMatchObject({ id: original.id, version: "1.0.0", title: "One" });
  });

  it("reads one back off a record, and refuses what is not one", () => {
    const kept = chose(setup({ ops: [{ op: "runes.give", args: { amount: 50000 }, once: true }] }));
    expect(chosenFrom(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(chosenFrom(null)).toBeNull();
    expect(chosenFrom({ id: "x", title: "X", version: "1" })).toBeNull();
    expect(chosenFrom({ ...kept, ops: [{ notAnOp: true }] })).toBeNull();
  });

  it("keeps `once`, which is the whole difference between a setting and a gift", () => {
    const kept = chose(setup({ ops: [{ op: "flag.set", args: { name: "x" } }, { op: "runes.give", args: { amount: 1 }, once: true }] }));
    const read = chosenFrom(JSON.parse(JSON.stringify(kept)));
    expect(read?.ops[0]?.once).toBeUndefined();
    expect(read?.ops[1]?.once).toBe(true);
  });
});

describe("what a tool is sent", () => {
  const profile: ControlProfile = { tool: "TarnishedTool", setup: [{ op: "flag.set", args: { name: "world.noCutscenes", value: true } }], rows: [] };

  it("puts the run's setup in the terms, so the server needs to know nothing new", () => {
    const merged = withChosen(profile, chose(setup({ ops: [{ op: "runes.give", args: { amount: 50000 }, once: true }] })));
    expect(merged.setup).toEqual([
      { op: "flag.set", args: { name: "world.noCutscenes", value: true } },
      { op: "runes.give", args: { amount: 50000 }, once: true },
    ]);
    // Only the terms change. The rules are the pack author's business.
    expect(merged.rows).toBe(profile.rows);
  });

  it("applies the player's choice after the author's, so the choice wins", () => {
    const merged = withChosen(profile, chose(setup({ ops: [{ op: "flag.set", args: { name: "world.noCutscenes", value: false } }] })));
    expect(merged.setup?.at(-1)?.args).toEqual({ name: "world.noCutscenes", value: false });
  });

  it("leaves a profile alone when there is no setup to fold in", () => {
    expect(withChosen(profile, null)).toBe(profile);
  });

  it("gives a run with a setup and no profile something to send", () => {
    const merged = withChosen({}, chose(setup()));
    expect(merged.setup).toHaveLength(1);
  });
});
