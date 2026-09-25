import type { Attached, LiveStore, Watcher } from "../lib/handlers/live";

// Two rows, the way dynamoLive keeps them: `marks` is the CONN row, written
// by connect() and read by connection() and decksOf(); `watchMarks` is the
// per-session row, written by watch() from its own attached argument and
// read by watchers(). A deck's watch row must carry `deck: true` on its
// own, the same as it does in dynamo, or a deck would look like a writer
// of the run it is watching. The watch row is dated too, as dynamo dates
// it, because which of an account's devices takes a press turns on it.
// `follows` is a theme link's followers, by link id.
export function memoryLive(): LiveStore & {
  conns: Map<string, string>;
  watches: Map<string, Set<string>>;
  marks: Map<string, Attached>;
  watchMarks: Map<string, Attached>;
  follows: Map<string, Set<string>>;
} {
  const conns = new Map<string, string>();
  const watches = new Map<string, Set<string>>();
  const marks = new Map<string, Attached>();
  const watchMarks = new Map<string, Attached>();
  const watchedAt = new Map<string, string>();
  const follows = new Map<string, Set<string>>();
  const watchKey = (sessionId: string, connectionId: string) => `${sessionId}|${connectionId}`;
  return {
    conns,
    watches,
    marks,
    watchMarks,
    follows,
    async connect(id, sub, _at, attached) {
      conns.set(id, sub);
      if (attached) marks.set(id, attached);
    },
    async connection(id) {
      const sub = conns.get(id);
      return sub ? { sub, ...(marks.get(id) ?? {}) } : null;
    },
    async watch(id, sessionId, _sub, at, attached) {
      if (!watches.has(sessionId)) watches.set(sessionId, new Set());
      watches.get(sessionId)!.add(id);
      watchMarks.set(watchKey(sessionId, id), attached ?? {});
      watchedAt.set(watchKey(sessionId, id), at);
    },
    async watchers(sessionId): Promise<Watcher[]> {
      return [...(watches.get(sessionId) ?? [])].map((connectionId) => ({
        connectionId,
        sub: conns.get(connectionId) ?? "",
        watchedAt: watchedAt.get(watchKey(sessionId, connectionId)) ?? "",
        ...(watchMarks.get(watchKey(sessionId, connectionId)) ?? {}),
      }));
    },
    async unwatch(id, sessionId) {
      watches.get(sessionId)?.delete(id);
      watchMarks.delete(watchKey(sessionId, id));
      watchedAt.delete(watchKey(sessionId, id));
    },
    async decksOf(sub) {
      return [...conns.entries()]
        .filter(([id, s]) => s === sub && marks.get(id)?.deck === true)
        .map(([connectionId]) => ({ connectionId, ...(marks.get(connectionId) ?? {}) }));
    },
    async follow(id, channelId) {
      if (!follows.has(channelId)) follows.set(channelId, new Set());
      follows.get(channelId)!.add(id);
    },
    async followers(channelId) {
      return [...(follows.get(channelId) ?? [])];
    },
    async disconnect(id) {
      conns.delete(id);
      marks.delete(id);
      for (const [sessionId, set] of watches) {
        set.delete(id);
        watchMarks.delete(watchKey(sessionId, id));
        watchedAt.delete(watchKey(sessionId, id));
      }
      for (const set of follows.values()) set.delete(id);
    },
  };
}
