import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";

import streamDeck from "@elgato/streamdeck";
import { container, fromOffer, profile, specsFor, type DeviceId } from "@runlog/deck-profiles";

import { DEVICE_PROFILES } from "./profiles.ts";
import type { DeckState } from "./state.ts";

/**
 * A profile for the pack the deck is following, built here rather than shipped.
 *
 * The plugin ships one for every pack in the repository. A pack from the
 * Marketplace was not there when the plugin was packed, so its run puts the
 * deck on the generic layout and none of the pack's own moves reach a key.
 * Everything a profile is laid out from is already in the offer the deck is
 * holding, though: the moves, the trackers, and the setups for the tool. So
 * the same generator the shipped forty-four came out of runs here, on the
 * run rather than on a pack file, and what comes out is handed to the
 * Stream Deck app to import.
 *
 * Handed over, not installed. A plugin may only switch to a profile it
 * declares in its manifest, and a pack nobody had heard of when the plugin
 * was packed is not in there. A `.streamDeckProfile` is the app's own file
 * type, so opening it is the app's import prompt, and what the streamer
 * gets is a profile of their own that nothing here can take away again.
 */

/** Where a built profile is written: the plugin's own folder, beside the logs the SDK writes. */
const FOLDER = ["profiles", "on-demand"];

/**
 * A pack id as a file name.
 *
 * Ids are reverse-domain and usually already safe; anything else a pack
 * author put in one becomes a dash rather than a path somewhere it should
 * not be. Two ids that differ only in what is replaced land on one file,
 * which costs a rebuild and nothing else: the file is written every time.
 */
export function slugFor(packId: string): string {
  return packId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+/, "") || "pack";
}

/**
 * The profile for the run the deck is on, written to a file.
 *
 * `null` where there is nothing to build from: no snapshot, no pack id, or
 * a deck this package lays nothing out for, which is a Pedal or a Neo.
 */
export function buildFor(state: DeckState, device: number): { file: string; bytes: Uint8Array } | null {
  const run = state.snapshot?.run;
  const deck = DEVICE_PROFILES[device] as DeviceId | undefined;
  if (!run?.packId || deck === undefined) return null;

  const slug = slugFor(run.packId);
  const keyed = fromOffer(state.snapshot?.offer ?? {});
  const spec = specsFor(keyed, { slug, name: run.packTitle ?? run.packId }, deck)[0]!;
  const bytes = container(profile(spec));

  const dir = join(cwd(), ...FOLDER);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}-${deck}.streamDeckProfile`);
  writeFileSync(file, bytes);
  streamDeck.logger.info(`profile: built ${slug}-${deck} from the run`);
  return { file, bytes };
}

/** Hands the file to whatever opens a `.streamDeckProfile`, which is the Stream Deck app. */
export function install(file: string): void {
  streamDeck.system.openUrl(pathToFileURL(file).href);
  streamDeck.logger.info("profile: handed to the Stream Deck app to import");
}
