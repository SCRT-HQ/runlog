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

/**
 * What kind of thing a setup is, as this package needs to know it.
 *
 * A copy of the vocabulary `@runlog/rules-schema` defines, the way this
 * package keeps its own copy of the offer and of the engine's layout. The
 * reason is the same: this code is bundled into a browser and into the
 * Stream Deck plugin, and importing a value out of the schema package
 * drags the schema, and the container package behind it, into both
 * bundles. A type is erased and costs nothing; five words are not worth a
 * dependency.
 *
 * The copy is only worth anything while it still matches, which is what
 * `profiles.test.ts` holds it to.
 */
export const SETUP_GROUPS = ["loadout", "items", "unlocks", "warp", "effects"] as const;
export type SetupGroup = (typeof SETUP_GROUPS)[number];

/**
 * Which group a setup belongs to, for one that did not say.
 *
 * Everything this package is handed says so now: a file read off disk
 * declares it, the offer carries it, and the table the plugin ships writes
 * it down. This is for what arrives from somewhere older, and it reads the
 * operations the way the schema package does, less the cases that cannot
 * reach here.
 */
export function groupFrom(setup: { title: string; ops?: Array<{ op: string }> }): SetupGroup {
  const ops = (setup.ops ?? []).map((o) => o.op);
  if (ops.some((op) => op.startsWith("warp."))) return "warp";
  if (ops.some((op) => op.startsWith("weapon."))) return "loadout";
  if (ops.length > 0 && ops.every((op) => op.startsWith("item.") || op.startsWith("runes."))) return "items";
  // An offer carries no operations at all, and a title is the last of the
  // old guess: a deck following a page too old to say should still put the
  // warps on the Warp key.
  if (ops.length === 0 && setup.title.startsWith("Warp")) return "warp";
  return ops.length === 0 ? "loadout" : "effects";
}

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
 * The Open key comes last but one because nothing on the deck needs it
 * mid-scene: it puts the run in the browser. Finish is last of all, as far
 * from a hand mid-scene as the layout goes, and it takes a hold on top of
 * that.
 *
 * Every key here is about the run in hand. The ones that are not are
 * {@link UTILITY}, on a page of their own at the end of every profile.
 *
 * No Metric key is set to the clock: the Clock action is a key of its own,
 * and a picker never offers what a dedicated key does. The last result is
 * the readout that takes that place.
 *
 * Twelve keys, which is more than a Mini or a + has room for. They page.
 * This order is what a deck too small for a frame lays down; the XL and
 * the Stream Deck spread the same twelve over the zones below.
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
  { action: "metric", settings: { field: "latest" } },
  { action: "open", settings: { target: "run" } },
  { action: "finish" },
];

/**
 * The keys that are not about the run in hand.
 *
 * Install a profile, the guide, a new run and the dock: none of them reads
 * anything off the run the deck is following, and none of them is pressed
 * mid-scene. They sit on the last page of every profile, so every deck has
 * them without anybody adding a key by hand, and so page one stays the
 * run's.
 */
export const UTILITY: Key[] = [
  { action: "install" },
  { action: "open", settings: { target: "guide" } },
  { action: "open", settings: { target: "newrun" } },
  { action: "open", settings: { target: "dock" } },
];

/**
 * The last page of a framed profile, cell by cell.
 *
 * It is not the run's page, so it does not wear the run's frame. It keeps
 * Connect and the run in the top left, because a deck that is not
 * connected is a deck that says nothing wherever you are standing, and
 * puts the rest in the right two columns, around the way back. The way
 * back itself is the frame's own `turns.previous`, so a hand finds it in
 * the same cell it turns every other page from.
 *
 * Only the framed decks are here. A Mini and a + page through their keys
 * in order, and the page after the last of them is already {@link UTILITY}
 * alone.
 */
export const UTILITY_PAGE: Record<"xl" | "sd", Array<{ key: Key; at: string }>> = {
  xl: [
    { key: { action: "connect" }, at: "0,0" },
    { key: { action: "run" }, at: "1,0" },
    { key: { action: "open", settings: { target: "rules" } }, at: "6,0" },
    { key: { action: "open", settings: { target: "guide" } }, at: "7,0" },
    { key: { action: "open", settings: { target: "run" } }, at: "6,1" },
    { key: { action: "open", settings: { target: "newrun" } }, at: "7,1" },
    { key: { action: "autoroll" }, at: "6,2" },
    { key: { action: "open", settings: { target: "dock" } }, at: "7,2" },
    { key: { action: "install" }, at: "7,3" },
  ],
  sd: [
    { key: { action: "connect" }, at: "0,0" },
    { key: { action: "run" }, at: "1,0" },
    { key: { action: "open", settings: { target: "rules" } }, at: "3,0" },
    { key: { action: "open", settings: { target: "guide" } }, at: "4,0" },
    { key: { action: "open", settings: { target: "dock" } }, at: "2,1" },
    { key: { action: "open", settings: { target: "run" } }, at: "3,1" },
    { key: { action: "open", settings: { target: "newrun" } }, at: "4,1" },
    { key: { action: "autoroll" }, at: "2,2" },
    { key: { action: "install" }, at: "4,2" },
  ],
};

/**
 * The three things a pack puts on a deck, each with a pool of cells.
 *
 * A pool is a row or a block the frame keeps for one kind of key, and each
 * has a queue of its own: `numbers` is what an eye reads, `setups` is what
 * a tool is handed, `moves` is what a hand presses mid-scene.
 */
export type Pool = "numbers" | "setups" | "moves";

/** The pools in the order a page fills each from its own queue. */
export const POOLS: Pool[] = ["numbers", "setups", "moves"];

/** The order the queues spill in, once every pool has taken its own. */
export const SPILLS: Pool[] = ["moves", "setups", "numbers"];

/**
 * A deck laid out in zones: what stays put, and the cells that page.
 *
 * `fixed` is the frame proper, the keys in the same cell on every page of
 * the run's. The pools are the free cells around it.
 *
 * `extras` are the base keys this frame has no cell for. Each queue takes
 * them either side of the pack's own: `first` is what a deck that cannot
 * pin all twelve still opens on, and `last` is what waits behind the pack.
 */
export interface Queued {
  /** Ahead of the pack's keys. */
  first: Key[];
  /** Behind them. */
  last: Key[];
}

export interface Frame {
  /** A key and the cell it holds on every page of the run's. Cells are `"column,row"`. */
  fixed: Array<{ key: Key; at: string }>;
  /** The base keys the frame leaves out, before and behind the pack's own in each queue. */
  extras: Record<Pool, Queued>;
  /** The free cells each pool owns, in the order it fills them. */
  pools: Record<Pool, string[]>;
  /** Where a queue looks for a cell once its own pool is full. */
  spill: Record<Pool, Pool[]>;
  /**
   * Where a page turn goes on a page that needs one.
   *
   * Every profile ends on the utility page, so every page ahead of it
   * spends the next cell. A cell listed in a pool and taken by a turn is
   * the pool's on the pages the turn is not there, which is how the moves
   * reach one cell further along on page one.
   */
  turns: { next: string; previous: string };
  /** The last page, from {@link UTILITY_PAGE}. */
  utility: Array<{ key: Key; at: string }>;
}

/**
 * The XL and the Stream Deck, laid out the way a streamer laid one out.
 *
 * The left of the deck is the run: Connect, the run, Undo and the clock
 * along the top, Next and the three readouts under them, Roll below that,
 * Finish in the bottom left corner. None of it moves as the pages turn.
 *
 * The right of the deck is the pack: its counters and resources across the
 * top right, its setups on the third row, its moves along the bottom. The
 * page turns sit in the bottom right corner, where a hand ends.
 *
 * Nothing that is not about the run in hand is on these pages. The guide,
 * a new run, the dock, the rules, the dice the run throws for itself and
 * Install a profile are all on {@link UTILITY_PAGE}, the last page of
 * every profile.
 *
 * The Mini and the + have no frame here on purpose. Six keys and eight are
 * fewer than the twelve every profile opens with, so anything pinned
 * down would be a cell the pack's own keys never get; those two lay
 * {@link BASE} down in order and page.
 */
export const FRAMES: Partial<Record<DeviceId, Frame>> = {
  // Eight by four. Ten cells are the run's, and the twenty-one that are
  // left are the pack's, in three pools with a row each.
  xl: {
    fixed: [
      { key: { action: "connect" }, at: "0,0" },
      { key: { action: "run" }, at: "1,0" },
      { key: { action: "undo" }, at: "2,0" },
      { key: { action: "clock" }, at: "3,0" },
      { key: { action: "next" }, at: "0,1" },
      { key: { action: "metric", settings: { field: "latest" } }, at: "1,1" },
      { key: { action: "metric", settings: { field: "unit" } }, at: "2,1" },
      { key: { action: "metric", settings: { field: "score" } }, at: "3,1" },
      { key: { action: "roll" }, at: "0,2" },
      { key: { action: "finish" }, at: "0,3" },
    ],
    // Every base key an XL has room to pin is pinned, so nothing queues
    // beside the pack's own.
    extras: {
      numbers: { first: [], last: [] },
      setups: { first: [], last: [] },
      moves: { first: [], last: [] },
    },
    pools: {
      numbers: ["4,0", "5,0", "6,0", "7,0", "4,1", "5,1", "6,1", "7,1"],
      setups: ["1,2", "2,2", "3,2", "4,2", "5,2", "6,2", "7,2"],
      // 6,3 is the way back on every page but the first, where there is
      // nowhere to go back to.
      moves: ["1,3", "2,3", "3,3", "4,3", "5,3", "6,3"],
    },
    spill: { numbers: ["setups", "moves"], setups: ["numbers", "moves"], moves: ["setups", "numbers"] },
    turns: { next: "7,3", previous: "6,3" },
    utility: UTILITY_PAGE.xl,
  },
  // Five by three, where a pinned key is a cell the pack never gets. The
  // same shape at that size: the run along the top and down the left, the
  // moves along the bottom, the two number cells beside them. Only the
  // score is pinned of the three readouts; the other two lead the numbers
  // queue, so a pack with a counter of its own gets those cells instead.
  sd: {
    fixed: [
      { key: { action: "connect" }, at: "0,0" },
      { key: { action: "run" }, at: "1,0" },
      { key: { action: "undo" }, at: "2,0" },
      { key: { action: "clock" }, at: "3,0" },
      { key: { action: "metric", settings: { field: "score" } }, at: "4,0" },
      { key: { action: "next" }, at: "0,1" },
      { key: { action: "roll" }, at: "1,1" },
      { key: { action: "finish" }, at: "2,1" },
    ],
    extras: {
      numbers: {
        first: [
          { action: "metric", settings: { field: "latest" } },
          { action: "metric", settings: { field: "unit" } },
        ],
        last: [],
      },
      setups: { first: [], last: [] },
      moves: { first: [], last: [] },
    },
    pools: {
      numbers: ["3,1", "4,1"],
      // No row to spare for the setups on a five by three: they spill.
      setups: [],
      moves: ["0,2", "1,2", "2,2", "3,2"],
    },
    spill: { numbers: ["setups", "moves"], setups: ["moves", "numbers"], moves: ["setups", "numbers"] },
    turns: { next: "4,2", previous: "3,2" },
    utility: UTILITY_PAGE.sd,
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
