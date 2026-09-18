import { parseThemeRecord, type ThemeRecordV1 } from "@runlog/themes";
import { nameFor, type Who } from "../storage/who.ts";
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
  close(): void;
}

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const MAX_DRAFT_BYTES = 65_536;
const LIBRARY_STORE = "library";
const DRAFT_STORE = "drafts";
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

function openDatabase(scopeKey: string, factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let settled = false;
    let upgradeError: ThemeStorageError | null = null;
    try {
      request = factory.open(scopeKey, 1);
    } catch (cause) {
      reject(mapDatabaseError(cause, "unavailable"));
      return;
    }

    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains(LIBRARY_STORE)) db.createObjectStore(LIBRARY_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE, { keyPath: "id" });
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
      if (!db.objectStoreNames.contains(LIBRARY_STORE) || !db.objectStoreNames.contains(DRAFT_STORE)) {
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
  readonly #db: IDBDatabase;
  #closed = false;

  constructor(scopeKey: string, db: IDBDatabase) {
    this.scopeKey = scopeKey;
    this.#db = db;
    db.onversionchange = () => this.close();
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

    return this.#transaction(LIBRARY_STORE, "readwrite", (store, set, fail) => {
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
          put.onsuccess = () => set(success(row));
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
    return this.#transaction(LIBRARY_STORE, "readwrite", (store, set, fail) => {
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
          put.onsuccess = () => set(success(row));
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
          set(Object.freeze(request.result.map(parseStoredDraft).sort(compareIds)));
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
          set(request.result === undefined ? null : parseStoredDraft(request.result));
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
          const current = get.result === undefined ? null : parseStoredDraft(get.result);
          if (current === null ? expectedLocalRevision !== null : current.localRevision !== expectedLocalRevision) {
            set(conflict<StoredThemeDraft>(current));
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
          const current = get.result === undefined ? null : parseStoredDraft(get.result);
          if (current === null || current.localRevision !== expectedLocalRevision) {
            set(conflict<null>(current));
            return;
          }
          const remove = store.delete(id);
          remove.onerror = () => fail(mapDatabaseError(remove.error, "unavailable"));
          remove.onsuccess = () => set(success(null));
        } catch (cause) {
          fail(cause instanceof ThemeStorageError ? cause : invalidData("Unable to delete draft", cause));
        }
      };
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
  const selectedFactory = factory ?? globalThis.indexedDB;
  if (selectedFactory === undefined) throw storageError("unavailable", "IndexedDB is unavailable");
  const scopeKey = `${nameFor(who)}:themes`;
  const db = await openDatabase(scopeKey, selectedFactory);
  return new IndexedDbThemeRepository(scopeKey, db);
}
