import { describe, expect, it, vi } from "vitest";
import { presentationSnapshotKey, type PresentationSnapshotV1 } from "@runlog/themes";
import { SyncError } from "../../sync/client.ts";
import type { LookApi, LookPublishOutcome } from "../../sync/lookApi.ts";
import { snapshotForBuiltin } from "../appearance.ts";
import type { LocalLookChannel, LookChannelStore } from "./channelStore.ts";
import { createLookPublisher, LOOK_PUBLISH_DEBOUNCE_MS, type LookPublishState } from "./publisher.ts";

const ID = "lk_AAAAAAAAAAAAAAAA";
const AT = "2026-09-25T10:00:00.000Z";
const summary = (revision: number) => ({ id: ID, revision, createdAt: AT, updatedAt: AT, publishedAt: revision > 0 ? AT : null });

function fakeServer() {
  const server = {
    revision: 0,
    secret: "s".repeat(43),
    readKey: "r".repeat(32),
    gone: false,
    /** Answers or failures to give before the rules below apply, in order. */
    script: [] as Array<LookPublishOutcome | Error | Promise<LookPublishOutcome>>,
    publishes: [] as Array<{ base: number; key: string; secret: string }>,
  };
  const api: LookApi = {
    async list() {
      return [];
    },
    async create() {
      return { kind: "ok", channel: summary(0), readKey: server.readKey, secret: server.secret };
    },
    async publish({ secret, base, snapshot }) {
      server.publishes.push({ base, key: presentationSnapshotKey(snapshot), secret });
      const scripted = server.script.shift();
      if (scripted instanceof Error) throw scripted;
      if (scripted) return scripted;
      if (server.gone) return { kind: "gone" };
      if (secret !== server.secret) return { kind: "not-publisher" };
      if (base !== server.revision) return { kind: "stale", revision: server.revision };
      server.revision += 1;
      return { kind: "ok", revision: server.revision };
    },
    async transfer() {
      server.secret = "t".repeat(43);
      return { kind: "ok", channel: summary(server.revision), secret: server.secret };
    },
    async relink() {
      server.readKey = "q".repeat(32);
      return { kind: "ok", channel: summary(server.revision), readKey: server.readKey };
    },
    async revoke() {
      server.gone = true;
      return true;
    },
  };
  return { server, api };
}

function memoryStore(initial: LocalLookChannel | null = null) {
  const box = { value: initial, saves: 0 };
  const store: LookChannelStore = {
    async load() {
      return box.value;
    },
    async update(change) {
      const next = change(box.value);
      if (next === undefined) return { written: false, value: box.value };
      box.saves += 1;
      box.value = next;
      return { written: true, value: next };
    },
    async save(channel) {
      box.saves += 1;
      box.value = channel;
    },
    async clear() {
      box.value = null;
    },
    close() {},
  };
  return { box, store };
}

function manualTimers() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    pending,
    setTimer: (fn: () => void, ms: number) => {
      const entry = { fn, ms };
      pending.push(entry);
      return entry;
    },
    clearTimer: (handle: unknown) => {
      const i = pending.indexOf(handle as { fn: () => void; ms: number });
      if (i >= 0) pending.splice(i, 1);
    },
    fire() {
      pending.shift()?.fn();
    },
  };
}

/** A tab: its own publisher, timers and look, over a server and a stored record it may share with another tab. */
function tab(api: LookApi, store: LookChannelStore) {
  const timers = manualTimers();
  const look = { now: snapshotForBuiltin("ember") as PresentationSnapshotV1 };
  const states: LookPublishState["kind"][] = [];
  const publisher = createLookPublisher({
    api,
    store,
    snapshot: () => look.now,
    onState: (state) => states.push(state.kind),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { timers, look, states, publisher };
}

function setup(initial: LocalLookChannel | null = null) {
  const { server, api } = fakeServer();
  const { box, store } = memoryStore(initial);
  return { server, api, box, store, ...tab(api, store) };
}
const held = (revision: number, key: string | null): LocalLookChannel => ({
  schemaVersion: 1,
  id: ID,
  secret: "s".repeat(43),
  readKey: "r".repeat(32),
  revision,
  publishedKey: key,
});

describe("publishing this device's look", () => {
  it("makes a link and publishes the applied look at once, before the link is called ready", async () => {
    const t = setup();
    await t.publisher.start();
    expect(t.states).toEqual(["none"]);
    expect(await t.publisher.create()).toBe("ok");
    await t.publisher.idle();
    expect(t.server.publishes).toEqual([{ base: 0, key: presentationSnapshotKey(snapshotForBuiltin("ember")), secret: "s".repeat(43) }]);
    expect(t.box.value).toMatchObject({
      id: ID,
      readKey: "r".repeat(32),
      revision: 1,
      publishedKey: presentationSnapshotKey(snapshotForBuiltin("ember")),
    });
    expect(t.states).toEqual(["none", "not-published", "following"]);
  });

  it("sends one publish a second after the last of a burst of Applies", async () => {
    const t = setup(held(1, presentationSnapshotKey(snapshotForBuiltin("ember"))));
    await t.publisher.start();
    await t.publisher.idle();
    expect(t.server.publishes).toHaveLength(0);
    t.server.revision = 1;
    for (const id of ["glaze", "daylight", "stardust", "rainbow-road", "glaze"] as const) {
      t.look.now = snapshotForBuiltin(id);
      t.publisher.applied();
    }
    expect(t.timers.pending.map((p) => p.ms)).toEqual([LOOK_PUBLISH_DEBOUNCE_MS]);
    t.timers.fire();
    await t.publisher.idle();
    expect(t.server.publishes.map((p) => p.key)).toEqual([presentationSnapshotKey(snapshotForBuiltin("glaze"))]);
    // The same look again is not news.
    t.publisher.applied();
    t.timers.fire();
    await t.publisher.idle();
    expect(t.server.publishes).toHaveLength(1);
  });

  it("takes another tab's newer revision and sends this look on it", async () => {
    const t = setup(held(1, null));
    t.server.revision = 3;
    await t.publisher.start();
    await t.publisher.idle();
    expect(t.server.publishes.map((p) => p.base)).toEqual([1, 3]);
    expect(t.box.value?.revision).toBe(4);
    expect(t.states.at(-1)).toBe("following");
  });

  it("stops and says so when another device holds the link, and goes on after Use this device", async () => {
    const t = setup(held(1, null));
    t.server.revision = 1;
    t.server.secret = "t".repeat(43);
    await t.publisher.start();
    await t.publisher.idle();
    expect(t.states.at(-1)).toBe("elsewhere");
    expect(t.timers.pending).toHaveLength(0);
    t.look.now = snapshotForBuiltin("glaze");
    t.publisher.applied();
    t.timers.fire();
    await t.publisher.idle();
    expect(t.server.publishes).toHaveLength(1);
    expect(await t.publisher.takeOver(ID)).toBe("ok");
    await t.publisher.idle();
    expect(t.server.publishes.at(-1)).toMatchObject({ secret: "t".repeat(43), key: presentationSnapshotKey(snapshotForBuiltin("glaze")) });
    expect(t.box.value).toMatchObject({ secret: "t".repeat(43), readKey: "r".repeat(32) });
    expect(t.states.at(-1)).toBe("following");
  });

  it("forgets a link the server no longer has", async () => {
    const t = setup(held(1, null));
    t.server.gone = true;
    await t.publisher.start();
    await t.publisher.idle();
    expect(t.box.value).toBeNull();
    expect(t.states.at(-1)).toBe("gone");
  });

  it("retries offline on the theme sync schedule and says the widgets show the last look", async () => {
    const t = setup(held(1, null));
    t.server.revision = 1;
    t.server.script.push(new SyncError("offline"), new SyncError("offline"));
    await t.publisher.start();
    await t.publisher.idle();
    expect(t.states.at(-1)).toBe("offline");
    expect(t.timers.pending.map((p) => p.ms)).toEqual([20_000]);
    t.timers.fire();
    await t.publisher.idle();
    expect(t.timers.pending.map((p) => p.ms)).toEqual([40_000]);
    t.timers.fire();
    await t.publisher.idle();
    expect(t.states.at(-1)).toBe("following");
    expect(t.server.publishes).toHaveLength(3);
  });

  it("says not published yet when the first publish cannot go", async () => {
    const t = setup();
    await t.publisher.start();
    t.server.script.push(new SyncError("offline"));
    await t.publisher.create();
    await t.publisher.idle();
    expect(t.states.at(-1)).toBe("not-published");
  });

  it("waits as long as the server asks after a rate limit", async () => {
    const t = setup(held(1, null));
    t.server.revision = 1;
    t.server.script.push({ kind: "rate-limited", retryAfterMs: 12_000 });
    await t.publisher.start();
    await t.publisher.idle();
    expect(t.timers.pending.map((p) => p.ms)).toEqual([12_000]);
  });

  it("does not retry a sign-out", async () => {
    const t = setup(held(1, null));
    t.server.script.push(new SyncError("unauthorized"));
    await t.publisher.start();
    await t.publisher.idle();
    expect(t.timers.pending).toHaveLength(0);
  });

  it("writes nothing and reports nothing once stopped, even when an answer lands afterwards", async () => {
    const t = setup(held(1, null));
    t.server.revision = 1;
    let land!: (outcome: LookPublishOutcome) => void;
    t.server.script.push(new Promise<LookPublishOutcome>((resolve) => (land = resolve)));
    await t.publisher.start();
    const before = t.states.length;
    const saves = t.box.saves;
    t.publisher.stop();
    land({ kind: "ok", revision: 2 });
    await t.publisher.idle();
    expect(t.box.saves).toBe(saves);
    expect(t.states).toHaveLength(before);
    t.publisher.applied();
    expect(t.timers.pending).toHaveLength(0);
  });

  it("keeps the new key after New link, and forgets the link after Revoke", async () => {
    const t = setup(held(1, presentationSnapshotKey(snapshotForBuiltin("ember"))));
    t.server.revision = 1;
    await t.publisher.start();
    expect(await t.publisher.relink()).toBe("ok");
    expect(t.box.value?.readKey).toBe("q".repeat(32));
    expect(await t.publisher.revoke(ID)).toBe(true);
    expect(t.box.value).toBeNull();
    expect(t.states.at(-1)).toBe("none");
  });

  it("keeps another tab's new read key when this tab publishes after it", async () => {
    const one = setup(held(1, presentationSnapshotKey(snapshotForBuiltin("ember"))));
    one.server.revision = 1;
    const two = tab(one.api, one.store);
    await one.publisher.start();
    await two.publisher.start();
    await one.publisher.idle();
    await two.publisher.idle();
    expect(await one.publisher.relink()).toBe("ok");
    two.look.now = snapshotForBuiltin("glaze");
    two.publisher.applied();
    two.timers.fire();
    await two.publisher.idle();
    expect(one.server.publishes.map((p) => p.key)).toEqual([presentationSnapshotKey(snapshotForBuiltin("glaze"))]);
    expect(one.box.value).toMatchObject({ readKey: "q".repeat(32), revision: 2 });
  });

  it("finds a link another tab made before its next publish or create", async () => {
    const one = setup();
    const two = tab(one.api, one.store);
    const creates = vi.spyOn(one.api, "create");
    await one.publisher.start();
    await two.publisher.start();
    expect(await two.publisher.create()).toBe("ok");
    await two.publisher.idle();
    expect(creates).toHaveBeenCalledTimes(1);
    one.look.now = snapshotForBuiltin("glaze");
    one.publisher.applied();
    one.timers.fire();
    await one.publisher.idle();
    expect(one.server.publishes.map((p) => p.key).at(-1)).toBe(presentationSnapshotKey(snapshotForBuiltin("glaze")));
    expect(one.states.at(-1)).toBe("following");
    expect(await one.publisher.create()).toBe("ok");
    expect(creates).toHaveBeenCalledTimes(1);
  });

  it("keeps a link made or moved while the account changed", async () => {
    const t = setup(held(1, presentationSnapshotKey(snapshotForBuiltin("ember"))));
    t.server.revision = 1;
    await t.publisher.start();
    await t.publisher.idle();
    let land!: () => void;
    const gate = new Promise<void>((resolve) => (land = resolve));
    const transfer = t.api.transfer.bind(t.api);
    t.api.transfer = async (id) => {
      await gate;
      return transfer(id);
    };
    const moving = t.publisher.takeOver(ID);
    t.publisher.stop();
    land();
    expect(await moving).toBe("ok");
    expect(t.box.value).toMatchObject({ id: ID, secret: "t".repeat(43), readKey: "r".repeat(32) });

    const fresh = setup();
    await fresh.publisher.start();
    const create = fresh.api.create.bind(fresh.api);
    let open!: () => void;
    const held2 = new Promise<void>((resolve) => (open = resolve));
    fresh.api.create = async () => {
      await held2;
      return create();
    };
    const making = fresh.publisher.create();
    fresh.publisher.stop();
    open();
    expect(await making).toBe("ok");
    expect(fresh.box.value).toMatchObject({ id: ID, secret: "s".repeat(43), readKey: "r".repeat(32), revision: 0 });
    expect(fresh.server.publishes).toHaveLength(0);
  });

  it("remembers another device holds the link, and sends nothing on the next start", async () => {
    const t = setup(held(1, null));
    t.server.revision = 1;
    t.server.secret = "t".repeat(43);
    await t.publisher.start();
    await t.publisher.idle();
    expect(t.box.value?.elsewhere).toBe(true);
    const again = tab(t.api, t.store);
    await again.publisher.start();
    await again.publisher.idle();
    expect(again.states).toEqual(["elsewhere"]);
    expect(t.server.publishes).toHaveLength(1);
  });

  it("says the widgets show the last look while it waits out a rate limit", async () => {
    const t = setup(held(1, null));
    t.server.revision = 1;
    t.server.script.push({ kind: "rate-limited", retryAfterMs: 12_000 });
    await t.publisher.start();
    await t.publisher.idle();
    expect(t.states.at(-1)).toBe("offline");
  });

  it("follows up a publish whose answer landed after a relink", async () => {
    const t = setup(held(1, null));
    t.server.revision = 1;
    let land!: (outcome: LookPublishOutcome) => void;
    t.server.script.push(new Promise<LookPublishOutcome>((resolve) => (land = resolve)));
    await t.publisher.start();
    const relinking = t.publisher.relink();
    await relinking;
    land({ kind: "ok", revision: 2 });
    await t.publisher.idle();
    expect(t.box.value).toMatchObject({
      readKey: "q".repeat(32),
      revision: 2,
      publishedKey: presentationSnapshotKey(snapshotForBuiltin("ember")),
    });
    expect(t.states.at(-1)).toBe("following");
  });

  it("reports a record it cannot read as a failure and tries again", async () => {
    const t = setup(held(1, null));
    t.store.load = async () => {
      throw new Error("storage");
    };
    await t.publisher.start();
    expect(t.states.at(-1)).toBe("not-published");
    expect(t.timers.pending.map((p) => p.ms)).toEqual([20_000]);
    t.timers.fire();
    await t.publisher.idle();
    expect(t.timers.pending.map((p) => p.ms)).toEqual([40_000]);
  });

  it("never writes the secret to the console", async () => {
    const t = setup(held(1, null));
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    t.server.script.push({ kind: "rejected", code: "invalid-look" });
    await t.publisher.start();
    await t.publisher.idle();
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("s".repeat(43));
      spy.mockRestore();
    }
  });
});
