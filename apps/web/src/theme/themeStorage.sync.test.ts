import {
  createThemeRecordFromPreset,
  presentationSnapshotKey,
  resolveThemeRecord,
  type RemoteThemeV1,
  type ThemeRecordV1,
} from "@runlog/themes";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
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
    expect(await repo.listOutbox()).toMatchObject([{ attempts: 0, hold: null, notBefore: 0 }]);
    repo.close();
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

  it("leaves version 2 untouched when the upgrade stops halfway, and queues each theme once on the retry", async () => {
    const factory = new IDBFactory();
    const who = account("upgrade_retry");
    await seedVersion2(factory, who);

    // The first key is minted, then minting the second fails partway through the upgrade.
    const realKey = globalThis.crypto.randomUUID.bind(globalThis.crypto);
    let calls = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      calls += 1;
      if (calls === 2) throw new Error("interrupted");
      return realKey();
    });
    await expect(openThemeRepository(who, factory)).rejects.toThrow();
    expect(calls).toBe(2);

    const halfway = await rawDump(factory, who);
    expect(halfway.version).toBe(2);
    expect(halfway.stores).toEqual(["drafts", "library", "metadata"]);
    expect(halfway.drafts).toEqual(v2Rows.drafts);
    expect(halfway.applied).toEqual(v2Rows.applied);

    vi.restoreAllMocks();
    const repo = await openThemeRepository(who, factory);
    expect((await repo.listOutbox()).map((e) => e.themeId).sort()).toEqual(["kept", "second"]);
    expect(await repo.loadTheme("kept")).toEqual(v2Rows.library[0]);
    expect(await repo.loadDraft("draft_one")).toEqual(v2Rows.drafts[0]);
    repo.close();
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
