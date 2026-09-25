import { LOOK_CHANNEL_ID_PATTERN, LOOK_READ_KEY_PATTERN, LOOK_SECRET_PATTERN } from "@runlog/themes";
import { nameFor, type Who } from "../../storage/who.ts";

/**
 * The theme link this device publishes, and the secret that lets it.
 *
 * A database of its own, named for the account, so the secret sits beside
 * nothing that syncs, exports or is broadcast between tabs, and another
 * account signed in on this browser opens a different one. The server
 * keeps only the secret's hash.
 */
export interface LocalLookChannel {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly secret: string;
  /** Null on a device that took the link over: only the device that made or relinked it knows the key. */
  readonly readKey: string | null;
  readonly revision: number;
  /** `presentationSnapshotKey` of the last look the server confirmed, so an unchanged look is not sent again. */
  readonly publishedKey: string | null;
}
export interface LookChannelStore {
  load(): Promise<LocalLookChannel | null>;
  save(channel: LocalLookChannel): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

const STORE = "channel";
const KEY = "this-device";
const VERSION = 1;
const FIELDS = "id,publishedKey,readKey,revision,schemaVersion,secret";

export function parseLocalLookChannel(input: unknown): LocalLookChannel | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const r = input as Record<string, unknown>;
  if (Object.keys(r).sort().join(",") !== FIELDS) return null;
  const { schemaVersion, id, secret, readKey, revision, publishedKey } = r;
  if (schemaVersion !== 1) return null;
  if (typeof id !== "string" || !LOOK_CHANNEL_ID_PATTERN.test(id)) return null;
  if (typeof secret !== "string" || !LOOK_SECRET_PATTERN.test(secret)) return null;
  if (readKey !== null && (typeof readKey !== "string" || !LOOK_READ_KEY_PATTERN.test(readKey))) return null;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return null;
  if (publishedKey !== null && (typeof publishedKey !== "string" || publishedKey.length > 8192)) return null;
  return Object.freeze({ schemaVersion: 1, id, secret, readKey, revision: revision as number, publishedKey });
}

const settled = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const committed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function openLookChannelStore(who: Who, factory?: IDBFactory): Promise<LookChannelStore> {
  if (who.kind !== "account") throw new Error("Only a signed-in account publishes a theme link");
  let selected: IDBFactory | undefined;
  try {
    selected = factory ?? globalThis.indexedDB;
  } catch {
    selected = undefined;
  }
  if (selected === undefined) throw new Error("IndexedDB is unavailable");
  const request = selected.open(`${nameFor(who)}:look`, VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
  };
  const db = await settled(request);
  let closed = false;
  const open = () => {
    if (closed) throw new Error("Theme link storage is closed");
  };
  return {
    async load() {
      open();
      return parseLocalLookChannel(await settled(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY)));
    },
    async save(channel) {
      open();
      const checked = parseLocalLookChannel(channel);
      if (checked === null) throw new TypeError("Theme link record does not read");
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(checked, KEY);
      await committed(tx);
    },
    async clear() {
      open();
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      await committed(tx);
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
