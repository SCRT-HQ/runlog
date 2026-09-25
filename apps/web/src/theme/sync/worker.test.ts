import { createThemeRecordFromPreset, type ThemeRecordV1 } from "@runlog/themes";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openThemeRepository, type ThemeRepository } from "../themeStorage.ts";
import { THEME_RETRY, retryDelay } from "./reconcile.ts";
import { memoryThemeApi, memoryThemeServer, serverRecord, type MemoryThemeServer } from "./testing/memoryThemeApi.ts";
import { createThemeSync, webLock, type ThemeSync, type ThemeSyncReport } from "./worker.ts";

function record(id: string, name = id): ThemeRecordV1 {
  const made = createThemeRecordFromPreset({ id, name, presetId: "ember" });
  if (!made.ok) throw new Error("fixture");
  return made.value;
}

interface Device {
  repo: ThemeRepository;
  sync: ThemeSync;
  reports: ThemeSyncReport[];
  changed: number;
  timers: Array<{ run: () => void; ms: number }>;
  clock: { now: number };
}

const open: Device[] = [];
/** The repository with some methods replaced, the rest bound to the real one. */
function wrap(repo: ThemeRepository, overrides: Partial<ThemeRepository>): ThemeRepository {
  return new Proxy(repo, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) return overrides[prop as keyof ThemeRepository];
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

async function device(
  server: MemoryThemeServer,
  sub = "user_1",
  overrides: (repo: ThemeRepository) => Partial<ThemeRepository> = () => ({}),
): Promise<Device> {
  const repo = await openThemeRepository({ kind: "account", id: sub }, new IDBFactory());
  const d = { repo, reports: [], changed: 0, timers: [], clock: { now: 1_000_000 } } as unknown as Device;
  let ids = 0;
  d.sync = createThemeSync({
    repository: wrap(repo, overrides(repo)),
    api: memoryThemeApi(server, sub),
    onLibraryChanged: () => (d.changed += 1),
    onReport: (r) => d.reports.push(r),
    now: () => d.clock.now,
    newId: () => `theme_copy_${sub}_${(ids += 1)}`,
    setTimer: (run, ms) => d.timers.push({ run, ms }),
    clearTimer: () => undefined,
    lock: (run) => run(),
  });
  open.push(d);
  return d;
}
async function settle(d: Device) {
  d.sync.wake("local");
  await d.sync.idle();
}
const last = (d: Device) => d.reports.at(-1)!;

afterEach(() => {
  for (const d of open.splice(0)) {
    d.sync.stop();
    d.repo.close();
  }
});

describe("the theme sync worker", () => {
  it("says synced only once the server confirmed", async () => {
    const server = memoryThemeServer();
    const a = await device(server);
    await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    let release!: () => void;
    server.script.push({ hold: new Promise<void>((r) => (release = r)) });
    a.sync.wake("local");
    await vi.waitFor(() => expect(last(a).items.get("t1")).toEqual({ kind: "pending" }));
    release();
    await a.sync.idle();
    expect(last(a).items.get("t1")).toEqual({ kind: "synced" });
    expect(serverRecord(server, "t1")?.name).toBe("t1");
  });

  it("brings a theme made on one device to the other", async () => {
    const server = memoryThemeServer();
    const [a, b] = [await device(server), await device(server)];
    await a.repo.saveTheme({ record: record("t1", "Kiln"), expectedLocalRevision: null });
    await settle(a);
    await settle(b);
    expect((await b.repo.listLibrary()).map((r) => r.record.name)).toEqual(["Kiln"]);
    expect(b.changed).toBe(1);
  });

  it("keeps the server's edit and saves the other as a conflict copy, applying neither", async () => {
    const server = memoryThemeServer();
    const [a, b] = [await device(server), await device(server)];
    await a.repo.saveTheme({ record: record("t1", "Base"), expectedLocalRevision: null });
    await settle(a);
    await settle(b);
    const onA = await a.repo.loadTheme("t1");
    const onB = await b.repo.loadTheme("t1");
    if (onA?.kind !== "saved" || onB?.kind !== "saved") throw new Error("rows");
    await a.repo.saveTheme({ record: record("t1", "From A"), expectedLocalRevision: onA.localRevision });
    await b.repo.saveTheme({ record: record("t1", "From B"), expectedLocalRevision: onB.localRevision });
    await settle(a);
    await settle(b);
    expect(serverRecord(server, "t1")?.name).toBe("From A");
    expect((await b.repo.listLibrary()).map((r) => r.record.name).sort()).toEqual(["From A", "From B (conflict copy)"]);
    expect(last(b).notices).toEqual([{ kind: "conflict-copy", themeId: "t1", copyId: "theme_copy_user_1_1" }]);
    expect(await b.repo.loadAppliedSource()).toBeNull();
    await settle(b);
    await settle(a);
    expect((await a.repo.listLibrary()).map((r) => r.record.name).sort()).toEqual(["From A", "From B (conflict copy)"]);
  });

  it("turns an edit that meets a delete into a recovered copy and keeps the id deleted", async () => {
    const server = memoryThemeServer();
    const [a, b] = [await device(server), await device(server)];
    await a.repo.saveTheme({ record: record("t1", "Base"), expectedLocalRevision: null });
    await settle(a);
    await settle(b);
    const onA = await a.repo.loadTheme("t1");
    const onB = await b.repo.loadTheme("t1");
    if (onA?.kind !== "saved" || onB?.kind !== "saved") throw new Error("rows");
    await a.repo.deleteTheme({ id: "t1", expectedLocalRevision: onA.localRevision });
    await settle(a);
    await b.repo.saveTheme({ record: record("t1", "Edited offline"), expectedLocalRevision: onB.localRevision });
    await settle(b);
    expect(server.rows.get("user_1/t1")?.state).toBe("deleted");
    expect(await b.repo.loadTheme("t1")).toMatchObject({ kind: "deleted" });
    expect((await b.repo.listLibrary()).map((r) => r.record.name)).toEqual(["Edited offline (recovered)"]);
    expect(last(b).notices[0]).toMatchObject({ kind: "recovery-copy", themeId: "t1" });
  });

  it("confirms a write whose answer was lost, without a second revision or a copy", async () => {
    const server = memoryThemeServer();
    const a = await device(server);
    await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    server.script.push("lose-response");
    await settle(a);
    expect(last(a).phase).toBe("offline");
    a.sync.wake("online");
    await a.sync.idle();
    expect(server.writes).toBe(1);
    expect(server.rows.get("user_1/t1")?.revision).toBe(1);
    expect(await a.repo.listOutbox()).toEqual([]);
    expect((await a.repo.listLibrary()).length).toBe(1);
  });

  it("waits out a rate limit without spending a try", async () => {
    const server = memoryThemeServer();
    const a = await device(server);
    await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    server.script.push({ rateLimitedMs: 1_500 });
    await settle(a);
    expect(await a.repo.listOutbox()).toMatchObject([{ attempts: 0, notBefore: 1_001_500, sent: true }]);
    expect(a.timers.at(-1)!.ms).toBe(1_500);
    a.clock.now += 1_500;
    a.timers.at(-1)!.run();
    await a.sync.idle();
    expect(last(a).items.get("t1")).toEqual({ kind: "synced" });
  });

  it("sends nothing else after a rate limit, and wakes when the limited entry is due", async () => {
    const server = memoryThemeServer();
    const a = await device(server);
    await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    await a.repo.saveTheme({ record: record("t2"), expectedLocalRevision: null });
    server.script.push({ rateLimitedMs: 4_000 });
    const lists = server.lists;
    await settle(a);
    expect(await a.repo.listOutbox()).toMatchObject([
      { themeId: "t1", sent: true, notBefore: 1_004_000 },
      { themeId: "t2", sent: false, attempts: 0 },
    ]);
    expect(server.rows.size).toBe(0);
    expect(server.lists).toBe(lists);
    expect(a.timers.at(-1)!.ms).toBe(4_000);
    expect(last(a).phase).toBe("idle");
    a.clock.now += 4_000;
    a.timers.at(-1)!.run();
    await a.sync.idle();
    expect(last(a).items.get("t1")).toEqual({ kind: "synced" });
    expect(last(a).items.get("t2")).toEqual({ kind: "synced" });
  });

  it("backs off through eight tries, then shows Not synced until a fresh round", async () => {
    const server = memoryThemeServer();
    const a = await device(server);
    await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    server.script.push(...Array<"error">(8).fill("error"));
    await settle(a);
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const timer = a.timers.at(-1)!;
      waits.push(timer.ms);
      a.clock.now += timer.ms;
      timer.run();
      await a.sync.idle();
    }
    expect(waits).toEqual([1, 2, 3, 4, 5, 6, 7].map(retryDelay));
    expect(await a.repo.listOutbox()).toMatchObject([{ attempts: THEME_RETRY.tries, hold: "retry-exhausted", sent: true }]);
    expect(last(a).items.get("t1")).toEqual({ kind: "held", hold: "retry-exhausted", detail: null });
    a.sync.wake("focus");
    await a.sync.idle();
    expect(last(a).items.get("t1")).toEqual({ kind: "synced" });
  });

  it("pauses offline and asks for sign-in without losing the change", async () => {
    const server = memoryThemeServer();
    const a = await device(server);
    await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    server.script.push("offline");
    await settle(a);
    expect(last(a).phase).toBe("offline");
    expect(await a.repo.listOutbox()).toMatchObject([{ attempts: 0 }]);
    server.script.push("unauthorized");
    a.sync.wake("online");
    await a.sync.idle();
    expect(last(a).phase).toBe("sign-in");
    expect(await a.repo.listOutbox()).toHaveLength(1);
    expect((await a.repo.listLibrary()).length).toBe(1);
  });

  it("holds a create past the cap, keeps the theme on the device, and sends it once there is room", async () => {
    const server = memoryThemeServer(1);
    const [a, b] = [await device(server), await device(server)];
    await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    await settle(a);
    await b.repo.saveTheme({ record: record("t2"), expectedLocalRevision: null });
    await settle(b);
    expect(last(b).items.get("t2")).toEqual({ kind: "held", hold: "library-full", detail: null });
    expect((await b.repo.listLibrary()).map((r) => r.id)).toContain("t2");
    const onA = await a.repo.loadTheme("t1");
    if (onA?.kind !== "saved") throw new Error("row");
    await a.repo.deleteTheme({ id: "t1", expectedLocalRevision: onA.localRevision });
    await settle(a);
    await settle(b);
    await b.sync.idle();
    expect(last(b).items.get("t2")).toEqual({ kind: "synced" });
  });

  it("does not skip a remote change it had to leave for a pending edit", async () => {
    const server = memoryThemeServer();
    const [a, b] = [await device(server), await device(server)];
    await a.repo.saveTheme({ record: record("t1", "Base"), expectedLocalRevision: null });
    await settle(a);
    await settle(b);
    expect(await b.repo.loadSyncMeta()).toEqual({ libraryRevision: 1 });
    const onA = await a.repo.loadTheme("t1");
    const onB = await b.repo.loadTheme("t1");
    if (onA?.kind !== "saved" || onB?.kind !== "saved") throw new Error("rows");
    await a.repo.saveTheme({ record: record("t1", "From A"), expectedLocalRevision: onA.localRevision });
    await settle(a);
    // B's own edit waits a minute behind a rate limit, so B's pull meets A's change while B's is pending.
    await b.repo.saveTheme({ record: record("t1", "From B"), expectedLocalRevision: onB.localRevision });
    server.script.push({ rateLimitedMs: 60_000 });
    await settle(b);
    // The rate limit ends that pass; the next one has nothing due and only pulls.
    await settle(b);
    expect(await b.repo.loadTheme("t1")).toMatchObject({ record: { name: "From B" } });
    expect(await b.repo.loadSyncMeta()).toEqual({ libraryRevision: null });
    b.clock.now += 60_000;
    b.timers.at(-1)!.run();
    await b.sync.idle();
    expect((await b.repo.listLibrary()).map((r) => r.record.name).sort()).toEqual(["From A", "From B (conflict copy)"]);
    expect(await b.repo.loadSyncMeta()).toEqual({ libraryRevision: 3 });
  });

  it("stops at once: a late answer after a switch writes nothing and reports nothing", async () => {
    const server = memoryThemeServer();
    const a = await device(server);
    await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    let release!: () => void;
    server.script.push({ hold: new Promise<void>((r) => (release = r)) });
    a.sync.wake("local");
    await vi.waitFor(() => expect(last(a).items.get("t1")).toEqual({ kind: "pending" }));
    const reports = a.reports.length;
    a.sync.stop();
    release();
    await a.sync.idle();
    expect(a.reports.length).toBe(reports);
    expect(a.changed).toBe(0);
    expect(await a.repo.listOutbox()).toMatchObject([{ attempts: 1, sent: true }]);
    expect(await a.repo.listRemote()).toEqual([]);
  });

  it("sends the body stored under the key when a local save lands between the read and the mark", async () => {
    const server = memoryThemeServer();
    let folded = false;
    let saved = 0;
    // The outbox was listed with "First"; before the mark, a local save folds "Second" into the same unsent entry.
    const a = await device(server, "user_1", (repo) => ({
      async markAttempt(input) {
        if (!folded) {
          folded = true;
          await repo.saveTheme({ record: record("t1", "Second"), expectedLocalRevision: saved });
        }
        return repo.markAttempt(input);
      },
    }));
    const first = await a.repo.saveTheme({ record: record("t1", "First"), expectedLocalRevision: null });
    if (!first.ok) throw new Error("save");
    saved = first.value.localRevision;
    await settle(a);
    expect(folded).toBe(true);
    expect(serverRecord(server, "t1")?.name).toBe("Second");
    expect(await a.repo.listOutbox()).toEqual([]);
  });

  it("decides again when a save lands between the refusal and the resolve", async () => {
    const server = memoryThemeServer();
    let armed = false;
    let raced = false;
    const a = await device(server);
    const b = await device(server, "user_1", (repo) => ({
      async resolveConflict(input) {
        if (armed && !raced) {
          raced = true;
          const row = await repo.loadTheme("t1");
          if (row?.kind !== "saved") throw new Error("row");
          await repo.saveTheme({ record: record("t1", "From B, later"), expectedLocalRevision: row.localRevision });
        }
        return repo.resolveConflict(input);
      },
    }));
    await a.repo.saveTheme({ record: record("t1", "Base"), expectedLocalRevision: null });
    await settle(a);
    await settle(b);
    const onA = await a.repo.loadTheme("t1");
    const onB = await b.repo.loadTheme("t1");
    if (onA?.kind !== "saved" || onB?.kind !== "saved") throw new Error("rows");
    await a.repo.saveTheme({ record: record("t1", "From A"), expectedLocalRevision: onA.localRevision });
    await settle(a);
    await b.repo.saveTheme({ record: record("t1", "From B"), expectedLocalRevision: onB.localRevision });
    armed = true;
    await settle(b);
    expect(raced).toBe(true);
    expect(serverRecord(server, "t1")?.name).toBe("From A");
    expect((await b.repo.listLibrary()).map((r) => r.record.name).sort()).toEqual(["From A", "From B, later (conflict copy)"]);
    expect(last(b).notices).toEqual([{ kind: "conflict-copy", themeId: "t1", copyId: "theme_copy_user_1_2" }]);
    expect(await b.repo.listOutbox()).toEqual([]);
  });

  it("keeps the server's edit when a delete meets it, and a dismissed notice goes", async () => {
    const server = memoryThemeServer();
    const [a, b] = [await device(server), await device(server)];
    await a.repo.saveTheme({ record: record("t1", "Base"), expectedLocalRevision: null });
    await settle(a);
    await settle(b);
    const onA = await a.repo.loadTheme("t1");
    const onB = await b.repo.loadTheme("t1");
    if (onA?.kind !== "saved" || onB?.kind !== "saved") throw new Error("rows");
    await b.repo.saveTheme({ record: record("t1", "From B"), expectedLocalRevision: onB.localRevision });
    await settle(b);
    await a.repo.deleteTheme({ id: "t1", expectedLocalRevision: onA.localRevision });
    await settle(a);
    expect(await a.repo.loadTheme("t1")).toMatchObject({ kind: "saved", record: { name: "From B" } });
    expect(last(a).notices).toEqual([{ kind: "kept-server", themeId: "t1", copyId: null }]);
    expect(await a.repo.listOutbox()).toEqual([]);
    expect(serverRecord(server, "t1")?.name).toBe("From B");
    a.sync.dismiss(0);
    await vi.waitFor(() => expect(last(a).notices).toEqual([]));
  });

  it("runs one follow-up pass for any number of wakes during a pass", async () => {
    const server = memoryThemeServer();
    const a = await device(server);
    await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    let release!: () => void;
    server.script.push({ hold: new Promise<void>((r) => (release = r)) });
    a.sync.wake("local");
    await vi.waitFor(() => expect(last(a).items.get("t1")).toEqual({ kind: "pending" }));
    a.sync.wake("local");
    a.sync.wake("poll");
    a.sync.wake("local");
    release();
    await a.sync.idle();
    // Each pass ends with one list: the first pass and exactly one follow-up.
    expect(server.lists).toBe(2);
  });

  it("reports and tries again later when a pass fails on storage", async () => {
    const server = memoryThemeServer();
    let failures = 1;
    const a = await device(server, "user_1", (repo) => ({
      async listOutbox() {
        if (failures > 0) {
          failures -= 1;
          throw new Error("storage went away");
        }
        return repo.listOutbox();
      },
    }));
    await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    a.sync.wake("local");
    await a.sync.idle();
    await vi.waitFor(() => expect(last(a).phase).toBe("idle"));
    expect(last(a).items.get("t1")).toEqual({ kind: "pending" });
    expect(a.timers.at(-1)!.ms).toBe(retryDelay(1));
    a.clock.now += retryDelay(1);
    a.timers.at(-1)!.run();
    await a.sync.idle();
    expect(last(a).items.get("t1")).toEqual({ kind: "synced" });
  });

  it("reads a library over several pages", async () => {
    const server = memoryThemeServer();
    server.pageSize = 1;
    const [a, b] = [await device(server), await device(server)];
    for (const id of ["t1", "t2", "t3"]) await a.repo.saveTheme({ record: record(id), expectedLocalRevision: null });
    await settle(a);
    const lists = server.lists;
    await settle(b);
    expect(server.lists - lists).toBe(3);
    expect((await b.repo.listLibrary()).map((r) => r.id).sort()).toEqual(["t1", "t2", "t3"]);
    expect(await b.repo.loadSyncMeta()).toEqual({ libraryRevision: 3 });
  });

  it("takes the themes that read when one does not, and reads the library again later", async () => {
    const server = memoryThemeServer();
    const [a, b] = [await device(server), await device(server)];
    for (const id of ["t1", "t2"]) await a.repo.saveTheme({ record: record(id), expectedLocalRevision: null });
    await settle(a);
    server.unreadable.add("t2");
    await settle(b);
    expect((await b.repo.listLibrary()).map((r) => r.id)).toEqual(["t1"]);
    expect(await b.repo.loadSyncMeta()).toEqual({ libraryRevision: null });
    expect(last(b).phase).toBe("idle");
    server.unreadable.clear();
    await settle(b);
    expect((await b.repo.listLibrary()).map((r) => r.id).sort()).toEqual(["t1", "t2"]);
    expect(await b.repo.loadSyncMeta()).toEqual({ libraryRevision: 2 });
  });

  describe("a refusal that comes back after later changes were queued", () => {
    const refusals = {
      invalid: { kind: "rejected", code: "invalid-theme", message: "bad", issues: [] },
      "library-full": { kind: "library-full", limit: 1 },
    } as const;
    /** Saves t1 (and confirms it first, for an update), then holds the write in flight until `refuse` answers. */
    async function refusedInFlight(base: "create" | "update", hold: keyof typeof refusals) {
      const server = memoryThemeServer();
      const a = await device(server);
      let saved = await a.repo.saveTheme({ record: record("t1", "One"), expectedLocalRevision: null });
      if (!saved.ok) throw new Error("save");
      if (base === "update") {
        await settle(a);
        saved = await a.repo.saveTheme({ record: record("t1", "Two"), expectedLocalRevision: saved.value.localRevision });
        if (!saved.ok) throw new Error("save");
      }
      let refuse!: () => void;
      server.script.push({ hold: new Promise<void>((r) => (refuse = r)), answer: refusals[hold] });
      a.sync.wake("local");
      await vi.waitFor(async () => expect(await a.repo.listOutbox()).toMatchObject([{ sent: true }]));
      const [sentKey] = (await a.repo.listOutbox()).map((e) => e.key);
      return { server, a, localRevision: saved.value.localRevision, refuse, sentKey: sentKey! };
    }

    describe.each(["invalid", "library-full"] as const)("as %s", (hold) => {
      it("sends nothing for a create deleted while it was in flight", async () => {
        const { server, a, localRevision, refuse } = await refusedInFlight("create", hold);
        await a.repo.deleteTheme({ id: "t1", expectedLocalRevision: localRevision });
        refuse();
        await a.sync.idle();
        expect(await a.repo.listOutbox()).toEqual([]);
        expect(server.rows.has("user_1/t1")).toBe(false);
        a.sync.wake("focus");
        await a.sync.idle();
        expect(server.rows.has("user_1/t1")).toBe(false);
        expect(last(a).items.has("t1")).toBe(false);
      });

      it("sends the delete of an update deleted while it was in flight", async () => {
        const { server, a, localRevision, refuse } = await refusedInFlight("update", hold);
        await a.repo.deleteTheme({ id: "t1", expectedLocalRevision: localRevision });
        refuse();
        await a.sync.idle();
        expect(server.rows.get("user_1/t1")).toMatchObject({ state: "deleted", revision: 2 });
        expect(await a.repo.listOutbox()).toEqual([]);
      });
    });

    it("sends a second save made while a refused save was in flight, under a new key", async () => {
      const { server, a, localRevision, refuse, sentKey } = await refusedInFlight("create", "invalid");
      await a.repo.saveTheme({ record: record("t1", "Second"), expectedLocalRevision: localRevision });
      refuse();
      await a.sync.idle();
      expect(server.rows.get("user_1/t1")).toMatchObject({ state: "live", revision: 1, record: { name: "Second" } });
      expect(server.receipts.has(`user_1/${sentKey}`)).toBe(false);
      expect(await a.repo.listOutbox()).toEqual([]);
      expect(last(a).items.get("t1")).toEqual({ kind: "synced" });
    });
  });

  describe("a key the server already used for a different change", () => {
    /** Leaves a receipt under the entry's key with another fingerprint, as a different change would have. */
    async function reuseKeyOf(server: MemoryThemeServer, d: Device) {
      const [entry] = await d.repo.listOutbox();
      server.receipts.set(`user_1/${entry!.key}`, {
        fingerprint: "another change",
        theme: { state: "deleted", id: "tx", revision: 1, updatedAt: "2026-09-23T10:00:00.000Z", deletedAt: "2026-09-23T10:00:00.000Z" },
      });
      return entry!.key;
    }

    it("sends the same change again under a new key", async () => {
      const server = memoryThemeServer();
      const a = await device(server);
      await a.repo.saveTheme({ record: record("t1", "Mine"), expectedLocalRevision: null });
      const reused = await reuseKeyOf(server, a);
      await settle(a);
      expect(serverRecord(server, "t1")?.name).toBe("Mine");
      expect(server.writes).toBe(1);
      expect([...server.receipts.keys()].filter((k) => k !== `user_1/${reused}`)).toHaveLength(1);
      expect(await a.repo.listOutbox()).toEqual([]);
      expect(last(a).items.get("t1")).toEqual({ kind: "synced" });
    });

    it("lets the revision check decide the new send: a newer edit makes a conflict copy", async () => {
      const server = memoryThemeServer();
      const [a, b] = [await device(server), await device(server)];
      await a.repo.saveTheme({ record: record("t1", "Base"), expectedLocalRevision: null });
      await settle(a);
      await settle(b);
      const onA = await a.repo.loadTheme("t1");
      const onB = await b.repo.loadTheme("t1");
      if (onA?.kind !== "saved" || onB?.kind !== "saved") throw new Error("rows");
      await a.repo.saveTheme({ record: record("t1", "From A"), expectedLocalRevision: onA.localRevision });
      await settle(a);
      await b.repo.saveTheme({ record: record("t1", "From B"), expectedLocalRevision: onB.localRevision });
      await reuseKeyOf(server, b);
      await settle(b);
      expect(serverRecord(server, "t1")?.name).toBe("From A");
      expect((await b.repo.listLibrary()).map((r) => r.record.name).sort()).toEqual(["From A", "From B (conflict copy)"]);
      expect(last(b).notices).toEqual([{ kind: "conflict-copy", themeId: "t1", copyId: "theme_copy_user_1_1" }]);
    });

    it("holds the change when the new key is answered key-reused too, without looping", async () => {
      const server = memoryThemeServer();
      const a = await device(server);
      await a.repo.saveTheme({ record: record("t1"), expectedLocalRevision: null });
      const reused = await reuseKeyOf(server, a);
      server.script.push(
        { hold: Promise.resolve(), answer: { kind: "key-reused" } },
        { hold: Promise.resolve(), answer: { kind: "key-reused" } },
      );
      await settle(a);
      const [held] = await a.repo.listOutbox();
      expect(held).toMatchObject({ hold: "retry-exhausted", sent: true });
      expect(held!.key).not.toBe(reused);
      expect(server.writes).toBe(0);
      expect(last(a).items.get("t1")).toEqual({ kind: "held", hold: "retry-exhausted", detail: null });
      server.script.push({ hold: Promise.resolve(), answer: { kind: "key-reused" } });
      a.sync.wake("focus");
      await a.sync.idle();
      expect(await a.repo.listOutbox()).toMatchObject([{ key: held!.key, hold: "retry-exhausted" }]);
      expect(server.script).toEqual([]);
    });
  });

  it("never logs a theme's name", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    const server = memoryThemeServer();
    const a = await device(server);
    await a.repo.saveTheme({ record: record("t1", "Secret Palette"), expectedLocalRevision: null });
    server.script.push("error");
    await settle(a);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret Palette");
  });
});

describe("webLock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes the browser's lock for the scope when there is one", async () => {
    const request = vi.fn((_name: string, run: () => Promise<unknown>) => run());
    vi.stubGlobal("navigator", { locks: { request } });
    const run = vi.fn(async () => 5);
    expect(await webLock("account:a:themes")(run)).toBe(5);
    expect(request).toHaveBeenCalledWith("runlog-theme-sync:account:a:themes", expect.any(Function));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs anyway, once, when the browser refuses the lock", async () => {
    vi.stubGlobal("navigator", { locks: { request: vi.fn(async () => Promise.reject(new DOMException("denied", "SecurityError"))) } });
    const run = vi.fn(async () => 7);
    expect(await webLock("s")(run)).toBe(7);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run twice when the pass itself fails under the lock", async () => {
    vi.stubGlobal("navigator", { locks: { request: (_name: string, run: () => Promise<unknown>) => run() } });
    const run = vi.fn(async () => Promise.reject(new Error("pass failed")));
    await expect(webLock("s")(run)).rejects.toThrow("pass failed");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs without a lock where the browser has none", async () => {
    vi.stubGlobal("navigator", {});
    const run = vi.fn(async () => 1);
    expect(await webLock("s")(run)).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
