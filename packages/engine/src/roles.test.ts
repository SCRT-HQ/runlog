import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { actingSeats, playerConfig, rolesForUnit } from "./roles.ts";
import type { RunEvent } from "./events.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}
const kiln = loadPack("packs/demo/pack.yaml");

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent =>
  ({ t, at: NOW, ...props }) as RunEvent;

/** A run in `mode` with `players` at the table, having entered `units` units. */
function run(mode: string, players: number | undefined, units: number) {
  const log: RunEvent[] = [
    ev("RunStarted", {
      packId: kiln.id,
      packVersion: kiln.version,
      mode,
      ...(players ? { players } : {}),
    }),
    ...Array.from({ length: units }, () => ev("UnitEntered")),
  ];
  return reduce(kiln, log);
}

const seats = (mode: string, players: number, unit: number) =>
  rolesForUnit(kiln, run(mode, players, unit)).map((r) => `${r.label}:${r.player}`);

describe("whose turn it is to press", () => {
  it("is nobody's in particular where no role acts, and the acting role's seat where one does", () => {
    // The demo's Pairs mode marks the Thrower; a solo mode has no roles at all.
    expect(actingSeats(kiln, run("standard", undefined, 1))).toBeNull();
    expect(actingSeats(kiln, run("pairs", 2, 1))).toEqual([1]);
    expect(actingSeats(kiln, run("pairs", 2, 2))).toEqual([2]);
    expect(actingSeats(kiln, run("pairs", 3, 3))).toEqual([3]);
    expect(actingSeats(kiln, run("pairs", 2, 0))).toEqual([1]);
    expect(actingSeats(kiln, run("pairs", 2, 1), 2)).toEqual([2]);
    // The same mode with the mark taken off: any seat acts.
    const unmarked = structuredClone(kiln);
    for (const r of unmarked.modes["pairs"]!.players!.roles!) r.acts = false;
    expect(actingSeats(unmarked, run("pairs", 2, 1))).toBeNull();
  });
});

describe("role rotation", () => {
  it("has nothing to say about a solo mode", () => {
    expect(rolesForUnit(kiln, run("standard", undefined, 2))).toEqual([]);
    expect(playerConfig(kiln, run("standard", undefined, 2))).toBeUndefined();
  });

  it("assigns each declared role to a seat", () => {
    expect(seats("pairs", 2, 1)).toEqual(["Thrower:1", "Watcher:2"]);
  });

  /**
   * "Clockwise" means one seat per closed unit, which is what people actually
   * do at a table. Getting this from the log rather than from a counter held
   * in the view is what lets the run be reopened tomorrow without losing its
   * place in the rotation.
   */
  it("moves the roles on one seat per unit", () => {
    expect(seats("pairs", 2, 2)).toEqual(["Thrower:2", "Watcher:1"]);
    expect(seats("pairs", 2, 3)).toEqual(["Thrower:1", "Watcher:2"]);
  });

  it("wraps round the table rather than running off the end", () => {
    expect(seats("pairs", 3, 1)).toEqual(["Thrower:1", "Watcher:2"]);
    expect(seats("pairs", 3, 3)).toEqual(["Thrower:3", "Watcher:1"]);
    expect(seats("pairs", 3, 4)).toEqual(["Thrower:1", "Watcher:2"]);
  });

  it("shows unit one's assignment before anyone has entered a unit", () => {
    // So people know where to sit before the run starts.
    expect(rolesForUnit(kiln, run("pairs", 2, 0)).map((r) => r.player)).toEqual([1, 2]);
  });

  it("can be asked about a unit other than the current one", () => {
    const state = run("pairs", 2, 1);
    expect(rolesForUnit(kiln, state, 2).map((r) => r.player)).toEqual([2, 1]);
  });

  it("falls back to the mode's minimum when the log recorded no count", () => {
    // An older log, or one started before the count was asked for.
    expect(rolesForUnit(kiln, run("pairs", undefined, 1)).map((r) => r.player)).toEqual([1, 2]);
  });
});
