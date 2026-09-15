/**
 * The decks we lay a profile out for, and the keys every profile opens with.
 *
 * Data only: `profiles.mjs` does the arranging. Splitting them is what lets
 * the test hold a layout against a grid without running a generator, and it
 * keeps the one thing a person is likely to edit - what sits where - in a
 * file with no machinery in it.
 */

/**
 * The four decks, with the numbers a layout needs.
 *
 * `model` is the string the Stream Deck app writes into a profile's
 * `Device.Model`, taken from the app's own shipped profiles rather than
 * guessed: `DefaultProfiles/StreamDeck*_winDefault.streamDeckProfile` for the
 * Stream Deck, the Mini and the +, and the XL from a plugin that ships one.
 * `type` is the manifest's `DeviceType`, which is the SDK's own enumeration.
 *
 * A + has eight keys and four dials, and they are two different controllers
 * in a profile rather than twelve positions on one.
 */
export const DEVICES = {
  xl: { model: "20GAT9901", type: 2, columns: 8, rows: 4, dials: 0 },
  sd: { model: "20GAA9902", type: 0, columns: 5, rows: 3, dials: 0 },
  mini: { model: "20GAI9901", type: 1, columns: 3, rows: 2, dials: 0 },
  plus: { model: "20GBD9901", type: 7, columns: 4, rows: 2, dials: 4 },
};

/**
 * The keys every profile opens with, in the order they are laid down.
 *
 * Connect first because nothing else does anything until it has been
 * pressed, then the run it is on, then the three presses somebody reaches
 * for mid-scene, then the numbers. The dedicated Roll key and the Press key
 * set to the waiting roll are both here on purpose: Roll is lit only while
 * dice are waiting, and Press takes the primary whatever it is, so the two
 * say different things about the same moment.
 *
 * The clock and the dice the run throws for itself sit with the presses,
 * because both are things somebody reaches for while a scene is running.
 *
 * The two Open keys come last but one because nothing on the deck needs
 * them mid-scene: one puts the run in the browser, the other the guide.
 * Finish is last of all, as far from a hand mid-scene as the layout goes,
 * and it takes a hold on top of that.
 *
 * Fourteen keys, which is more than a Mini or a + has room for. They page.
 */
export const BASE = [
  { action: "connect" },
  { action: "run" },
  { action: "next" },
  { action: "roll" },
  { action: "undo" },
  { action: "clock" },
  { action: "autoroll" },
  { action: "metric", settings: { field: "score" } },
  { action: "metric", settings: { field: "unit" } },
  { action: "metric", settings: { field: "clock" } },
  { action: "press", settings: { target: { kind: "roll" } } },
  { action: "open", settings: { target: "run" } },
  { action: "open", settings: { target: "guide" } },
  { action: "finish" },
];

/**
 * What the four dials on a + carry.
 *
 * Only Next and Metric declare `Encoder` in the manifest, so these are the
 * only two that can sit here at all. They repeat on every page of a +
 * profile: paging moves the keys, and a clock you can no longer see because
 * you turned to the moves is a dial doing nobody any good.
 */
export const DIALS = [
  { action: "next" },
  { action: "metric", settings: { field: "score" } },
  { action: "metric", settings: { field: "clock" } },
  { action: "metric", settings: { field: "unit" } },
];

/**
 * The packs a profile is laid out for: the demo pack, and every sketch.
 *
 * Paths rather than a list of packs, because the list is whatever is on
 * disk. `profiles.mjs` reads the sketches folder, so a pack added to the
 * repository has a profile on the next run of the generator without anybody
 * editing a list here.
 */
export const DEMO = { slug: "demo", file: "packs/demo/pack.yaml" };
export const SKETCHES = "packs/sketches";

/**
 * A pack's slug is its file's stem, and these are the exceptions.
 *
 * The slug is what names the `.streamDeckProfile` file, the manifest entry
 * and the profile the plugin switches to, so changing one renames a profile
 * on every deck that already has it. Elden Ring's was laid out before the
 * rule existed and keeps the name it shipped under.
 */
export const SLUGS = { "elden-ring-tarnishedtool": "elden-ring" };
