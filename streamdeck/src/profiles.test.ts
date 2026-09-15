import { describe, expect, it } from "vitest";

import { DEVICE_PROFILES, GENERIC_PROFILE, PACK_PROFILES, profileFor } from "./profiles.ts";

/**
 * The names the plugin asks the Stream Deck app for.
 *
 * `profiles.ts` is written by `design/profiles.mjs`, and the design test
 * holds it against the packs on disk. What is held here is the other half:
 * that a run's pack and the deck in front of it come out as the name the
 * manifest lists, because a name that is a letter off is a switch that does
 * nothing and says nothing about why.
 */
describe("the profile a pack's run puts a deck on", () => {
  it("names the pack's own profile for the deck it is laid out for", () => {
    expect(profileFor("com.scrthq.runlog.elden-ring-tarnishedtool", 2)).toBe("profiles/elden-ring-xl");
    expect(profileFor("com.scrthq.runlog.elden-ring-tarnishedtool", 0)).toBe("profiles/elden-ring-sd");
    expect(profileFor("com.scrthq.runlog.elden-ring-tarnishedtool", 1)).toBe("profiles/elden-ring-mini");
    expect(profileFor("com.scrthq.runlog.elden-ring-tarnishedtool", 7)).toBe("profiles/elden-ring-plus");
  });

  it("falls back to the generic layout for a pack that ships no profile", () => {
    // A pack bought in the marketplace, or written by the streamer: the
    // generic keys still press it, and they are what the deck gets.
    expect(profileFor("com.example.bought", 2)).toBe(`profiles/${GENERIC_PROFILE}-xl`);
    expect(profileFor(undefined, 0)).toBe(`profiles/${GENERIC_PROFILE}-sd`);
  });

  it("leaves a deck nothing is laid out for alone", () => {
    // A Pedal is 5 and a Neo is 9. Neither has a profile in the package, and
    // asking for one that is not there would be a switch to nowhere.
    expect(profileFor("com.scrthq.runlog.forfeits", 5)).toBe(null);
    expect(profileFor(undefined, 9)).toBe(null);
  });

  it("knows a slug for every pack the plugin ships a layout for", () => {
    expect(Object.keys(PACK_PROFILES)).toHaveLength(10);
    expect(PACK_PROFILES["com.scrthq.runlog.long-kiln"]).toBe("demo");
    expect(Object.values(DEVICE_PROFILES).sort()).toEqual(["mini", "plus", "sd", "xl"]);
  });
});
