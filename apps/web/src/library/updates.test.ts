import { describe, expect, it } from "vitest";
import { newerVersion, updatesFor, type MarketplaceEntry } from "./marketplace.ts";

const entry = (id: string, version: string): MarketplaceEntry => ({
  id,
  version,
  title: id,
  category: "other",
  tags: [],
  features: [],
  requires: [],
  players: 1,
  kind: "",
  price: "free",
  source: "bundled",
  load: async () => "",
});

describe("versions", () => {
  it("compare as people write them", () => {
    expect(newerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(newerVersion("2", "1.9.9")).toBe(true);
    expect(newerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(newerVersion("0.9.0", "1.0.0")).toBe(false);
    expect(newerVersion("1.0.0", "1.0.0-beta")).toBe(true);
    expect(newerVersion("1.0.0-beta", "1.0.0")).toBe(false);
  });
});

describe("what the marketplace can update", () => {
  const entries = [entry("dev.runlog.kiln", "1.2.0"), entry("dev.runlog.day", "0.1.0")];
  it("offers a newer version to a pack that came from the marketplace, and only to those", () => {
    const packs = [
      { id: "kiln", origin: "catalog", catalog: { id: "dev.runlog.kiln", version: "1.0.0" } },
      { id: "day", origin: "catalog", catalog: { id: "dev.runlog.day", version: "0.1.0" } },
      { id: "mine", origin: "file" },
      { id: "dev.runlog.kiln" },
      { id: "gone", origin: "catalog", catalog: { id: "dev.runlog.kiln", version: "0.1.0" }, deletedAt: "2026-01-01" },
    ];
    const out = updatesFor(packs, entries);
    expect([...out.keys()]).toEqual(["kiln"]);
    expect(out.get("kiln")?.version).toBe("1.2.0");
  });
});
