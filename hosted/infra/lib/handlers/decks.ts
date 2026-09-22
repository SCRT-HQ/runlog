import type { LiveStore, Poster, Watcher } from "./live.js";
import type { SessionPointer } from "./store.js";

/**
 * The list a Stream Deck picks a run from.
 *
 * A deck names no run when it connects: it names the account, and this
 * says which of that account's runs are open and which of those something
 * is holding. The deck picks from that, so the list has to arrive whenever
 * it changes, and this is the one piece of code that sends it.
 *
 * It lives here rather than inside the socket handler because a run does
 * not only change on a socket. A run is ended over HTTP, and while the
 * only sender was a closure in `ws.ts`, ending one told the deck nothing:
 * its list went on naming a run that was over, every key read "That run
 * has ended", and nothing on the deck could ask again.
 */

/** One of the account's runs that a device is holding open, as a deck reads it. */
export type HeldRun = { id: string; name?: string; packTitle?: string; held: true };

/** The one thing a run list needs of the store. */
export interface DeckStore {
  manifest(sub: string): Promise<{ sessions: SessionPointer[] }>;
}

/** Says which runs are held to an account's decks, or to one of them. */
export type TellDecks = (sub: string, only?: string) => Promise<void>;

/**
 * Whether a watcher is a device that could be playing the run.
 *
 * A control surface, a deck, a seat and the two anonymous kinds are all
 * watching rather than playing. A run nothing but those is on is a run with
 * nobody at the keyboard, and a deck pressing it would press into a void.
 */
export function writes(w: { sub: string; control?: boolean; deck?: boolean; seated?: boolean }): boolean {
  return !w.control && !w.deck && !w.seated && !w.sub.startsWith("public:") && !w.sub.startsWith("stream:");
}

/**
 * The account's runs, and which of them something is holding open.
 *
 * The newest twenty are considered, because an account's manifest is every
 * run it has ever played and a deck's picker is a short list.
 *
 * `any` is the difference between an account whose runs are all local and
 * one that has nothing open at all: the key says "Not synced" for the
 * first and "No run open" for the second, and only this end can tell.
 */
export async function heldRuns(live: LiveStore, store: DeckStore, sub: string): Promise<{ runs: HeldRun[]; any: boolean }> {
  const { sessions } = await store.manifest(sub);
  const mine = sessions
    .filter((p) => p.role === "owner" && !p.deletedAt && !p.endedAt)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  const recent = mine.slice(0, 20);
  const held = await Promise.all(recent.map(async (p) => (((await live.watchers(p.id)) as Watcher[]).some(writes) ? p : null)));
  return {
    any: mine.length > 0,
    runs: held
      .filter((p): p is (typeof recent)[number] => p !== null)
      .map((p) => ({
        id: p.id,
        ...(p.name ? { name: p.name } : {}),
        ...(p.packTitle ? { packTitle: p.packTitle } : {}),
        held: true as const,
      })),
  };
}

/**
 * A sender of run lists, for whichever handler has news.
 *
 * Everything in here sits under one guard: a deck that cannot be given its
 * list right now is still connected and hears the next push. A rejection
 * out of the manifest or the watchers must not turn its caller into a 500,
 * which on `$connect` would refuse the deck outright and on an HTTP route
 * would fail a request that has already done its real work.
 */
export function deckTeller(live: LiveStore, poster: Poster | undefined, store: DeckStore): TellDecks {
  return async (sub, only) => {
    if (!poster) return;
    try {
      const decks = only ? [{ connectionId: only }] : await live.decksOf(sub);
      if (decks.length === 0) return;
      const line = JSON.stringify({ t: "runs", ...(await heldRuns(live, store, sub)) });
      for (const d of decks) {
        if ((await poster.post(d.connectionId, line)) === "gone") await live.disconnect(d.connectionId);
      }
    } catch (error) {
      console.error("live: could not say which runs are held", error);
    }
  };
}
