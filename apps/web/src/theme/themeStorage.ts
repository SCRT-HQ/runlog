import {
  parsePresentationSnapshot,
  parseRemoteTheme,
  parseThemeRecord,
  presentationSnapshotKey,
  type RemoteThemeV1,
  type ThemeRecordV1,
} from "@runlog/themes";
import { nameFor, type Who } from "../storage/who.ts";
import { newSyncKey } from "./sync/ids.ts";
import {
  parseMutation,
  parseRemoteRow,
  planLocalChange,
  planRefused,
  type LocalThemeChange,
  type ThemeHold,
  type ThemeMutationV1,
  type ThemeRemoteRow,
} from "./sync/outbox.ts";
import { parseThemeDraft, type ThemeDraftV1 } from "./themeDraft.ts";

export interface SavedThemeRow {
  readonly kind: "saved";
  readonly id: string;
  readonly localRevision: number;
  readonly record: ThemeRecordV1;
}

export interface DeletedThemeRow {
  readonly kind: "deleted";
  readonly id: string;
  readonly localRevision: number;
}

export type ThemeLibraryRow = SavedThemeRow | DeletedThemeRow;

export interface StoredThemeDraft {
  readonly id: string;
  readonly localRevision: number;
  readonly draft: ThemeDraftV1;
}

export interface AppliedThemeSourceV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly localRevision: number;
  readonly snapshotKey: string;
}

export interface ThemeFinalizeInput {
  readonly record: ThemeRecordV1;
  readonly expectedLocalRevision: number | null;
  readonly draftId: string;
  readonly expectedDraftRevision: number;
}

interface DeletedDraftRow {
  readonly kind: "deleted-draft";
  readonly id: string;
  readonly localRevision: number;
}

type DraftStorageRow = StoredThemeDraft | DeletedDraftRow;

export type ThemeCasResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: "conflict"; readonly current: ThemeLibraryRow | StoredThemeDraft | null };

export class ThemeStorageError extends Error {
  readonly code: "unavailable" | "blocked" | "aborted" | "invalid-data" | "closed";

  constructor(code: ThemeStorageError["code"], message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ThemeStorageError";
    this.code = code;
  }
}

export interface ThemeRepository {
  readonly scopeKey: string;
  listLibrary(): Promise<readonly SavedThemeRow[]>;
  loadTheme(id: string): Promise<ThemeLibraryRow | null>;
  saveTheme(input: { record: ThemeRecordV1; expectedLocalRevision: number | null }): Promise<ThemeCasResult<SavedThemeRow>>;
  deleteTheme(input: { id: string; expectedLocalRevision: number }): Promise<ThemeCasResult<DeletedThemeRow>>;
  listDrafts(): Promise<readonly StoredThemeDraft[]>;
  loadDraft(id: string): Promise<StoredThemeDraft | null>;
  saveDraft(input: { draft: ThemeDraftV1; expectedLocalRevision: number | null }): Promise<ThemeCasResult<StoredThemeDraft>>;
  deleteDraft(input: { id: string; expectedLocalRevision: number }): Promise<ThemeCasResult<null>>;
  finalizeDraft(input: ThemeFinalizeInput): Promise<ThemeCasResult<SavedThemeRow>>;
  loadAppliedSource(): Promise<AppliedThemeSourceV1 | null>;
  saveAppliedSource(source: AppliedThemeSourceV1 | null): Promise<void>;
  readonly tracksSync: boolean;
  listOutbox(): Promise<readonly ThemeMutationV1[]>;
  listRemote(): Promise<readonly ThemeRemoteRow[]>;
  loadSyncMeta(): Promise<{ readonly libraryRevision: number | null }>;
  saveSyncMeta(meta: { readonly libraryRevision: number | null }): Promise<void>;
  /** Marks one entry as handed to the server and returns it exactly as stored, or null when it is gone. */
  markAttempt(input: { seq: number; attempts: number; notBefore: number; hold: ThemeHold | null }): Promise<ThemeMutationV1 | null>;
  confirmMutation(input: { seq: number; remote: ThemeRemoteRow | null }): Promise<void>;
  /**
   * Records that the server refused an entry. Changes queued behind it fold into it in the same transaction
   * (see planRefused): "collapsed" when they did, "held" when nothing followed, "gone" when the entry is gone.
   */
  holdRefused(input: { seq: number; attempts: number; hold: "invalid" | "library-full" }): Promise<"held" | "collapsed" | "gone">;
  applyRemote(theme: RemoteThemeV1): Promise<"applied" | "pending" | "stale">;
  /**
   * Settles a refused change in one transaction. `expectedLocalRevision` is the library row's version the
   * caller decided on (null when there was no row); if a save or pull changed the row since, nothing is
   * written and the answer is "stale".
   */
  resolveConflict(input: {
    themeId: string;
    expectedLocalRevision: number | null;
    server: RemoteThemeV1 | null;
    copy: ThemeRecordV1 | null;
    recreate: ThemeRecordV1 | null;
  }): Promise<"resolved" | "stale">;
  releaseHolds(input: { holds: readonly ThemeHold[]; resetBackoff: boolean }): Promise<number>;
  close(): void;
}

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const MAX_DRAFT_BYTES = 65_536;
const MAX_SNAPSHOT_KEY_BYTES = 65_536;
const LIBRARY_STORE = "library";
const DRAFT_STORE = "drafts";
const METADATA_STORE = "metadata";
const OUTBOX_STORE = "outbox";
const REMOTE_STORE = "remote";
const SYNC_META_KEY = "sync-meta";
const SEED_PENDING_KEY = "seed-pending";
const SCHEMA_VERSION = 3;
const APPLIED_SOURCE_KEY = "applied-source";
const UNSET = Symbol("unset");

function storageError(code: ThemeStorageError["code"], message: string, cause?: unknown): ThemeStorageError {
  return new ThemeStorageError(code, message, cause);
}

function invalidData(message: string, cause?: unknown): ThemeStorageError {
  return storageError("invalid-data", message, cause);
}

function ensureIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw invalidData(`Invalid ${label}`);
}

function ensurePositiveRevision(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw invalidData(`Invalid ${label}`);
}

function ensureExpectedRevision(value: unknown): asserts value is number | null {
  if (value !== null) ensurePositiveRevision(value, "expected local revision");
}

function nextRevision(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value === Number.MAX_SAFE_INTEGER) {
    throw invalidData(`${label} cannot be incremented safely`);
  }
  return value + 1;
}

function strictData(
  input: unknown,
  keys: readonly string[],
  label: string,
  requiredKeys: readonly string[] = keys,
): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalidData(`Invalid ${label}`);
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(input);
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch (cause) {
    throw invalidData(`Unable to inspect ${label}`, cause);
  }
  if (prototype !== Object.prototype && prototype !== null) throw invalidData(`Invalid ${label}`);
  const allowed = new Set(keys);
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.has(key)) throw invalidData(`Invalid ${label} field`);
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidData(`Invalid ${label} field`);
    }
    result[key] = descriptor.value;
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(result, key)) throw invalidData(`Missing ${label} field`);
  }
  return result;
}

function parseLibraryRow(input: unknown): ThemeLibraryRow {
  const base = strictData(input, ["kind", "id", "localRevision", "record"], "theme library row", ["kind", "id", "localRevision"]);
  if (base.kind === "deleted") {
    const deleted = strictData(input, ["kind", "id", "localRevision"], "deleted theme row");
    ensureIdentifier(deleted.id, "stored theme id");
    ensurePositiveRevision(deleted.localRevision, "stored local revision");
    return Object.freeze({ kind: "deleted", id: deleted.id, localRevision: deleted.localRevision });
  }

  const saved = strictData(input, ["kind", "id", "localRevision", "record"], "saved theme row");
  if (saved.kind !== "saved") throw invalidData("Invalid theme row kind");
  ensureIdentifier(saved.id, "stored theme id");
  ensurePositiveRevision(saved.localRevision, "stored local revision");
  const record = parseThemeRecord(saved.record);
  if (!record.ok) throw invalidData("Invalid stored theme record", record.issues);
  if (record.value.id !== saved.id) throw invalidData("Stored theme id does not match record id");
  return Object.freeze({ kind: "saved", id: saved.id, localRevision: saved.localRevision, record: record.value });
}

function parseStoredDraft(input: unknown): StoredThemeDraft {
  const row = strictData(input, ["id", "localRevision", "draft"], "stored theme draft");
  ensureIdentifier(row.id, "stored draft id");
  ensurePositiveRevision(row.localRevision, "stored draft local revision");
  const draft = parseThemeDraft(row.draft);
  if (!draft.ok) throw invalidData("Invalid stored theme draft", draft.issues);
  if (draft.value.id !== row.id) throw invalidData("Stored draft id does not match draft id");
  return Object.freeze({ id: row.id, localRevision: row.localRevision, draft: draft.value });
}

function parseDraftStorageRow(input: unknown): DraftStorageRow {
  const base = strictData(input, ["kind", "id", "localRevision", "draft"], "draft storage row", ["id", "localRevision"]);
  if (base.kind !== "deleted-draft") return parseStoredDraft(input);

  const marker = strictData(input, ["kind", "id", "localRevision"], "deleted draft row");
  ensureIdentifier(marker.id, "deleted draft id");
  ensurePositiveRevision(marker.localRevision, "deleted draft local revision");
  return Object.freeze({ kind: "deleted-draft", id: marker.id, localRevision: marker.localRevision });
}

function parseAppliedThemeSource(input: unknown): AppliedThemeSourceV1 {
  const source = strictData(input, ["schemaVersion", "id", "localRevision", "snapshotKey"], "applied theme source");
  if (source.schemaVersion !== 1) throw invalidData("Invalid applied theme source schema version");
  ensureIdentifier(source.id, "applied theme source id");
  ensurePositiveRevision(source.localRevision, "applied theme source local revision");
  if (typeof source.snapshotKey !== "string") throw invalidData("Invalid applied theme source snapshot key");
  if (new TextEncoder().encode(source.snapshotKey).byteLength > MAX_SNAPSHOT_KEY_BYTES) {
    throw invalidData("Applied theme source snapshot key exceeds 65536 UTF-8 bytes");
  }

  let snapshotInput: unknown;
  try {
    snapshotInput = JSON.parse(source.snapshotKey);
  } catch (cause) {
    throw invalidData("Invalid applied theme source snapshot key", cause);
  }
  const snapshot = parsePresentationSnapshot(snapshotInput);
  if (!snapshot.ok) throw invalidData("Invalid applied theme source snapshot key", snapshot.issues);
  if (presentationSnapshotKey(snapshot.value) !== source.snapshotKey) {
    throw invalidData("Applied theme source snapshot key is not canonical");
  }
  return Object.freeze({
    schemaVersion: 1,
    id: source.id,
    localRevision: source.localRevision,
    snapshotKey: source.snapshotKey,
  });
}

function isStoredDraft(row: DraftStorageRow): row is StoredThemeDraft {
  return !("kind" in row);
}

function success<T>(value: T): ThemeCasResult<T> {
  return Object.freeze({ ok: true, value });
}

function conflict<T>(current: ThemeLibraryRow | StoredThemeDraft | null): ThemeCasResult<T> {
  return Object.freeze({ ok: false, reason: "conflict", current });
}

function compareIds(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function mapDatabaseError(error: unknown, fallback: ThemeStorageError["code"]): ThemeStorageError {
  if (error instanceof ThemeStorageError) return error;
  const name = error instanceof DOMException ? error.name : "";
  const code = name === "AbortError" ? "aborted" : fallback;
  return storageError(code, `Theme storage ${code}`, error);
}

function validateWho(who: Who): void {
  if (typeof who !== "object" || who === null) throw invalidData("Invalid storage identity");
  const data = strictData(who, ["kind", "id"], "storage identity", ["kind"]);
  if (data.kind === "local" || data.kind === "anon") {
    strictData(who, ["kind"], "storage identity");
    return;
  }
  if (data.kind === "account") {
    strictData(who, ["kind", "id"], "storage identity");
    if (typeof data.id !== "string" || data.id.length === 0) throw invalidData("Invalid account id");
    return;
  }
  throw invalidData("Invalid storage identity discriminant");
}

function afterAll(requests: readonly IDBRequest[], fail: (error: ThemeStorageError) => void, done: () => void): void {
  if (requests.length === 0) {
    done();
    return;
  }
  let left = requests.length;
  for (const request of requests) {
    request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
    request.onsuccess = () => {
      left -= 1;
      if (left === 0) done();
    };
  }
}

/** A create the server has never heard of: base `none`, never sent. */
function createEntry(themeId: string, record: ThemeRecordV1, key: string): Omit<ThemeMutationV1, "seq"> {
  return { themeId, op: "put", record, base: { kind: "none" }, key, sent: false, attempts: 0, notBefore: 0, hold: null };
}

function enqueueChange(
  tx: IDBTransaction,
  change: LocalThemeChange,
  newKey: () => string,
  fail: (error: ThemeStorageError) => void,
  done: () => void,
): void {
  const id = change.op === "put" ? change.record.id : change.id;
  const outbox = tx.objectStore(OUTBOX_STORE);
  const queued = outbox.index("themeId").getAll(id);
  const remote = tx.objectStore(REMOTE_STORE).get(id);
  let ready = 0;
  const next = () => {
    ready += 1;
    if (ready < 2) return;
    try {
      const plan = planLocalChange({
        queued: queued.result.map(parseMutation),
        remote: remote.result === undefined ? null : parseRemoteRow(remote.result),
        change,
        newKey,
      });
      const writes: IDBRequest[] = [];
      if (plan.kind === "append") writes.push(outbox.add(plan.entry));
      if (plan.kind === "replace") writes.push(outbox.put({ ...plan.entry, seq: plan.seq }));
      if (plan.kind === "drop") for (const seq of plan.seqs) writes.push(outbox.delete(seq));
      afterAll(writes, fail, done);
    } catch (cause) {
      fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to queue the theme change", cause));
    }
  };
  queued.onerror = () => fail(mapDatabaseError(queued.error, "unavailable"));
  remote.onerror = () => fail(mapDatabaseError(remote.error, "unavailable"));
  queued.onsuccess = next;
  remote.onsuccess = next;
}

function openDatabase(scopeKey: string, factory: IDBFactory, tracksSync: boolean): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let settled = false;
    let upgradeError: ThemeStorageError | null = null;
    try {
      request = factory.open(scopeKey, SCHEMA_VERSION);
    } catch (cause) {
      reject(mapDatabaseError(cause, "unavailable"));
      return;
    }

    request.onupgradeneeded = (event) => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains(LIBRARY_STORE)) db.createObjectStore(LIBRARY_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(METADATA_STORE)) db.createObjectStore(METADATA_STORE);
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          db.createObjectStore(OUTBOX_STORE, { keyPath: "seq", autoIncrement: true }).createIndex("themeId", "themeId", {
            unique: false,
          });
        }
        if (!db.objectStoreNames.contains(REMOTE_STORE)) db.createObjectStore(REMOTE_STORE, { keyPath: "id" });
        // Themes saved under this account before sync existed are the account's. The upgrade only marks
        // them; the repository queues them after open, so a failure there never blocks the library.
        if (tracksSync && event.oldVersion > 0 && event.oldVersion < 3) {
          request.transaction!.objectStore(METADATA_STORE).put({ schemaVersion: 1 }, SEED_PENDING_KEY);
        }
      } catch (cause) {
        upgradeError = storageError("unavailable", "Unable to create theme storage schema", cause);
        request.transaction?.abort();
      }
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(storageError("blocked", "Opening theme storage was blocked"));
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(upgradeError ?? mapDatabaseError(request.error, "unavailable"));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      if (
        !db.objectStoreNames.contains(LIBRARY_STORE) ||
        !db.objectStoreNames.contains(DRAFT_STORE) ||
        !db.objectStoreNames.contains(METADATA_STORE) ||
        !db.objectStoreNames.contains(OUTBOX_STORE) ||
        !db.objectStoreNames.contains(REMOTE_STORE)
      ) {
        settled = true;
        db.close();
        reject(invalidData("Theme storage schema is invalid"));
        return;
      }
      settled = true;
      resolve(db);
    };
  });
}

class IndexedDbThemeRepository implements ThemeRepository {
  readonly scopeKey: string;
  readonly tracksSync: boolean;
  readonly #db: IDBDatabase;
  readonly #newKey: () => string;
  #closed = false;

  constructor(scopeKey: string, db: IDBDatabase, tracksSync: boolean, newKey: () => string) {
    this.scopeKey = scopeKey;
    this.tracksSync = tracksSync;
    this.#db = db;
    this.#newKey = newKey;
    db.onversionchange = () => this.close();
  }

  #syncStores(names: readonly string[]): readonly string[] {
    return this.tracksSync ? [...names, OUTBOX_STORE, REMOTE_STORE] : names;
  }

  #ensureOpen(): void {
    if (this.#closed) throw storageError("closed", "Theme storage is closed");
  }

  #transaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    start: (store: IDBObjectStore, set: (value: T) => void, fail: (error: ThemeStorageError) => void) => void,
  ): Promise<T> {
    this.#ensureOpen();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      let candidate: T | typeof UNSET = UNSET;
      let explicitError: ThemeStorageError | null = null;
      let settled = false;
      try {
        tx = this.#db.transaction(storeName, mode);
      } catch (cause) {
        reject(mapDatabaseError(cause, this.#closed ? "closed" : "unavailable"));
        return;
      }

      const rejectOnce = (error: ThemeStorageError) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const fail = (error: ThemeStorageError) => {
        if (explicitError !== null) return;
        explicitError = error;
        try {
          tx.abort();
        } catch (cause) {
          rejectOnce(error.cause === undefined ? storageError(error.code, error.message, cause) : error);
        }
      };
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        if (candidate === UNSET) reject(invalidData("Theme storage transaction completed without a result"));
        else resolve(candidate);
      };
      tx.onabort = () => rejectOnce(explicitError ?? mapDatabaseError(tx.error, "aborted"));
      tx.onerror = () => rejectOnce(explicitError ?? mapDatabaseError(tx.error, "aborted"));

      try {
        start(
          tx.objectStore(storeName),
          (value) => {
            candidate = value;
          },
          fail,
        );
      } catch (cause) {
        fail(cause instanceof ThemeStorageError ? cause : invalidData("Theme storage operation failed", cause));
      }
    });
  }

  #multiStoreTransaction<T>(
    storeNames: readonly string[],
    mode: IDBTransactionMode,
    start: (tx: IDBTransaction, set: (value: T) => void, fail: (error: ThemeStorageError) => void) => void,
  ): Promise<T> {
    this.#ensureOpen();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      let candidate: T | typeof UNSET = UNSET;
      let explicitError: ThemeStorageError | null = null;
      let settled = false;
      try {
        tx = this.#db.transaction(storeNames, mode);
      } catch (cause) {
        reject(mapDatabaseError(cause, this.#closed ? "closed" : "unavailable"));
        return;
      }

      const rejectOnce = (error: ThemeStorageError) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const fail = (error: ThemeStorageError) => {
        if (explicitError !== null) return;
        explicitError = error;
        try {
          tx.abort();
        } catch (cause) {
          rejectOnce(error.cause === undefined ? storageError(error.code, error.message, cause) : error);
        }
      };
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        if (candidate === UNSET) reject(invalidData("Theme storage transaction completed without a result"));
        else resolve(candidate);
      };
      tx.onabort = () => rejectOnce(explicitError ?? mapDatabaseError(tx.error, "aborted"));
      tx.onerror = () => rejectOnce(explicitError ?? mapDatabaseError(tx.error, "aborted"));

      try {
        start(
          tx,
          (value) => {
            candidate = value;
          },
          fail,
        );
      } catch (cause) {
        fail(cause instanceof ThemeStorageError ? cause : invalidData("Theme storage operation failed", cause));
      }
    });
  }

  async listLibrary(): Promise<readonly SavedThemeRow[]> {
    this.#ensureOpen();
    return this.#transaction(LIBRARY_STORE, "readonly", (store, set, fail) => {
      const request = store.getAll();
      request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
      request.onsuccess = () => {
        try {
          const rows = request.result
            .map(parseLibraryRow)
            .filter((row): row is SavedThemeRow => row.kind === "saved")
            .sort(compareIds);
          set(Object.freeze(rows));
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Invalid stored theme rows", cause));
        }
      };
    });
  }

  async loadTheme(id: string): Promise<ThemeLibraryRow | null> {
    this.#ensureOpen();
    ensureIdentifier(id, "theme id");
    return this.#transaction(LIBRARY_STORE, "readonly", (store, set, fail) => {
      const request = store.get(id);
      request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
      request.onsuccess = () => {
        try {
          set(request.result === undefined ? null : parseLibraryRow(request.result));
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Invalid stored theme row", cause));
        }
      };
    });
  }

  async saveTheme(input: { record: ThemeRecordV1; expectedLocalRevision: number | null }): Promise<ThemeCasResult<SavedThemeRow>> {
    this.#ensureOpen();
    const recordInput = input.record;
    const expectedLocalRevision = input.expectedLocalRevision;
    const parsed = parseThemeRecord(recordInput);
    if (!parsed.ok) throw invalidData("Invalid theme record", parsed.issues);
    ensureExpectedRevision(expectedLocalRevision);
    const id = parsed.value.id;

    return this.#multiStoreTransaction(this.#syncStores([LIBRARY_STORE]), "readwrite", (tx, set, fail) => {
      const store = tx.objectStore(LIBRARY_STORE);
      const get = store.get(id);
      get.onerror = () => fail(mapDatabaseError(get.error, "unavailable"));
      get.onsuccess = () => {
        try {
          const current = get.result === undefined ? null : parseLibraryRow(get.result);
          if (
            current?.kind === "deleted" ||
            (current === null ? expectedLocalRevision !== null : current.localRevision !== expectedLocalRevision)
          ) {
            set(conflict<SavedThemeRow>(current));
            return;
          }

          const localRevision = current === null ? 1 : nextRevision(current.localRevision, "Local revision");
          const contentRevision = current === null ? 1 : nextRevision(current.record.contentRevision, "Content revision");
          const normalized = parseThemeRecord({ ...parsed.value, contentRevision });
          if (!normalized.ok) throw invalidData("Unable to normalize theme record", normalized.issues);
          const row: SavedThemeRow = Object.freeze({ kind: "saved", id, localRevision, record: normalized.value });
          const put = store.put(row);
          put.onerror = () => fail(mapDatabaseError(put.error, "unavailable"));
          put.onsuccess = () => {
            if (!this.tracksSync) {
              set(success(row));
              return;
            }
            enqueueChange(tx, { op: "put", record: row.record }, this.#newKey, fail, () => set(success(row)));
          };
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to save theme", cause));
        }
      };
    });
  }

  async deleteTheme(input: { id: string; expectedLocalRevision: number }): Promise<ThemeCasResult<DeletedThemeRow>> {
    this.#ensureOpen();
    const id = input.id;
    const expectedLocalRevision = input.expectedLocalRevision;
    ensureIdentifier(id, "theme id");
    ensurePositiveRevision(expectedLocalRevision, "expected local revision");
    return this.#multiStoreTransaction(this.#syncStores([LIBRARY_STORE]), "readwrite", (tx, set, fail) => {
      const store = tx.objectStore(LIBRARY_STORE);
      const get = store.get(id);
      get.onerror = () => fail(mapDatabaseError(get.error, "unavailable"));
      get.onsuccess = () => {
        try {
          const current = get.result === undefined ? null : parseLibraryRow(get.result);
          if (current?.kind !== "saved" || current.localRevision !== expectedLocalRevision) {
            set(conflict<DeletedThemeRow>(current));
            return;
          }
          const row: DeletedThemeRow = Object.freeze({
            kind: "deleted",
            id,
            localRevision: nextRevision(current.localRevision, "Local revision"),
          });
          const put = store.put(row);
          put.onerror = () => fail(mapDatabaseError(put.error, "unavailable"));
          put.onsuccess = () => {
            if (!this.tracksSync) {
              set(success(row));
              return;
            }
            enqueueChange(tx, { op: "delete", id }, this.#newKey, fail, () => set(success(row)));
          };
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to delete theme", cause));
        }
      };
    });
  }

  async listDrafts(): Promise<readonly StoredThemeDraft[]> {
    this.#ensureOpen();
    return this.#transaction(DRAFT_STORE, "readonly", (store, set, fail) => {
      const request = store.getAll();
      request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
      request.onsuccess = () => {
        try {
          set(Object.freeze(request.result.map(parseDraftStorageRow).filter(isStoredDraft).sort(compareIds)));
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Invalid stored drafts", cause));
        }
      };
    });
  }

  async loadDraft(id: string): Promise<StoredThemeDraft | null> {
    this.#ensureOpen();
    ensureIdentifier(id, "draft id");
    return this.#transaction(DRAFT_STORE, "readonly", (store, set, fail) => {
      const request = store.get(id);
      request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
      request.onsuccess = () => {
        try {
          if (request.result === undefined) {
            set(null);
            return;
          }
          const row = parseDraftStorageRow(request.result);
          set(isStoredDraft(row) ? row : null);
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Invalid stored draft", cause));
        }
      };
    });
  }

  async saveDraft(input: { draft: ThemeDraftV1; expectedLocalRevision: number | null }): Promise<ThemeCasResult<StoredThemeDraft>> {
    this.#ensureOpen();
    const draftInput = input.draft;
    const expectedLocalRevision = input.expectedLocalRevision;
    const parsed = parseThemeDraft(draftInput);
    if (!parsed.ok) throw invalidData("Invalid theme draft", parsed.issues);
    ensureExpectedRevision(expectedLocalRevision);
    if (new TextEncoder().encode(JSON.stringify(parsed.value)).byteLength > MAX_DRAFT_BYTES) {
      throw invalidData("Theme draft exceeds 65536 UTF-8 bytes");
    }

    return this.#transaction(DRAFT_STORE, "readwrite", (store, set, fail) => {
      const get = store.get(parsed.value.id);
      get.onerror = () => fail(mapDatabaseError(get.error, "unavailable"));
      get.onsuccess = () => {
        try {
          const current = get.result === undefined ? null : parseDraftStorageRow(get.result);
          const currentDraft = current !== null && isStoredDraft(current) ? current : null;
          const matches =
            current === null
              ? expectedLocalRevision === null
              : isStoredDraft(current)
                ? current.localRevision === expectedLocalRevision
                : expectedLocalRevision === null;
          if (!matches) {
            set(conflict<StoredThemeDraft>(currentDraft));
            return;
          }
          const row: StoredThemeDraft = Object.freeze({
            id: parsed.value.id,
            localRevision: current === null ? 1 : nextRevision(current.localRevision, "Draft local revision"),
            draft: parsed.value,
          });
          const put = store.put(row);
          put.onerror = () => fail(mapDatabaseError(put.error, "unavailable"));
          put.onsuccess = () => set(success(row));
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to save draft", cause));
        }
      };
    });
  }

  async deleteDraft(input: { id: string; expectedLocalRevision: number }): Promise<ThemeCasResult<null>> {
    this.#ensureOpen();
    const id = input.id;
    const expectedLocalRevision = input.expectedLocalRevision;
    ensureIdentifier(id, "draft id");
    ensurePositiveRevision(expectedLocalRevision, "expected local revision");
    return this.#transaction(DRAFT_STORE, "readwrite", (store, set, fail) => {
      const get = store.get(id);
      get.onerror = () => fail(mapDatabaseError(get.error, "unavailable"));
      get.onsuccess = () => {
        try {
          const current = get.result === undefined ? null : parseDraftStorageRow(get.result);
          if (current === null || !isStoredDraft(current) || current.localRevision !== expectedLocalRevision) {
            set(conflict<null>(current !== null && isStoredDraft(current) ? current : null));
            return;
          }
          const marker: DeletedDraftRow = Object.freeze({
            kind: "deleted-draft",
            id,
            localRevision: nextRevision(current.localRevision, "Draft local revision"),
          });
          const put = store.put(marker);
          put.onerror = () => fail(mapDatabaseError(put.error, "unavailable"));
          put.onsuccess = () => set(success(null));
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to delete draft", cause));
        }
      };
    });
  }

  async finalizeDraft(input: ThemeFinalizeInput): Promise<ThemeCasResult<SavedThemeRow>> {
    this.#ensureOpen();
    const recordInput = input.record;
    const expectedLocalRevision = input.expectedLocalRevision;
    const draftId = input.draftId;
    const expectedDraftRevision = input.expectedDraftRevision;
    const parsed = parseThemeRecord(recordInput);
    if (!parsed.ok) throw invalidData("Invalid theme record", parsed.issues);
    ensureExpectedRevision(expectedLocalRevision);
    ensureIdentifier(draftId, "draft id");
    ensurePositiveRevision(expectedDraftRevision, "expected draft revision");
    const id = parsed.value.id;

    return this.#multiStoreTransaction(this.#syncStores([LIBRARY_STORE, DRAFT_STORE]), "readwrite", (tx, set, fail) => {
      const libraryStore = tx.objectStore(LIBRARY_STORE);
      const draftStore = tx.objectStore(DRAFT_STORE);
      const libraryGet = libraryStore.get(id);
      const draftGet = draftStore.get(draftId);
      let libraryReady = false;
      let draftReady = false;

      const finalize = () => {
        if (!libraryReady || !draftReady) return;
        try {
          const currentTheme = libraryGet.result === undefined ? null : parseLibraryRow(libraryGet.result);
          const currentDraftRow = draftGet.result === undefined ? null : parseDraftStorageRow(draftGet.result);
          const currentDraft = currentDraftRow !== null && isStoredDraft(currentDraftRow) ? currentDraftRow : null;

          if (
            currentTheme?.kind === "deleted" ||
            (currentTheme === null ? expectedLocalRevision !== null : currentTheme.localRevision !== expectedLocalRevision)
          ) {
            set(conflict<SavedThemeRow>(currentTheme));
            return;
          }
          if (currentDraft === null || currentDraft.localRevision !== expectedDraftRevision) {
            set(conflict<SavedThemeRow>(currentDraft));
            return;
          }
          const expectedSourceId = expectedLocalRevision === null ? null : id;
          if (
            currentDraft.draft.sourceThemeId !== expectedSourceId ||
            currentDraft.draft.baseLocalRevision !== expectedLocalRevision ||
            currentDraft.draft.record.id !== id
          ) {
            set(conflict<SavedThemeRow>(currentDraft));
            return;
          }

          const localRevision = currentTheme === null ? 1 : nextRevision(currentTheme.localRevision, "Local revision");
          const contentRevision = currentTheme === null ? 1 : nextRevision(currentTheme.record.contentRevision, "Content revision");
          const normalized = parseThemeRecord({ ...parsed.value, contentRevision });
          if (!normalized.ok) throw invalidData("Unable to normalize theme record", normalized.issues);
          const row: SavedThemeRow = Object.freeze({ kind: "saved", id, localRevision, record: normalized.value });
          const marker: DeletedDraftRow = Object.freeze({
            kind: "deleted-draft",
            id: draftId,
            localRevision: nextRevision(currentDraft.localRevision, "Draft local revision"),
          });
          const libraryPut = libraryStore.put(row);
          const draftPut = draftStore.put(marker);
          let libraryWritten = false;
          let draftWritten = false;
          const setWhenWritten = () => {
            if (!libraryWritten || !draftWritten) return;
            if (!this.tracksSync) {
              set(success(row));
              return;
            }
            enqueueChange(tx, { op: "put", record: row.record }, this.#newKey, fail, () => set(success(row)));
          };
          libraryPut.onerror = () => fail(mapDatabaseError(libraryPut.error, "unavailable"));
          draftPut.onerror = () => fail(mapDatabaseError(draftPut.error, "unavailable"));
          libraryPut.onsuccess = () => {
            libraryWritten = true;
            setWhenWritten();
          };
          draftPut.onsuccess = () => {
            draftWritten = true;
            setWhenWritten();
          };
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to finalize draft", cause));
        }
      };

      libraryGet.onerror = () => fail(mapDatabaseError(libraryGet.error, "unavailable"));
      draftGet.onerror = () => fail(mapDatabaseError(draftGet.error, "unavailable"));
      libraryGet.onsuccess = () => {
        libraryReady = true;
        finalize();
      };
      draftGet.onsuccess = () => {
        draftReady = true;
        finalize();
      };
    });
  }

  async loadAppliedSource(): Promise<AppliedThemeSourceV1 | null> {
    this.#ensureOpen();
    return this.#transaction(METADATA_STORE, "readonly", (store, set, fail) => {
      const request = store.get(APPLIED_SOURCE_KEY);
      request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
      request.onsuccess = () => {
        try {
          set(request.result === undefined ? null : parseAppliedThemeSource(request.result));
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Invalid applied theme source", cause));
        }
      };
    });
  }

  async saveAppliedSource(source: AppliedThemeSourceV1 | null): Promise<void> {
    this.#ensureOpen();
    const parsed = source === null ? null : parseAppliedThemeSource(source);
    return this.#transaction(METADATA_STORE, "readwrite", (store, set, fail) => {
      const request = parsed === null ? store.delete(APPLIED_SOURCE_KEY) : store.put(parsed, APPLIED_SOURCE_KEY);
      request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
      request.onsuccess = () => set(undefined);
    });
  }

  async listOutbox(): Promise<readonly ThemeMutationV1[]> {
    return this.#transaction(OUTBOX_STORE, "readonly", (store, set, fail) => {
      const request = store.getAll();
      request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
      request.onsuccess = () => {
        try {
          set(Object.freeze(request.result.map(parseMutation).sort((a, b) => a.seq - b.seq)));
        } catch (cause) {
          fail(invalidData("Invalid theme outbox", cause));
        }
      };
    });
  }

  async listRemote(): Promise<readonly ThemeRemoteRow[]> {
    return this.#transaction(REMOTE_STORE, "readonly", (store, set, fail) => {
      const request = store.getAll();
      request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
      request.onsuccess = () => {
        try {
          set(Object.freeze(request.result.map(parseRemoteRow)));
        } catch (cause) {
          fail(invalidData("Invalid remote theme rows", cause));
        }
      };
    });
  }

  async loadSyncMeta(): Promise<{ readonly libraryRevision: number | null }> {
    return this.#transaction(METADATA_STORE, "readonly", (store, set, fail) => {
      const request = store.get(SYNC_META_KEY);
      request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
      request.onsuccess = () => {
        const value = request.result as { schemaVersion?: unknown; libraryRevision?: unknown } | undefined;
        const revision = value?.libraryRevision;
        set({
          libraryRevision:
            value?.schemaVersion === 1 && Number.isSafeInteger(revision) && (revision as number) >= 0 ? (revision as number) : null,
        });
      };
    });
  }

  async saveSyncMeta(meta: { readonly libraryRevision: number | null }): Promise<void> {
    return this.#transaction(METADATA_STORE, "readwrite", (store, set, fail) => {
      const request = store.put({ schemaVersion: 1, libraryRevision: meta.libraryRevision }, SYNC_META_KEY);
      request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
      request.onsuccess = () => set(undefined);
    });
  }

  async markAttempt(input: { seq: number; attempts: number; notBefore: number; hold: ThemeHold | null }): Promise<ThemeMutationV1 | null> {
    return this.#transaction(OUTBOX_STORE, "readwrite", (store, set, fail) => {
      const get = store.get(input.seq);
      get.onerror = () => fail(mapDatabaseError(get.error, "unavailable"));
      get.onsuccess = () => {
        if (get.result === undefined) {
          set(null);
          return;
        }
        try {
          // Read and marked in one transaction: the caller sends exactly this key and body.
          const marked = parseMutation({
            ...parseMutation(get.result),
            sent: true,
            attempts: input.attempts,
            notBefore: input.notBefore,
            hold: input.hold,
          });
          const put = store.put(marked);
          afterAll([put], fail, () => set(marked));
        } catch (cause) {
          fail(invalidData("Invalid theme outbox entry", cause));
        }
      };
    });
  }

  async holdRefused(input: { seq: number; attempts: number; hold: "invalid" | "library-full" }): Promise<"held" | "collapsed" | "gone"> {
    return this.#transaction(OUTBOX_STORE, "readwrite", (store, set, fail) => {
      const get = store.get(input.seq);
      get.onerror = () => fail(mapDatabaseError(get.error, "unavailable"));
      get.onsuccess = () => {
        if (get.result === undefined) {
          set("gone");
          return;
        }
        let themeId: string;
        try {
          themeId = parseMutation(get.result).themeId;
        } catch (cause) {
          fail(invalidData("Invalid theme outbox entry", cause));
          return;
        }
        const mine = store.index("themeId").getAll(themeId);
        mine.onerror = () => fail(mapDatabaseError(mine.error, "unavailable"));
        mine.onsuccess = () => {
          try {
            const plan = planRefused({
              queued: mine.result.map(parseMutation),
              seq: input.seq,
              hold: input.hold,
              attempts: input.attempts,
              newKey: this.#newKey,
            });
            if (plan === null) {
              set("gone");
              return;
            }
            const writes: IDBRequest[] = [];
            if (plan.kind === "hold") writes.push(store.put(parseMutation(plan.entry)));
            else {
              if (plan.entry !== null) writes.push(store.put(parseMutation(plan.entry)));
              for (const seq of plan.drop) writes.push(store.delete(seq));
            }
            afterAll(writes, fail, () => set(plan.kind === "hold" ? "held" : "collapsed"));
          } catch (cause) {
            fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to record the refused theme change", cause));
          }
        };
      };
    });
  }

  async confirmMutation(input: { seq: number; remote: ThemeRemoteRow | null }): Promise<void> {
    return this.#multiStoreTransaction([OUTBOX_STORE, REMOTE_STORE], "readwrite", (tx, set, fail) => {
      const outbox = tx.objectStore(OUTBOX_STORE);
      const get = outbox.get(input.seq);
      get.onerror = () => fail(mapDatabaseError(get.error, "unavailable"));
      get.onsuccess = () => {
        if (get.result === undefined) {
          set(undefined);
          return;
        }
        let entry: ThemeMutationV1;
        try {
          entry = parseMutation(get.result);
        } catch (cause) {
          fail(invalidData("Invalid theme outbox entry", cause));
          return;
        }
        const later = outbox.index("themeId").getAll(entry.themeId);
        later.onerror = () => fail(mapDatabaseError(later.error, "unavailable"));
        later.onsuccess = () => {
          try {
            const writes: IDBRequest[] = [outbox.delete(input.seq)];
            const remote = tx.objectStore(REMOTE_STORE);
            writes.push(input.remote === null ? remote.delete(entry.themeId) : remote.put(parseRemoteRow(input.remote)));
            const following = later.result
              .map(parseMutation)
              .filter((e) => e.seq > input.seq)
              .sort((a, b) => a.seq - b.seq);
            const next = following[0];
            if (next !== undefined && next.base.kind === "previous") {
              const live = input.remote !== null && input.remote.state === "live";
              if (live) {
                writes.push(outbox.put({ ...next, base: { kind: "revision", revision: input.remote!.revision } }));
              } else if (next.op === "delete") {
                // The theme is already gone on the server: the delete that followed has nothing left to do,
                // and whatever came after it now starts from a theme the server does not have.
                writes.push(outbox.delete(next.seq));
                const after = following[1];
                if (after !== undefined && after.base.kind === "previous") writes.push(outbox.put({ ...after, base: { kind: "none" } }));
              } else {
                writes.push(outbox.put({ ...next, base: { kind: "none" } }));
              }
            }
            afterAll(writes, fail, () => set(undefined));
          } catch (cause) {
            fail(invalidData("Unable to confirm the theme change", cause));
          }
        };
      };
    });
  }

  async applyRemote(theme: RemoteThemeV1): Promise<"applied" | "pending" | "stale"> {
    const parsed = parseRemoteTheme(theme);
    if (!parsed.ok) throw invalidData("Invalid remote theme", parsed.issues);
    const value = parsed.value;
    return this.#multiStoreTransaction([LIBRARY_STORE, OUTBOX_STORE, REMOTE_STORE], "readwrite", (tx, set, fail) => {
      const library = tx.objectStore(LIBRARY_STORE);
      const remote = tx.objectStore(REMOTE_STORE);
      const queued = tx.objectStore(OUTBOX_STORE).index("themeId").count(value.id);
      const known = remote.get(value.id);
      const local = library.get(value.id);
      let ready = 0;
      const next = () => {
        ready += 1;
        if (ready < 3) return;
        try {
          if (queued.result > 0) {
            set("pending");
            return;
          }
          const knownRow = known.result === undefined ? null : parseRemoteRow(known.result);
          const current = local.result === undefined ? null : parseLibraryRow(local.result);
          if ((knownRow !== null && knownRow.revision >= value.revision) || (value.state === "live" && current?.kind === "deleted")) {
            set("stale");
            return;
          }
          const writes: IDBRequest[] = [remote.put({ id: value.id, revision: value.revision, state: value.state })];
          if (value.state === "live") {
            writes.push(
              library.put(
                Object.freeze({
                  kind: "saved",
                  id: value.id,
                  localRevision: current === null ? 1 : nextRevision(current.localRevision, "Local revision"),
                  record: value.record,
                }),
              ),
            );
          } else if (current?.kind === "saved") {
            writes.push(
              library.put(
                Object.freeze({ kind: "deleted", id: value.id, localRevision: nextRevision(current.localRevision, "Local revision") }),
              ),
            );
          } else if (current === null) {
            // A tombstone for a theme this device never had still blocks the id here.
            writes.push(library.put(Object.freeze({ kind: "deleted", id: value.id, localRevision: 1 })));
          }
          afterAll(writes, fail, () => set("applied"));
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to apply the remote theme", cause));
        }
      };
      for (const request of [queued, known, local] as IDBRequest[]) {
        request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
        request.onsuccess = next;
      }
    });
  }

  async resolveConflict(input: {
    themeId: string;
    expectedLocalRevision: number | null;
    server: RemoteThemeV1 | null;
    copy: ThemeRecordV1 | null;
    recreate: ThemeRecordV1 | null;
  }): Promise<"resolved" | "stale"> {
    ensureExpectedRevision(input.expectedLocalRevision);
    const server = input.server === null ? null : parseRemoteTheme(input.server);
    if (server !== null && !server.ok) throw invalidData("Invalid remote theme", server.issues);
    const copy = input.copy === null ? null : parseThemeRecord(input.copy);
    if (copy !== null && !copy.ok) throw invalidData("Invalid conflict copy", copy.issues);
    const recreate = input.recreate === null ? null : parseThemeRecord(input.recreate);
    if (recreate !== null && !recreate.ok) throw invalidData("Invalid theme to recreate", recreate.issues);
    return this.#multiStoreTransaction([LIBRARY_STORE, OUTBOX_STORE, REMOTE_STORE], "readwrite", (tx, set, fail) => {
      const library = tx.objectStore(LIBRARY_STORE);
      const outbox = tx.objectStore(OUTBOX_STORE);
      const remote = tx.objectStore(REMOTE_STORE);
      const keys = outbox.index("themeId").getAllKeys(input.themeId);
      const local = library.get(input.themeId);
      let ready = 0;
      const next = () => {
        ready += 1;
        if (ready < 2) return;
        try {
          const current = local.result === undefined ? null : parseLibraryRow(local.result);
          if ((current?.localRevision ?? null) !== input.expectedLocalRevision) {
            // Saved or pulled since the caller read it: the decision was made on an older version.
            set("stale");
            return;
          }
          const writes: IDBRequest[] = keys.result.map((key) => outbox.delete(key));
          if (server !== null) {
            const theme = server.value;
            writes.push(remote.put({ id: theme.id, revision: theme.revision, state: theme.state }));
            const localRevision = current === null ? 1 : nextRevision(current.localRevision, "Local revision");
            writes.push(
              library.put(
                theme.state === "live"
                  ? Object.freeze({ kind: "saved", id: theme.id, localRevision, record: theme.record })
                  : Object.freeze({ kind: "deleted", id: theme.id, localRevision }),
              ),
            );
          } else {
            writes.push(remote.delete(input.themeId));
            if (recreate !== null) writes.push(outbox.add(createEntry(input.themeId, recreate.value, this.#newKey())));
          }
          if (copy !== null) {
            writes.push(library.add(Object.freeze({ kind: "saved", id: copy.value.id, localRevision: 1, record: copy.value })));
            writes.push(outbox.add(createEntry(copy.value.id, copy.value, this.#newKey())));
          }
          afterAll(writes, fail, () => set("resolved"));
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to keep both versions", cause));
        }
      };
      keys.onerror = () => fail(mapDatabaseError(keys.error, "unavailable"));
      local.onerror = () => fail(mapDatabaseError(local.error, "unavailable"));
      keys.onsuccess = next;
      local.onsuccess = next;
    });
  }

  async releaseHolds(input: { holds: readonly ThemeHold[]; resetBackoff: boolean }): Promise<number> {
    const holds = new Set<ThemeHold | null>(input.holds);
    return this.#transaction(OUTBOX_STORE, "readwrite", (store, set, fail) => {
      const cursor = store.openCursor();
      let changed = 0;
      cursor.onerror = () => fail(mapDatabaseError(cursor.error, "unavailable"));
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (at === null) {
          set(changed);
          return;
        }
        try {
          const entry = parseMutation(at.value);
          if (holds.has(entry.hold) || (input.resetBackoff && entry.hold === null && (entry.attempts > 0 || entry.notBefore > 0))) {
            // `sent` stays: a released entry may still have reached the server, so it keeps its key and body.
            at.update({ ...entry, hold: null, attempts: 0, notBefore: 0 });
            changed += 1;
          }
          at.continue();
        } catch (cause) {
          fail(invalidData("Invalid theme outbox entry", cause));
        }
      };
    });
  }

  /**
   * Queues the themes an account saved before sync existed, once. The upgrade to version 3 leaves a marker;
   * this clears it in the same transaction that queues the themes, so a failure leaves it for the next open.
   */
  async seedExisting(): Promise<number> {
    const stores = [LIBRARY_STORE, OUTBOX_STORE, REMOTE_STORE, METADATA_STORE];
    return this.#multiStoreTransaction(stores, "readwrite", (tx, set, fail) => {
      const metadata = tx.objectStore(METADATA_STORE);
      const outbox = tx.objectStore(OUTBOX_STORE);
      const marker = metadata.get(SEED_PENDING_KEY);
      const rows = tx.objectStore(LIBRARY_STORE).getAll();
      const queued = outbox.getAll();
      const known = tx.objectStore(REMOTE_STORE).getAllKeys();
      let ready = 0;
      const next = () => {
        ready += 1;
        if (ready < 4) return;
        if (marker.result === undefined) {
          set(0);
          return;
        }
        try {
          // Queued or already known to the server: either way it is not a create from nothing. Only the raw
          // themeId is read, so one unreadable outbox row cannot hold seeding back for good.
          const already = new Set<unknown>(known.result);
          for (const entry of queued.result as unknown[]) {
            const themeId = typeof entry === "object" && entry !== null ? (entry as { themeId?: unknown }).themeId : undefined;
            if (typeof themeId === "string") already.add(themeId);
          }
          const writes: IDBRequest[] = [];
          for (const value of rows.result) {
            let row: ThemeLibraryRow;
            try {
              row = parseLibraryRow(value);
            } catch {
              continue; // A row that does not read stays where it is; listLibrary reports it.
            }
            if (row.kind !== "saved" || already.has(row.id)) continue;
            writes.push(outbox.add(createEntry(row.id, row.record, this.#newKey())));
          }
          const count = writes.length;
          writes.push(metadata.delete(SEED_PENDING_KEY));
          afterAll(writes, fail, () => set(count));
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to queue saved themes", cause));
        }
      };
      for (const request of [marker, rows, queued, known] as IDBRequest[]) {
        request.onerror = () => fail(mapDatabaseError(request.error, "unavailable"));
        request.onsuccess = next;
      }
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }
}

export async function openThemeRepository(who: Who, factory?: IDBFactory): Promise<ThemeRepository> {
  validateWho(who);
  let selectedFactory: IDBFactory | undefined;
  try {
    selectedFactory = factory ?? globalThis.indexedDB;
  } catch (cause) {
    throw storageError("unavailable", "IndexedDB is unavailable", cause);
  }
  if (selectedFactory === undefined) throw storageError("unavailable", "IndexedDB is unavailable");
  const scopeKey = `${nameFor(who)}:themes`;
  const tracksSync = who.kind === "account";
  const db = await openDatabase(scopeKey, selectedFactory, tracksSync);
  const repository = new IndexedDbThemeRepository(scopeKey, db, tracksSync, newSyncKey);
  if (tracksSync) {
    try {
      await repository.seedExisting();
    } catch (cause) {
      // The library still reads. The marker stays, so the next open queues these themes.
      console.warn("Saved themes were not queued for sync; retrying on next open", cause instanceof Error ? cause.name : "unknown error");
    }
  }
  return repository;
}
