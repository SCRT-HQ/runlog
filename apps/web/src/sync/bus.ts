/**
 * How the rest of the app and the sync engine hear about each other.
 *
 * Two kinds of news: something changed here (the run hook wrote a log, a
 * pack was imported or forgotten, a license key was typed), and something
 * arrived from elsewhere (the engine pulled a run, a pack or a license). Neither side imports the other; both talk
 * to this. Deliberately tiny, a Map of listeners, because the alternative
 * is a state library for two events.
 */

export type Kind = "run" | "pack" | "license";

export type SyncNews =
  | { t: "localChange"; kind: Kind; id: string }
  | { t: "pulled"; kind: Kind; ids: string[] }
  /** Something at the table of a watched run that is not a move; see the socket's `Gesture`. */
  | { t: "gesture"; id: string; kind: string; data: Record<string, unknown>; from?: string; at: string };

type Listener = (news: SyncNews) => void;

const listeners = new Set<Listener>();

export const syncBus = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  emit(news: SyncNews): void {
    for (const l of listeners) l(news);
  },
  localChange(kind: Kind, id: string): void {
    syncBus.emit({ t: "localChange", kind, id });
  },
  pulled(kind: Kind, ids: string[]): void {
    if (ids.length > 0) syncBus.emit({ t: "pulled", kind, ids });
  },
};
