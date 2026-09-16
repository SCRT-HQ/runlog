import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";

import streamDeck from "@elgato/streamdeck";
import { container, fromOffer, laysOut, profile, specsFor, type DeviceId, type Keyed } from "@runlog/deck-profiles";

import { DEVICE_PROFILES } from "./profiles.ts";
import type { DeckState } from "./state.ts";

/**
 * A profile for the pack the deck is following, built here rather than shipped.
 *
 * The plugin ships one for every pack in the repository. A pack from the
 * Marketplace was not there when the plugin was packed, so its run puts the
 * deck on the generic layout and none of the pack's own moves reach a key.
 * Everything a profile is laid out from is already in the snapshot the deck
 * is holding, though: the pack's moves and numbers in the layout, and the
 * setups for the tool in the offer. So the same generator the shipped
 * forty-four came out of runs here, on the run rather than on a pack file,
 * and what comes out is handed to the Stream Deck app to import.
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
 * A laid-out pack, written to a file beside the plugin.
 *
 * `null` for a layout with nothing of the pack's own on it, and for a deck
 * this package lays nothing out for, which is a Pedal or a Neo: the generic
 * profile is already that layout, and a file of it gives nobody anything
 * the plugin did not install.
 */
function write(
  keyed: Keyed,
  pack: { id: string; title?: string },
  device: number,
  from: string,
): { file: string; bytes: Uint8Array } | null {
  const deck = DEVICE_PROFILES[device] as DeviceId | undefined;
  if (deck === undefined || !laysOut(keyed)) return null;

  const slug = slugFor(pack.id);
  const spec = specsFor(keyed, { slug, name: pack.title ?? pack.id }, deck)[0]!;
  const bytes = container(profile(spec));

  const dir = join(cwd(), ...FOLDER);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}-${deck}.streamDeckProfile`);
  writeFileSync(file, bytes);
  streamDeck.logger.info(`profile: built ${slug}-${deck} from ${from}`);
  return { file, bytes };
}

/**
 * The profile for the run the deck is on, written to a file.
 *
 * The keys are the pack's, not the moment's: the snapshot's `layout` names
 * every move and number the pack has, and the offer is read for the setups
 * and the commands, which the layout does not carry. A page too old to
 * publish a layout leaves the offer as the only thing to read, and the
 * profile is then as narrow as whatever the run was waiting on.
 *
 * `null` where there is nothing to build from: no snapshot, no pack id, or
 * a deck this package lays nothing out for.
 */
export function buildFor(state: DeckState, device: number): { file: string; bytes: Uint8Array } | null {
  const run = state.snapshot?.run;
  if (!run?.packId) return null;
  const keyed = fromOffer(state.snapshot?.offer ?? {}, state.snapshot?.layout);
  return write(keyed, { id: run.packId, ...(run.packTitle ? { title: run.packTitle } : {}) }, device, "the run");
}

/**
 * Hands the file to the Stream Deck app by its own door.
 *
 * A `file:` URL through `openUrl` goes to the OS opener and the app never
 * hears of it (seen on an XL: the file was written, nothing was imported).
 * Double-clicking a `.streamDeckProfile` is turned by the app's own handler
 * into `streamdeck://app/openfile/<path>`, which is the link it acts on, so
 * that is the link to send.
 */
export function install(file: string): void {
  streamDeck.system.openUrl(`streamdeck://app/openfile/${encodeURIComponent(file)}`);
  streamDeck.logger.info("profile: handed to the Stream Deck app to import");
}
