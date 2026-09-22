import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSetupText, type Setup } from "@runlog/rules-schema";
import { catalogFor, opDef, rangeOfValue, type ListName } from "./catalog.ts";

/**
 * The setups shipped in packs/setups, held against the tool's own names.
 *
 * The schema checks the shape of a setup and nothing about what is in it,
 * so until now a setup could name a weapon that does not exist and pass
 * every check in the repository. What happens then is not an error
 * anybody sees: the frame reaches the tool, the tool matches the name
 * against its own list, finds nothing, and the streamer is handed a
 * loadout with a hole in it mid-run.
 *
 * `lists/tarnishedtool.json` is extracted from the tool's own resources by
 * `scripts/extract-tool-lists.py`, so a name in it is a name the tool
 * accepts. Checking against it here is the same check the tool will make,
 * made where a mistake costs a test run.
 *
 * Every argument the catalog describes as a name is checked, not a chosen
 * few, so an operation gaining a name argument is covered the day it is
 * added rather than the day somebody remembers this file.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const setupsDir = join(repoRoot, "packs", "setups");

/** The tool's lists, as the panel would fetch them. */
const lists = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "lists", "tarnishedtool.json"), "utf8")) as {
  graces: Array<{ name: string; area?: string }>;
  items: string[];
  weapons: Array<{ name: string; max?: number }>;
  ashes: string[];
  bosses: string[];
};

const names = (list: ListName): Set<string> => new Set(lists[list].map((entry) => (typeof entry === "string" ? entry : entry.name)));

/** A weapon's own reinforcement ceiling: +25 on smithing stones, +10 on somber ones. */
const ceiling = new Map(lists.weapons.map((w) => [w.name, w.max ?? 25]));

/** How many areas each grace name appears in, since that is what makes `area` necessary. */
const graceAreas = new Map<string, string[]>();
for (const g of lists.graces) {
  graceAreas.set(g.name, [...(graceAreas.get(g.name) ?? []), ...(g.area ? [g.area] : [])]);
}

const files = readdirSync(setupsDir)
  .filter((f) => f.endsWith(".yaml"))
  .sort();

const shipped: Array<{ file: string; setup: Setup }> = files.map((file) => {
  const parsed = loadSetupText(readFileSync(join(setupsDir, file), "utf8"), "yaml");
  if (!parsed.ok) throw new Error(`${file} did not load`);
  return { file, setup: parsed.setup };
});

describe("the setups we ship", () => {
  it("ships some, so an empty folder cannot pass every check below", () => {
    expect(shipped.length).toBeGreaterThan(20);
  });

  it("names only operations the tool has", () => {
    for (const { file, setup } of shipped) {
      const catalog = catalogFor(setup.tool);
      expect(catalog, `${file} names a tool nothing here knows: ${setup.tool}`).not.toBe(null);
      for (const op of setup.ops) {
        expect(opDef(catalog, op.op), `${file}: ${op.op}`).not.toBe(null);
      }
    }
  });

  it("spells every name the way the tool spells it", () => {
    // The one that matters. A weapon, an item, a grace or an ash that the
    // tool cannot find is a silent hole in somebody's loadout.
    const wrong: string[] = [];
    for (const { file, setup } of shipped) {
      const catalog = catalogFor(setup.tool);
      for (const op of setup.ops) {
        const def = opDef(catalog, op.op);
        if (!def) continue;
        for (const arg of def.args) {
          if (arg.kind !== "name" || !arg.list) continue;
          const value = (op.args ?? {})[arg.name];
          if (value === undefined) continue;
          if (typeof value !== "string" || !names(arg.list).has(value)) {
            wrong.push(`${file}: ${op.op} ${arg.name} = ${JSON.stringify(value)}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("asks for a weapon no further than that weapon goes", () => {
    // The tool holds a level past a weapon's ceiling rather than refusing
    // it, so this is never an error at run time. It is a lie in the file
    // all the same: a somber weapon written at +25 reads as though
    // somebody knew what it would do, and the next person to copy the line
    // carries it somewhere it is not clamped.
    const past: string[] = [];
    for (const { file, setup } of shipped) {
      for (const op of setup.ops) {
        if (op.op !== "weapon.named") continue;
        const args = op.args ?? {};
        const max = ceiling.get(String(args["name"]));
        const upgrade = args["upgrade"];
        if (max === undefined || typeof upgrade !== "number") continue;
        if (upgrade > max) past.push(`${file}: ${String(args["name"])} at +${upgrade}, which stops at +${max}`);
      }
    }
    expect(past).toEqual([]);
  });

  it("says which area a grace is in wherever the name alone is ambiguous", () => {
    const vague: string[] = [];
    for (const { file, setup } of shipped) {
      for (const op of setup.ops) {
        if (op.op !== "warp.grace") continue;
        const args = op.args ?? {};
        const areas = graceAreas.get(String(args["name"])) ?? [];
        const area = args["area"];
        if (areas.length > 1 && area === undefined) {
          vague.push(`${file}: ${String(args["name"])} is in ${areas.length} areas and names none`);
        }
        if (area !== undefined && !areas.includes(String(area))) {
          vague.push(`${file}: ${String(args["name"])} is not in ${String(area)}`);
        }
      }
    }
    expect(vague).toEqual([]);
  });

  it("keeps every number inside what the tool will accept", () => {
    const outside: string[] = [];
    for (const { file, setup } of shipped) {
      const catalog = catalogFor(setup.tool);
      for (const op of setup.ops) {
        const def = opDef(catalog, op.op);
        if (!def) continue;
        for (const arg of def.args) {
          const value = (op.args ?? {})[arg.name];
          if (arg.kind !== "number" || typeof value !== "number") continue;
          // `value.set` carries its bounds per value rather than per
          // argument: vigor stops at 99, the speed multiplier at 10.
          const bounds = op.op === "value.set" ? rangeOfValue(String((op.args ?? {})["name"])) : arg;
          if (bounds?.least !== undefined && value < bounds.least)
            outside.push(`${file}: ${op.op} ${arg.name} = ${value}, under ${bounds.least}`);
          if (bounds?.most !== undefined && value > bounds.most)
            outside.push(`${file}: ${op.op} ${arg.name} = ${value}, over ${bounds.most}`);
        }
      }
    }
    expect(outside).toEqual([]);
  });

  it("gives every setup an id and a title of its own", () => {
    // Two setups sharing an id is one of them silently winning wherever a
    // library is keyed by it; two sharing a title is a picker a person
    // cannot choose from.
    const ids = shipped.map(({ setup }) => setup.id);
    const titles = shipped.map(({ setup }) => setup.title);
    expect(new Set(ids).size, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(", ")}`).toBe(ids.length);
    expect(new Set(titles).size, `duplicate titles: ${titles.filter((t, i) => titles.indexOf(t) !== i).join(", ")}`).toBe(titles.length);
  });

  it("is checked by the validator the pipeline runs, every one of them", () => {
    // `check:packs` names each file it validates, so a setup added to the
    // folder and not to that list is checked by nobody.
    const script = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const checks = script.scripts["check:packs"] ?? "";
    const missing = files.filter((f) => !checks.includes(`packs/setups/${f}`));
    expect(missing, "add these to check:packs in package.json").toEqual([]);
  });
});
