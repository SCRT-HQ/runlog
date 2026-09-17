import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The pickers, held to one rule: a picker never offers what a dedicated
 * key does, unless that key is dynamic the way Next action is.
 *
 * Two keys for the same thing is two keys somebody has to choose between
 * with nothing to choose on, and the one under the picker is always the
 * lesser of the two: the Clock action pauses and resumes as well as
 * reading, and Install a profile takes any pack in the library rather than
 * the one the deck happens to be following.
 *
 * The inspectors are plain HTML the Stream Deck app loads, not built with
 * the plugin, so what they offer is read here as text rather than imported.
 */

const plugin = new URL("../com.scrthq.runlog.sdPlugin/", import.meta.url);
const read = (rest: string) => readFileSync(fileURLToPath(new URL(rest, plugin)), "utf8");

/** The fixed fields the Metric inspector lists, from its own table. */
function metricFields(): string[] {
  const table = /const FIXED = \[(.*?)\];/s.exec(read("ui/metric.html"))![1]!;
  return [...table.matchAll(/\["(\w+)",/g)].map((m) => m[1]!);
}

/** Every option written into an inspector's page, the empty "Set up" one aside. */
function options(file: string): string[] {
  return [...read(file).matchAll(/<option value="(\w*)"/g)].map((m) => m[1]!).filter((value) => value !== "");
}

describe("what a picker offers", () => {
  it("leaves the clock off the Metric field list, because Clock is a key", () => {
    expect(metricFields()).toEqual(["score", "unit", "latest", "leader"]);
  });

  it("offers the inspector the same fields a dial turns through", () => {
    const source = readFileSync(fileURLToPath(new URL("./actions/metric.ts", import.meta.url)), "utf8");
    const wheel = /export const FIELDS = \[(.*?)\] as const;/s.exec(source)![1]!;
    expect([...wheel.matchAll(/"(\w+)"/g)].map((m) => m[1]!)).toEqual(metricFields());
  });

  it("leaves the profile hand-over off the Open target list, because Install a profile is a key", () => {
    expect(options("ui/open.html")).toEqual(["run", "dock", "newrun", "guide", "rules"]);
  });

  it("builds the Press, Apply setup and Command lists from the run rather than writing any in", () => {
    // These three offer the pack's own words, which no page here knows, so
    // an option written into the HTML would be one the run cannot answer.
    // The roll that waited on this list is gone: Roll is a key of its own.
    for (const file of ["ui/press.html", "ui/setup.html", "ui/command.html"]) {
      expect(options(file), file).toEqual([]);
    }
  });
});
