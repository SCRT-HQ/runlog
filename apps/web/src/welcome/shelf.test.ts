import { describe, expect, it } from "vitest";
import { loadMarketplace, shippedIds, STARTER_PACK, type MarketplaceEntry } from "../library/marketplace.ts";
import { loadShelf } from "./shelf.ts";

/**
 * The welcome page's shelf, without the marketplace's reading of every pack.
 *
 * The names are made at build time, so the guard that matters is that they
 * say what the marketplace would have said: the same packs, the same titles
 * and descriptions, in the same order.
 */

const none = async () => [];

describe("the welcome page's shelf", () => {
  it("names the packs that ship exactly as the marketplace does, in its order", async () => {
    const [all, shipped] = await Promise.all([loadMarketplace({ testing: false }), shippedIds()]);
    const expected = all
      .filter((entry) => shipped.has(entry.id))
      .map((entry) => ({ id: entry.id, title: entry.title, ...(entry.description ? { description: entry.description } : {}) }));
    const shelf = await loadShelf(none);
    expect(shelf).toEqual(expected);
    expect(shelf).toHaveLength(9);
    expect(shelf[0]!.id).toBe(STARTER_PACK);
  });

  it("takes a listing's words over the bundle's copy of the same pack, and leaves other listings off", async () => {
    const listing = (id: string, title: string, description?: string) =>
      ({ id, title, ...(description ? { description } : {}) }) as unknown as MarketplaceEntry;
    const shelf = await loadShelf(async () => [
      listing(STARTER_PACK, "Forfeits, newer", "Published since."),
      listing("org.someone.else", "Not shipped"),
    ]);
    expect(shelf[0]).toEqual({ id: STARTER_PACK, title: "Forfeits, newer", description: "Published since." });
    expect(shelf.map((e) => e.id)).not.toContain("org.someone.else");
    expect(shelf).toHaveLength(9);
  });
});
