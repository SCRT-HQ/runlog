import { describe, expect, it } from "vitest";
import { addressForPlay, addressOf, createSectionFromHash, hrefFor, linkTo, runFromAddress, seatFromAddress } from "./route.ts";

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
    ["#packs/dev.runlog.kiln/docs", "/packs/dev.runlog.kiln/docs"],
    ["#marketplace/dev.runlog.kiln/docs/rulebook", "/marketplace/dev.runlog.kiln/docs/rulebook"],
    ["#play", "/play"],
    ["#run/01ABC", "/run/01ABC"],
    ["#seat/01ABC", "/seat/01ABC"],
    ["#run/01ABC?t=tok", "/run/01ABC?t=tok"],
    ["#widget/clock/01ABC?bg=none&t=tok", "/widget/clock/01ABC?bg=none&t=tok"],
    ["#dock/controls/01ABC", "/dock/controls/01ABC"],
    ["#link/discord?c=ABCDEF", "/link/discord?c=ABCDEF"],
    ["#link/discord?verified=1", "/link/discord?verified=1"],
    ["#create", "/create"],
    ["#create/tables", "/create/tables"],
    ["#themes/recovery", "/themes/recovery"],
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
    // The marketplace was the marketplace, under the old prefix and without it.
    expect(addressOf({ pathname: "/play/marketplace/com.scrthq.runlog.long-kiln", search: "", hash: "" }, "/")).toBe(
      "#marketplace/com.scrthq.runlog.long-kiln",
    );
    expect(addressOf({ pathname: "/marketplace", search: "", hash: "" }, "/")).toBe("#marketplace");
    expect(addressOf({ pathname: "/marketplace/com.scrthq.runlog.long-kiln", search: "", hash: "" }, "/")).toBe(
      "#marketplace/com.scrthq.runlog.long-kiln",
    );
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

  it("tells a run played from a seat from a run of this device's own", () => {
    expect(seatFromAddress("#seat/01ABC")).toBe("01ABC");
    expect(seatFromAddress("#run/01ABC")).toBeNull();
    expect(runFromAddress("#seat/01ABC")).toBeNull();
  });
});

/**
 * The Designer's section, in the address.
 *
 * The editor is six sections now, and which one is showing is worth a
 * reload and a Back press, so it is spelled in the address like any other
 * page. The bare `#create` is the Designer with nothing said about where
 * in it, which the editor reads as its first section.
 */
describe("the Designer's section", () => {
  it("reads the segment after create, and nothing said is the first section", () => {
    expect(createSectionFromHash("#create/tables")).toBe("tables");
    expect(createSectionFromHash("#create/publish")).toBe("publish");
    expect(createSectionFromHash("#create")).toBe("");
  });

  it("is not any other head, and not a word that merely starts with one", () => {
    for (const at of ["", "#packs", "#guide/start", "#createx", "#create/tables/extra", "#run/01ABC"]) {
      expect(createSectionFromHash(at)).toBeNull();
    }
  });
});

describe("a link the app writes for itself", () => {
  it("is the hash after where it belongs while paths are off, which is the case in tests", () => {
    expect(linkTo("#guide/start")).toBe("#guide/start");
    expect(linkTo("#guide/start", "/play")).toBe("/play#guide/start");
    expect(linkTo("#marketplace/a-pack", "./")).toBe("./#marketplace/a-pack");
  });
});

/**
 * Where the run writes its own address.
 *
 * Reported from play: starting a run from the shelf left `/packs` in
 * the bar, so a refresh went back to the shelf. Every other section
 * wrote its address on the way in and the run did not.
 */
describe("the address the run should be wearing", () => {
  it("takes over another section's address, since that section is no longer on screen", () => {
    for (const at of ["#packs", "#guide", "#guide/streaming", "#profile", "#profile/servers", "#marketplace", "#create"]) {
      expect(addressForPlay(at, true)).toBe("#play");
    }
  });

  it("says the shelf where there is no pack loaded, which is what the run view shows then", () => {
    expect(addressForPlay("#packs", false)).toBe("#packs");
    expect(addressForPlay("#marketplace", false)).toBe("#packs");
  });

  it("leaves a run that has named itself alone", () => {
    expect(addressForPlay("#run/01ABC", true)).toBeNull();
    expect(addressForPlay("#play", true)).toBeNull();
  });

  it("leaves alone what is not a section: the run view has nothing better to say", () => {
    // A shared pack, a race code, a widget, an empty address.
    for (const at of ["", "#shared/abc", "#race/XYZ", "#widget/log", "#dock/1"]) {
      expect(addressForPlay(at, true)).toBeNull();
    }
  });

  it("is not fooled by a section's name inside another word", () => {
    expect(addressForPlay("#packsomething", true)).toBeNull();
    expect(addressForPlay("#guidebook", true)).toBeNull();
  });
});
