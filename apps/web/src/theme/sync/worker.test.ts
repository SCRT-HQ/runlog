import { createThemeRecordFromPreset, type ThemeRecordV1 } from "@runlog/themes";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openThemeRepository, type ThemeRepository } from "../themeStorage.ts";
import { THEME_RETRY, retryDelay } from "./reconcile.ts";
import { memoryThemeApi, memoryThemeServer, serverRecord, type MemoryThemeServer } from "./testing/memoryThemeApi.ts";
import { createThemeSync, type ThemeSync, type ThemeSyncReport } from "./worker.ts";

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
async function device(server: MemoryThemeServer, sub = "user_1", factory = new IDBFactory()): Promise<Device> {
  const repo = await openThemeRepository({ kind: "account", id: sub }, factory);
  const d = { repo, reports: [], changed: 0, timers: [], clock: { now: 1_000_000 } } as unknown as Device;
  let ids = 0;
  d.sync = createThemeSync({
    repository: repo,
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
    const a = await device(server);
    const saved = await a.repo.saveTheme({ record: record("t1", "First"), expectedLocalRevision: null });
    if (!saved.ok) throw new Error("save");
    const repo = a.repo;
    let folded = false;
    // The outbox was listed with "First"; before the mark, a local save folds "Second" into the same unsent entry.
    const markAttempt: ThemeRepository["markAttempt"] = async (input) => {
      if (!folded) {
        folded = true;
        await repo.saveTheme({ record: record("t1", "Second"), expectedLocalRevision: saved.value.localRevision });
      }
      return repo.markAttempt(input);
    };
    const wrapped = new Proxy(repo, {
      get(target, prop) {
        if (prop === "markAttempt") return markAttempt;
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const sync = createThemeSync({
      repository: wrapped,
      api: memoryThemeApi(server),
      onLibraryChanged: () => undefined,
      onReport: () => undefined,
      setTimer: () => undefined,
      clearTimer: () => undefined,
      lock: (run) => run(),
    });
    sync.wake("local");
    await sync.idle();
    sync.stop();
    expect(folded).toBe(true);
    expect(serverRecord(server, "t1")?.name).toBe("Second");
    expect(await repo.listOutbox()).toEqual([]);
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
