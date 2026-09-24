import {
  COLOR_DEFINITIONS,
  createThemeRecordFromPreset,
  presentationSnapshotKey,
  resolveThemeRecord,
  type ThemeRecordV1,
} from "@runlog/themes";
import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nameFor, type Who } from "../storage/who.ts";
import { type ThemeDraftV1 } from "./themeDraft.ts";
import { openThemeRepository, ThemeStorageError } from "./themeStorage.ts";

function record(id: string, contentRevision = 1): ThemeRecordV1 {
  const parsed = createThemeRecordFromPreset({ id, name: id, presetId: "daylight", contentRevision });
  if (!parsed.ok) throw new Error("fixture record is invalid");
  return parsed.value;
}

function draft(id: string, sourceThemeId: string | null = null, baseLocalRevision: number | null = null): ThemeDraftV1 {
  return {
    schemaVersion: 1,
    id,
    sourceThemeId,
    baseLocalRevision,
    record: record(sourceThemeId ?? `preview_${id}`),
    rawName: "",
    rawColors: { "surface.page": "#12", "text.primary": "still typing" },
  };
}

function snapshotKey(id = "snapshot_source"): string {
  const resolved = resolveThemeRecord(record(id));
  if (!resolved.ok) throw new Error("fixture snapshot is invalid");
  return presentationSnapshotKey(resolved.value);
}

function expectErrorCode(code: ThemeStorageError["code"]) {
  return expect.objectContaining({ name: "ThemeStorageError", code });
}

async function rawDatabase(factory: IDBFactory, who: Who): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = factory.open(`${nameFor(who)}:themes`);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function putRaw(
  factory: IDBFactory,
  who: Who,
  store: "library" | "drafts" | "metadata" | "outbox" | "remote",
  value: unknown,
  key?: IDBValidKey,
) {
  const db = await rawDatabase(factory, who);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
  });
  db.close();
}

async function getRaw(factory: IDBFactory, who: Who, store: "library" | "drafts" | "metadata" | "outbox" | "remote", key: IDBValidKey) {
  const db = await rawDatabase(factory, who);
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  db.close();
  return value;
}

afterEach(() => vi.restoreAllMocks());

describe("theme repository identity and persistence", () => {
  it("isolates local, anon, and account identities on one browser without adopting another scope", async () => {
    const factory = new IDBFactory();
    const identities: Who[] = [
      { kind: "local" },
      { kind: "anon" },
      { kind: "account", id: "account_a" },
      { kind: "account", id: "account_b" },
    ];

    for (const [index, who] of identities.entries()) {
      const repo = await openThemeRepository(who, factory);
      expect(repo.scopeKey).toBe(`${nameFor(who)}:themes`);
      expect(await repo.listLibrary()).toEqual([]);
      await repo.saveTheme({ record: record(`theme_${index}`), expectedLocalRevision: null });
      repo.close();
    }

    for (const [index, who] of identities.entries()) {
      const repo = await openThemeRepository(who, factory);
      expect((await repo.listLibrary()).map(({ id }) => id)).toEqual([`theme_${index}`]);
      repo.close();
    }
  });

  it("persists themes and invalid raw draft text across repository reopen", async () => {
    const factory = new IDBFactory();
    const who: Who = { kind: "account", id: "persisted" };
    const first = await openThemeRepository(who, factory);
    const saved = await first.saveTheme({ record: record("kept", 99), expectedLocalRevision: null });
    const drafted = await first.saveDraft({ draft: draft("unfinished"), expectedLocalRevision: null });
    expect(saved).toMatchObject({ ok: true, value: { localRevision: 1, record: { contentRevision: 1 } } });
    expect(drafted).toMatchObject({ ok: true, value: { localRevision: 1 } });
    first.close();

    const reopened = await openThemeRepository(who, factory);
    expect(await reopened.loadTheme("kept")).toEqual(saved.ok ? saved.value : null);
    expect(await reopened.loadDraft("unfinished")).toEqual(drafted.ok ? drafted.value : null);
    reopened.close();
  });
});

describe("theme library CAS", () => {
  it("lets only one of two handles win the same expected revision", async () => {
    const factory = new IDBFactory();
    const who: Who = { kind: "anon" };
    const first = await openThemeRepository(who, factory);
    const second = await openThemeRepository(who, factory);
    const created = await first.saveTheme({ record: record("race"), expectedLocalRevision: null });
    expect(created.ok).toBe(true);

    const attempts = await Promise.all([
      first.saveTheme({ record: record("race"), expectedLocalRevision: 1 }),
      second.saveTheme({ record: record("race"), expectedLocalRevision: 1 }),
    ]);
    expect(attempts.filter(({ ok }) => ok)).toHaveLength(1);
    expect(attempts.filter(({ ok }) => !ok)).toHaveLength(1);
    expect(await first.loadTheme("race")).toMatchObject({ kind: "saved", localRevision: 2, record: { contentRevision: 2 } });
    first.close();
    second.close();
  });

  it("increments repository and content revisions, ignoring caller revision for ordering", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const created = await repo.saveTheme({ record: record("edited", 777), expectedLocalRevision: null });
    expect(created).toMatchObject({ ok: true, value: { localRevision: 1, record: { contentRevision: 1 } } });

    const edited = await repo.saveTheme({ record: record("edited", 1), expectedLocalRevision: 1 });
    expect(edited).toMatchObject({ ok: true, value: { localRevision: 2, record: { contentRevision: 2 } } });

    const staleCreate = await repo.saveTheme({ record: record("edited", Number.MAX_SAFE_INTEGER), expectedLocalRevision: null });
    expect(staleCreate).toMatchObject({ ok: false, reason: "conflict", current: { localRevision: 2 } });
    repo.close();
  });

  it("turns a matching saved row into a tombstone and never recreates it", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    await repo.saveTheme({ record: record("removed"), expectedLocalRevision: null });
    const staleDelete = await repo.deleteTheme({ id: "removed", expectedLocalRevision: 2 });
    expect(staleDelete).toMatchObject({ ok: false, current: { kind: "saved", localRevision: 1 } });

    const deleted = await repo.deleteTheme({ id: "removed", expectedLocalRevision: 1 });
    expect(deleted).toEqual({ ok: true, value: { kind: "deleted", id: "removed", localRevision: 2 } });
    expect(await repo.listLibrary()).toEqual([]);
    expect(await repo.loadTheme("removed")).toEqual(deleted.ok ? deleted.value : null);

    const recreate = await repo.saveTheme({ record: record("removed"), expectedLocalRevision: 2 });
    expect(recreate).toEqual({ ok: false, reason: "conflict", current: deleted.ok ? deleted.value : null });
    repo.close();
  });

  it("rejects revision overflow without partially writing", async () => {
    const factory = new IDBFactory();
    const who: Who = { kind: "anon" };
    const repo = await openThemeRepository(who, factory);
    repo.close();
    await putRaw(factory, who, "library", {
      kind: "saved",
      id: "overflow",
      localRevision: Number.MAX_SAFE_INTEGER,
      record: record("overflow", Number.MAX_SAFE_INTEGER),
    });
    const reopened = await openThemeRepository(who, factory);
    await expect(reopened.saveTheme({ record: record("overflow"), expectedLocalRevision: Number.MAX_SAFE_INTEGER })).rejects.toEqual(
      expectErrorCode("invalid-data"),
    );
    expect(await reopened.loadTheme("overflow")).toMatchObject({
      localRevision: Number.MAX_SAFE_INTEGER,
      record: { contentRevision: Number.MAX_SAFE_INTEGER },
    });
    reopened.close();
  });

  it("captures saveTheme input before asynchronous CAS work and reads getters once", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    await repo.saveTheme({ record: record("captured_save"), expectedLocalRevision: null });

    const mutable = { record: record("captured_save"), expectedLocalRevision: 2 as number | null };
    const staleSave = repo.saveTheme(mutable);
    mutable.expectedLocalRevision = 1;
    await expect(staleSave).resolves.toMatchObject({ ok: false, current: { localRevision: 1 } });

    let recordReads = 0;
    let revisionReads = 0;
    const getterInput = {
      get record() {
        recordReads += 1;
        return record("captured_save");
      },
      get expectedLocalRevision() {
        revisionReads += 1;
        return 1;
      },
    };
    await expect(repo.saveTheme(getterInput)).resolves.toMatchObject({ ok: true, value: { localRevision: 2 } });
    expect({ recordReads, revisionReads }).toEqual({ recordReads: 1, revisionReads: 1 });
    repo.close();
  });

  it("captures deleteTheme input before asynchronous CAS work and reads getters once", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    await repo.saveTheme({ record: record("delete_original"), expectedLocalRevision: null });
    await repo.saveTheme({ record: record("delete_protected"), expectedLocalRevision: null });

    const mutable = { id: "delete_original", expectedLocalRevision: 1 };
    const deleting = repo.deleteTheme(mutable);
    mutable.id = "delete_protected";
    await expect(deleting).resolves.toEqual({
      ok: true,
      value: { kind: "deleted", id: "delete_original", localRevision: 2 },
    });
    expect(await repo.loadTheme("delete_original")).toMatchObject({ kind: "deleted" });
    expect(await repo.loadTheme("delete_protected")).toMatchObject({ kind: "saved" });

    await repo.saveTheme({ record: record("delete_getter"), expectedLocalRevision: null });
    let idReads = 0;
    let revisionReads = 0;
    const getterInput = {
      get id() {
        idReads += 1;
        return "delete_getter";
      },
      get expectedLocalRevision() {
        revisionReads += 1;
        return 1;
      },
    };
    await expect(repo.deleteTheme(getterInput)).resolves.toMatchObject({ ok: true });
    expect({ idReads, revisionReads }).toEqual({ idReads: 1, revisionReads: 1 });
    repo.close();
  });
});

describe("draft CAS and bounds", () => {
  it("stores, lists deterministically, conflicts, and deletes drafts by revision", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const z = await repo.saveDraft({ draft: draft("z"), expectedLocalRevision: null });
    const a = await repo.saveDraft({ draft: draft("a"), expectedLocalRevision: null });
    expect((await repo.listDrafts()).map(({ id }) => id)).toEqual(["a", "z"]);
    expect(await repo.saveDraft({ draft: draft("z"), expectedLocalRevision: null })).toMatchObject({ ok: false });
    expect(await repo.deleteDraft({ id: "z", expectedLocalRevision: 2 })).toMatchObject({
      ok: false,
      current: z.ok ? z.value : null,
    });
    expect(await repo.deleteDraft({ id: "z", expectedLocalRevision: 1 })).toEqual({ ok: true, value: null });
    expect(await repo.loadDraft("z")).toBeNull();
    expect(await repo.deleteDraft({ id: "missing", expectedLocalRevision: 1 })).toEqual({
      ok: false,
      reason: "conflict",
      current: null,
    });
    expect(a.ok).toBe(true);
    repo.close();
  });

  it("rejects oversized serialized drafts before writing", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const rawColors = Object.fromEntries(COLOR_DEFINITIONS.map(({ id }) => [id, "🙂".repeat(1024)]));
    const oversized = { ...draft("oversized"), rawName: "🙂".repeat(1024), rawColors } as ThemeDraftV1;
    await expect(repo.saveDraft({ draft: oversized, expectedLocalRevision: null })).rejects.toEqual(expectErrorCode("invalid-data"));
    expect(await repo.loadDraft("oversized")).toBeNull();
    repo.close();
  });

  it("captures saveDraft input before asynchronous CAS work and reads getters once", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    await repo.saveDraft({ draft: draft("captured_draft"), expectedLocalRevision: null });

    const mutable = { draft: draft("captured_draft"), expectedLocalRevision: 2 as number | null };
    const staleSave = repo.saveDraft(mutable);
    mutable.expectedLocalRevision = 1;
    await expect(staleSave).resolves.toMatchObject({ ok: false, current: { localRevision: 1 } });

    let draftReads = 0;
    let revisionReads = 0;
    const getterInput = {
      get draft() {
        draftReads += 1;
        return draft("captured_draft");
      },
      get expectedLocalRevision() {
        revisionReads += 1;
        return 1;
      },
    };
    await expect(repo.saveDraft(getterInput)).resolves.toMatchObject({ ok: true, value: { localRevision: 2 } });
    expect({ draftReads, revisionReads }).toEqual({ draftReads: 1, revisionReads: 1 });
    repo.close();
  });

  it("captures deleteDraft input before asynchronous CAS work and reads getters once", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    await repo.saveDraft({ draft: draft("draft_original"), expectedLocalRevision: null });
    await repo.saveDraft({ draft: draft("draft_protected"), expectedLocalRevision: null });

    const mutable = { id: "draft_original", expectedLocalRevision: 1 };
    const deleting = repo.deleteDraft(mutable);
    mutable.id = "draft_protected";
    await expect(deleting).resolves.toEqual({ ok: true, value: null });
    expect(await repo.loadDraft("draft_original")).toBeNull();
    expect(await repo.loadDraft("draft_protected")).toMatchObject({ id: "draft_protected" });

    await repo.saveDraft({ draft: draft("draft_getter"), expectedLocalRevision: null });
    let idReads = 0;
    let revisionReads = 0;
    const getterInput = {
      get id() {
        idReads += 1;
        return "draft_getter";
      },
      get expectedLocalRevision() {
        revisionReads += 1;
        return 1;
      },
    };
    await expect(repo.deleteDraft(getterInput)).resolves.toMatchObject({ ok: true });
    expect({ idReads, revisionReads }).toEqual({ idReads: 1, revisionReads: 1 });
    repo.close();
  });

  it("retains a hidden draft generation across delete, reopen, and recreate", async () => {
    const factory = new IDBFactory();
    const who: Who = { kind: "account", id: "draft_generations" };
    const first = await openThemeRepository(who, factory);
    await expect(first.saveDraft({ draft: draft("cycle"), expectedLocalRevision: null })).resolves.toMatchObject({
      ok: true,
      value: { localRevision: 1 },
    });
    await expect(first.deleteDraft({ id: "cycle", expectedLocalRevision: 1 })).resolves.toEqual({ ok: true, value: null });
    expect(await first.loadDraft("cycle")).toBeNull();
    expect(await first.listDrafts()).toEqual([]);
    first.close();

    const reopened = await openThemeRepository(who, factory);
    expect(await reopened.loadDraft("cycle")).toBeNull();
    await expect(reopened.saveDraft({ draft: draft("cycle"), expectedLocalRevision: 1 })).resolves.toEqual({
      ok: false,
      reason: "conflict",
      current: null,
    });
    await expect(reopened.deleteDraft({ id: "cycle", expectedLocalRevision: 1 })).resolves.toEqual({
      ok: false,
      reason: "conflict",
      current: null,
    });

    await expect(reopened.saveDraft({ draft: draft("cycle"), expectedLocalRevision: null })).resolves.toMatchObject({
      ok: true,
      value: { localRevision: 3 },
    });
    await expect(reopened.saveDraft({ draft: draft("cycle"), expectedLocalRevision: 1 })).resolves.toMatchObject({
      ok: false,
      current: { localRevision: 3 },
    });
    await expect(reopened.deleteDraft({ id: "cycle", expectedLocalRevision: 1 })).resolves.toMatchObject({
      ok: false,
      current: { localRevision: 3 },
    });
    reopened.close();
  });

  it("strictly validates hidden draft markers and rejects generation overflow", async () => {
    const factory = new IDBFactory();
    const who: Who = { kind: "anon" };
    const setup = await openThemeRepository(who, factory);
    setup.close();
    await putRaw(factory, who, "drafts", {
      kind: "deleted-draft",
      id: "overflow_marker",
      localRevision: Number.MAX_SAFE_INTEGER,
    });
    await putRaw(factory, who, "drafts", {
      kind: "deleted-draft",
      id: "corrupt_marker",
      localRevision: 2,
      draft: draft("corrupt_marker"),
    });

    const repo = await openThemeRepository(who, factory);
    expect(await repo.loadDraft("overflow_marker")).toBeNull();
    await expect(repo.saveDraft({ draft: draft("overflow_marker"), expectedLocalRevision: null })).rejects.toEqual(
      expectErrorCode("invalid-data"),
    );
    await expect(repo.loadDraft("corrupt_marker")).rejects.toEqual(expectErrorCode("invalid-data"));
    repo.close();
  });
});

describe("atomic draft finalization", () => {
  it("atomically creates a theme and replaces its draft with a hidden deletion generation", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const validDraft = draft("new_theme");
    const storedDraft = await repo.saveDraft({ draft: validDraft, expectedLocalRevision: null });
    expect(storedDraft.ok).toBe(true);
    if (!storedDraft.ok) throw new Error("fixture");

    const result = await repo.finalizeDraft({
      record: validDraft.record,
      expectedLocalRevision: null,
      draftId: validDraft.id,
      expectedDraftRevision: storedDraft.value.localRevision,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "saved", id: validDraft.record.id, localRevision: 1, record: { contentRevision: 1 } },
    });
    expect(await repo.loadDraft(validDraft.id)).toBeNull();
    expect((await repo.loadTheme(validDraft.record.id))?.kind).toBe("saved");
    repo.close();
  });

  it("updates an associated theme while keeping repository control of both revisions", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    await repo.saveTheme({ record: record("edited", 97), expectedLocalRevision: null });
    const validDraft = { ...draft("edited_draft", "edited", 1), record: record("edited", 88) };
    const storedDraft = await repo.saveDraft({ draft: validDraft, expectedLocalRevision: null });
    if (!storedDraft.ok) throw new Error("fixture");

    await expect(
      repo.finalizeDraft({
        record: record("edited", 999),
        expectedLocalRevision: 1,
        draftId: validDraft.id,
        expectedDraftRevision: storedDraft.value.localRevision,
      }),
    ).resolves.toMatchObject({ ok: true, value: { localRevision: 2, record: { contentRevision: 2 } } });
    expect(await repo.loadDraft(validDraft.id)).toBeNull();
    repo.close();
  });

  it("returns the stale library row without changing either store", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    await repo.saveTheme({ record: record("stale_library"), expectedLocalRevision: null });
    const validDraft = draft("stale_library_draft", "stale_library", 1);
    const storedDraft = await repo.saveDraft({ draft: validDraft, expectedLocalRevision: null });
    if (!storedDraft.ok) throw new Error("fixture");
    await repo.saveTheme({ record: record("stale_library"), expectedLocalRevision: 1 });

    await expect(
      repo.finalizeDraft({
        record: validDraft.record,
        expectedLocalRevision: 1,
        draftId: validDraft.id,
        expectedDraftRevision: storedDraft.value.localRevision,
      }),
    ).resolves.toMatchObject({ ok: false, current: { kind: "saved", localRevision: 2 } });
    expect(await repo.loadTheme("stale_library")).toMatchObject({ localRevision: 2 });
    expect(await repo.loadDraft(validDraft.id)).toEqual(storedDraft.value);
    repo.close();
  });

  it("returns the stale draft row without changing the library", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const first = draft("stale_draft");
    const storedDraft = await repo.saveDraft({ draft: first, expectedLocalRevision: null });
    if (!storedDraft.ok) throw new Error("fixture");
    const updatedDraft = await repo.saveDraft({ draft: first, expectedLocalRevision: 1 });
    if (!updatedDraft.ok) throw new Error("fixture");

    await expect(
      repo.finalizeDraft({
        record: first.record,
        expectedLocalRevision: null,
        draftId: first.id,
        expectedDraftRevision: storedDraft.value.localRevision,
      }),
    ).resolves.toEqual({ ok: false, reason: "conflict", current: updatedDraft.value });
    expect(await repo.loadTheme(first.record.id)).toBeNull();
    expect(await repo.loadDraft(first.id)).toEqual(updatedDraft.value);
    repo.close();
  });

  it("does not revive a deleted theme during finalization", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    await repo.saveTheme({ record: record("deleted_source"), expectedLocalRevision: null });
    const validDraft = draft("deleted_draft", "deleted_source", 1);
    const storedDraft = await repo.saveDraft({ draft: validDraft, expectedLocalRevision: null });
    if (!storedDraft.ok) throw new Error("fixture");
    const deleted = await repo.deleteTheme({ id: "deleted_source", expectedLocalRevision: 1 });

    await expect(
      repo.finalizeDraft({
        record: validDraft.record,
        expectedLocalRevision: 2,
        draftId: validDraft.id,
        expectedDraftRevision: storedDraft.value.localRevision,
      }),
    ).resolves.toEqual({ ok: false, reason: "conflict", current: deleted.ok ? deleted.value : null });
    expect(await repo.loadDraft(validDraft.id)).toEqual(storedDraft.value);
    repo.close();
  });

  it("rejects draft source associations that do not match the candidate without writing", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const unrelated = draft("unrelated_draft");
    const storedDraft = await repo.saveDraft({ draft: unrelated, expectedLocalRevision: null });
    if (!storedDraft.ok) throw new Error("fixture");

    await expect(
      repo.finalizeDraft({
        record: record("different_candidate"),
        expectedLocalRevision: null,
        draftId: unrelated.id,
        expectedDraftRevision: storedDraft.value.localRevision,
      }),
    ).resolves.toEqual({ ok: false, reason: "conflict", current: storedDraft.value });
    expect(await repo.loadTheme("different_candidate")).toBeNull();
    expect(await repo.loadDraft(unrelated.id)).toEqual(storedDraft.value);
    repo.close();
  });

  it("rolls back both stores when the two-store transaction aborts", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const validDraft = draft("aborted_finalize");
    const storedDraft = await repo.saveDraft({ draft: validDraft, expectedLocalRevision: null });
    if (!storedDraft.ok) throw new Error("fixture");
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = originalPut.apply(this, args);
      if (this.name === "drafts") request.addEventListener("success", () => request.transaction?.abort());
      return request;
    });

    await expect(
      repo.finalizeDraft({
        record: validDraft.record,
        expectedLocalRevision: null,
        draftId: validDraft.id,
        expectedDraftRevision: storedDraft.value.localRevision,
      }),
    ).rejects.toEqual(expectErrorCode("aborted"));
    expect(await repo.loadTheme(validDraft.record.id)).toBeNull();
    expect(await repo.loadDraft(validDraft.id)).toEqual(storedDraft.value);
    repo.close();
  });

  it("captures finalization input before asynchronous work and reads getters once", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const validDraft = draft("captured_finalize");
    const protectedDraft = draft("protected_finalize");
    await repo.saveDraft({ draft: validDraft, expectedLocalRevision: null });
    await repo.saveDraft({ draft: protectedDraft, expectedLocalRevision: null });
    const mutable = {
      record: validDraft.record,
      expectedLocalRevision: null as number | null,
      draftId: validDraft.id,
      expectedDraftRevision: 1,
    };
    const finalizing = repo.finalizeDraft(mutable);
    mutable.record = protectedDraft.record;
    mutable.draftId = protectedDraft.id;
    mutable.expectedDraftRevision = 2;
    await expect(finalizing).resolves.toMatchObject({ ok: true, value: { id: validDraft.record.id } });
    expect(await repo.loadDraft(protectedDraft.id)).not.toBeNull();

    const reads = { record: 0, library: 0, draftId: 0, draft: 0 };
    const getterDraft = draft("getter_finalize");
    await repo.saveDraft({ draft: getterDraft, expectedLocalRevision: null });
    await repo.finalizeDraft({
      get record() {
        reads.record += 1;
        return getterDraft.record;
      },
      get expectedLocalRevision() {
        reads.library += 1;
        return null;
      },
      get draftId() {
        reads.draftId += 1;
        return getterDraft.id;
      },
      get expectedDraftRevision() {
        reads.draft += 1;
        return 1;
      },
    });
    expect(reads).toEqual({ record: 1, library: 1, draftId: 1, draft: 1 });
    repo.close();
  });

  it("preserves the deleted draft generation so stale finalizers cannot win an ABA cycle", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const original = draft("finalize_cycle");
    const first = await repo.saveDraft({ draft: original, expectedLocalRevision: null });
    if (!first.ok) throw new Error("fixture");
    await repo.finalizeDraft({
      record: original.record,
      expectedLocalRevision: null,
      draftId: original.id,
      expectedDraftRevision: first.value.localRevision,
    });
    const recreated = await repo.saveDraft({ draft: draft("finalize_cycle"), expectedLocalRevision: null });
    expect(recreated).toMatchObject({ ok: true, value: { localRevision: 3 } });

    await expect(
      repo.finalizeDraft({
        record: record("stale_aba_candidate"),
        expectedLocalRevision: null,
        draftId: original.id,
        expectedDraftRevision: 1,
      }),
    ).resolves.toMatchObject({ ok: false, current: { localRevision: 3 } });
    expect(await repo.loadTheme("stale_aba_candidate")).toBeNull();
    repo.close();
  });
});

describe("applied source metadata", () => {
  it("upgrades a v1 database without changing existing library or draft rows", async () => {
    const factory = new IDBFactory();
    const who: Who = { kind: "account", id: "upgrade_v1" };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(`${nameFor(who)}:themes`, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("library", { keyPath: "id" });
        request.result.createObjectStore("drafts", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["library", "drafts"], "readwrite");
      tx.objectStore("library").put({ kind: "saved", id: "legacy", localRevision: 1, record: record("legacy") });
      tx.objectStore("drafts").put({ id: "legacy_draft", localRevision: 1, draft: draft("legacy_draft") });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();

    const repo = await openThemeRepository(who, factory);
    expect(await repo.loadTheme("legacy")).toMatchObject({ kind: "saved", localRevision: 1 });
    expect(await repo.loadDraft("legacy_draft")).toMatchObject({ localRevision: 1 });
    expect(await repo.loadAppliedSource()).toBeNull();
    expect(await repo.listOutbox()).toMatchObject([{ themeId: "legacy", op: "put", base: { kind: "none" } }]);
    repo.close();
    const upgraded = await rawDatabase(factory, who);
    expect(upgraded.version).toBe(3);
    expect([...upgraded.objectStoreNames]).toEqual(["drafts", "library", "metadata", "outbox", "remote"]);
    upgraded.close();
  });

  it("stores, scopes, reloads, and clears one canonical applied source", async () => {
    const factory = new IDBFactory();
    const firstWho: Who = { kind: "account", id: "metadata_a" };
    const secondWho: Who = { kind: "account", id: "metadata_b" };
    const source = { schemaVersion: 1 as const, id: "applied", localRevision: 4, snapshotKey: snapshotKey() };
    const first = await openThemeRepository(firstWho, factory);
    const second = await openThemeRepository(secondWho, factory);
    await first.saveAppliedSource(source);
    expect(await first.loadAppliedSource()).toEqual(source);
    expect(await second.loadAppliedSource()).toBeNull();
    expect(await getRaw(factory, firstWho, "metadata", "applied-source")).toEqual(source);
    first.close();

    const reopened = await openThemeRepository(firstWho, factory);
    expect(await reopened.loadAppliedSource()).toEqual(source);
    await reopened.saveAppliedSource(null);
    expect(await reopened.loadAppliedSource()).toBeNull();
    expect(await getRaw(factory, firstWho, "metadata", "applied-source")).toBeUndefined();
    reopened.close();
    second.close();
  });

  it("rejects malformed, noncanonical, and oversized applied sources without replacing the current row", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const canonical = snapshotKey();
    const original = { schemaVersion: 1 as const, id: "original", localRevision: 1, snapshotKey: canonical };
    await repo.saveAppliedSource(original);
    const invalidSources: unknown[] = [
      { ...original, schemaVersion: 2 },
      { ...original, id: "bad id" },
      { ...original, localRevision: 0 },
      { ...original, extra: true },
      { ...original, snapshotKey: "not json" },
      { ...original, snapshotKey: JSON.stringify(JSON.parse(canonical), null, 2) },
      { ...original, snapshotKey: `${" ".repeat(65_537)}${canonical}` },
    ];
    for (const source of invalidSources) {
      await expect(repo.saveAppliedSource(source as never)).rejects.toEqual(expectErrorCode("invalid-data"));
      expect(await repo.loadAppliedSource()).toEqual(original);
    }
    repo.close();
  });

  it("reports corrupt metadata without deleting or coercing the stored value", async () => {
    const factory = new IDBFactory();
    const who: Who = { kind: "anon" };
    const setup = await openThemeRepository(who, factory);
    setup.close();
    const corrupt = { schemaVersion: 1, id: "corrupt", localRevision: 1, snapshotKey: "{}", extra: true };
    await putRaw(factory, who, "metadata", corrupt, "applied-source");

    const repo = await openThemeRepository(who, factory);
    await expect(repo.loadAppliedSource()).rejects.toEqual(expectErrorCode("invalid-data"));
    expect(await getRaw(factory, who, "metadata", "applied-source")).toEqual(corrupt);
    repo.close();
  });

  it("keeps the previous metadata when persistence aborts", async () => {
    const factory = new IDBFactory();
    const who: Who = { kind: "anon" };
    const repo = await openThemeRepository(who, factory);
    const original = { schemaVersion: 1 as const, id: "original", localRevision: 1, snapshotKey: snapshotKey("original") };
    await repo.saveAppliedSource(original);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = originalPut.apply(this, args);
      if (this.name === "metadata") request.addEventListener("success", () => request.transaction?.abort());
      return request;
    });

    await expect(
      repo.saveAppliedSource({ schemaVersion: 1, id: "replacement", localRevision: 2, snapshotKey: snapshotKey("replacement") }),
    ).rejects.toEqual(expectErrorCode("aborted"));
    expect(await repo.loadAppliedSource()).toEqual(original);
    repo.close();
  });
});

describe("validation, lifecycle, and durability", () => {
  it("validates identity, ids, and expected revisions before opening or transacting", async () => {
    const factory = new IDBFactory();
    await expect(openThemeRepository({ kind: "account", id: "" }, factory)).rejects.toEqual(expectErrorCode("invalid-data"));
    await expect(openThemeRepository({ kind: "unexpected" } as never, factory)).rejects.toEqual(expectErrorCode("invalid-data"));
    const repo = await openThemeRepository({ kind: "anon" }, factory);
    await expect(repo.loadTheme("bad id")).rejects.toEqual(expectErrorCode("invalid-data"));
    await expect(repo.deleteDraft({ id: "valid", expectedLocalRevision: 0 })).rejects.toEqual(expectErrorCode("invalid-data"));
    repo.close();
  });

  it("rejects unavailable, denied, blocked, and closed access explicitly", async () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    await expect(openThemeRepository({ kind: "anon" })).rejects.toEqual(expectErrorCode("unavailable"));
    if (before) Object.defineProperty(globalThis, "indexedDB", before);
    else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;

    const denied = {
      open() {
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as IDBFactory;
    await expect(openThemeRepository({ kind: "anon" }, denied)).rejects.toEqual(expectErrorCode("unavailable"));

    const request = Object.assign(new EventTarget(), { result: undefined, error: null, transaction: null }) as unknown as IDBOpenDBRequest;
    const blocked = { open: () => request } as unknown as IDBFactory;
    const opening = openThemeRepository({ kind: "anon" }, blocked);
    queueMicrotask(() => request.onblocked?.(new Event("blocked") as IDBVersionChangeEvent));
    await expect(opening).rejects.toEqual(expectErrorCode("blocked"));

    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    repo.close();
    repo.close();
    await expect(repo.listLibrary()).rejects.toEqual(expectErrorCode("closed"));
  });

  it("preserves the original schema-upgrade failure as the typed error cause", async () => {
    const cause = new Error("schema creation failed");
    vi.spyOn(IDBDatabase.prototype, "createObjectStore").mockImplementation(() => {
      throw cause;
    });

    await expect(openThemeRepository({ kind: "anon" }, new IDBFactory())).rejects.toMatchObject({
      name: "ThemeStorageError",
      code: "unavailable",
      cause,
    });
  });

  it("wraps a throwing global IndexedDB getter and preserves its cause", async () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    const cause = new DOMException("factory denied", "SecurityError");
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        throw cause;
      },
    });
    try {
      await expect(openThemeRepository({ kind: "anon" })).rejects.toMatchObject({
        name: "ThemeStorageError",
        code: "unavailable",
        cause,
      });
    } finally {
      if (before) Object.defineProperty(globalThis, "indexedDB", before);
      else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    }
  });

  it("rejects corrupt stored rows without deleting or coercing them", async () => {
    const factory = new IDBFactory();
    const who: Who = { kind: "anon" };
    const setup = await openThemeRepository(who, factory);
    setup.close();
    await putRaw(factory, who, "library", {
      kind: "saved",
      id: "corrupt",
      localRevision: 1,
      record: { ...record("different"), id: "different" },
      extra: true,
    });
    const repo = await openThemeRepository(who, factory);
    await expect(repo.loadTheme("corrupt")).rejects.toEqual(expectErrorCode("invalid-data"));
    await expect(repo.listLibrary()).rejects.toEqual(expectErrorCode("invalid-data"));
    repo.close();

    const db = await rawDatabase(factory, who);
    const stillThere = await new Promise((resolve, reject) => {
      const request = db.transaction("library").objectStore("library").get("corrupt");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    expect(stillThere).toMatchObject({ id: "corrupt", extra: true });
    db.close();
  });

  it("does not resolve a successful request before its transaction commits", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const originalPut = IDBObjectStore.prototype.put;
    let requestSucceeded!: () => void;
    const success = new Promise<void>((resolve) => (requestSucceeded = resolve));
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = originalPut.apply(this, args);
      request.addEventListener("success", () => requestSucceeded());
      return request;
    });

    let settled = false;
    const saving = repo.saveTheme({ record: record("durable"), expectedLocalRevision: null }).finally(() => {
      settled = true;
    });
    await success;
    expect(settled).toBe(false);
    await expect(saving).resolves.toMatchObject({ ok: true });
    expect(settled).toBe(true);
    repo.close();
  });

  it("rejects when the actual transaction aborts after put success", async () => {
    const repo = await openThemeRepository({ kind: "anon" }, new IDBFactory());
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = originalPut.apply(this, args);
      request.addEventListener("success", () => request.transaction?.abort());
      return request;
    });

    await expect(repo.saveTheme({ record: record("aborted"), expectedLocalRevision: null })).rejects.toEqual(expectErrorCode("aborted"));
    expect(await repo.loadTheme("aborted")).toBeNull();
    repo.close();
  });
});
