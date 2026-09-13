import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { complaints, parse, tidy } from "./profile.ts";

/**
 * The profiles shipped in packs/profiles, held against the packs they are
 * written for.
 *
 * Two things drift here and neither announces itself. A pack gets an
 * entry renamed and a rule quietly stops firing. The tool renames an
 * operation and a rule is quietly refused mid-run. Both look, to whoever
 * is playing, like the integration being broken.
 *
 * So every shipped profile is checked the way the panel checks one, and a
 * complaint here is the same complaint a person would have seen after
 * playing for an hour.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const profiles = join(repoRoot, "packs", "profiles");

/** Which pack each profile is for. Named, rather than guessed from a filename. */
const FOR: Record<string, string> = {
  "elden-ring-interference.json": "packs/sketches/elden-ring-interference.yaml",
};

const load = (relative: string) => {
  const r = loadPackText(readFileSync(join(repoRoot, relative), "utf8"), "yaml");
  if (!r.ok) throw new Error(`${relative} did not load`);
  return r.pack;
};

describe("the profiles we ship", () => {
  const files = readdirSync(profiles).filter((f) => f.endsWith(".json"));

  it("are all spoken for, so a new one cannot arrive unchecked", () => {
    expect(files.sort()).toEqual(Object.keys(FOR).sort());
  });

  for (const file of files) {
    describe(file, () => {
      const profile = parse(readFileSync(join(profiles, file), "utf8"));
      const pack = load(FOR[file]!);

      it("is a profile at all", () => {
        expect(profile).not.toBeNull();
      });

      it("has nothing wrong with it against the pack it is for", () => {
        expect(complaints(pack, profile!)).toEqual([]);
      });

      it("names the tool it is for, since a shipped one reaches strangers", () => {
        expect(profile!.tool).toBeTruthy();
      });

      it("says nothing that would be dropped on the way out", () => {
        expect(tidy(profile!)).toEqual(profile);
      });
    });
  }
});
