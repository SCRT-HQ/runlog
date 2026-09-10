import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { catalogEntry, filterCatalog, LEGACY_IDS, loadCatalog, publishersOf, STARTER_PACK, withTesting, type CatalogEntry } from "./catalog.ts";

/**
 * The catalog is the packs directory, read at build. What has to hold: every
 * entry is a pack that loads, the starter is first, and the names the old
 * header used still find their packs.
 */
describe("the catalog", () => {
  it("lists every pack that ships, each of which loads", async () => {
    const entries = await loadCatalog();
    expect(entries.map((e) => e.id)).toEqual([
      "com.scrthq.runlog.any-given-day",
      "com.scrthq.runlog.elden-ring-expedition",
      "com.scrthq.runlog.elden-ring-trial",
      "com.scrthq.runlog.forfeits",
      "com.scrthq.runlog.frog-first",
      "com.scrthq.runlog.homefront",
      "com.scrthq.runlog.ladder-work",
      "com.scrthq.runlog.engine-testing",
      "com.scrthq.runlog.pantry-roulette",
      "com.scrthq.runlog.practice-room",
      "com.scrthq.runlog.rocket-league-ladder",
      "com.scrthq.runlog.rocket-league-showdown",
      "com.scrthq.runlog.run-of-show",
      "com.scrthq.runlog.salt-and-signal",
      "com.scrthq.runlog.sunday-desk",
      "com.scrthq.runlog.the-backlog",
      "com.scrthq.runlog.long-kiln",
      "com.scrthq.runlog.twenty-five",
      "com.scrthq.runlog.two-doors",
      "com.scrthq.runlog.word-count",
    ]);
    for (const e of entries) {
      const parsed = loadPackText(await e.load(), "yaml");
      expect(parsed.ok, e.id).toBe(true);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.price).toBe("free");
      // Every shipped pack says what it is and how it plays.
      expect(e.category, e.id).not.toBe("other");
      expect(e.tags.length, e.id).toBeGreaterThan(0);
      expect(e.features.length, e.id).toBeGreaterThan(0);
    }
    const trial = entries.find((e) => e.id === "com.scrthq.runlog.elden-ring-trial");
    expect(trial?.features).toContain("moderated");
    expect(trial?.features).not.toContain("solo");
    const day = entries.find((e) => e.id === "com.scrthq.runlog.any-given-day");
    expect(day?.features).toEqual(expect.arrayContaining(["solo", "together", "seeded", "timers", "cards", "journal", "reachesBack"]));
  });

  it("puts the starter first, and knows the old short names", async () => {
    expect((await loadCatalog())[0]?.id).toBe(STARTER_PACK);
    expect(await catalogEntry(LEGACY_IDS["kiln"]!)).toMatchObject({ title: "The Long Kiln" });
    expect(await catalogEntry("nope")).toBeNull();
  });
});

describe("publishers in the catalog", () => {
  const entry = (id: string, publisher: { id: string; name: string } | undefined, price: CatalogEntry["price"]): CatalogEntry =>
    ({ id, version: "1", title: id, category: "games", tags: [], features: [], requires: [], players: 1, kind: "", price, publisher, source: "listing", load: async () => "" }) as CatalogEntry;
  const all = [
    entry("a", { id: "org1", name: "Kiln Works" }, "free"),
    entry("b", { id: "org1", name: "Kiln Works" }, { amount: 300, currency: "usd", display: "$3.00" }),
    entry("c", { id: "org1", name: "Kiln Works" }, { amount: 150, currency: "usd", display: "$1.50" }),
    entry("d", { id: "org2", name: "Ash" }, "free"),
    entry("e", undefined, "free"),
  ];

  it("lists each publisher with what they have, most packs first", () => {
    expect(publishersOf(all)).toEqual([
      { id: "org1", name: "Kiln Works", count: 3, free: 1, from: "$1.50" },
      { id: "org2", name: "Ash", count: 1, free: 1, from: null },
    ]);
  });

  it("narrows to one publisher's packs", () => {
    expect(filterCatalog(all, { publisher: "org1" }).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(filterCatalog(all, { publisher: "org2", q: "d" }).map((e) => e.id)).toEqual(["d"]);
  });
});

describe("the test bench", () => {
  /**
   * `packs/testing/engine-testing.yaml` is a separate pull request's pack
   * and may not exist on this branch, so its entry is built by hand rather
   * than read off disk: the rule under test is what `loadCatalog` does
   * with a `bench: true` entry, not the pack file itself.
   */
  const bench: CatalogEntry = {
    id: "com.scrthq.runlog.engine-testing",
    version: "1.0.0",
    title: "Engine Testing",
    category: "other",
    tags: [],
    features: [],
    requires: [],
    players: 1,
    kind: "",
    price: "free",
    source: "bundled",
    load: async () => "",
    bench: true,
  };
  const ordinary: CatalogEntry = { ...bench, id: "com.scrthq.runlog.any-given-day", title: "Any Given Day", bench: undefined };

  it("is dropped from a copy whose catalog should not carry it", () => {
    expect(withTesting([ordinary, bench], false).map((e) => e.id)).toEqual([ordinary.id]);
  });

  it("stays when the copy carries it, or when nothing was asked either way", () => {
    expect(withTesting([ordinary, bench], true).map((e) => e.id)).toEqual([ordinary.id, bench.id]);
    expect(withTesting([ordinary, bench]).map((e) => e.id)).toEqual([ordinary.id, bench.id]);
  });

  it("is never counted as a publisher's listing, even if one somehow named it", () => {
    const listed = { ...bench, publisher: { id: "org1", name: "Kiln Works" } };
    expect(publishersOf([listed, { ...ordinary, publisher: { id: "org1", name: "Kiln Works" } }])).toEqual([{ id: "org1", name: "Kiln Works", count: 1, free: 1, from: null }]);
  });
});
