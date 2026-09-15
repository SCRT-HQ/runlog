/**
 * Who the plugin says it is, in the blocks a profile carries.
 *
 * Every action stored in a profile names the plugin that owns it and
 * carries the label the Stream Deck app shows beside it, and both come out
 * of `streamdeck/com.scrthq.runlog.sdPlugin/manifest.json`. The generator
 * used to read that file. A browser building a profile for a Marketplace
 * pack has no file to read, so the same handful of strings is written here
 * and `plugin.test.ts` holds them against the manifest: a rename or a
 * version bump over there fails that test, which is the prompt to change
 * this and regenerate the committed profiles, exactly as a layout change
 * would be.
 */

/** The plugin block every one of our actions carries. */
export const PLUGIN = { Name: "Runlog", UUID: "com.scrthq.runlog", Version: "0.1.0.0" };

/** The `Name` the app expects beside each of our actions, by the action's short name. */
export const ACTION_NAMES: Record<string, string> = {
  next: "Next action",
  press: "Press",
  roll: "Roll",
  undo: "Undo",
  run: "Run",
  connect: "Connect",
  metric: "Metric",
  setup: "Apply setup",
  command: "Command",
  open: "Open in the browser",
  clock: "Clock",
  autoroll: "Keep rolling for me",
  finish: "Finish the run",
};

/** The app's own page turns, which are not ours and take none of our furniture. */
export const PAGE_PLUGIN = { Name: "Pages", UUID: "com.elgato.streamdeck.page", Version: "1.0" };

export const TURNS = {
  next: { Name: "Next Page", UUID: "com.elgato.streamdeck.page.next" },
  previous: { Name: "Previous Page", UUID: "com.elgato.streamdeck.page.previous" },
};
