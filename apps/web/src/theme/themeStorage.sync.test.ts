import {
  createThemeRecordFromPreset,
  presentationSnapshotKey,
  resolveThemeRecord,
  type RemoteThemeV1,
  type ThemeRecordV1,
} from "@runlog/themes";
import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nameFor, type Who } from "../storage/who.ts";
import { openThemeRepository } from "./themeStorage.ts";

function record(id: string, name = id): ThemeRecordV1 {
  const made = createThemeRecordFromPreset({ id, name, presetId: "daylight" });
  if (!made.ok) throw new Error("fixture");
  return made.value;
}
const account = (id = "a"): Who => ({ kind: "account", id });
const live = (id: string, revision: number, name = id): RemoteThemeV1 => ({
  state: "live",
  id,
  revision,
  updatedAt: "2026-09-23T10:00:00.000Z",
  record: record(id, name),
});
const gone = (id: string, revision: number): RemoteThemeV1 => ({
  state: "deleted",
  id,
  revision,
  updatedAt: "2026-09-23T10:00:00.000Z",
  deletedAt: "2026-09-23T10:00:00.000Z",
});

describe("the theme outbox", () => {
  it("queues nothing for a guest or a local build", async () => {
    for (const who of [{ kind: "anon" }, { kind: "local" }] as Who[]) {
      const repo = await openThemeRepository(who, new IDBFactory());
      await repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
      expect(repo.tracksSync).toBe(false);
      expect(await repo.listOutbox()).toEqual([]);
      repo.close();
    }
  });

  it("queues an account's save in the same transaction, and folds a second unsent save into it", async () => {
    const repo = await openThemeRepository(account(), new IDBFactory());
    const first = await repo.saveTheme({ record: record("t1", "One"), expectedLocalRevision: null });
    if (!first.ok) throw new Error("save");
    await repo.saveTheme({ record: record("t1", "Two"), expectedLocalRevision: first.value.localRevision });
    const outbox = await repo.listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ themeId: "t1", op: "put", base: { kind: "none" }, attempts: 0, record: { name: "Two" } });
    repo.close();
  });

  it("confirms, then chains the next change from the confirmed revision", async () => {
    const repo = await openThemeRepository(account(), new IDBFactory());
    const saved = await repo.saveTheme({ record: record("t1", "One"), expectedLocalRevision: null });
    if (!saved.ok) throw new Error("save");
    const [create] = await repo.listOutbox();
    await repo.markAttempt({ seq: create!.seq, attempts: 1, notBefore: 0, hold: null });
    const again = await repo.saveTheme({ record: record("t1", "Two"), expectedLocalRevision: saved.value.localRevision });
    if (!again.ok) throw new Error("save");
    expect((await repo.listOutbox())[1]).toMatchObject({ base: { kind: "previous" } });
    await repo.confirmMutation({ seq: create!.seq, remote: { id: "t1", revision: 1, state: "live" } });
    expect(await repo.listOutbox()).toMatchObject([{ record: { name: "Two" }, base: { kind: "revision", revision: 1 } }]);
    expect(await repo.listRemote()).toEqual([{ id: "t1", revision: 1, state: "live" }]);
    repo.close();
  });

  it("drops a never-sent create on delete, and queues a delete for a confirmed theme", async () => {
    const repo = await openThemeRepository(account(), new IDBFactory());
    const a = await repo.saveTheme({ record: record("a"), expectedLocalRevision: null });
    if (!a.ok) throw new Error("save");
    await repo.deleteTheme({ id: "a", expectedLocalRevision: a.value.localRevision });
    expect(await repo.listOutbox()).toEqual([]);
    expect(await repo.applyRemote(live("b", 3))).toBe("applied");
    const b = await repo.loadTheme("b");
    if (b?.kind !== "saved") throw new Error("pulled");
    await repo.deleteTheme({ id: "b", expectedLocalRevision: b.localRevision });
    expect(await repo.listOutbox()).toMatchObject([{ themeId: "b", op: "delete", base: { kind: "revision", revision: 3 } }]);
    repo.close();
  });

  it("applies a pulled theme only when nothing is queued for it and it is newer", async () => {
    const repo = await openThemeRepository(account(), new IDBFactory());
    expect(await repo.applyRemote(live("t1", 2, "Pulled"))).toBe("applied");
    expect(await repo.loadTheme("t1")).toMatchObject({ kind: "saved", localRevision: 1, record: { name: "Pulled" } });
    expect(await repo.applyRemote(live("t1", 2, "Same again"))).toBe("stale");
    const row = await repo.loadTheme("t1");
    if (row?.kind !== "saved") throw new Error("row");
    await repo.saveTheme({ record: record("t1", "Mine"), expectedLocalRevision: row.localRevision });
    expect(await repo.applyRemote(live("t1", 5, "Theirs"))).toBe("pending");
    expect(await repo.loadTheme("t1")).toMatchObject({ record: { name: "Mine" } });
    expect(await repo.loadAppliedSource()).toBeNull();
    repo.close();
  });

  it("turns a pulled tombstone into a local one and never revives a local tombstone", async () => {
    const repo = await openThemeRepository(account(), new IDBFactory());
    await repo.applyRemote(live("t1", 1));
    expect(await repo.applyRemote(gone("t1", 2))).toBe("applied");
    expect(await repo.listLibrary()).toEqual([]);
    expect(await repo.loadTheme("t1")).toMatchObject({ kind: "deleted" });
    expect(await repo.applyRemote(live("t1", 9))).toBe("stale");
    expect(await repo.loadTheme("t1")).toMatchObject({ kind: "deleted" });
    repo.close();
  });

  it("resolves a conflict in one step: server kept, queue cleared, copy saved and queued", async () => {
    const repo = await openThemeRepository(account(), new IDBFactory());
    await repo.applyRemote(live("t1", 1, "Base"));
    const row = await repo.loadTheme("t1");
    if (row?.kind !== "saved") throw new Error("row");
    await repo.saveTheme({ record: record("t1", "Mine"), expectedLocalRevision: row.localRevision });
    const copy = { ...record("theme_copy", "Mine (conflict copy)") };
    await repo.resolveConflict({ themeId: "t1", server: live("t1", 2, "Theirs"), copy, recreate: null });
    expect((await repo.listLibrary()).map((r) => r.record.name).sort()).toEqual(["Mine (conflict copy)", "Theirs"]);
    expect(await repo.listOutbox()).toMatchObject([{ themeId: "theme_copy", op: "put", base: { kind: "none" } }]);
    expect(await repo.listRemote()).toContainEqual({ id: "t1", revision: 2, state: "live" });
    repo.close();
  });

  it("releases holds for a fresh round", async () => {
    const repo = await openThemeRepository(account(), new IDBFactory());
    await repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    const [e] = await repo.listOutbox();
    await repo.markAttempt({ seq: e!.seq, attempts: 8, notBefore: 0, hold: "retry-exhausted" });
    expect(await repo.releaseHolds({ holds: ["retry-exhausted"], resetBackoff: true })).toBe(1);
    expect(await repo.listOutbox()).toMatchObject([{ sent: true, attempts: 0, hold: null, notBefore: 0 }]);
    repo.close();
  });

  it("keeps a released entry that was sent: a later save appends with a new key and the old key keeps its body", async () => {
    const repo = await openThemeRepository(account(), new IDBFactory());
    const one = await repo.saveTheme({ record: record("t1", "One"), expectedLocalRevision: null });
    if (!one.ok) throw new Error("save");
    const [first] = await repo.listOutbox();
    expect(first).toMatchObject({ sent: false });
    await repo.markAttempt({ seq: first!.seq, attempts: 8, notBefore: 0, hold: "retry-exhausted" });
    await repo.releaseHolds({ holds: ["retry-exhausted"], resetBackoff: true });

    const two = await repo.saveTheme({ record: record("t1", "Two"), expectedLocalRevision: one.value.localRevision });
    if (!two.ok) throw new Error("save");
    const after = await repo.listOutbox();
    expect(after).toMatchObject([
      { seq: first!.seq, key: first!.key, sent: true, record: { name: "One" }, base: { kind: "none" } },
      { op: "put", sent: false, record: { name: "Two" }, base: { kind: "previous" } },
    ]);
    expect(after[1]!.key).not.toBe(first!.key);

    await repo.deleteTheme({ id: "t1", expectedLocalRevision: two.value.localRevision });
    expect(await repo.listOutbox()).toMatchObject([
      { seq: first!.seq, key: first!.key, record: { name: "One" } },
      { op: "put", record: { name: "Two" } },
      { op: "delete", base: { kind: "previous" } },
    ]);
    repo.close();
  });

  it("appends a delete behind a released create that was sent instead of dropping the create", async () => {
    const repo = await openThemeRepository(account(), new IDBFactory());
    const saved = await repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    if (!saved.ok) throw new Error("save");
    const [create] = await repo.listOutbox();
    await repo.markAttempt({ seq: create!.seq, attempts: 3, notBefore: 5_000, hold: null });
    await repo.releaseHolds({ holds: [], resetBackoff: true });
    await repo.deleteTheme({ id: "t1", expectedLocalRevision: saved.value.localRevision });
    expect(await repo.listOutbox()).toMatchObject([
      { seq: create!.seq, key: create!.key, op: "put", sent: true, attempts: 0, notBefore: 0, base: { kind: "none" } },
      { op: "delete", sent: false, base: { kind: "previous" } },
    ]);
    repo.close();
  });

  it("drops a follow-on delete once the change before it confirms the theme is gone", async () => {
    for (const remote of [{ id: "t1", revision: 2, state: "deleted" as const }, null]) {
      const repo = await openThemeRepository(account(), new IDBFactory());
      const saved = await repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
      if (!saved.ok) throw new Error("save");
      const [create] = await repo.listOutbox();
      await repo.markAttempt({ seq: create!.seq, attempts: 1, notBefore: 0, hold: null });
      await repo.deleteTheme({ id: "t1", expectedLocalRevision: saved.value.localRevision });
      expect(await repo.listOutbox()).toHaveLength(2);
      await repo.confirmMutation({ seq: create!.seq, remote });
      expect(await repo.listOutbox()).toEqual([]);
      expect(await repo.listRemote()).toEqual(remote === null ? [] : [remote]);
      repo.close();
    }
  });

  it("rejects a corrupt outbox row as invalid data when confirming or releasing", async () => {
    const factory = new IDBFactory();
    const who = account("corrupt");
    const repo = await openThemeRepository(who, factory);
    repo.close();
    await rawPut(factory, who, "outbox", { seq: 5, themeId: "t1", op: "put" });
    const reopened = await openThemeRepository(who, factory);
    await expect(reopened.confirmMutation({ seq: 5, remote: null })).rejects.toMatchObject({ code: "invalid-data" });
    await expect(reopened.releaseHolds({ holds: ["invalid"], resetBackoff: true })).rejects.toMatchObject({ code: "invalid-data" });
    reopened.close();
  });

  it("keeps one account's queue out of another's", async () => {
    const factory = new IDBFactory();
    const a = await openThemeRepository(account("a"), factory);
    await a.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    const b = await openThemeRepository(account("b"), factory);
    expect(await b.listOutbox()).toEqual([]);
    expect(b.scopeKey).toBe(`${nameFor(account("b"))}:themes`);
    a.close();
    b.close();
  });

  it("remembers the library revision it last pulled", async () => {
    const repo = await openThemeRepository(account(), new IDBFactory());
    expect(await repo.loadSyncMeta()).toEqual({ libraryRevision: null });
    await repo.saveSyncMeta({ libraryRevision: 12 });
    expect(await repo.loadSyncMeta()).toEqual({ libraryRevision: 12 });
    repo.close();
  });
});

function snapshotKey(id: string): string {
  const resolved = resolveThemeRecord(record(id));
  if (!resolved.ok) throw new Error("fixture");
  return presentationSnapshotKey(resolved.value);
}

const v2Rows = {
  library: [
    { kind: "saved", id: "kept", localRevision: 4, record: record("kept", "Kept") },
    { kind: "saved", id: "second", localRevision: 1, record: record("second", "Second") },
    { kind: "deleted", id: "gone", localRevision: 2 },
  ],
  drafts: [
    {
      id: "draft_one",
      localRevision: 3,
      draft: {
        schemaVersion: 1,
        id: "draft_one",
        sourceThemeId: "kept",
        baseLocalRevision: 4,
        record: record("kept", "Kept"),
        rawName: "Kept, half edited",
        rawColors: { "surface.page": "#12" },
      },
    },
  ],
  applied: { schemaVersion: 1, id: "kept", localRevision: 4, snapshotKey: snapshotKey("kept") },
};

/** A version 2 database as the app wrote it before sync existed. */
async function seedVersion2(factory: IDBFactory, who: Who): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(`${nameFor(who)}:themes`, 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("library", { keyPath: "id" });
      request.result.createObjectStore("drafts", { keyPath: "id" });
      request.result.createObjectStore("metadata");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["library", "drafts", "metadata"], "readwrite");
    for (const row of v2Rows.library) tx.objectStore("library").put(row);
    for (const row of v2Rows.drafts) tx.objectStore("drafts").put(row);
    tx.objectStore("metadata").put(v2Rows.applied, "applied-source");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

async function rawPut(factory: IDBFactory, who: Who, store: string, value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(`${nameFor(who)}:themes`);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

async function rawDump(factory: IDBFactory, who: Who) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(`${nameFor(who)}:themes`);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const read = (store: string, key?: IDBValidKey) =>
    new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(store);
      const request = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  const dump = {
    version: db.version,
    stores: [...db.objectStoreNames],
    library: await read("library"),
    drafts: await read("drafts"),
    applied: await read("metadata", "applied-source"),
    seedPending: await read("metadata", "seed-pending"),
  };
  db.close();
  return dump;
}

afterEach(() => vi.restoreAllMocks());

describe("upgrading a version 2 database", () => {
  it("keeps every saved theme, tombstone, draft and applied source, and queues each saved theme once", async () => {
    const factory = new IDBFactory();
    const who = account("upgrade_v2");
    await seedVersion2(factory, who);

    const repo = await openThemeRepository(who, factory);
    expect(await repo.loadTheme("kept")).toEqual(v2Rows.library[0]);
    expect(await repo.loadTheme("gone")).toEqual(v2Rows.library[2]);
    expect(await repo.loadDraft("draft_one")).toEqual(v2Rows.drafts[0]);
    expect(await repo.loadAppliedSource()).toEqual(v2Rows.applied);
    const outbox = await repo.listOutbox();
    expect(outbox.map((e) => e.themeId).sort()).toEqual(["kept", "second"]);
    for (const e of outbox) {
      expect(e).toMatchObject({ op: "put", base: { kind: "none" }, attempts: 0, notBefore: 0, hold: null });
      expect(e.record).toEqual(v2Rows.library.find((r) => r.id === e.themeId)?.record);
    }
    expect(new Set(outbox.map((e) => e.key)).size).toBe(2);
    expect(await repo.listRemote()).toEqual([]);
    expect(await repo.loadSyncMeta()).toEqual({ libraryRevision: null });
    repo.close();

    const dump = await rawDump(factory, who);
    expect(dump.version).toBe(3);
    expect(dump.stores).toEqual(["drafts", "library", "metadata", "outbox", "remote"]);
    expect(dump.library).toEqual([...v2Rows.library].sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect(dump.drafts).toEqual(v2Rows.drafts);
    expect(dump.applied).toEqual(v2Rows.applied);
    expect(dump.seedPending).toBeUndefined();

    const again = await openThemeRepository(who, factory);
    expect(await again.listOutbox()).toHaveLength(2);
    again.close();
  });

  it("queues nothing when a guest's database upgrades", async () => {
    const factory = new IDBFactory();
    const who: Who = { kind: "anon" };
    await seedVersion2(factory, who);
    const repo = await openThemeRepository(who, factory);
    expect(await repo.listOutbox()).toEqual([]);
    expect(await repo.loadTheme("kept")).toEqual(v2Rows.library[0]);
    repo.close();
    expect((await rawDump(factory, who)).version).toBe(3);
  });

  it("still opens and reads the library when queueing fails, and queues each theme once on the next open", async () => {
    const factory = new IDBFactory();
    const who = account("seed_retry");
    await seedVersion2(factory, who);

    const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
      throw new DOMException("interrupted", "UnknownError");
    });
    const repo = await openThemeRepository(who, factory);
    expect(add).toHaveBeenCalled();
    expect((await repo.listLibrary()).map((r) => r.id)).toEqual(["kept", "second"]);
    expect(await repo.loadDraft("draft_one")).toEqual(v2Rows.drafts[0]);
    expect(await repo.loadAppliedSource()).toEqual(v2Rows.applied);
    expect(await repo.listOutbox()).toEqual([]);
    repo.close();

    const halfway = await rawDump(factory, who);
    expect(halfway.version).toBe(3);
    expect(halfway.seedPending).toEqual({ schemaVersion: 1 });
    expect(halfway.library).toEqual([...v2Rows.library].sort((a, b) => (a.id < b.id ? -1 : 1)));

    add.mockRestore();
    const retried = await openThemeRepository(who, factory);
    expect((await retried.listOutbox()).map((e) => e.themeId).sort()).toEqual(["kept", "second"]);
    retried.close();
    expect((await rawDump(factory, who)).seedPending).toBeUndefined();

    const again = await openThemeRepository(who, factory);
    expect(await again.listOutbox()).toHaveLength(2);
    again.close();
  });

  it("starts over when another tab's upgrade to version 3 was rolled back", async () => {
    const factory = new IDBFactory();
    const who = account("upgrade_rolled_back");
    await seedVersion2(factory, who);
    await new Promise<void>((resolve) => {
      const request = factory.open(`${nameFor(who)}:themes`, 3);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true }).add({ themeId: "kept" });
        request.transaction!.abort();
      };
      request.onerror = () => resolve();
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    expect((await rawDump(factory, who)).version).toBe(2);

    const repo = await openThemeRepository(who, factory);
    expect((await repo.listOutbox()).map((e) => e.themeId).sort()).toEqual(["kept", "second"]);
    repo.close();
  });
});
