import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ACTION_NAMES, PLUGIN } from "./plugin.ts";

/**
 * The plugin's own name, version and action labels, held against the
 * manifest they are copied from.
 *
 * They are copied because a browser building a profile for a Marketplace
 * pack has no manifest to read. This is the guard on that copy: rename an
 * action or bump the plugin's version over there and this fails, which is
 * the prompt to change `plugin.ts` and regenerate the committed profiles.
 * Every one of these strings is written into every action of every
 * profile, so a stale one ships on somebody's deck.
 */
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../streamdeck/com.scrthq.runlog.sdPlugin/manifest.json", import.meta.url)), "utf8"),
) as { Name: string; UUID: string; Version: string; Actions: Array<{ UUID: string; Name: string }> };

describe("what a profile says the plugin is", () => {
  it("names the plugin the manifest names", () => {
    expect(PLUGIN).toEqual({ Name: manifest.Name, UUID: manifest.UUID, Version: manifest.Version });
  });

  it("carries every action's label, and only the actions there are", () => {
    const listed = Object.fromEntries(manifest.Actions.map((a) => [a.UUID.replace(`${manifest.UUID}.`, ""), a.Name]));
    expect(ACTION_NAMES).toEqual(listed);
  });
});
