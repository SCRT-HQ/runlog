import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { areasFor, known, type Lists } from "./lists.ts";

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
