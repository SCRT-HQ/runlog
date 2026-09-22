import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { areasFor, known, type Lists } from "./lists.ts";
import { catalogFor, opDef } from "./catalog.ts";

/**
 * The lists behind the name fields, and the one question they are there
 * to answer: which of these needs an area, and which of them does not.
 */

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, "lists", "tarnishedtool.json"), "utf8")) as {
  graces: { name: string; area: string }[];
  items: string[];
  weapons: { name: string; max: number }[];
  ashes: { name: string }[];
  bosses: { name: string; area: string }[];
};
const lists: Lists = {
  graces: raw.graces,
  items: raw.items.map((name) => ({ name })),
  weapons: raw.weapons,
  ashes: raw.ashes,
  bosses: raw.bosses,
};

describe("the tool's own names", () => {
  it("carries every list the catalog asks for", () => {
    expect(raw.graces.length).toBeGreaterThan(400);
    // Armor is in here too: it is a thing with a name and a count, which
    // is what this list is for, and a weapon is not.
    expect(raw.items.length).toBeGreaterThan(1600);
    expect(raw.items).toContain("White Mask");
    expect(raw.items).toContain("Lord of Blood's Exultation");
    expect(raw.items).not.toContain("Godskin Peeler");
    expect(raw.weapons.length).toBeGreaterThan(480);
    expect(raw.ashes.length).toBe(116);
    expect(raw.bosses.length).toBeGreaterThan(200);
  });

  it("knows a weapon's own ceiling, which is not the same for all of them", () => {
    expect(raw.weapons.find((w) => w.name === "Wing of Astel")?.max).toBe(10);
    expect(raw.weapons.find((w) => w.name === "Uchigatana")?.max).toBe(25);
  });

  it("asks for no area where a name is in one place", () => {
    expect(areasFor(lists, "graces", "Church of Elleh")).toEqual(["Limgrave"]);
    expect(areasFor(lists, "bosses", "Godrick the Grafted")).toHaveLength(1);
  });

  it("offers exactly the places a repeated name is in, and nothing else", () => {
    expect(areasFor(lists, "graces", "Artist's Shack")).toEqual(["Limgrave", "Liurnia of the Lakes"]);
    // The one that is in four, which is the whole reason the field exists.
    expect(areasFor(lists, "bosses", "Bell Bearing Hunter")).toHaveLength(4);
  });

  it("has nothing to narrow by until a name is typed", () => {
    expect(areasFor(lists, "graces", "").length).toBeGreaterThan(20);
    expect(areasFor(lists, "graces", "not a place")).toEqual([]);
  });

  it("says whether a typed name is one the tool will find, ignoring case and spacing", () => {
    expect(known(lists, "weapons", "  wing of astel ")).toBe(true);
    expect(known(lists, "items", "Golden Seed")).toBe(true);
    expect(known(lists, "items", "Golden Seeds")).toBe(false);
    // Nothing to say yet, rather than a complaint about an empty box.
    expect(known(lists, "graces", "")).toBe(null);
    expect(known({}, "graces", "Church of Elleh")).toBe(null);
  });
});

/**
 * Runes are given, not set.
 *
 * `player.runes` was in the list of numbers a rule could read and
 * write, and it was neither: the tool's own field of that name is the
 * box holding how many somebody is about to give themselves, and a
 * button does the giving. A rule that added twelve million runes moved
 * the number in that box and nothing else.
 */
describe("the numbers a rule can set", () => {
  const tool = catalogFor("TarnishedTool")!;
  const values = opDef(tool, "value.set")?.args.find((a) => a.name === "name")?.options ?? [];

  it("does not offer runes, which nothing can read", () => {
    expect(values.length).toBeGreaterThan(10);
    expect(values).not.toContain("player.runes");
  });

  it("gives them instead, one way and by an amount", () => {
    const give = opDef(tool, "runes.give");
    expect(give?.oneWay).toBe(true);
    expect(give?.args.map((a) => a.name)).toEqual(["amount"]);
    // A toll is the same operation with the sign turned round.
    expect(give?.args[0]?.least).toBeLessThan(0);
  });
});

/**
 * The extracted lists themselves, read off disk.
 *
 * `scripts/extract-tool-lists.py` used to split each row on every comma,
 * which is wrong for the rows whose name carries one. "Burn, O Flame!" came
 * out as `"Burn`, the columns after it shifted, and the incantation itself
 * was missing from the list entirely. Nothing caught it: the panel simply
 * never offered those spells, and a setup naming one failed the name check
 * with no hint as to why.
 */
describe("the names the tool matches against", () => {
  const lists = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "lists", "tarnishedtool.json"), "utf8")) as Record<
    string,
    Array<string | { name: string }>
  >;

  const named = (key: string) => lists[key]!.map((e) => (typeof e === "string" ? e : e.name));

  it("carries no half of a name that was cut at a comma", () => {
    for (const key of ["graces", "items", "weapons", "ashes", "bosses"]) {
      const cut = named(key).filter((n) => n.startsWith('"') || n.endsWith('"') || n !== n.trim());
      expect(cut, key).toEqual([]);
    }
  });

  it("keeps the names that carry a comma whole", () => {
    // The four the split broke, spelled as the tool spells them.
    for (const name of ["Burn, O Flame!", "Flame, Grant Me Strength", "Flame, Cleanse Me", "O, Flame!"]) {
      expect(named("items"), name).toContain(name);
    }
  });
});
