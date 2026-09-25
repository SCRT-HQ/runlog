import { describe, expect, it } from "vitest";
import { presentationSnapshotKey, type PublicLookV1 } from "@runlog/themes";
import { SyncError } from "../sync/client.ts";
import type { PublicLookAnswer } from "../sync/lookApi.ts";
import { snapshotForBuiltin } from "../theme/appearance.ts";
import {
  bootFollowedLook,
  createLookFollower,
  forgetCachedLook,
  LOOK_POLL_MS,
  readCachedLook,
  writeCachedLook,
  type FollowedLook,
} from "./channel.ts";

const A = "a".repeat(32);
const B = "b".repeat(32);
const lookOf = (id: Parameters<typeof snapshotForBuiltin>[0], revision: number): PublicLookV1 => ({
  schemaVersion: 1,
  revision,
  snapshot: snapshotForBuiltin(id),
});
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
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
  };
}
function follow(readKey: string, answers: Array<PublicLookAnswer | Error>, storage = memoryStorage()) {
  const seen: FollowedLook[] = [];
  const asked: string[] = [];
  const timers = manualTimers();
  const follower = createLookFollower({
    readKey,
    fetchLook: async (key) => {
      asked.push(key);
      const next = answers.shift() ?? new SyncError("offline");
      if (next instanceof Error) throw next;
      return next;
    },
    onChange: (look) => seen.push(look),
    storage,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { follower, seen, asked, timers, storage };
}
const keyOf = (look: FollowedLook | undefined) => (look?.kind === "look" ? presentationSnapshotKey(look.snapshot) : look?.kind);

describe("a widget's cache of a theme link", () => {
  it("keeps the last good look per link, the four most recent links only", () => {
    const s = memoryStorage();
    writeCachedLook(A, lookOf("ember", 1), s);
    expect(readCachedLook(A, s)?.revision).toBe(1);
    expect(readCachedLook(B, s)).toBeNull();
    for (const c of ["c", "d", "e", "f"]) writeCachedLook(c.repeat(32), lookOf("glaze", 1), s);
    expect(readCachedLook(A, s)).toBeNull();
    expect(readCachedLook("f".repeat(32), s)?.revision).toBe(1);
    forgetCachedLook("f".repeat(32), s);
    expect(readCachedLook("f".repeat(32), s)).toBeNull();
  });

  it("reads nothing from a cache that does not read, and nothing for a key of the wrong shape", () => {
    const s = memoryStorage();
    s.setItem(`runlog.look.v1:${A}`, '{"schemaVersion":1,"revision":1,"snapshot":{"colors":"url(x)"}}');
    expect(readCachedLook(A, s)).toBeNull();
    s.setItem(`runlog.look.v1:${B}`, "x".repeat(9000));
    expect(readCachedLook(B, s)).toBeNull();
    expect(readCachedLook("short", s)).toBeNull();
  });

  it("boots from the same link's cache, waits with none, and calls a malformed key gone", () => {
    const s = memoryStorage();
    writeCachedLook(A, lookOf("glaze", 3), s);
    expect(bootFollowedLook(A, s)).toMatchObject({ kind: "look", revision: 3, from: "cache" });
    expect(bootFollowedLook(B, s)).toEqual({ kind: "waiting" });
    expect(bootFollowedLook("", s)).toEqual({ kind: "gone" });
    expect(bootFollowedLook(`${A}&t=x`, s)).toEqual({ kind: "gone" });
  });
});

describe("a widget following a theme link", () => {
  it("shows the cached look at once, then the server's", async () => {
    const f = follow(A, [{ kind: "look", look: lookOf("daylight", 4) }]);
    writeCachedLook(A, lookOf("glaze", 3), f.storage);
    f.follower.start();
    await f.follower.idle();
    expect(f.seen.map(keyOf)).toEqual([
      presentationSnapshotKey(snapshotForBuiltin("glaze")),
      presentationSnapshotKey(snapshotForBuiltin("daylight")),
    ]);
    expect(readCachedLook(A, f.storage)?.revision).toBe(4);
  });

  it("drops to gone and forgets the cache when the link was revoked or its account deleted", async () => {
    const f = follow(A, [{ kind: "gone" }]);
    writeCachedLook(A, lookOf("glaze", 3), f.storage);
    f.follower.start();
    await f.follower.idle();
    expect(f.seen.at(-1)).toEqual({ kind: "gone" });
    expect(readCachedLook(A, f.storage)).toBeNull();
  });

  it("keeps the last good look through an answer that does not read, or no answer", async () => {
    const f = follow(A, [new SyncError("error"), new SyncError("offline")]);
    writeCachedLook(A, lookOf("glaze", 3), f.storage);
    f.follower.start();
    await f.follower.idle();
    f.follower.ring();
    await f.follower.idle();
    expect(f.seen.map(keyOf)).toEqual([presentationSnapshotKey(snapshotForBuiltin("glaze"))]);
  });

  it("starting offline with only another link's cache, shows nobody's look", async () => {
    const f = follow(B, [new SyncError("offline")]);
    writeCachedLook(A, lookOf("rainbow-road", 9), f.storage);
    f.follower.start();
    await f.follower.idle();
    expect(f.seen).toEqual([{ kind: "waiting" }]);
  });

  it("does not let an older answer overtake a newer one", async () => {
    const f = follow(A, [
      { kind: "look", look: lookOf("glaze", 5) },
      { kind: "look", look: lookOf("ember", 4) },
    ]);
    f.follower.start();
    await f.follower.idle();
    f.follower.ring();
    await f.follower.idle();
    expect(keyOf(f.seen.at(-1))).toBe(presentationSnapshotKey(snapshotForBuiltin("glaze")));
  });

  it("reads again on a ring and once a minute, and not after it stops", async () => {
    const f = follow(A, [
      { kind: "look", look: lookOf("ember", 1) },
      { kind: "look", look: lookOf("glaze", 2) },
      { kind: "look", look: lookOf("daylight", 3) },
    ]);
    f.follower.start();
    await f.follower.idle();
    f.follower.ring();
    await f.follower.idle();
    expect(f.timers.pending.map((p) => p.ms)).toEqual([LOOK_POLL_MS]);
    f.timers.pending.shift()!.fn();
    await f.follower.idle();
    expect(f.timers.pending.map((p) => p.ms)).toEqual([LOOK_POLL_MS]);
    expect(keyOf(f.seen.at(-1))).toBe(presentationSnapshotKey(snapshotForBuiltin("daylight")));
    f.follower.stop();
    expect(f.timers.pending).toHaveLength(0);
    f.follower.ring();
    await f.follower.idle();
    expect(f.asked).toHaveLength(3);
  });

  it("writes and shows nothing again when a read brings the revision it already shows", async () => {
    const f = follow(A, [
      { kind: "look", look: lookOf("glaze", 2) },
      { kind: "look", look: lookOf("glaze", 2) },
    ]);
    const writes: string[] = [];
    const setItem = f.storage.setItem;
    f.storage.setItem = (k: string, v: string) => {
      writes.push(k);
      setItem(k, v);
    };
    f.follower.start();
    await f.follower.idle();
    const written = writes.length;
    f.follower.ring();
    await f.follower.idle();
    expect(f.asked).toHaveLength(2);
    expect(writes).toHaveLength(written);
    expect(f.seen.map((look) => look.kind)).toEqual(["waiting", "look"]);
  });

  it("takes the server's word for a cached revision once, then nothing more for it", async () => {
    const f = follow(A, [
      { kind: "look", look: lookOf("glaze", 3) },
      { kind: "look", look: lookOf("glaze", 3) },
    ]);
    writeCachedLook(A, lookOf("glaze", 3), f.storage);
    f.follower.start();
    await f.follower.idle();
    f.follower.ring();
    await f.follower.idle();
    expect(f.seen.map((look) => (look.kind === "look" ? look.from : look.kind))).toEqual(["cache", "server"]);
  });

  it("never asks the server with a key of the wrong shape", async () => {
    const f = follow("short", [{ kind: "look", look: lookOf("ember", 1) }]);
    f.follower.start();
    await f.follower.idle();
    expect(f.asked).toEqual([]);
    expect(f.seen).toEqual([{ kind: "gone" }]);
  });
});
