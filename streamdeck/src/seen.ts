import { isWarp } from "@runlog/deck-profiles";

import type { Offer } from "./state.ts";

/**
 * The setups a deck has seen a run offer, kept per pack.
 *
 * A setup is written for a tool rather than for a pack, so a pack file
 * names none and a profile built from one would have no Apply setup keys
 * on it. The plugin ships a table of the setups written in the repository
 * (`setups.ts`), which covers the packs Runlog ships and nothing else. A
 * pack from the Marketplace, or one somebody wrote themselves, names its
 * setups in one place a deck can reach: the offer, on every snapshot of a
 * run of that pack.
 *
 * So they are remembered. What is kept is what a key is named from and
 * whether the run called it a command, which is the one thing the offer
 * says that the title alone does not. It lives in the plugin's global
 * settings, so a deck that followed a run last week can still lay the
 * pack out today without a run open anywhere.
 */

/**
 * A setup the deck has seen, as much of it as a key needs.
 *
 * `warp` is whether the run offered it as a command, which is a key that
 * hands it over once rather than changing what the run is held to.
 *
 * An alias rather than an interface on purpose: it goes into the global
 * settings, and the SDK wants what it stores to be JSON, which only an
 * alias satisfies.
 */
export type SeenSetup = { id: string; title: string; warp: boolean };

/**
 * How many setups are kept per pack.
 *
 * A library is somebody's own and has no ceiling; the settings file the
 * plugin keeps is written on every snapshot that moves this, so there has
 * to be one. Sixty-four is more than fills a deck of any size, and the
 * oldest go first.
 */
const CAP = 64;

let seen: Record<string, SeenSetup[]> = {};

/**
 * What the global settings hold, read back in at launch and on every change.
 *
 * Merged rather than taken whole. This fires from the plugin's own write as
 * much as from another surface's, and a setup seen a moment ago must not be
 * dropped by a settings event that crossed the write of it.
 */
export function loadSeen(from: Record<string, SeenSetup[]> | undefined): void {
  for (const [packId, setups] of Object.entries(from ?? {})) remember(packId, setups);
}

/** All of it, for writing back to the global settings. */
export function allSeen(): Record<string, SeenSetup[]> {
  return seen;
}

/** What the deck has seen for one pack, oldest first. */
export function seenSetups(packId: string): SeenSetup[] {
  return seen[packId] ?? [];
}

/**
 * The setups in a run's offer, as this keeps them.
 *
 * The offer's `commands` is not the warps: it is every setup again, less
 * whatever the wire would drop, because which of the two a key does is the
 * key's own business. `fromOffer` in `@runlog/deck-profiles` takes the
 * warps among them as the commands and the rest as the setups, and this
 * records the same split so a profile built later comes out the same.
 */
export function setupsInOffer(offer: Offer | undefined): SeenSetup[] {
  if (!offer) return [];
  const warps = new Set((offer.commands ?? []).filter((s) => isWarp(s)).map((s) => s.id));
  const out = new Map<string, SeenSetup>();
  for (const s of [...(offer.setups ?? []), ...(offer.commands ?? [])]) {
    out.set(s.id, { id: s.id, title: s.title, warp: warps.has(s.id) });
  }
  return [...out.values()];
}

/**
 * Merges what a snapshot offered into what is already known for the pack.
 *
 * By id, keeping the latest title: a setup renamed in somebody's library
 * should say the new name on the key. `false` where nothing moved, which
 * is every snapshot after the first of a run and is what keeps the global
 * settings from being rewritten once a second.
 */
export function remember(packId: string, setups: SeenSetup[]): boolean {
  if (setups.length === 0) return false;
  const before = seen[packId] ?? [];
  // `set` on a key already in the map keeps its place, so a title that
  // changed does not move the key to the end of the deck.
  const merged = new Map(before.map((s) => [s.id, s]));
  for (const s of setups) merged.set(s.id, s);
  const after = [...merged.values()].slice(-CAP);
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  seen = { ...seen, [packId]: after };
  return true;
}
