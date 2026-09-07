/**
 * Local storage for packs, runs and licenses.
 *
 * Everything here stays in the browser unless the player signs in, which
 * turns sync on for this device (a switch turns it back off). That default is not incidental: a pack may be a private
 * transcription of a rulebook someone paid for, and a run log is a record of
 * their own work. Neither leaves the machine on its own — and when sync is
 * on, a pack's text still only travels if the player says so for that pack.
 *
 * IndexedDB rather than localStorage because runs are event logs that grow all
 * session, imported packs are large enough to matter, and a training log might
 * be resumed a week later. localStorage remains as a migration source for runs
 * saved before this existed.
 *
 * Written against the raw API rather than pulling in a wrapper: it is one
 * object store pattern repeated a few times, and a dependency for that is not
 * worth the weight in something meant to run offline from a static file.
 *
 * Deleting is a tombstone, not a delete. A record marked `deletedAt` is still
 * here so the deletion can be told to the other devices; `purge*` removes it
 * for real once that has happened, or immediately where there is no sync.
 */

import { ulid } from "./ids.ts";
import { migrateRuns, type LegacyRun } from "./migrate.ts";

const DB_NAME = "runlog";
/**
 * v2 added `drafts`, v3 `keys`, v4 re-keyed `runs` by run id, gave packs an
 * `updatedAt`, and added `sync`; v5 added the license store under its
 * British name, and v6 renamed it. `onupgradeneeded` creates whatever is
 * missing, for v4 walks the old runs through `migrateRuns`, and for v6
 * carries the v5 store's rows across.
 */
const DB_VERSION = 6;
const PACKS = "packs";
const RUNS = "runs";
const DRAFTS = "drafts";
const KEYS = "keys";
const SYNC = "sync";
const LICENSES = "licenses";
/** The v5 name of the license store, spelt the way the rest of the code no longer is. */
const LICENSES_V5 = "licences";
const BY_PACK = "byPack";

/** A pack the player imported from their own file. */
export interface StoredPack {
  id: string;
  title: string;
  version: string;
  /** The authored source, kept verbatim so it can be re-validated or exported. */
  source: string;
  format: "yaml" | "json";
  /** Filename it arrived as, for showing in the picker. */
  filename: string;
  importedAt: string;
  updatedAt: string;
  /**
   * The player chose to keep this pack's text in their account. Off unless
   * they said so: the text may be theirs to read and not theirs to copy.
   */
  sync?: boolean;
  /**
   * Opened from a sealed copy that was sold to this player. The text is
   * here so the file need not be opened again, and it never travels: the
   * license key does instead, so the file can be opened on another device.
   */
  sealed?: boolean;
  /** Where it came from: a file of the player's, the catalog, or a sealed copy. Absent means a file. */
  origin?: "file" | "catalog" | "sealed" | "listing";
  /** For a catalog pack: which entry, at which version, so a newer one can be offered. */
  catalog?: { id: string; version: string };
  deletedAt?: string;
}

/**
 * A license key the player has typed once and should not have to again.
 *
 * Keyed by the pack it opened, because that is what a buyer thinks they own:
 * not a file, a game. The key is what the receipt said; the seller's
 * reference and the title are what the file's clear header said, kept so
 * the next sealed file can be matched to a key before anyone is asked.
 */
export interface StoredLicense {
  packId: string;
  key: string;
  ref?: string;
  title?: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface StoredRun {
  /** The key. Minted when the run starts; carried in its first event too. */
  runId: string;
  packId: string;
  packVersion: string;
  /** The pack's title, so a list or a mail need not show an id. */
  packTitle?: string;
  /**
   * The log: the events the server has numbered, in its order, then the
   * ones made here and not yet sent. See sync/log.ts.
   */
  events: unknown[];
  updatedAt: string;
  /** The highest server sequence number in `events`; absent until the server has seen it. */
  seq?: number;
  /** This account's part in it; absent for a run the server has never seen. */
  role?: "owner" | "player" | "viewer";
  /** Who is in it, as the server last said. */
  members?: Array<{ sub: string; role: "owner" | "player" | "viewer"; joinedAt: string; name?: string }>;
  /** The race this run is an entry in, when it is one. Local; a device that pulled the run finds it from the account's races. */
  raceId?: string;
  /** Open to anyone with its link, as the server last said. */
  shared?: boolean;
  deletedAt?: string;
}

/** What the server last confirmed about an item, so an unchanged one is not re-sent. */
export interface SyncState {
  id: string;
  kind: "run" | "pack" | "license";
  updatedAt: string;
  hash: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = (e) => {
      const db = request.result;
      const tx = request.transaction!;
      if (!db.objectStoreNames.contains(PACKS)) db.createObjectStore(PACKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: "publicKey" });
      if (!db.objectStoreNames.contains(SYNC)) db.createObjectStore(SYNC, { keyPath: "id" });
      if (!db.objectStoreNames.contains(LICENSES)) db.createObjectStore(LICENSES, { keyPath: "packId" });

      if (db.objectStoreNames.contains(LICENSES_V5)) {
        // v5 shipped the store under the British spelling. Copy its rows
        // into the renamed store, then drop it; the sync store's `kind`
        // strings get the same treatment so nothing reads as a stranger.
        const old = tx.objectStore(LICENSES_V5).openCursor();
        old.onsuccess = () => {
          const c = old.result;
          if (c) {
            tx.objectStore(LICENSES).put(c.value);
            c.continue();
            return;
          }
          db.deleteObjectStore(LICENSES_V5);
        };
        const sync = tx.objectStore(SYNC).openCursor();
        sync.onsuccess = () => {
          const c = sync.result;
          if (!c) return;
          const state = c.value as Omit<SyncState, "kind"> & { kind: string };
          if (state.kind === "licence") c.update({ ...state, kind: "license" });
          c.continue();
        };
      }

      if (!db.objectStoreNames.contains(RUNS)) {
        db.createObjectStore(RUNS, { keyPath: "runId" }).createIndex(BY_PACK, "packId");
      } else if (e.oldVersion < 4) {
        // A key path cannot be changed in place. Read every run out of the
        // old store, drop it, make the new one, and put them back with ids —
        // all inside the version-change transaction, so a failure leaves the
        // old database exactly as it was.
        const old: LegacyRun[] = [];
        const cursor = tx.objectStore(RUNS).openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            old.push(c.value as LegacyRun);
            c.continue();
            return;
          }
          db.deleteObjectStore(RUNS);
          const runs = db.createObjectStore(RUNS, { keyPath: "runId" });
          runs.createIndex(BY_PACK, "packId");
          for (const record of migrateRuns(old, ulid)) runs.put(record);
        };
      }

      if (e.oldVersion > 0 && e.oldVersion < 4) {
        // Packs learn when they last changed: importing is the only change
        // they had, so that is the honest backfill.
        const packs = tx.objectStore(PACKS).openCursor();
        packs.onsuccess = () => {
          const c = packs.result;
          if (!c) return;
          const pack = c.value as StoredPack;
          if (!pack.updatedAt) c.update({ ...pack, updatedAt: pack.importedAt });
          c.continue();
        };
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab is trying to upgrade the schema. A connection that stays
      // open blocks that upgrade for as long as it lives, so the older tab
      // gets out of the way — otherwise a new version of the app is stuck
      // behind an old one nobody remembers leaving open.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    // A private window, a blocked upgrade, a browser with storage disabled:
    // all land here. Losing persistence is survivable; losing the session is
    // not, so every failure degrades to "nothing was saved".
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);

    // And a last resort, because the failure that actually hurt was none of
    // the above: an upgrade blocked by a connection that never answered, so
    // no event ever fired and every read simply hung. A view waiting forever
    // on storage is worse than a view told there is none.
    setTimeout(() => resolve(null), 4000);
  });
  return dbPromise;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(store, mode);
          const request = work(tx.objectStore(store));
          request.onsuccess = () => resolve(request.result as T);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

const now = () => new Date().toISOString();

/* ---- packs -------------------------------------------------------------- */

/** Every pack, tombstones included. Sync reads this; the shelf does not. */
export const listAllPacks = (): Promise<StoredPack[]> =>
  run<StoredPack[]>(PACKS, "readonly", (s) => s.getAll()).then((r) => r ?? []);

/** The packs still on the shelf. */
export const listPacks = (): Promise<StoredPack[]> =>
  listAllPacks().then((packs) => packs.filter((p) => !p.deletedAt));

export const loadPack = (id: string): Promise<StoredPack | null> =>
  run<StoredPack>(PACKS, "readonly", (s) => s.get(id));

export const savePack = (pack: StoredPack): Promise<unknown> =>
  run(PACKS, "readwrite", (s) => s.put({ ...pack, updatedAt: pack.updatedAt || now() }));

/** Take a pack off the shelf. A tombstone, so the deletion can travel. */
export async function forgetPack(id: string): Promise<void> {
  const pack = await loadPack(id);
  if (!pack) return;
  const at = now();
  await run(PACKS, "readwrite", (s) => s.put({ ...pack, source: "", deletedAt: at, updatedAt: at }));
}

export const purgePack = (id: string): Promise<unknown> =>
  run(PACKS, "readwrite", (s) => s.delete(id));

export async function markPackSync(id: string, on: boolean): Promise<void> {
  const pack = await loadPack(id);
  if (!pack) return;
  await run(PACKS, "readwrite", (s) => s.put({ ...pack, sync: on, updatedAt: now() }));
}

/* ---- runs --------------------------------------------------------------- */

/** Every run, tombstones included. Sync reads this. */
export const listRuns = (): Promise<StoredRun[]> =>
  run<StoredRun[]>(RUNS, "readonly", (s) => s.getAll()).then((r) => r ?? []);

export const loadRun = (runId: string): Promise<StoredRun | null> =>
  run<StoredRun>(RUNS, "readonly", (s) => s.get(runId));

export const runsFor = (packId: string): Promise<StoredRun[]> =>
  run<StoredRun[]>(RUNS, "readonly", (s) => s.index(BY_PACK).getAll(packId)).then((r) => r ?? []);

/**
 * The run a pack is in the middle of: the newest one that has not been
 * forgotten. Derived every time rather than stored as a pointer, so there is
 * no pointer to fall out of step with the runs it points at.
 */
export async function currentRun(packId: string): Promise<StoredRun | null> {
  const live = (await runsFor(packId)).filter((r) => !r.deletedAt);
  live.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return live[0] ?? null;
}

export const saveRun = (record: StoredRun): Promise<unknown> =>
  run(RUNS, "readwrite", (s) => s.put(record));

/** Forget a run. A tombstone: the log goes, the name stays until the deletion has traveled. */
export async function forgetRun(runId: string): Promise<void> {
  const record = await loadRun(runId);
  if (!record) return;
  const at = now();
  await run(RUNS, "readwrite", (s) => s.put({ ...record, events: [], deletedAt: at, updatedAt: at }));
}

export async function forgetRunsFor(packId: string): Promise<void> {
  for (const record of await runsFor(packId)) {
    if (!record.deletedAt) await forgetRun(record.runId);
  }
}

export const purgeRun = (runId: string): Promise<unknown> =>
  run(RUNS, "readwrite", (s) => s.delete(runId));

/* ---- licenses ----------------------------------------------------------- */

/** Every license, tombstones included. Sync reads this; `licensesToTry` does not. */
export const listLicenses = (): Promise<StoredLicense[]> =>
  run<StoredLicense[]>(LICENSES, "readonly", (s) => s.getAll()).then((r) => r ?? []);

export const loadLicense = (packId: string): Promise<StoredLicense | null> =>
  run<StoredLicense>(LICENSES, "readonly", (s) => s.get(packId));

export const saveLicense = (license: StoredLicense): Promise<unknown> =>
  run(LICENSES, "readwrite", (s) => s.put({ ...license, updatedAt: license.updatedAt || now() }));

/** Give a key up. A tombstone, so the other devices forget it too. */
export async function forgetLicense(packId: string): Promise<void> {
  const license = await loadLicense(packId);
  if (!license) return;
  const at = now();
  await run(LICENSES, "readwrite", (s) => s.put({ ...license, key: "", deletedAt: at, updatedAt: at }));
}

export const purgeLicense = (packId: string): Promise<unknown> =>
  run(LICENSES, "readwrite", (s) => s.delete(packId));

/**
 * The keys worth trying on a sealed file, most likely first.
 *
 * A file's clear header names the sale and the title but not the pack, so
 * the match is a guess ordered by evidence: a key that opened a file with
 * the same seller's reference, then one that opened the same title, then
 * the rest. Each try costs a key derivation, which is why the order matters.
 */
export async function licensesToTry(header: { ref?: string; title?: string }): Promise<StoredLicense[]> {
  const live = (await listLicenses()).filter((l) => !l.deletedAt && l.key);
  const score = (l: StoredLicense) =>
    header.ref && l.ref === header.ref ? 2 : header.title && l.title === header.title ? 1 : 0;
  return live.sort((a, b) => score(b) - score(a));
}

/* ---- what the server has confirmed --------------------------------------- */

export const listSyncState = (): Promise<SyncState[]> =>
  run<SyncState[]>(SYNC, "readonly", (s) => s.getAll()).then((r) => r ?? []);

export const putSyncState = (state: SyncState): Promise<unknown> =>
  run(SYNC, "readwrite", (s) => s.put(state));

export const forgetSyncState = (id: string): Promise<unknown> =>
  run(SYNC, "readwrite", (s) => s.delete(id));

/* ---- drafts ------------------------------------------------------------- */

/**
 * A pack being written in the app.
 *
 * Stored as the object under construction rather than as text: a draft is
 * routinely invalid mid-edit — half a table, a mode with no label — and
 * serializing it to YAML on every keystroke would mean parsing it back to
 * render the next one.
 */
export interface StoredDraft {
  id: string;
  /** The partial pack. Not necessarily valid; that is what drafting means. */
  pack: unknown;
  updatedAt: string;
}

export const loadDraft = (id: string): Promise<StoredDraft | null> =>
  run<StoredDraft>(DRAFTS, "readonly", (s) => s.get(id));

export const saveDraft = (draft: StoredDraft): Promise<unknown> =>
  run(DRAFTS, "readwrite", (s) => s.put(draft));

export const forgetDraft = (id: string): Promise<unknown> =>
  run(DRAFTS, "readwrite", (s) => s.delete(id));

/* ---- signing keys ------------------------------------------------------- */

/**
 * A signing key this browser has seen before.
 *
 * A signature proves a pack is unchanged since its author signed it. It does
 * not say who the author is — the key travels inside the pack, so anyone can
 * make one and claim any name. What closes that gap for a reader who will
 * never compare a fingerprint by hand is memory: a key seen on three packs
 * since March is a different proposition from one that turned up today
 * claiming to be somebody you have heard of.
 */
export interface KnownKey {
  publicKey: string;
  fingerprint: string;
  /** Every name this key has signed under. More than one is worth noticing. */
  names: string[];
  /** Pack ids it has signed. */
  packs: string[];
  firstSeen: string;
  lastSeen: string;
}

export const knownKey = (publicKey: string): Promise<KnownKey | null> =>
  run<KnownKey>(KEYS, "readonly", (s) => s.get(publicKey));

/** Record a key, merging with whatever was already known about it. */
export async function rememberKey(
  seen: Omit<KnownKey, "firstSeen" | "lastSeen" | "names" | "packs"> & {
    name?: string;
    packId: string;
  },
): Promise<KnownKey> {
  const existing = await knownKey(seen.publicKey);
  const at = now();
  const merged: KnownKey = {
    publicKey: seen.publicKey,
    fingerprint: seen.fingerprint,
    names: [...new Set([...(existing?.names ?? []), ...(seen.name ? [seen.name] : [])])],
    packs: [...new Set([...(existing?.packs ?? []), seen.packId])],
    firstSeen: existing?.firstSeen ?? at,
    lastSeen: at,
  };
  await run(KEYS, "readwrite", (s) => s.put(merged));
  return merged;
}

/* ---- migration ---------------------------------------------------------- */

const legacyKey = (packId: string) => `runlog:run:${packId}`;

/**
 * Pull a run out of the old localStorage slot, if one is still there.
 *
 * Runs written before this module existed should not vanish because the
 * storage moved underneath them. It gets an id on the way, like every other
 * run from before ids.
 */
export function takeLegacyRun(packId: string): StoredRun | null {
  try {
    const raw = localStorage.getItem(legacyKey(packId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredRun>;
    if (!Array.isArray(parsed.events) || parsed.events.length === 0) return null;
    const [record] = migrateRuns(
      [
        {
          packId,
          packVersion: parsed.packVersion ?? "",
          events: parsed.events,
          updatedAt: parsed.updatedAt ?? now(),
        },
      ],
      ulid,
    );
    return record ?? null;
  } catch {
    return null;
  }
}

export function clearLegacyRun(packId: string): void {
  try {
    localStorage.removeItem(legacyKey(packId));
  } catch {
    /* nothing to do */
  }
}
