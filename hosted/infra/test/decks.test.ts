import { describe, expect, it } from "vitest";

import { deckTeller, type DeckStore } from "../lib/handlers/decks.js";
import type { LiveStore, Poster, Watcher } from "../lib/handlers/live.js";

/**
 * The run list a deck reads, and what is allowed to send it.
 *
 * It used to be a closure inside the socket handler, so the only things
 * that could tell a deck its list had moved were things that happened on a
 * socket. A run is ended over HTTP, which meant the one moment a deck most
 * needs to hear about never reached it: the list went on naming a run that
 * was over, and every key went on saying it had ended.
 */

/** Just enough of a live store to hand a list to a deck. */
function fakeLive(over: {
  decks?: string[];
  watchers?: Record<string, Array<Partial<Watcher> & { sub: string }>>;
}): LiveStore & { gone: string[] } {
  const gone: string[] = [];
  return {
    gone,
    async watchers(sessionId: string) {
      return (over.watchers?.[sessionId] ?? []).map((w) => ({ connectionId: "w", watchedAt: "", ...w }) as Watcher);
    },
    async decksOf() {
      return (over.decks ?? []).map((connectionId) => ({ connectionId }));
    },
    async disconnect(id: string) {
      gone.push(id);
    },
  } as unknown as LiveStore & { gone: string[] };
}

const store = (rows: Array<Record<string, unknown>>): DeckStore => ({
  async manifest() {
    return {
      sessions: rows.map((s) => ({ role: "owner", updatedAt: "2026-01-01T00:00:00.000Z", ...s })) as never,
    };
  },
});

function recorder(result: "sent" | "gone" = "sent"): { posted: Array<[string, string]>; poster: Poster } {
  const posted: Array<[string, string]> = [];
  return {
    posted,
    poster: {
      async post(connectionId, data) {
        posted.push([connectionId, data]);
        return result;
      },
    },
  };
}

const line = (posted: Array<[string, string]>, id: string) => JSON.parse(posted.find(([c]) => c === id)![1]);

describe("telling a deck which runs are held", () => {
  it("names a run a page is holding, and leaves out one nobody is", async () => {
    const live = fakeLive({ decks: ["deck1"], watchers: { s1: [{ sub: "user_1" }] } });
    const { posted, poster } = recorder();

    await deckTeller(live, poster, store([{ id: "s1", name: "Thursday" }, { id: "s2" }]))("user_1");

    expect(line(posted, "deck1")).toEqual({ t: "runs", runs: [{ id: "s1", name: "Thursday", held: true }], any: true });
  });

  it("drops a run that has ended, which is the thing a deck is waiting to hear", async () => {
    const live = fakeLive({ decks: ["deck1"], watchers: { s1: [{ sub: "user_1" }] } });
    const { posted, poster } = recorder();

    // The page is still open and still watching, so nothing on the socket
    // has changed. The run is over all the same, and `any` goes with it:
    // the account has nothing open, which is a different key face from an
    // account whose runs are all local.
    await deckTeller(live, poster, store([{ id: "s1", endedAt: "2026-01-02T00:00:00.000Z" }]))("user_1");

    expect(line(posted, "deck1")).toEqual({ t: "runs", runs: [], any: false });
  });

  it("counts a run the account owns but nothing is holding, so the deck knows it is there", async () => {
    // Held is what can be pressed; `any` is what exists. A run with no page
    // on it is the second and not the first.
    const live = fakeLive({ decks: ["deck1"], watchers: {} });
    const { posted, poster } = recorder();

    await deckTeller(live, poster, store([{ id: "s1" }]))("user_1");

    expect(line(posted, "deck1")).toEqual({ t: "runs", runs: [], any: true });
  });

  it("does not count a deck's own watch as somebody holding the run", async () => {
    // A deck watching a run is not a device that can play it. If it were,
    // a deck would hold its own run open for ever.
    const live = fakeLive({ decks: ["deck1"], watchers: { s1: [{ sub: "user_1", deck: true }] } });
    const { posted, poster } = recorder();

    await deckTeller(live, poster, store([{ id: "s1" }]))("user_1");

    expect(line(posted, "deck1").runs).toEqual([]);
  });

  it("says nothing at all when the account has no deck connected", async () => {
    const { posted, poster } = recorder();
    await deckTeller(fakeLive({ decks: [] }), poster, store([{ id: "s1" }]))("user_1");
    expect(posted).toEqual([]);
  });

  it("tells one deck alone when that deck is the one that asked", async () => {
    const live = fakeLive({ decks: ["deck1", "deck2"] });
    const { posted, poster } = recorder();

    await deckTeller(live, poster, store([{ id: "s1" }]))("user_1", "deck2");

    expect(posted.map(([id]) => id)).toEqual(["deck2"]);
  });

  it("forgets a connection the gateway says is gone", async () => {
    const live = fakeLive({ decks: ["deck1"] });
    const { poster } = recorder("gone");

    await deckTeller(live, poster, store([{ id: "s1" }]))("user_1");

    expect(live.gone).toEqual(["deck1"]);
  });

  it("swallows a store that will not answer, so no caller is brought down by a list", async () => {
    const live = fakeLive({ decks: ["deck1"] });
    const { posted, poster } = recorder();
    const broken: DeckStore = {
      async manifest() {
        throw new Error("no");
      },
    };

    await expect(deckTeller(live, poster, broken)("user_1")).resolves.toBeUndefined();
    expect(posted).toEqual([]);
  });

  it("does nothing without a poster, which is how a test rig runs", async () => {
    const live = fakeLive({ decks: ["deck1"] });
    await expect(deckTeller(live, undefined, store([{ id: "s1" }]))("user_1")).resolves.toBeUndefined();
  });
});
