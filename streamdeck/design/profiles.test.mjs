import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEVICES, container, fromPack, profile, shippedName } from "@runlog/deck-profiles";

import { SKETCHES, SLUGS } from "./layouts.mjs";
import { layouts, profileSpecs, setupsFor, setupsTable, table, toolFor } from "./profiles.mjs";
import { PACK_SETUPS } from "../src/setups.ts";

/**
 * The generator as a script: which packs it reads, what it writes beside
 * them, and whether the manifest still lists what came out.
 *
 * How a profile is laid out, and whether its keys fit the deck, is
 * `packages/deck-profiles` and is tested there. What is left here is the
 * part that is only true of this repository: the list of packs on disk, the
 * slug each ships under, the files committed under the plugin, and the
 * table the plugin reads at run time.
 */

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..", "com.scrthq.runlog.sdPlugin");
const repo = join(here, "..", "..");

const MANIFEST = JSON.parse(readFileSync(join(plugin, "manifest.json"), "utf8"));

const all = profileSpecs().map((spec) => ({ spec, built: profile(spec) }));

describe("the profiles we ship", () => {
  it("lays one out for the generic keys and one for every pack that ships", () => {
    // The demo pack and every sketch, by the slug each takes from its file
    // name. Written out rather than read from the folder a second time: this
    // is the list, and a sketch that stopped parsing would otherwise drop
    // off it without a word.
    expect(layouts().map((l) => l.slug)).toEqual([
      "runlog",
      "demo",
      "elden-ring",
      "forfeits",
      "ladder-work",
      "practice-room",
      "rocket-league-ladder",
      "rocket-league-showdown",
      "run-of-show",
      "soundclash",
      "twenty-five",
    ]);
    const sketches = readdirSync(join(repo, SKETCHES)).filter((f) => f.endsWith(".yaml"));
    expect(layouts()).toHaveLength(sketches.length + 2);
    expect(all).toHaveLength(layouts().length * Object.keys(DEVICES).length);
    expect(all).toHaveLength(44);
  });

  it("is one per pack per device, and the manifest lists every one", () => {
    expect(all.map(({ spec }) => `${spec.slug}-${spec.device}`)).toEqual(MANIFEST.Profiles.map((p) => p.Name.replace("profiles/", "")));
    for (const p of MANIFEST.Profiles) {
      const device = p.Name.split("-").pop();
      expect(p.DeviceType, `${p.Name} should be laid out for the device it names`).toBe(DEVICES[device].type);
    }
  });

  it("installs the generic four with the plugin and a pack's four on demand", () => {
    // Forty profiles arriving on the day somebody installs the plugin is a
    // profile list nobody can find their own work in. A pack's four are
    // installed the first time a deck follows a run of that pack, and never
    // switch themselves on the way in: the plugin says when.
    for (const p of MANIFEST.Profiles) {
      const generic = p.Name.startsWith("profiles/runlog-");
      expect(p.AutoInstall, `${p.Name}`).toBe(generic);
      expect(p.DontAutoSwitchWhenInstalled, `${p.Name}`).toBe(true);
    }
    expect(MANIFEST.Profiles.filter((p) => p.AutoInstall)).toHaveLength(4);
  });

  it("hands the plugin a table of the names rather than letting it guess them", () => {
    // `src/profiles.ts` is written by the generator and read at run time. If
    // it is behind the packs on disk the plugin asks for a profile that is
    // not in the package, and the switch does nothing anybody can see.
    const written = readFileSync(join(here, "..", "src", "profiles.ts"), "utf8");
    expect(written.replace(/\r\n/g, "\n")).toBe(table().replace(/\r\n/g, "\n"));
    for (const layout of layouts()) {
      if (layout.pack) expect(written).toContain(`"${layout.pack.id}": "${layout.slug}"`);
    }
  });

  it("hands the plugin the setups each pack's tool ships, for a profile built without a run", async () => {
    // `src/setups.ts` is written by the generator too, and read at run time
    // by the Install key. Behind the setups on disk, it lays out a deck
    // missing a page of keys the shipped profile has.
    const written = readFileSync(join(here, "..", "src", "setups.ts"), "utf8");
    expect(written.replace(/\r\n/g, "\n")).toBe((await setupsTable()).replace(/\r\n/g, "\n"));
  });

  it("matches the profiles committed under the plugin, byte for byte", () => {
    // A `.streamDeckProfile` is generated and committed rather than built at
    // install time, so a layout change that nobody regenerated for leaves a
    // stale zip sitting next to the source that no longer agrees with it.
    for (const { spec, built } of all) {
      const path = join(plugin, "profiles", `${spec.slug}-${spec.device}.streamDeckProfile`);
      const committed = readFileSync(path);
      expect(Buffer.from(container(built)).equals(committed), `${spec.slug}-${spec.device}`).toBe(true);
    }
  });

  it("names each profile after the pack it was laid out from, and marks it as ours", () => {
    // What the Stream Deck app calls it in somebody's list: the pack's own
    // title with the mark after it. Every profile Runlog makes carries it,
    // a download and the Install key's build included, so a pack has one
    // name wherever its profile came from. The generator puts it on; what
    // is held here is that these files came out with it.
    for (const layout of layouts()) {
      const named = all.filter(({ spec }) => spec.slug === layout.slug);
      expect(named).toHaveLength(4);
      const expected = layout.pack ? shippedName(layout.pack.title) : "Runlog";
      for (const { built } of named) expect(built.files["manifest.json"].Name).toBe(expected);
    }
    expect(shippedName("The Long Kiln")).toBe("The Long Kiln (Runlog)");
  });

  it("keeps the slug Elden Ring's profile shipped under", () => {
    // Its file name says the tool as well as the game; its slug does not,
    // and changing that now would rename the profile on every deck that
    // already has it.
    expect(SLUGS["elden-ring-tarnishedtool"]).toBe("elden-ring");
    expect(layouts().find((l) => l.slug === "elden-ring").pack.id).toBe("com.scrthq.runlog.elden-ring-tarnishedtool");
  });

  describe("the Elden Ring profile", () => {
    const setups = ["bare-handed", "brute", "cleric", "glass", "long-night", "sorcerer", "well-armed"];

    /** Every action on every page of a built profile. */
    const placed = (built) =>
      Object.values(built.files)
        .filter((file) => file.Controllers)
        .flatMap((file) => file.Controllers.flatMap((c) => Object.values(c.Actions ?? {})));

    for (const device of Object.keys(DEVICES)) {
      it(`carries the pack's own loadouts on a ${device}`, () => {
        const built = all.find(({ spec }) => spec.slug === "elden-ring" && spec.device === device).built;
        const settings = placed(built).map((a) => a.Settings);
        // One key per kind rather than one per file, so what is held here is
        // that every kind this tool has setups for reached the profile.
        const kinds = settings.filter((s) => s.group).map((s) => s.group);
        expect([...kinds].sort()).toEqual(["effects", "items", "loadout", "unlocks", "warp"]);
        // And that the files those kinds are drawn from are still here, so a
        // setup that stopped naming this tool vanishes loudly rather than
        // quietly emptying a key.
        const shipped = setupsFor(toolFor(layouts().find((l) => l.slug === "elden-ring").pack.id)).map((x) => x.id);
        for (const id of setups) expect(shipped).toContain(`com.scrthq.runlog.setups.${id}`);
      });
    }

    it("is the same split the table hands the plugin for a build off the pack file", () => {
      // The two paths to a profile for this pack: the shipped one, laid out
      // from the setup files, and the Install key's, laid out from the
      // table. They have to agree on which setups there are and which of
      // them are commands, or a streamer who imported the second is missing
      // keys the first has.
      const pack = layouts().find((l) => l.slug === "elden-ring").pack;
      const fromTable = fromPack(pack, PACK_SETUPS[pack.id]);
      const fromFiles = fromPack(pack, setupsFor(toolFor(pack.id)));
      expect(fromTable.setups).toEqual(fromFiles.setups);
      expect(fromTable.commands).toEqual(fromFiles.commands);
      expect(fromTable.setups.length).toBeGreaterThan(0);
      // The warps are the commands, and they say so in their own files:
      // Start of the DLC moves the player too, but what it is for is opening
      // the DLC, so it declares itself an unlock and stays an Apply setup.
      expect(fromTable.commands.every((x) => x.group === "warp")).toBe(true);
      expect(fromTable.setups.map((x) => x.id)).toContain("com.scrthq.runlog.setups.start-of-the-dlc");
    });
  });
});
