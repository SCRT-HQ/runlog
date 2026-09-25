import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { presentationSnapshotKey, type PresentationSnapshotV1 } from "@runlog/themes";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { route, type Deps } from "../hosted/infra/lib/handlers/api.ts";
import { hashToken } from "../hosted/infra/lib/handlers/auth.ts";
import { lookRinger, lookUnfollower, type Poster } from "../hosted/infra/lib/handlers/live.ts";
import { route as wsRoute, type WsDeps, type WsEvent } from "../hosted/infra/lib/handlers/ws.ts";
import { memoryLive } from "../hosted/infra/test/memory-live.ts";
import { memoryLooks } from "../hosted/infra/test/memory-looks.ts";
import { createTransport } from "../apps/web/src/sync/client.ts";
import { createLookApi, fetchPublicLook } from "../apps/web/src/sync/lookApi.ts";
import { snapshotForBuiltin } from "../apps/web/src/theme/appearance.ts";
import { openLookChannelStore, type LookChannelStore } from "../apps/web/src/theme/follow/channelStore.ts";
import { createLookPublisher, type LookPublisher, type LookPublishState } from "../apps/web/src/theme/follow/publisher.ts";
import { createLookFollower, readCachedLook, type FollowedLook, type LookFollower } from "../apps/web/src/widget/channel.ts";

type Built = Parameters<typeof snapshotForBuiltin>[0];
const BASE = "https://runlog.test/api";
const RUN_TOKEN = "t".repeat(32);
const key = (id: Built) => presentationSnapshotKey(snapshotForBuiltin(id));
const keyOf = (look: FollowedLook | undefined) => (look?.kind === "look" ? presentationSnapshotKey(look.snapshot) : look?.kind);

let seconds = 0;
const looks = memoryLooks();
const live = memoryLive();
/** Which widget a connection belongs to, so a ring reaches the follower that opened it. */
const followers = new Map<string, LookFollower>();
/** Every ring, by the connection it went to. */
const rung: string[] = [];
const rings = (connectionId: string) => rung.filter((c) => c === connectionId).length;
const poster: Poster = {
  async post(connectionId, data) {
    if ((JSON.parse(data) as { t?: string }).t === "look") {
      rung.push(connectionId);
      followers.get(connectionId)?.ring();
    }
    return live.conns.has(connectionId) ? "sent" : "gone";
  },
};
// Any reach past the theme link routes into another store is a failure of this test's premise.
const refuse = (allowed: Record<string, unknown> = {}) =>
  new Proxy(allowed, {
    get: (target, name) =>
      name === "then"
        ? undefined
        : name in target
          ? target[name as string]
          : () => {
              throw new Error(`theme link routes reached ${String(name)}`);
            },
  });
const deps = {
  store: refuse({ deleteUser: async () => 0 }),
  races: refuse(),
  billing: refuse(),
  publishers: refuse(),
  listings: refuse(),
  sales: refuse(),
  gates: false,
  env: "test",
  appUrl: "https://runlog.test/",
  now: () => new Date(Date.parse("2026-09-25T10:00:00.000Z") + (seconds += 1) * 1000).toISOString(),
  verify: async (authorization?: string) => {
    if (authorization === "Bearer alice") return { sub: "user_a", sid: "s1" };
    if (authorization === "Bearer bob") return { sub: "user_b", sid: "s2" };
    throw new Error("bad token");
  },
  looks,
  ringLook: lookRinger(live, poster),
  unfollowLook: lookUnfollower(live),
} as unknown as Deps;
const wsDeps = {
  live,
  poster,
  looks,
  store: {
    async getSession(id: string) {
      if (id !== "run1") return null;
      return {
        meta: {
          id,
          packId: "p",
          packVersion: "1",
          ownerSub: "user_a",
          createdAt: "",
          updatedAt: "",
          seq: 1,
          publicTokenHash: hashToken(RUN_TOKEN),
        },
        members: [],
      };
    },
    async streamKeyOwner() {
      return null;
    },
    async manifest() {
      return { packs: [], licenses: [], sessions: [] };
    },
    async getSnapshot() {
      return null;
    },
    async updateSession() {
      return null;
    },
  },
  races: {
    async getRace() {
      return null;
    },
  },
  verify: async () => {
    throw new Error("no accounts on a widget's socket");
  },
  now: () => "2026-09-25T10:00:00.000Z",
} as unknown as WsDeps;
const ws = (routeKey: string, connectionId: string, extra: Partial<WsEvent> = {}) =>
  wsRoute({ requestContext: { routeKey, connectionId }, ...extra }, wsDeps);

const fetchImpl: typeof fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const event = {
    version: "2.0",
    routeKey: "$default",
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    ...(url.search ? { queryStringParameters: Object.fromEntries(url.searchParams) } : {}),
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    requestContext: { http: { method: init.method ?? "GET", path: url.pathname } },
    isBase64Encoded: false,
    ...(typeof init.body === "string" ? { body: init.body } : {}),
  } as unknown as APIGatewayProxyEventV2;
  const out = (await route(event, deps)) as APIGatewayProxyStructuredResultV2;
  return new Response(out.body ?? "", { status: out.statusCode ?? 200, headers: out.headers as Record<string, string> });
};
const offline: typeof fetch = async () => {
  throw new TypeError("offline");
};

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

interface Device {
  publisher: LookPublisher;
  store: LookChannelStore;
  look: { now: PresentationSnapshotV1 };
  states: LookPublishState["kind"][];
  apply(id: Built): Promise<void>;
}
const devices: Device[] = [];
async function device(sub: string, token: string): Promise<Device> {
  const store = await openLookChannelStore({ kind: "account", id: sub }, new IDBFactory());
  const look = { now: snapshotForBuiltin("ember") as PresentationSnapshotV1 };
  const states: LookPublishState["kind"][] = [];
  const timers: Array<() => void> = [];
  const publisher = createLookPublisher({
    api: createLookApi(createTransport(BASE, async () => token, fetchImpl)),
    store,
    snapshot: () => look.now,
    onState: (s) => states.push(s.kind),
    setTimer: (fn) => (timers.push(fn), fn),
    clearTimer: (handle) => {
      const i = timers.indexOf(handle as () => void);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  await publisher.start();
  const d: Device = {
    publisher,
    store,
    look,
    states,
    async apply(id) {
      look.now = snapshotForBuiltin(id);
      publisher.applied();
      // The debounce, released by hand.
      timers.shift()?.();
      await publisher.idle();
    },
  };
  devices.push(d);
  return d;
}

interface Widget {
  follower: LookFollower;
  seen: FollowedLook[];
  storage: ReturnType<typeof memoryStorage>;
}
async function widget(
  connectionId: string,
  readKey: string,
  { storage = memoryStorage(), fetch = fetchImpl }: { storage?: ReturnType<typeof memoryStorage>; fetch?: typeof fetchImpl } = {},
): Promise<Widget> {
  const seen: FollowedLook[] = [];
  const follower = createLookFollower({
    readKey,
    fetchLook: (k) => fetchPublicLook(BASE, k, fetch),
    onChange: (look) => seen.push(look),
    storage,
    setTimer: () => null,
    clearTimer: () => undefined,
    // A ring reads at once here, so a settle sees it; the random wait is the unit tests' business.
    ringDelay: () => 0,
  });
  followers.set(connectionId, follower);
  follower.start();
  // The run's own socket: the widget follows its link on the connection it watches the run on.
  expect((await ws("$connect", connectionId, { queryStringParameters: { t: RUN_TOKEN, run: "run1" } })).statusCode).toBe(200);
  await ws("$default", connectionId, { body: JSON.stringify({ t: "follow", ch: readKey }) });
  await follower.idle();
  return { follower, seen, storage };
}
const settle = async (...widgets: Widget[]) => {
  for (const w of widgets) await w.follower.idle();
};
const following = (id: string) => [...(live.follows.get(id) ?? [])].sort();

afterEach(() => {
  for (const f of followers.values()) f.stop();
  followers.clear();
  for (const d of devices.splice(0)) {
    d.publisher.stop();
    d.store.close();
  }
});

describe("a theme link between machines, through the real handlers", () => {
  it("two widgets follow a device, move with the link, refuse the old device, and fall back after New link and Revoke", async () => {
    const laptop = await device("user_a", "alice");
    expect(await laptop.publisher.create()).toBe("ok");
    await laptop.publisher.idle();
    const held = (await laptop.store.load())!;
    const [w1, w2] = [await widget("c1", held.readKey!), await widget("c2", held.readKey!)];
    expect([keyOf(w1.seen.at(-1)), keyOf(w2.seen.at(-1))]).toEqual([key("ember"), key("ember")]);
    expect(following(held.id)).toEqual(["c1", "c2"]);

    await laptop.apply("glaze");
    await settle(w1, w2);
    expect([keyOf(w1.seen.at(-1)), keyOf(w2.seen.at(-1))]).toEqual([key("glaze"), key("glaze")]);

    // The desktop takes the link over and publishes its own look; the widgets follow it.
    const desktop = await device("user_a", "alice");
    desktop.look.now = snapshotForBuiltin("daylight");
    expect(await desktop.publisher.takeOver(held.id)).toBe("ok");
    await desktop.publisher.idle();
    await settle(w1, w2);
    expect([keyOf(w1.seen.at(-1)), keyOf(w2.seen.at(-1))]).toEqual([key("daylight"), key("daylight")]);
    expect((await desktop.store.load())?.readKey).toBeNull();
    const current = (await desktop.store.load())!.revision;
    expect(current).toBe(3);

    // The laptop wakes with a new Apply and its old secret: refused, and the widgets keep the desktop's look.
    await laptop.apply("stardust");
    expect(laptop.states.at(-1)).toBe("elsewhere");
    expect((await laptop.store.load())?.elsewhere).toBe(true);
    await settle(w1, w2);
    expect(keyOf(w1.seen.at(-1))).toBe(key("daylight"));
    // A replay of the laptop's old publish, at the revision it last saw or at the current one, is refused the same way.
    const replayer = createLookApi(createTransport(BASE, async () => "alice", fetchImpl));
    for (const base of [2, current])
      expect(await replayer.publish({ id: held.id, secret: held.secret, base, snapshot: snapshotForBuiltin("stardust") })).toEqual({
        kind: "not-publisher",
      });
    expect(looks.rows.get(`user_a/${held.id}`)?.revision).toBe(current);
    await settle(w1, w2);
    expect([keyOf(w1.seen.at(-1)), keyOf(w2.seen.at(-1))]).toEqual([key("daylight"), key("daylight")]);

    // New link: widgets on the old address fall back at once; a widget on the new one follows.
    expect(await desktop.publisher.relink()).toBe("ok");
    await settle(w1, w2);
    expect([w1.seen.at(-1), w2.seen.at(-1)]).toEqual([{ kind: "gone" }, { kind: "gone" }]);
    expect(readCachedLook(held.readKey!, w1.storage)).toBeNull();
    expect(following(held.id)).toEqual([]);
    const fresh = (await desktop.store.load())!.readKey!;
    expect(fresh).not.toBe(held.readKey);
    const w3 = await widget("c3", fresh);
    expect(keyOf(w3.seen.at(-1))).toBe(key("daylight"));
    expect(following(held.id)).toEqual(["c3"]);

    // The next look rings the new address only; the old one hears nothing more.
    const [before1, before2] = [rings("c1"), rings("c2")];
    await desktop.apply("glaze");
    expect(desktop.states.at(-1)).toBe("following");
    await settle(w1, w2, w3);
    expect(keyOf(w3.seen.at(-1))).toBe(key("glaze"));
    expect([rings("c1"), rings("c2")]).toEqual([before1, before2]);
    expect([w1.seen.at(-1), w2.seen.at(-1)]).toEqual([{ kind: "gone" }, { kind: "gone" }]);

    // Revoke: the last widget falls back too.
    expect(await desktop.publisher.revoke(held.id)).toBe(true);
    await settle(w3);
    expect(w3.seen.at(-1)).toEqual({ kind: "gone" });
    expect(readCachedLook(fresh, w3.storage)).toBeNull();
    expect(following(held.id)).toEqual([]);
    expect(await desktop.store.load()).toBeNull();
  });

  it("keeps another account out, and drops the widgets when the owner deletes the account", async () => {
    const mine = await device("user_a", "alice");
    await mine.publisher.create();
    await mine.publisher.idle();
    const held = (await mine.store.load())!;
    const w = await widget("c9", held.readKey!);
    expect(keyOf(w.seen.at(-1))).toBe(key("ember"));

    const bob = createLookApi(createTransport(BASE, async () => "bob", fetchImpl));
    expect(await bob.list()).toEqual([]);
    expect(await bob.transfer(held.id)).toEqual({ kind: "gone" });
    expect(await bob.relink(held.id)).toEqual({ kind: "gone" });
    expect(await bob.revoke(held.id)).toBe(false);
    expect(await bob.publish({ id: held.id, secret: held.secret, base: 1, snapshot: snapshotForBuiltin("glaze") })).toEqual({
      kind: "gone",
    });
    expect(looks.rows.get(`user_a/${held.id}`)).toMatchObject({ revision: 1, readKeyHash: hashToken(held.readKey!) });
    await settle(w);
    expect(keyOf(w.seen.at(-1))).toBe(key("ember"));

    // Bob's own link, and a key that opens nothing, follow nothing of Alice's.
    const theirs = await device("user_b", "bob");
    theirs.look.now = snapshotForBuiltin("stardust");
    expect(await theirs.publisher.create()).toBe("ok");
    await theirs.publisher.idle();
    const bobs = (await theirs.store.load())!;
    expect(bobs.id).not.toBe(held.id);
    const wb = await widget("c10", bobs.readKey!);
    const stray = await widget("c11", "k".repeat(32));
    expect(keyOf(wb.seen.at(-1))).toBe(key("stardust"));
    expect(stray.seen.at(-1)).toEqual({ kind: "gone" });
    expect(following(held.id)).toEqual(["c9"]);
    expect(following(bobs.id)).toEqual(["c10"]);
    const beforeBob = rings("c10");
    await mine.apply("glaze");
    await settle(w, wb);
    expect(keyOf(w.seen.at(-1))).toBe(key("glaze"));
    expect(keyOf(wb.seen.at(-1))).toBe(key("stardust"));
    expect([rings("c10"), rings("c11")]).toEqual([beforeBob, 0]);

    const deleted = await fetchImpl(`${BASE}/me`, { method: "DELETE", headers: { authorization: "Bearer alice" } });
    expect(deleted.status).toBe(200);
    await settle(w, wb);
    expect(w.seen.at(-1)).toEqual({ kind: "gone" });
    expect(readCachedLook(held.readKey!, w.storage)).toBeNull();
    expect(following(held.id)).toEqual([]);
    expect(looks.rows.has(`user_a/${held.id}`)).toBe(false);
    expect(looks.pointers.has(hashToken(held.readKey!))).toBe(false);
    // Bob's link and its widget are untouched.
    expect(keyOf(wb.seen.at(-1))).toBe(key("stardust"));
    expect(following(bobs.id)).toEqual(["c10"]);
  });

  it("never shows another link's cached look to a widget that starts offline", async () => {
    const mine = await device("user_a", "alice");
    mine.look.now = snapshotForBuiltin("glaze");
    await mine.publisher.create();
    await mine.publisher.idle();
    const a = (await mine.store.load())!;
    const theirs = await device("user_b", "bob");
    theirs.look.now = snapshotForBuiltin("daylight");
    await theirs.publisher.create();
    await theirs.publisher.idle();
    const b = (await theirs.store.load())!;

    // One browser (a shared machine) keeps link A's look from an earlier evening.
    const shared = memoryStorage();
    const earlier = await widget("c20", a.readKey!, { storage: shared });
    expect(keyOf(earlier.seen.at(-1))).toBe(key("glaze"));
    expect(readCachedLook(a.readKey!, shared)).not.toBeNull();
    earlier.follower.stop();

    // OBS starts with the network down on link B: nothing of A's, only the fixed built-in.
    const cold = await widget("c21", b.readKey!, { storage: shared, fetch: offline });
    expect(cold.seen).toEqual([{ kind: "waiting" }]);
    expect(readCachedLook(b.readKey!, shared)).toBeNull();

    // A publish on A while it waits rings nobody on B.
    await mine.apply("stardust");
    await settle(cold);
    expect(cold.seen).toEqual([{ kind: "waiting" }]);
    expect(rings("c21")).toBe(0);

    // Back online, the widget on B shows B's look, and still nothing of A's.
    const back = await widget("c22", b.readKey!, { storage: shared });
    expect(back.seen.map(keyOf)).toEqual(["waiting", key("daylight")]);
    expect(back.seen.some((look) => keyOf(look) === key("glaze") || keyOf(look) === key("stardust"))).toBe(false);
  });
});
