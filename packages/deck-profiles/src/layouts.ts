import type { Setup } from "@runlog/rules-schema";

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
  { action: "press", settings: { target: { kind: "roll" } } },
  { action: "open", settings: { target: "run" } },
  { action: "open", settings: { target: "guide" } },
  { action: "finish" },
];

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
 */
export function isWarp(setup: Setup): boolean {
  return setup.title.startsWith("Warp") || (setup.ops ?? []).some((op) => op.op.startsWith("warp."));
}
