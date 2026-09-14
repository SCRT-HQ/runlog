import { describe, expect, it } from "vitest";
import type { Setup } from "@runlog/rules-schema";
import { chose, chosenFrom, combine, creditLine, edit, forTool, shippedSetups, withChosen } from "./setups.ts";
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

  /**
   * A name the tool does not have is a gift nobody receives.
   *
   * `item.named` takes a string and the format deliberately says nothing
   * about what is in it: the shape of an operation's arguments is the
   * tool's business, which is what lets one format serve tools nobody
   * here has heard of. The cost is that a misspelling validates, ships,
   * and then quietly hands over nothing, on the one screen where nobody
   * is looking at the app to find out.
   *
   * The lists the tool publishes are in this repository already, for the
   * pickers in Settings. So the setups we ship are held against them.
   */
  it("name only things the tool actually has", async () => {
    const lists = (await import("./lists/tarnishedtool.json", { with: { type: "json" } })).default as {
      items: Array<string | { name: string }>;
      weapons: Array<string | { name: string }>;
    };
    const nameOf = (v: string | { name: string }) => (typeof v === "string" ? v : v.name);
    const known = { items: new Set(lists.items.map(nameOf)), weapons: new Set(lists.weapons.map(nameOf)) };

    const missing: string[] = [];
    for (const s of forTool(await shippedSetups(), "TarnishedTool")) {
      for (const op of s.ops) {
        const name = (op.args as { name?: unknown } | undefined)?.name;
        if (typeof name !== "string") continue;
        if (op.op === "item.named" && !known.items.has(name)) missing.push(`${s.id}: no such item "${name}"`);
        if (op.op === "weapon.named" && !known.weapons.has(name)) missing.push(`${s.id}: no such weapon "${name}"`);
      }
    }
    expect(missing, missing.join("; ")).toEqual([]);
  });

  /**
   * A press the tool has no action for is the same silent failure as a
   * misspelled item, and arrives the same way: `action.invoke` takes a
   * string, the tool answers "not registered in this build", and the run
   * carries on having been handed nothing.
   *
   * The catalog is the list of presses this app offers, written by hand
   * against the tool's own `HotkeyActions`. So the setups are held
   * against the catalog, which is the nearest thing to that enum that
   * lives in this repository.
   */
  it("press only buttons the catalog knows", async () => {
    const { catalogFor, opDef } = await import("./catalog.ts");
    const catalog = catalogFor("TarnishedTool");
    const presses = new Set(opDef(catalog, "action.invoke")?.args.find((a) => a.name === "action")?.options ?? []);
    expect(presses.size, "the catalog should list some presses").toBeGreaterThan(0);

    const unknown: string[] = [];
    for (const s of forTool(await shippedSetups(), "TarnishedTool")) {
      for (const op of s.ops) {
        if (op.op !== "action.invoke") continue;
        const action = (op.args as { action?: unknown } | undefined)?.action;
        if (typeof action === "string" && !presses.has(action)) unknown.push(`${s.id}: no such press "${action}"`);
      }
    }
    expect(unknown, unknown.join("; ")).toEqual([]);
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
    expect(kept.from).toEqual([{ id: original.id, version: "1.0.0", title: "One" }]);
  });

  /**
   * Wanting two is the ordinary case: "a knight's armor" and "enough
   * stones to use it" are two sentences, and the run has to keep both
   * names or it cannot say afterwards what it was played under.
   */
  it("keeps several, in the order they were chosen, concatenated and not merged", () => {
    const armor = setup({
      id: "com.example.setups.armor",
      title: "Armor",
      ops: [{ op: "value.set", args: { name: "player.vigor", value: 40 } }],
    });
    const stones = setup({
      id: "com.example.setups.stones",
      title: "Stones",
      ops: [{ op: "value.set", args: { name: "player.vigor", value: 60 } }],
    });
    const both = combine([armor, stones])!;
    expect(both.from.map((f) => f.title)).toEqual(["Armor", "Stones"]);
    // Nothing is resolved: both lines stand, and a tool applying them in
    // order lands on the second. The player can see that and delete one.
    expect(both.ops).toHaveLength(2);
    expect(both.ops[1]?.args).toEqual({ name: "player.vigor", value: 60 });
    expect(combine([])).toBeNull();
  });

  /**
   * "Played under Cleric" is a fact until the operations are editable,
   * and a claim afterwards. The flag is worked out rather than asked
   * for, so an editor cannot forget to set it.
   */
  it("says whether the operations are still what the setups handed over", () => {
    const one = setup({ title: "One" });
    const kept = chose(one);
    expect(creditLine(kept)).toBe("Played under One");

    const untouched = edit(kept, one.ops, one.ops);
    expect(untouched?.edited).toBeUndefined();
    expect(creditLine(untouched)).toBe("Played under One");

    const changed = edit(kept, [...one.ops, { op: "runes.give", args: { amount: 5 }, once: true }], one.ops);
    expect(changed?.edited).toBe(true);
    expect(creditLine(changed)).toBe("Seeded from One, then edited");

    expect(creditLine(null)).toBeNull();
    // Everything deleted, and nothing was chosen: there is no choice left to keep.
    expect(edit(null, [], [])).toBeNull();
  });

  it("names several setups the way a sentence would", () => {
    const named = (titles: string[]) => creditLine(combine(titles.map((t, i) => setup({ id: `com.example.setups.s${i}`, title: t })))!);
    expect(named(["One"])).toBe("Played under One");
    expect(named(["One", "Two"])).toBe("Played under One and Two");
    expect(named(["One", "Two", "Three"])).toBe("Played under One, Two and Three");
  });

  it("reads one back off a record, and refuses what is not one", () => {
    const kept = chose(setup({ ops: [{ op: "runes.give", args: { amount: 50000 }, once: true }] }));
    expect(chosenFrom(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(chosenFrom(null)).toBeNull();
    expect(chosenFrom({ id: "x", title: "X", version: "1" })).toBeNull();
    expect(chosenFrom({ ...kept, ops: [{ notAnOp: true }] })).toBeNull();
  });

  /**
   * Runs written before this went plural are in libraries on people's
   * devices, and one of them may be open right now. The old shape is a
   * single setup beside its operations; it reads as a run seeded from
   * that one setup, which is exactly what it was.
   */
  it("still reads a run written before this held more than one", () => {
    const old = {
      id: "com.scrthq.runlog.setups.cleric",
      version: "1.0.0",
      title: "Cleric",
      ops: [{ op: "runes.give", args: { amount: 120000 }, once: true }],
    };
    const read = chosenFrom(old);
    expect(read?.from).toEqual([{ id: old.id, version: "1.0.0", title: "Cleric" }]);
    expect(read?.ops).toEqual(old.ops);
    expect(read?.edited).toBeUndefined();
    expect(creditLine(read)).toBe("Played under Cleric");
  });

  it("keeps `once`, which is the whole difference between a setting and a gift", () => {
    const kept = chose(
      setup({
        ops: [
          { op: "flag.set", args: { name: "x" } },
          { op: "runes.give", args: { amount: 1 }, once: true },
        ],
      }),
    );
    const read = chosenFrom(JSON.parse(JSON.stringify(kept)));
    expect(read?.ops[0]?.once).toBeUndefined();
    expect(read?.ops[1]?.once).toBe(true);
  });
});

describe("what a tool is sent", () => {
  const profile: ControlProfile = {
    tool: "TarnishedTool",
    setup: [{ op: "flag.set", args: { name: "world.noCutscenes", value: true } }],
    rows: [],
  };

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
