/**
 * Which profile a run's pack is laid out in, and what each deck is called.
 *
 * Written by `design/profiles.mjs`: run `npm run profiles -w streamdeck`
 * and commit what moves. Editing it by hand renames a profile the plugin
 * asks for without renaming the file behind it, and the switch then does
 * nothing at all.
 */

/** The slug of the profile laid out for each pack the plugin ships. */
export const PACK_PROFILES: Record<string, string> = {
  "com.scrthq.runlog.long-kiln": "demo",
  "com.scrthq.runlog.elden-ring-tarnishedtool": "elden-ring",
  "com.scrthq.runlog.forfeits": "forfeits",
  "com.scrthq.runlog.ladder-work": "ladder-work",
  "com.scrthq.runlog.practice-room": "practice-room",
  "com.scrthq.runlog.rocket-league-ladder": "rocket-league-ladder",
  "com.scrthq.runlog.rocket-league-showdown": "rocket-league-showdown",
  "com.scrthq.runlog.run-of-show": "run-of-show",
  "com.scrthq.runlog.soundclash": "soundclash",
  "com.scrthq.runlog.twenty-five": "twenty-five",
};

/** What a profile name calls each deck, by the SDK's `DeviceType`. */
export const DEVICE_PROFILES: Record<number, string> = {
  2: "xl",
  0: "sd",
  1: "mini",
  7: "plus",
};

/** The layout a run gets where its pack ships none, which is every Marketplace pack. */
export const GENERIC_PROFILE = "runlog";

/**
 * The profile to put a deck on for a run of this pack.
 *
 * `null` for a deck nothing here is laid out for - a Pedal, a Neo - which is
 * a deck to leave alone rather than one to push the generic layout onto.
 */
export function profileFor(packId: string | undefined, device: number): string | null {
  const deck = DEVICE_PROFILES[device];
  if (deck === undefined) return null;
  const slug = (packId === undefined ? undefined : PACK_PROFILES[packId]) ?? GENERIC_PROFILE;
  return `profiles/${slug}-${deck}`;
}
