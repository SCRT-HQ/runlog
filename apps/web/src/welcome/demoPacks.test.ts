import { describe, expect, it } from "vitest";
import { DEMO_PACK_IDS, loadDemoPack, parseDemoPack } from "./demoPacks.ts";
// A second real, valid pack, used only to prove a right-shaped, wrong-id
// pack is rejected rather than accepted under a different name.
import soundclashText from "../../../../packs/sketches/soundclash.yaml?raw";

/**
 * The landing page's only source of pack data: five bundled packs, loaded
 * straight out of the repository rather than through the marketplace's
 * listing/feed precedence, storage, or a network request. Nothing here may
 * reach for `loadMarketplace` or `marketplaceEntry`: a demo pack is not a
 * listing a publisher could replace.
 */
describe("the demo pack loader", () => {
  it("loads each allowlisted persona's pack and finds its named mode", async () => {
    const expected = [
      ["streamer", "com.scrthq.runlog.forfeits", "chats"],
      ["dj", "com.scrthq.runlog.soundclash", "clubStandard"],
      ["learner", "com.scrthq.runlog.practice-room", "hour"],
      ["elden-lord", "com.scrthq.runlog.elden-ring-tarnishedtool", "solo"],
      ["rlcs-champion", "com.scrthq.runlog.rocket-league-ladder", "placement"],
    ] as const;
    for (const [id, packId, modeId] of expected) {
      const pack = await loadDemoPack(id);
      expect(pack.id).toBe(packId);
      expect(pack.modes[modeId]).toBeDefined();
    }
  });

  it("lists exactly the five allowlisted ids, in the landing page's order", () => {
    expect(DEMO_PACK_IDS).toEqual(["streamer", "dj", "learner", "elden-lord", "rlcs-champion"]);
  });

  it("rejects malformed YAML rather than falling back to a marketplace copy", () => {
    expect(() => parseDemoPack("streamer", "not: [valid")).toThrow("Demo pack streamer failed to load");
  });

  it("rejects a valid pack whose id does not match the one asked for", () => {
    expect(() => parseDemoPack("streamer", soundclashText)).toThrow(
      "expected com.scrthq.runlog.forfeits, got com.scrthq.runlog.soundclash",
    );
  });
});
