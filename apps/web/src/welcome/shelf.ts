import heads from "virtual:runlog-shelf";
import { loadFeed, STARTER_PACK, type MarketplaceEntry } from "../library/marketplace.ts";

/** One card on the welcome page's pack shelf. */
export interface ShelfEntry {
  id: string;
  title: string;
  description?: string;
}

/**
 * The packs that ship, for the welcome page's shelf, in the marketplace's
 * own order: the starter first, then by title.
 *
 * The names come from a module made at build time (see shelf.ts beside
 * vite.config.ts), not from `loadMarketplace`, which reads every bundled
 * pack's whole file to get them. The feed is still asked, where there is
 * one, and a listing wins over the bundle's copy of the same id, as it does
 * in the marketplace: the platform seeds the built-ins into the feed, so a
 * newer version published is the one the shelf names.
 */
export async function loadShelf(feed: () => Promise<MarketplaceEntry[]> = loadFeed): Promise<ShelfEntry[]> {
  const byId = new Map<string, ShelfEntry>(heads.map((head) => [head.id, head]));
  for (const listing of await feed()) {
    if (!byId.has(listing.id)) continue;
    byId.set(listing.id, {
      id: listing.id,
      title: listing.title,
      ...(listing.description ? { description: listing.description } : {}),
    });
  }
  return [...byId.values()].sort((a, b) => {
    if (a.id === STARTER_PACK || b.id === STARTER_PACK) return a.id === STARTER_PACK ? -1 : b.id === STARTER_PACK ? 1 : 0;
    return a.title.localeCompare(b.title);
  });
}
