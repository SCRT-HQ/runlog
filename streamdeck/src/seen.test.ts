import { describe, expect, it } from "vitest";

import { allSeen, loadSeen, remember, seenSetups, setupsInOffer } from "./seen.ts";

/**
 * The setups a deck remembers off the runs it follows.
 *
 * One module holding one record, so every test here works on a pack id of
 * its own rather than resetting it: that is also how the plugin uses it,
 * one growing list per pack for the life of the install.
 */

/** As much of an offer as this reads, with the rest of the shape left off. */
const offer = (setups: Array<{ id: string; title: string }>, commands: Array<{ id: string; title: string }> = []) =>
  ({ setups, commands }) as never;

describe("the setups in a run's offer", () => {
  it("takes the warps among the commands as commands and the rest as setups", () => {
    // The offer lists every setup twice, once under each heading: which of
    // the two a key does is the key's own business on the page. A profile
    // has one key per setup, so the warps are the commands.
    const seen = setupsInOffer(
      offer(
        [
          { id: "s1", title: "Starter kit" },
          { id: "s2", title: "Warp to the camp" },
        ],
        [
          { id: "s1", title: "Starter kit" },
          { id: "s2", title: "Warp to the camp" },
        ],
      ),
    );
    expect(seen).toEqual([
      { id: "s1", title: "Starter kit", warp: false },
      { id: "s2", title: "Warp to the camp", warp: true },
    ]);
  });

  it("is nothing at all for an offer that carries none, and for no offer", () => {
    expect(setupsInOffer(undefined)).toEqual([]);
    expect(setupsInOffer(offer([]))).toEqual([]);
  });
});

describe("what the deck remembers for a pack", () => {
  it("keeps what it has seen, and says so only when the set moved", () => {
    const pack = "com.example.ember-trail";
    expect(remember(pack, [{ id: "s1", title: "Starter kit", warp: false }])).toBe(true);
    expect(seenSetups(pack)).toEqual([{ id: "s1", title: "Starter kit", warp: false }]);

    // The same offer again is every snapshot after the first: nothing is
    // written back to the settings for it.
    expect(remember(pack, [{ id: "s1", title: "Starter kit", warp: false }])).toBe(false);
    expect(remember(pack, [])).toBe(false);

    // A second setup is added rather than replacing the first.
    expect(remember(pack, [{ id: "s2", title: "Warp to the camp", warp: true }])).toBe(true);
    expect(seenSetups(pack).map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("takes the latest title without moving the setup down the deck", () => {
    const pack = "com.example.salt-and-signal";
    remember(pack, [
      { id: "s1", title: "Starter kit", warp: false },
      { id: "s2", title: "Second wind", warp: false },
    ]);
    expect(remember(pack, [{ id: "s1", title: "Starter kit, revised", warp: false }])).toBe(true);
    expect(seenSetups(pack)).toEqual([
      { id: "s1", title: "Starter kit, revised", warp: false },
      { id: "s2", title: "Second wind", warp: false },
    ]);
  });

  it("keeps sixty-four and drops the oldest", () => {
    const pack = "com.example.the-long-road";
    remember(
      pack,
      Array.from({ length: 70 }, (_, n) => ({ id: `s${n}`, title: `Setup ${n}`, warp: false })),
    );
    const kept = seenSetups(pack);
    expect(kept).toHaveLength(64);
    expect(kept[0]!.id).toBe("s6");
    expect(kept.at(-1)!.id).toBe("s69");
  });

  it("is nothing for a pack no run of which the deck has followed", () => {
    expect(seenSetups("com.example.never-seen")).toEqual([]);
  });
});

describe("what the global settings hold", () => {
  it("is merged in rather than taken whole", () => {
    const pack = "com.example.quarry-road";
    remember(pack, [{ id: "s1", title: "Starter kit", warp: false }]);
    // A settings event that crossed the write of s1 must not drop it.
    loadSeen({ [pack]: [{ id: "s2", title: "Second wind", warp: false }] });
    expect(seenSetups(pack).map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(allSeen()[pack]).toEqual(seenSetups(pack));
  });

  it("takes nothing from settings that hold none", () => {
    const before = allSeen();
    loadSeen(undefined);
    expect(allSeen()).toEqual(before);
  });
});
