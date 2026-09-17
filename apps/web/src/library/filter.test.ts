import { describe, expect, it } from "vitest";
import { facets, featuresOf, filterMarketplace, kindCounts, type MarketplaceEntry } from "./marketplace.ts";

/**
 * The sidebar's logic, without the sidebar: features read off a pack's
 * declaration, and a query narrowing a list.
 */

const entry = (over: Partial<MarketplaceEntry> & { id: string }): MarketplaceEntry => ({
  version: "1",
  title: over.id,
  category: "other",
  tags: [],
  features: [],
  source: "bundled",
  players: 1,
  tablePlays: true,
  requires: [],
  blurb: "",
  kind: "pack",
  price: "free",
  load: async () => "",
  ...over,
});

describe("what a pack's declaration says about how it plays", () => {
  it("reads solo, together, moderated, seeded and endless off the modes", () => {
    const { features, players } = featuresOf({
      modes: {
        a: { label: "A" },
        b: { label: "B", players: { min: 2, max: 4 } },
        c: { label: "C", moderated: { contestants: { min: 2, max: 10 } }, seeded: true },
        d: { label: "D", units: { min: 1, max: 999 } },
      },
      capabilities: ["timers", "decks", "journal"],
      targeting: { strategy: "playerChoice" },
    });
    expect(features).toEqual(["solo", "together", "moderated", "seeded", "endless", "timers", "cards", "journal", "reachesBack"]);
    expect(players).toBe(11);
  });

  it("does not count a journal the pack switched off, nor targeting set to none", () => {
    const { features } = featuresOf({
      modes: { a: { label: "A" } },
      capabilities: ["journal"],
      journal: { enabled: false },
      targeting: { strategy: "none" },
    });
    expect(features).toEqual(["solo"]);
  });
});

describe("narrowing the marketplace", () => {
  const list = [
    entry({
      id: "day",
      title: "Any Given Day",
      category: "everyday",
      tags: ["habits", "focus"],
      features: ["solo", "together"],
      description: "A day of things to do.",
    }),
    entry({
      id: "trial",
      title: "Elden Ring: Trial",
      category: "games",
      tags: ["Elden Ring", "race"],
      features: ["moderated", "seeded"],
      author: "Runlog",
    }),
    entry({ id: "kiln", title: "The Long Kiln", category: "craft", tags: ["ceramics"], features: ["solo", "cards"] }),
  ];

  it("matches words anywhere a person would look, case-insensitively", () => {
    expect(filterMarketplace(list, { q: "elden" }).map((e) => e.id)).toEqual(["trial"]);
    expect(filterMarketplace(list, { q: "things to do" }).map((e) => e.id)).toEqual(["day"]);
    expect(filterMarketplace(list, { q: "runlog craft" })).toHaveLength(0);
    expect(filterMarketplace(list, { q: "" })).toHaveLength(3);
  });

  it("categories are any-of, features and tags are all-of", () => {
    expect(filterMarketplace(list, { categories: new Set(["games", "craft"]) }).map((e) => e.id)).toEqual(["trial", "kiln"]);
    expect(filterMarketplace(list, { features: new Set(["solo", "cards"]) }).map((e) => e.id)).toEqual(["kiln"]);
    expect(filterMarketplace(list, { tags: new Set(["race"]) }).map((e) => e.id)).toEqual(["trial"]);
    expect(filterMarketplace(list, { tags: new Set(["race", "habits"]) })).toHaveLength(0);
  });

  it("can show only what is already in the library, or only what is not", () => {
    const owned = new Set(["kiln"]);
    expect(filterMarketplace(list, { mine: true }, owned).map((e) => e.id)).toEqual(["kiln"]);
    expect(filterMarketplace(list, { mine: false }, owned).map((e) => e.id)).toEqual(["day", "trial"]);
  });

  it("offers every value present, most common first", () => {
    const f = facets(list);
    expect(f.categories.map((c) => c.value)).toEqual(["craft", "everyday", "games"]);
    expect(f.features[0]).toMatchObject({ id: "solo", count: 2 });
    expect(f.tags.find((t) => t.value === "Elden Ring")?.count).toBe(1);
    expect(f.authors).toEqual([{ value: "Runlog", count: 1 }]);
  });
});

/**
 * The marketplace sold one kind of thing and so never had to say which.
 *
 * A setup is a document of its own, written for a tool rather than for a
 * pack, and somebody looking for one is not looking for the other. What
 * has to hold is that the second kind arriving changes nothing for
 * anybody who only wants the first.
 */
describe("kinds of listing", () => {
  const packs = [entry({ id: "a" }), entry({ id: "b" })];
  const setups = [{ ...entry({ id: "s" }), kind: "setup" as const }];
  const all = [...packs, ...setups];

  it("shows one kind at a time when asked", () => {
    expect(filterMarketplace(all, { kind: "pack" }).map((e) => e.id)).toEqual(["a", "b"]);
    expect(filterMarketplace(all, { kind: "setup" }).map((e) => e.id)).toEqual(["s"]);
  });

  it("shows everything when not asked, which is what it did before there were kinds", () => {
    expect(filterMarketplace(all, {}).map((e) => e.id)).toEqual(["a", "b", "s"]);
  });

  it("counts each kind, so a chooser need not offer an empty one", () => {
    expect(kindCounts(all)).toEqual({ pack: 2, setup: 1 });
    expect(kindCounts(packs)).toEqual({ pack: 2, setup: 0 });
  });

  it("narrows with the other filters rather than instead of them", () => {
    const tagged = [...packs, { ...entry({ id: "s2" }), kind: "setup" as const, tags: ["elden"] }];
    expect(filterMarketplace(tagged, { kind: "setup", tags: new Set(["elden"]) }).map((e) => e.id)).toEqual(["s2"]);
    expect(filterMarketplace(tagged, { kind: "pack", tags: new Set(["elden"]) })).toEqual([]);
  });
});
