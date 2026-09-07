import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { exportRun } from "./export.ts";
import type { RunEvent } from "./events.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

const at = "2026-01-01T00:00:00.000Z";
const started: RunEvent[] = [
  { t: "RunStarted", at, packId: kiln.id, packVersion: kiln.version, mode: kiln.defaultMode },
];

describe("naming a run", () => {
  it("starts nameless", () => {
    expect(reduce(kiln, started).name).toBeNull();
  });

  it("takes the name it is given, trimmed, and the latest one wins", () => {
    const events: RunEvent[] = [
      ...started,
      { t: "RunRenamed", at, name: "  the winter set " },
      { t: "RunRenamed", at, name: "the spring set" },
    ];
    expect(reduce(kiln, events).name).toBe("the spring set");
  });

  it("clears the name when given nothing, rather than keeping a blank", () => {
    const events: RunEvent[] = [...started, { t: "RunRenamed", at, name: "x" }, { t: "RunRenamed", at, name: "   " }];
    expect(reduce(kiln, events).name).toBeNull();
  });

  it("carries the name out in an archive, and leaves the field out when there is none", () => {
    expect(exportRun(kiln, started).name).toBeUndefined();
    expect(exportRun(kiln, [...started, { t: "RunRenamed", at, name: "the winter set" }]).name).toBe("the winter set");
  });
});
