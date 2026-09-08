import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Table } from "@runlog/rules-schema";
import { lineFor, tableLines } from "./tableLook.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

describe("a table beside the keypad", () => {
  it("lists a lookup table's lines with their ranges and the number that lands on each", () => {
    const lines = tableLines(kiln.tables["check"]!, { min: 1, max: 100 });
    expect(lines.length).toBe(kiln.tables["check"]!.entries.length);
    expect(lines[0]).toMatchObject({ range: "1–19", value: 1 });
    expect(lines[1]).toMatchObject({ range: "20–69", value: 20 });
    expect(lineFor(lines, kiln.tables["check"]!, 30)).toBe("check-kind");
    expect(lineFor(lines, kiln.tables["check"]!, 100)).toBe("check-cold");
  });

  it("reads a bands table's open ends", () => {
    const bands: Table = {
      resolution: "bands",
      title: "Bands",
      roll: "d10",
      entries: [
        { id: "low", lte: 3, text: "low" },
        { id: "mid", gte: 4, lte: 7, text: "mid" },
        { id: "high", gte: 8, text: "high" },
      ],
    } as Table;
    const lines = tableLines(bands, { min: 1, max: 10 });
    expect(lines.map((l) => l.range)).toEqual(["up to 3", "4–7", "8+"]);
    expect(lines.map((l) => l.value)).toEqual([1, 4, 8]);
    expect(lineFor(lines, bands, 9)).toBe("high");
  });

  it("has nothing to list for a table that is not landed on by one number", () => {
    const opposed = { resolution: "opposed", title: "Opposed", action: "d6", challenge: { dice: "d6", count: 2 }, entries: [] } as unknown as Table;
    expect(tableLines(opposed, null)).toEqual([]);
  });
});
