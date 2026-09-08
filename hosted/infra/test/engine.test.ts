import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { reduce, type RunEvent } from "@runlog/engine";

/**
 * The hosting reaching the engine.
 *
 * Until the Discord bot, nothing under hosted/ imported a workspace
 * package: the container is a port, and the API never reads a pack. The
 * bot reduces packs in the Lambda, so the hosting now depends on the
 * engine the way the app does — resolved from the workspace, sources and
 * all. This pins that the resolution works here, under the hosting's own
 * compiler options and test configuration, before any handler relies on
 * it; a broken alias would otherwise surface only in a bundle.
 */
describe("the hosting and the engine", () => {
  it("loads the demo pack and reduces a run with the workspace engine", () => {
    const text = readFileSync(join(__dirname, "..", "..", "..", "packs", "demo", "pack.yaml"), "utf8");
    const loaded = loadPackText(text, "yaml");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const events: RunEvent[] = [
      { t: "RunStarted", at: "2026-01-01T00:00:00Z", id: "e1", runId: "r1", packId: loaded.pack.id, packVersion: loaded.pack.version, mode: "standard", players: 1 } as unknown as RunEvent,
      { t: "UnitEntered", at: "2026-01-01T00:00:01Z", id: "e2" } as unknown as RunEvent,
    ];
    const state = reduce(loaded.pack, events);
    expect(state.unit).toBe(1);
    expect(state.status).toBe("active");
  });
});
