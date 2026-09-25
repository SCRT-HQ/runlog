import { LOOK_CHANNEL_LIMITS } from "@runlog/themes";
import { assertLookHash, assertLookId, assertLookTime, type LookChannelRow, type LookStore } from "../lib/handlers/looks";

/** The theme link store in Maps, with the same all-or-nothing rules the transactions give. */
export function memoryLooks(limit: number = LOOK_CHANNEL_LIMITS.maxChannels): LookStore & {
  rows: Map<string, LookChannelRow>;
  pointers: Map<string, { sub: string; id: string }>;
  counts: Map<string, number>;
} {
  const rows = new Map<string, LookChannelRow>();
  const pointers = new Map<string, { sub: string; id: string }>();
  const counts = new Map<string, number>();
  const key = (sub: string, id: string) => `${sub}/${id}`;
  const store: LookStore & { rows: typeof rows; pointers: typeof pointers; counts: typeof counts } = {
    rows,
    pointers,
    counts,
    async list(sub) {
      return [...rows.values()].filter((r) => r.sub === sub).sort((a, b) => (a.id < b.id ? -1 : 1));
    },
    async get(sub, id) {
      assertLookId(id);
      return rows.get(key(sub, id)) ?? null;
    },
    async byReadKey(hash) {
      assertLookHash(hash);
      return pointers.get(hash) ?? null;
    },
    async create({ sub, id, readKeyHash, secretHash, at }) {
      assertLookId(id);
      assertLookHash(readKeyHash);
      assertLookHash(secretHash);
      assertLookTime(at);
      if ([...rows.values()].filter((r) => r.sub === sub).length >= limit) return "full";
      if (rows.has(key(sub, id)) || pointers.has(readKeyHash)) throw new Error("theme link collision");
      rows.set(key(sub, id), {
        sub,
        id,
        readKeyHash,
        secretHash,
        revision: 0,
        snapshot: null,
        createdAt: at,
        updatedAt: at,
        publishedAt: null,
      });
      pointers.set(readKeyHash, { sub, id });
      return "created";
    },
    async countPublish(sub, id, at) {
      assertLookId(id);
      assertLookTime(at);
      const k = `${sub}/${id}/${at.slice(0, 16)}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k)!;
    },
    async publish({ sub, id, secretHash, base, snapshot, at }) {
      assertLookId(id);
      assertLookHash(secretHash);
      assertLookTime(at);
      if (!Number.isSafeInteger(base) || base < 0) throw new Error("theme link base revision is not a revision");
      const row = rows.get(key(sub, id));
      if (!row) return { kind: "gone" };
      if (row.secretHash !== secretHash) return { kind: "not-publisher" };
      if (row.revision !== base) return { kind: "stale", revision: row.revision };
      const revision = row.revision + 1;
      rows.set(key(sub, id), { ...row, revision, snapshot, updatedAt: at, publishedAt: at });
      return { kind: "published", revision };
    },
    async rotateSecret({ sub, id, secretHash, at }) {
      assertLookId(id);
      assertLookHash(secretHash);
      assertLookTime(at);
      const row = rows.get(key(sub, id));
      if (!row) return false;
      rows.set(key(sub, id), { ...row, secretHash, updatedAt: at });
      return true;
    },
    async relink({ sub, id, readKeyHash, at }) {
      assertLookId(id);
      assertLookHash(readKeyHash);
      assertLookTime(at);
      const row = rows.get(key(sub, id));
      if (!row || pointers.has(readKeyHash)) return null;
      pointers.delete(row.readKeyHash);
      pointers.set(readKeyHash, { sub, id });
      rows.set(key(sub, id), { ...row, readKeyHash, updatedAt: at });
      return { oldReadKeyHash: row.readKeyHash };
    },
    async remove(sub, id) {
      assertLookId(id);
      const row = rows.get(key(sub, id));
      if (!row) return false;
      rows.delete(key(sub, id));
      pointers.delete(row.readKeyHash);
      return true;
    },
    async removeAll(sub) {
      const ids: string[] = [];
      for (const { id } of await store.list(sub)) if (await store.remove(sub, id)) ids.push(id);
      return ids;
    },
  };
  return store;
}
