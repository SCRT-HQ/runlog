import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { hasProfileFor, installedFor, installedProfiles, profilesDir, withoutCopies } from "./installed.ts";

/**
 * Reading the Stream Deck app's own profile folder.
 *
 * A folder of the test's own, laid out the way the app lays its out: one
 * `<UUID>.sdProfile` directory per profile with a `manifest.json` in it.
 * Nothing here reads the real one - what somebody has on their desk is not
 * a fixture - and `profilesDir` is checked only for the shape of the path.
 */
const root = mkdtempSync(join(tmpdir(), "runlog-profiles-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function profile(manifest: Record<string, unknown>): void {
  const dir = join(root, `0000000${++n}-0000-0000-0000-000000000000.sdProfile`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ Version: "3.0", ...manifest }));
}

profile({ Name: "Main" });
profile({ Name: "Ember Trail" });
profile({ Name: "Salt and Signal copy copy" });
profile({ Name: "Soundclash", InstalledByPluginUUID: "com.scrthq.runlog", PreconfiguredName: "profiles/soundclash-xl" });
profile({ Name: "Runlog", InstalledByPluginUUID: "com.scrthq.runlog", PreconfiguredName: "profiles/runlog-xl" });
// A folder with no manifest at all, and one whose manifest will not parse:
// neither is a profile, and neither may take the read down with it.
mkdirSync(join(root, "empty.sdProfile"), { recursive: true });
mkdirSync(join(root, "broken.sdProfile"), { recursive: true });
writeFileSync(join(root, "broken.sdProfile", "manifest.json"), "{");

describe("the profiles the Stream Deck app already has", () => {
  it("reads every one that has a name, and nothing else in the folder", () => {
    expect(
      installedProfiles(root)
        .map((p) => p.name)
        .sort(),
    ).toEqual(["Ember Trail", "Main", "Runlog", "Salt and Signal copy copy", "Soundclash"]);
  });

  it("is no profiles at all where there is no folder to read", () => {
    expect(installedProfiles(join(root, "nowhere"))).toEqual([]);
    expect(installedProfiles(null)).toEqual([]);
  });

  it("names a folder under the app's own tree, or nothing on a platform it does not run on", () => {
    const dir = profilesDir();
    expect(dir === null || dir.endsWith("ProfilesV3")).toBe(true);
  });

  it("takes the app's copy suffixes off a name, however many of them there are", () => {
    expect(withoutCopies("Ember Trail")).toBe("Ember Trail");
    expect(withoutCopies("Ember Trail copy")).toBe("Ember Trail");
    expect(withoutCopies("Ember Trail copy copy copy")).toBe("Ember Trail");
    // Numbered, which is the other shape the app gives one.
    expect(withoutCopies("Ember Trail copy 2")).toBe("Ember Trail");
    expect(withoutCopies("Ember Trail copy copy 3")).toBe("Ember Trail");
    // Not a word in the middle, and not a profile somebody named that.
    expect(withoutCopies("Copy of the rules")).toBe("Copy of the rules");
    // A number that is not a copy count stays where it is.
    expect(withoutCopies("Ember Trail 2")).toBe("Ember Trail 2");
  });
});

describe("whether a pack already has a profile", () => {
  const profiles = installedProfiles(root);

  it("matches the pack's title, copies and all", () => {
    expect(hasProfileFor({ id: "com.example.ember-trail", title: "Ember Trail" }, profiles)).toBe(true);
    expect(hasProfileFor({ id: "com.example.salt-and-signal", title: "Salt and Signal" }, profiles)).toBe(true);
  });

  it("matches a shipped pack by the name the plugin asked the app to install under", () => {
    // No title at all, so the name rule has nothing to go on: the manifest
    // name the plugin declared is what is left.
    expect(hasProfileFor({ id: "com.scrthq.runlog.soundclash" }, profiles)).toBe(true);
  });

  it("says no for a pack nothing in the folder is for", () => {
    expect(hasProfileFor({ id: "com.example.long-road", title: "The Long Road" }, profiles)).toBe(false);
    // The generic profile is not any pack's.
    expect(hasProfileFor({ id: "com.scrthq.runlog.forfeits", title: "Forfeits" }, profiles)).toBe(false);
  });

  it("does not claim a profile some other plugin installed under a name of ours", () => {
    expect(
      hasProfileFor({ id: "com.scrthq.runlog.soundclash" }, [{ name: "Something else", preconfigured: "profiles/soundclash-xl" }]),
    ).toBe(false);
  });
});

describe("which of the two profiles a pack has", () => {
  const profiles = installedProfiles(root);

  it("is the shipped one where the plugin put it there itself", () => {
    // The one the plugin may switch a deck to: it is in the manifest, under
    // the name the plugin asked the app to install it under.
    expect(installedFor({ id: "com.scrthq.runlog.soundclash", title: "Soundclash" }, profiles)).toBe("shipped");
  });

  it("is the shipped one even where another profile answers the title rule", () => {
    // The awkward pair: the plugin's own profile has been copied, so its
    // name no longer reads as the pack's title, and a profile the streamer
    // imported is sitting there under the title instead. Both rules answer,
    // and the shipped one has to win: it is the profile the deck can be put
    // on, so there is nothing here to leave the deck alone for.
    expect(
      installedFor({ id: "com.scrthq.runlog.soundclash", title: "Soundclash" }, [
        { name: "Soundclash copy", installedBy: "com.scrthq.runlog", preconfigured: "profiles/soundclash-plus" },
        { name: "Soundclash" },
      ]),
    ).toBe("shipped");
  });

  it("is the imported one where the streamer brought it themselves", () => {
    // A pack the plugin ships a layout for, whose profile the streamer
    // imported off its page rather than letting the plugin install it.
    // Nothing records where it came from, so the name is the rule.
    expect(installedFor({ id: "com.scrthq.runlog.forfeits", title: "Ember Trail" }, profiles)).toBe("imported");
    // And for a pack the plugin ships nothing for, which is every other way
    // one of these arrives.
    expect(installedFor({ id: "com.example.salt-and-signal", title: "Salt and Signal" }, profiles)).toBe("imported");
  });

  it("tells a shipped profile from an import of the same pack, now the two are named apart", () => {
    // A profile the plugin installs is named "<title> (Runlog)" so it can
    // sit beside one the streamer imported without either becoming a copy.
    // Which is which is still read off the manifest rather than the name:
    // the plugin's own is the one a deck can be switched to.
    const pack = { id: "com.scrthq.runlog.long-kiln", title: "The Long Kiln" };
    const ours = { name: "The Long Kiln (Runlog)", installedBy: "com.scrthq.runlog", preconfigured: "profiles/demo-xl" };
    const theirs = { name: "The Long Kiln" };
    expect(installedFor(pack, [ours, theirs])).toBe("shipped");
    expect(installedFor(pack, [ours])).toBe("shipped");
    expect(installedFor(pack, [theirs])).toBe("imported");
    // And the shipped name is not read as an import of some other pack that
    // happens to share the title: the mark is part of the name.
    expect(installedFor({ id: "com.example.long-road", title: "The Long Kiln" }, [ours])).toBe(null);
  });

  it("is neither where nothing in the folder is for the pack", () => {
    expect(installedFor({ id: "com.example.long-road", title: "The Long Road" }, profiles)).toBe(null);
    expect(installedFor({ id: "com.scrthq.runlog.forfeits", title: "Forfeits" }, profiles)).toBe(null);
  });
});
