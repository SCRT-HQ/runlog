import { describe, expect, it } from "vitest";
import { addressOf, hrefFor, linkTo, runFromAddress } from "./route.ts";

/**
 * One address, two spellings: the hash the app reads, and the path the
 * hosted copy shows. Every page round-trips, a hash without a path spelling
 * is left alone, and paths only count under `play/` at the app's base.
 */
describe("an address, as a hash and as a path", () => {
  const cases: Array<[string, string]> = [
    ["#guide/streaming", "/guide/streaming"],
    ["#guide", "/guide"],
    ["#profile/servers", "/profile/servers"],
    ["#profile", "/profile"],
    ["#marketplace/com.scrthq.runlog.long-kiln", "/marketplace/com.scrthq.runlog.long-kiln"],
    ["#packs", "/packs"],
    ["#play", "/play"],
    ["#run/01ABC", "/run/01ABC"],
    ["#run/01ABC?t=tok", "/run/01ABC?t=tok"],
    ["#widget/clock/01ABC?bg=none&t=tok", "/widget/clock/01ABC?bg=none&t=tok"],
    ["#dock/controls/01ABC", "/dock/controls/01ABC"],
    ["#link/discord?c=ABCDEF", "/link/discord?c=ABCDEF"],
    ["#link/discord?verified=1", "/link/discord?verified=1"],
    ["#create", "/create"],
  ];

  it("spells every section at the root where paths are on, and reads it back", () => {
    for (const [hash, path] of cases) {
      expect(hrefFor(hash, "/")).toBe(path);
      const [pathname, search = ""] = path.split("?") as [string, string?];
      expect(addressOf({ pathname, search: search ? `?${search}` : "", hash: "" }, "/")).toBe(hash);
    }
  });

  it("still reads the addresses it used to write under play, so a bookmark keeps working", () => {
    // Written before the sections moved to the root. Read, then written
    // back in the new spelling by whoever lands on it.
    expect(addressOf({ pathname: "/play/guide/streaming", search: "", hash: "" }, "/")).toBe("#guide/streaming");
    // The marketplace was the catalog, under the old prefix and without it.
    expect(addressOf({ pathname: "/play/catalog/com.scrthq.runlog.long-kiln", search: "", hash: "" }, "/")).toBe("#marketplace/com.scrthq.runlog.long-kiln");
    expect(addressOf({ pathname: "/catalog", search: "", hash: "" }, "/")).toBe("#marketplace");
    expect(addressOf({ pathname: "/catalog/com.scrthq.runlog.long-kiln", search: "", hash: "" }, "/")).toBe("#marketplace/com.scrthq.runlog.long-kiln");
    expect(addressOf({ pathname: "/play/run/01ABC", search: "?t=tok", hash: "" }, "/")).toBe("#run/01ABC?t=tok");
    expect(addressOf({ pathname: "/runlog/play/profile", search: "", hash: "" }, "/runlog/")).toBe("#profile");
    // The front door itself is a section now, not a prefix.
    expect(addressOf({ pathname: "/play", search: "", hash: "" }, "/")).toBe("#play");
  });

  it("keeps the base a static host serves from", () => {
    expect(hrefFor("#guide/streaming", "/runlog/")).toBe("/runlog/guide/streaming");
    expect(addressOf({ pathname: "/runlog/guide/streaming", search: "", hash: "" }, "/runlog/")).toBe("#guide/streaming");
    // The app's front door, where nothing else is said: the run.
    expect(hrefFor("", "/runlog/")).toBe("/runlog/play");
    expect(hrefFor("", "/")).toBe("/play");
  });

  it("leaves a hash with no path spelling alone, in both directions", () => {
    expect(hrefFor("#pack=abc", "/")).toBe("#pack=abc");
    expect(hrefFor("#nope", "/")).toBe("#nope");
    expect(addressOf({ pathname: "/nope/x", search: "", hash: "" }, "/")).toBe("");
    expect(addressOf({ pathname: "/about.html", search: "", hash: "#guide/x" }, "/")).toBe("#guide/x");
    expect(addressOf({ pathname: "/play", search: "", hash: "#guide/x" }, "/")).toBe("#guide/x");
  });

  it("is only ever a hash where paths are off", () => {
    expect(hrefFor("#guide/streaming", null)).toBe("#guide/streaming");
    expect(hrefFor("", null)).toBe("");
    expect(addressOf({ pathname: "/play/guide/streaming", search: "", hash: "" }, null)).toBe("");
  });

  it("tells a run of this device's own from a live link to one", () => {
    expect(runFromAddress("#run/01ABC")).toBe("01ABC");
    expect(runFromAddress("#run/01ABC?t=tok")).toBeNull();
    expect(runFromAddress("#guide/start")).toBeNull();
  });
});

describe("a link the app writes for itself", () => {
  it("is the hash after where it belongs while paths are off, which is the case in tests", () => {
    expect(linkTo("#guide/start")).toBe("#guide/start");
    expect(linkTo("#guide/start", "/play")).toBe("/play#guide/start");
    expect(linkTo("#catalog/a-pack", "./")).toBe("./#catalog/a-pack");
  });
});
