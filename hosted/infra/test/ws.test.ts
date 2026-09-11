import { describe, expect, it } from "vitest";
import { notifier, type LiveStore, type Poster, type Watcher } from "../lib/handlers/live";
import { hashToken } from "../lib/handlers/auth";
import { route, type WsDeps, type WsEvent } from "../lib/handlers/ws";
import type { Race } from "../lib/handlers/races";
import type { SessionMember, SessionMeta } from "../lib/handlers/store";

/**
 * The socket is a doorbell: it carries a "changed" and nothing else. What
 * it must get right is who may ring it and who hears it. A stranger
 * cannot open one, a member cannot watch a session they are not in, and a
 * connection that has gone is cleaned up the first time it is missed.
 */

function memoryLive(): LiveStore & { conns: Map<string, string>; watches: Map<string, Set<string>> } {
  const conns = new Map<string, string>();
  const watches = new Map<string, Set<string>>();
  return {
    conns,
    watches,
    async connect(id, sub) {
      conns.set(id, sub);
    },
    async connection(id) {
      const sub = conns.get(id);
      return sub ? { sub } : null;
    },
    async watch(id, sessionId) {
      if (!watches.has(sessionId)) watches.set(sessionId, new Set());
      watches.get(sessionId)!.add(id);
    },
    async watchers(sessionId): Promise<Watcher[]> {
      return [...(watches.get(sessionId) ?? [])].map((connectionId) => ({ connectionId, sub: conns.get(connectionId) ?? "" }));
    },
    async disconnect(id) {
      conns.delete(id);
      for (const set of watches.values()) set.delete(id);
    },
  };
}

const meta = (id: string, ownerSub: string): SessionMeta => ({ id, packId: "p", packVersion: "1", ownerSub, createdAt: "", updatedAt: "", seq: 3 });
const member = (sub: string): SessionMember => ({ sub, role: "player", joinedAt: "" });

function deps(live = memoryLive()): WsDeps & { live: ReturnType<typeof memoryLive> } {
  return {
    live,
    store: {
      async streamKeyOwner(hash) {
        if (hash === hashToken("watchkey")) return { sub: "user_1", kind: "watch" as const };
        if (hash === hashToken("presskey")) return { sub: "user_1", kind: "press" as const };
        return null;
      },
      async manifest(sub) {
        const owned = sub === "user_1" ? ["open", "shared"] : [];
        return {
          packs: [],
          licenses: [],
          sessions: owned.map((id) => ({ id, role: "owner" as const, packId: "p", packVersion: "1", ownerSub: sub, updatedAt: id === "open" ? "2026-09-11T00:10:00Z" : "2026-09-11T00:00:00Z", seq: 3 })),
        };
      },
      async getSession(id) {
        if (id === "open") return { meta: { ...meta(id, "user_1"), publicTokenHash: hashToken("livetok") }, members: [member("user_1")] };
        if (id === "shared") return { meta: meta(id, "user_1"), members: [member("user_1"), member("user_2")] };
        if (id === "private") return { meta: meta(id, "user_9"), members: [member("user_9")] };
        return null;
      },
    },
    races: {
      async getRace(id): Promise<Race | null> {
        if (id === "race1") return { meta: { id, code: "ABCDEF", packId: "p", packVersion: "1", mode: "race", seed: "s", ownerSub: "user_1", createdAt: "", updatedAt: "", seq: 1 }, entries: [{ sub: "user_1", joinedAt: "" }] };
        if (id === "race2") return { meta: { id, code: "GHJKLM", packId: "p", packVersion: "1", mode: "race", seed: "s", ownerSub: "user_9", createdAt: "", updatedAt: "", seq: 1 }, entries: [{ sub: "user_9", joinedAt: "" }] };
        return null;
      },
    },
    verify: async (authorization) => {
      if (authorization === "Bearer good") return { sub: "user_1", sid: "s1" };
      throw new Error("bad token");
    },
    now: () => "2026-09-06T12:00:00.000Z",
  };
}

const ev = (routeKey: string, connectionId: string, extra: Partial<WsEvent> = {}): WsEvent => ({ requestContext: { routeKey, connectionId }, ...extra });

describe("opening a socket", () => {
  it("takes the token from the query string and refuses a bad one before the socket opens", async () => {
    const d = deps();
    expect((await route(ev("$connect", "c1", { queryStringParameters: { token: "good" } }), d)).statusCode).toBe(200);
    expect(d.live.conns.get("c1")).toBe("user_1");
    expect((await route(ev("$connect", "c2", { queryStringParameters: { token: "bad" } }), d)).statusCode).toBe(401);
    expect((await route(ev("$connect", "c3"), d)).statusCode).toBe(401);
    expect(d.live.conns.has("c2")).toBe(false);
  });
});

describe("a socket on a stream key", () => {
  it("watches the account's run in play, so a bot holds no run id and no link token", async () => {
    const d = deps();
    expect((await route(ev("$connect", "c1", { queryStringParameters: { k: "watchkey" } }), d)).statusCode).toBe(200);
    // "open" is the one that is both shared and most recently moved.
    expect(await d.live.watchers("open")).toEqual([{ connectionId: "c1", sub: "stream:user_1" }]);
  });

  it("refuses a press key, which belongs in a bot and never in a scene", async () => {
    const d = deps();
    expect((await route(ev("$connect", "c2", { queryStringParameters: { k: "presskey" } }), d)).statusCode).toBe(401);
    expect(d.live.conns.has("c2")).toBe(false);
  });

  it("refuses a key that opens nothing, and takes no requests once open", async () => {
    const d = deps();
    expect((await route(ev("$connect", "c3", { queryStringParameters: { k: "nope" } }), d)).statusCode).toBe(401);
    await route(ev("$connect", "c4", { queryStringParameters: { k: "watchkey" } }), d);
    // A scene's socket listens; it does not ask to watch anything else.
    await route(ev("$default", "c4", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    expect(await d.live.watchers("shared")).toEqual([]);
  });
});

describe("watching", () => {
  it("lets a member watch a session, and tells a non-member nothing", async () => {
    const d = deps();
    await route(ev("$connect", "c1", { queryStringParameters: { token: "good" } }), d);
    expect((await route(ev("$default", "c1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d)).statusCode).toBe(200);
    expect(await d.live.watchers("shared")).toEqual([{ connectionId: "c1", sub: "user_1" }]);
    // Not a member, and not a session: the same answer.
    expect((await route(ev("$default", "c1", { body: JSON.stringify({ t: "watch", id: "private" }) }), d)).statusCode).toBe(200);
    expect((await route(ev("$default", "c1", { body: JSON.stringify({ t: "watch", id: "nope" }) }), d)).statusCode).toBe(200);
    expect(await d.live.watchers("private")).toEqual([]);
  });

  it("lets a racer watch their race, and nobody else's", async () => {
    const d = deps();
    await route(ev("$connect", "c1", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$default", "c1", { body: JSON.stringify({ t: "watch", id: "race1" }) }), d);
    await route(ev("$default", "c1", { body: JSON.stringify({ t: "watch", id: "race2" }) }), d);
    expect(await d.live.watchers("race1")).toHaveLength(1);
    expect(await d.live.watchers("race2")).toEqual([]);
  });

  it("ignores a connection it never accepted, and nonsense", async () => {
    const d = deps();
    expect((await route(ev("$default", "ghost", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d)).statusCode).toBe(401);
    await route(ev("$connect", "c1", { queryStringParameters: { token: "good" } }), d);
    expect((await route(ev("$default", "c1", { body: "not json" }), d)).statusCode).toBe(400);
    expect((await route(ev("$default", "c1", { body: JSON.stringify({ t: "shout" }) }), d)).statusCode).toBe(400);
    // Base64, as the gateway sometimes sends it.
    expect((await route(ev("$default", "c1", { body: Buffer.from(JSON.stringify({ t: "watch", id: "shared" })).toString("base64"), isBase64Encoded: true }), d)).statusCode).toBe(200);
    expect(await d.live.watchers("shared")).toHaveLength(1);
  });

  it("forgets everything on disconnect", async () => {
    const d = deps();
    await route(ev("$connect", "c1", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$default", "c1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    await route(ev("$disconnect", "c1"), d);
    expect(d.live.conns.has("c1")).toBe(false);
    expect(await d.live.watchers("shared")).toEqual([]);
  });
});

describe("telling the listeners", () => {
  it("passes a member's gesture to everyone else watching, and nothing from a stranger or a link", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const d = { ...deps(live), poster: { async post(connectionId: string, data: string) { posted.push([connectionId, data]); return "sent" as const; } } };
    await live.connect("c1", "user_1", "");
    await live.connect("c2", "user_2", "");
    await live.connect("c9", "user_9", "");
    await live.connect("cl", "public:shared", "");
    for (const c of ["c1", "c2", "c9", "cl"]) await live.watch(c, "shared", "", "");
    const send = (connectionId: string, body: unknown) => route({ requestContext: { routeKey: "$default", connectionId }, body: JSON.stringify(body) }, d);
    expect((await send("c1", { t: "gesture", id: "shared", kind: "rolling", data: { dice: [{ faces: 20 }] } })).statusCode).toBe(200);
    expect(posted.map(([c]) => c).sort()).toEqual(["c2", "c9", "cl"]);
    expect(JSON.parse(posted[0]![1])).toMatchObject({ t: "gesture", id: "shared", kind: "rolling", data: { dice: [{ faces: 20 }] } });
    // Not a member of that run: nothing goes out, and the socket says nothing.
    posted.length = 0;
    expect((await send("c9", { t: "gesture", id: "shared", kind: "rolling" })).statusCode).toBe(200);
    expect(posted).toEqual([]);
    // A link's socket takes no requests; a wrong kind, or too much, is refused.
    expect((await send("cl", { t: "gesture", id: "shared", kind: "rolling" })).statusCode).toBe(200);
    expect(posted).toEqual([]);
    expect((await send("c1", { t: "gesture", id: "shared", kind: "Not A Kind" })).statusCode).toBe(400);
    expect((await send("c1", { t: "gesture", id: "shared", kind: "big", data: { pad: "x".repeat(3000) } })).statusCode).toBe(400);
  });

  it("posts one line to every watcher, and drops a connection that has gone", async () => {
    const live = memoryLive();
    await live.connect("c1", "user_1", "");
    await live.connect("c2", "user_2", "");
    await live.watch("c1", "shared", "user_1", "");
    await live.watch("c2", "shared", "user_2", "");
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(connectionId, data) {
        posted.push([connectionId, data]);
        return connectionId === "c2" ? "gone" : "sent";
      },
    };
    await notifier(live, poster)("shared", 12);
    expect(posted.map(([c]) => c).sort()).toEqual(["c1", "c2"]);
    expect(JSON.parse(posted[0]![1])).toEqual({ t: "changed", id: "shared", seq: 12 });
    expect(await live.watchers("shared")).toEqual([{ connectionId: "c1", sub: "user_1" }]);
  });

  it("never throws: a failed nudge costs a poll, not a move", async () => {
    const live = memoryLive();
    await live.connect("c1", "user_1", "");
    await live.watch("c1", "shared", "user_1", "");
    const poster: Poster = {
      async post() {
        throw new Error("the gateway is having a day");
      },
    };
    await expect(notifier(live, poster)("shared", 1)).resolves.toBeUndefined();
  });
});

describe("a run shared by link", () => {
  it("admits a socket with the link's token, watching that run only, and refuses a wrong one", async () => {
    const d = deps();
    expect((await route({ requestContext: { routeKey: "$connect", connectionId: "c9" }, queryStringParameters: { t: "wrong", run: "open" } }, d)).statusCode).toBe(401);
    expect((await route({ requestContext: { routeKey: "$connect", connectionId: "c9" }, queryStringParameters: { t: "livetok", run: "shared" } }, d)).statusCode).toBe(401);
    expect((await route({ requestContext: { routeKey: "$connect", connectionId: "c9" }, queryStringParameters: { t: "livetok", run: "open" } }, d)).statusCode).toBe(200);
    expect(d.live.watches.get("open")?.has("c9")).toBe(true);
    // It cannot ask to watch anything else.
    await route({ requestContext: { routeKey: "$default", connectionId: "c9" }, body: JSON.stringify({ t: "watch", id: "shared" }) }, d);
    expect(d.live.watches.get("shared")?.has("c9") ?? false).toBe(false);
  });
});
