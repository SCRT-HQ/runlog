import { describe, expect, it } from "vitest";
import { addressOf, hrefFor, linkTo, runFromAddress } from "./route.ts";

/**
 * One address, two spellings: the hash the app reads, and the path the
 * hosted copy shows. Every page round-trips, a hash without a path spelling
 * is left alone, and paths only count under `play/` at the app's base.
 */
describe("an address, as a hash and as a path", () => {
  const cases: Array<[string, string]> = [
    ["#guide/streaming", "/play/guide/streaming"],
    ["#guide", "/play/guide"],
    ["#profile/servers", "/play/profile/servers"],
    ["#profile", "/play/profile"],
    ["#catalog/com.scrthq.runlog.long-kiln", "/play/catalog/com.scrthq.runlog.long-kiln"],
    ["#run/01ABC", "/play/run/01ABC"],
    ["#run/01ABC?t=tok", "/play/run/01ABC?t=tok"],
    ["#widget/clock/01ABC?bg=none&t=tok", "/play/widget/clock/01ABC?bg=none&t=tok"],
    ["#dock/controls/01ABC", "/play/dock/controls/01ABC"],
    ["#link/discord?c=ABCDEF", "/play/link/discord?c=ABCDEF"],
    ["#link/discord?verified=1", "/play/link/discord?verified=1"],
    ["#create", "/play/create"],
  ];

  it("spells every page as a path under play where paths are on, and reads it back", () => {
    for (const [hash, path] of cases) {
      expect(hrefFor(hash, "/")).toBe(path);
      const [pathname, search = ""] = path.split("?") as [string, string?];
      expect(addressOf({ pathname, search: search ? `?${search}` : "", hash: "" }, "/")).toBe(hash);
    }
  });

  it("keeps the base a static host serves from", () => {
    expect(hrefFor("#guide/streaming", "/runlog/")).toBe("/runlog/play/guide/streaming");
    expect(addressOf({ pathname: "/runlog/play/guide/streaming", search: "", hash: "" }, "/runlog/")).toBe("#guide/streaming");
    expect(hrefFor("", "/runlog/")).toBe("/runlog/play");
    expect(hrefFor("", "/")).toBe("/play");
  });

  it("leaves a hash with no path spelling alone, in both directions", () => {
    expect(hrefFor("#pack=abc", "/")).toBe("#pack=abc");
    expect(hrefFor("#nope", "/")).toBe("#nope");
    expect(addressOf({ pathname: "/play/nope/x", search: "", hash: "" }, "/")).toBe("");
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
