/**
 * The decks we lay a profile out for, and the keys every profile opens with.
 *
 * Data only: `profiles.ts` does the arranging. Splitting them is what lets
 * a test hold a layout against a grid without running a generator, and it
 * keeps the one thing a person is likely to edit, what sits where, in a
 * file with no machinery in it.
 */

/** One deck, with the numbers a layout needs and the word a person calls it. */
export interface Device {
  /** What the Stream Deck app writes into a profile's `Device.Model`. */
  model: string;
  /** The manifest's `DeviceType`, which is the SDK's own enumeration. */
  type: number;
  columns: number;
  rows: number;
  dials: number;
  /** What to call it on a button somebody is choosing a download from. */
  label: string;
}

export type DeviceId = "xl" | "sd" | "mini" | "plus";

/**
 * The four decks, with the numbers a layout needs.
 *
 * `model` is taken from the app's own shipped profiles rather than
 * guessed: `DefaultProfiles/StreamDeck*_winDefault.streamDeckProfile` for
 * the Stream Deck, the Mini and the +, and the XL from a plugin that ships
 * one.
 *
 * A + has eight keys and four dials, and they are two different
 * controllers in a profile rather than twelve positions on one.
 */
export const DEVICES: Record<DeviceId, Device> = {
  xl: { model: "20GAT9901", type: 2, columns: 8, rows: 4, dials: 0, label: "XL" },
  sd: { model: "20GAA9902", type: 0, columns: 5, rows: 3, dials: 0, label: "Stream Deck" },
  mini: { model: "20GAI9901", type: 1, columns: 3, rows: 2, dials: 0, label: "Mini" },
  plus: { model: "20GBD9901", type: 7, columns: 4, rows: 2, dials: 4, label: "+" },
};

/** The decks in the order a profile is written for each, which the manifest lists them in. */
export const DEVICE_IDS: DeviceId[] = ["xl", "sd", "mini", "plus"];

/** One key, before anything knows which deck it is going on. */
export interface Key {
  /** The action's short name, which is the last part of its UUID. */
  action: string;
  settings?: Record<string, unknown>;
}

/**
 * The keys every profile opens with, in the order they are laid down.
 *
 * Connect first because nothing else does anything until it has been
 * pressed, then the run it is on, then the three presses somebody reaches
 * for mid-scene, then the numbers.
 *
 * The clock and the dice the run throws for itself sit with the presses,
 * because both are things somebody reaches for while a scene is running.
 *
 * The two Open keys come last but one because nothing on the deck needs
 * them mid-scene: one puts the run in the browser, the other the guide.
 * Finish is last of all, as far from a hand mid-scene as the layout goes,
 * and it takes a hold on top of that.
 *
 * Thirteen keys, which is more than a Mini or a + has room for. They page.
 * This order is what a deck too small for a frame lays down; the XL and
 * the Stream Deck spread the same thirteen over the zones below.
 */
export const BASE: Key[] = [
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
  { action: "open", settings: { target: "run" } },
  { action: "open", settings: { target: "guide" } },
  { action: "finish" },
];

/**
 * A deck laid out in zones: what stays put, and the cells that page.
 *
 * `fixed` is the frame proper, the keys in the same cell on every page of
 * the profile. The two pools are the free cells either side of it, each in
 * the order it fills, and each fed by a queue of its own: `drive` is what a
 * hand presses, `numbers` is what an eye reads.
 *
 * `extras` are the base keys this frame has no cell for; they go at the
 * front of their queue, so a deck that cannot pin all thirteen still opens
 * on them.
 */
export interface Frame {
  /** A key and the cell it holds on every page. Cells are `"column,row"`. */
  fixed: Array<{ key: Key; at: string }>;
  /**
   * Where a pack's Open rules key sits.
   *
   * Only a pack profile has one. The generic profile has the cell as the
   * first free one on the numbers side rather than a hole in the frame.
   */
  rules?: string;
  /** The base keys the frame leaves out, at the front of their queues. */
  extras: { drive: Key[]; numbers: Key[] };
  /** The free cells on the left, in fill order. */
  drive: string[];
  /** The free cells on the right, in fill order. */
  numbers: string[];
  /**
   * Where a page turn goes on a page that needs one.
   *
   * Both are ordinary free cells on every other page, which is how a
   * layout that fits does not grow a turn pointing at nothing.
   */
  turns: { next: string; previous: string };
}

/**
 * The XL and the Stream Deck, laid out by where a hand rests.
 *
 * Both put the driving keys under the left hand and the numbers under the
 * right eye, and both keep that arrangement on every page: the moves and
 * the trackers a pack brings page through the free cells, and Next, Roll
 * and Undo stay where the thumb left them.
 *
 * The second row is the trio pressed mid-scene, so the hand finds it
 * without looking, with Connect and the run above it. Finish sits in the
 * far bottom corner, as far from that hand as the grid goes, and it takes
 * a hold on top of that.
 *
 * The Mini and the + have no frame here on purpose. Six keys and eight are
 * fewer than the thirteen every profile opens with, so anything pinned
 * down would be a cell the pack's own keys never get; those two lay
 * {@link BASE} down in order and page.
 */
export const FRAMES: Partial<Record<DeviceId, Frame>> = {
  // Eight by four. The top row is the run and the numbers it works out,
  // the second the trio, and the six cells under the trio are the pack's
  // to fill. The right two thirds below the top row are all numbers.
  xl: {
    fixed: [
      { key: { action: "connect" }, at: "0,0" },
      { key: { action: "run" }, at: "1,0" },
      { key: { action: "open", settings: { target: "run" } }, at: "2,0" },
      { key: { action: "open", settings: { target: "guide" } }, at: "3,0" },
      { key: { action: "metric", settings: { field: "score" } }, at: "4,0" },
      { key: { action: "metric", settings: { field: "unit" } }, at: "5,0" },
      { key: { action: "metric", settings: { field: "clock" } }, at: "6,0" },
      { key: { action: "next" }, at: "0,1" },
      { key: { action: "roll" }, at: "1,1" },
      { key: { action: "undo" }, at: "2,1" },
      { key: { action: "clock" }, at: "3,1" },
      { key: { action: "autoroll" }, at: "0,2" },
      { key: { action: "finish" }, at: "0,3" },
    ],
    rules: "7,0",
    extras: { drive: [], numbers: [] },
    drive: ["1,2", "2,2", "3,2", "1,3", "2,3", "3,3"],
    numbers: ["4,1", "5,1", "6,1", "7,1", "4,2", "5,2", "6,2", "7,2", "4,3", "5,3", "6,3", "7,3"],
    turns: { next: "7,3", previous: "6,3" },
  },
  // Five by three. Two of the fifteen cells are all the room there is for
  // numbers beside the frame, so the clock's readout and the two Open keys
  // queue rather than pin, and the pack's own keys take what is left.
  sd: {
    fixed: [
      { key: { action: "connect" }, at: "0,0" },
      { key: { action: "run" }, at: "1,0" },
      { key: { action: "autoroll" }, at: "2,0" },
      { key: { action: "clock" }, at: "3,0" },
      { key: { action: "metric", settings: { field: "score" } }, at: "4,0" },
      { key: { action: "next" }, at: "0,1" },
      { key: { action: "roll" }, at: "1,1" },
      { key: { action: "undo" }, at: "2,1" },
      { key: { action: "metric", settings: { field: "unit" } }, at: "4,1" },
      { key: { action: "finish" }, at: "0,2" },
    ],
    extras: {
      drive: [
        { action: "open", settings: { target: "run" } },
        { action: "open", settings: { target: "guide" } },
      ],
      numbers: [{ action: "metric", settings: { field: "clock" } }],
    },
    drive: ["3,1", "1,2", "2,2", "3,2"],
    numbers: ["4,2"],
    turns: { next: "4,2", previous: "3,2" },
  },
};

/**
 * What the four dials on a + carry.
 *
 * Next, Metric and Clock declare `Encoder` in the manifest, so those three
 * are what can sit here at all. They repeat on every page of a + profile:
 * paging moves the keys, and a clock you can no longer see because you
 * turned to the moves is a dial doing nobody any good. The clock is the
 * action rather than the metric's readout of it, so turning to it and
 * pressing the dial pauses or resumes rather than doing nothing.
 */
export const DIALS: Key[] = [
  { action: "next" },
  { action: "metric", settings: { field: "score" } },
  { action: "clock" },
  { action: "metric", settings: { field: "unit" } },
];

/**
 * A setup a pack's profile puts on a Command key rather than an Apply-setup one.
 *
 * A setup that moves the player is a different kind of press from one that
 * only changes what they are holding: it happens once, it does not touch
 * the run's own setup, and it is worth a key that says so rather than one
 * that says "Apply setup" about a warp. `Warp` at the front of the title is
 * how an author says so on purpose; a `warp.*` op is how the tool says so
 * whether the author thought to name it that or not.
 *
 * The operations are optional because a run's offer carries none: a setup
 * reaches a deck as an id and a title, so the title is the only half of
 * this that travels. A pack read off disk hands over the whole file and
 * gets both halves.
 */
export function isWarp(setup: { title: string; ops?: Array<{ op: string }> }): boolean {
  return setup.title.startsWith("Warp") || (setup.ops ?? []).some((op) => op.op.startsWith("warp."));
}
