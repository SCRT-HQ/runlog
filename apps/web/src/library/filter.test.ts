import { describe, expect, it } from "vitest";
import { facets, featuresOf, filterCatalog, type CatalogEntry } from "./catalog.ts";

/**
 * The sidebar's logic, without the sidebar: features read off a pack's
 * declaration, and a query narrowing a list.
 */

const entry = (over: Partial<CatalogEntry> & { id: string }): CatalogEntry => ({
  version: "1",
  title: over.id,
  category: "other",
  tags: [],
  features: [],
  source: "bundled",
  players: 1,
  requires: [],
  kind: "",
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
    const { features } = featuresOf({ modes: { a: { label: "A" } }, capabilities: ["journal"], journal: { enabled: false }, targeting: { strategy: "none" } });
    expect(features).toEqual(["solo"]);
  });
});

describe("narrowing the catalog", () => {
  const list = [
    entry({ id: "day", title: "Any Given Day", category: "everyday", tags: ["habits", "focus"], features: ["solo", "together"], description: "A day of things to do." }),
    entry({ id: "trial", title: "Elden Ring: Trial", category: "games", tags: ["Elden Ring", "race"], features: ["moderated", "seeded"], author: "Runlog" }),
    entry({ id: "kiln", title: "The Long Kiln", category: "craft", tags: ["ceramics"], features: ["solo", "cards"] }),
  ];

  it("matches words anywhere a person would look, case-insensitively", () => {
    expect(filterCatalog(list, { q: "elden" }).map((e) => e.id)).toEqual(["trial"]);
    expect(filterCatalog(list, { q: "things to do" }).map((e) => e.id)).toEqual(["day"]);
    expect(filterCatalog(list, { q: "runlog craft" })).toHaveLength(0);
    expect(filterCatalog(list, { q: "" })).toHaveLength(3);
  });

  it("categories are any-of, features and tags are all-of", () => {
    expect(filterCatalog(list, { categories: new Set(["games", "craft"]) }).map((e) => e.id)).toEqual(["trial", "kiln"]);
    expect(filterCatalog(list, { features: new Set(["solo", "cards"]) }).map((e) => e.id)).toEqual(["kiln"]);
    expect(filterCatalog(list, { tags: new Set(["race"]) }).map((e) => e.id)).toEqual(["trial"]);
    expect(filterCatalog(list, { tags: new Set(["race", "habits"]) })).toHaveLength(0);
  });

  it("can show only what is already in the library, or only what is not", () => {
    const owned = new Set(["kiln"]);
    expect(filterCatalog(list, { mine: true }, owned).map((e) => e.id)).toEqual(["kiln"]);
    expect(filterCatalog(list, { mine: false }, owned).map((e) => e.id)).toEqual(["day", "trial"]);
  });

  it("offers every value present, most common first", () => {
    const f = facets(list);
    expect(f.categories.map((c) => c.value)).toEqual(["craft", "everyday", "games"]);
    expect(f.features[0]).toMatchObject({ id: "solo", count: 2 });
    expect(f.tags.find((t) => t.value === "Elden Ring")?.count).toBe(1);
    expect(f.authors).toEqual([{ value: "Runlog", count: 1 }]);
  });
});
