import { describe, expect, it } from "vitest";
import { notifier, type Attached, type LiveStore, type Poster, type Watcher } from "../lib/handlers/live";
import { hashToken } from "../lib/handlers/auth";
import { route, type WsDeps, type WsEvent } from "../lib/handlers/ws";
import type { Race } from "../lib/handlers/races";
import type { Ask, SessionMember, SessionMeta } from "../lib/handlers/store";
import { memoryGuilds } from "./memory-guilds";

/**
 * The socket is a doorbell: it carries a "changed" and nothing else. What
 * it must get right is who may ring it and who hears it. A stranger
 * cannot open one, a member cannot watch a session they are not in, and a
 * connection that has gone is cleaned up the first time it is missed.
 */

// Two rows, the way dynamoLive keeps them: `marks` is the CONN row, written
// by connect() and read by connection() and decksOf(); `watchMarks` is the
// per-session row, written by watch() from its own attached argument and
// read by watchers(). A deck's watch row must carry `deck: true` on its
// own, the same as it does in dynamo, or a deck would look like a writer
// of the run it is watching. The watch row is dated too, as dynamo dates
// it, because which of an account's devices takes a press turns on it.
function memoryLive(): LiveStore & {
  conns: Map<string, string>;
  watches: Map<string, Set<string>>;
  marks: Map<string, Attached>;
  watchMarks: Map<string, Attached>;
} {
  const conns = new Map<string, string>();
  const watches = new Map<string, Set<string>>();
  const marks = new Map<string, Attached>();
  const watchMarks = new Map<string, Attached>();
  const watchedAt = new Map<string, string>();
  const watchKey = (sessionId: string, connectionId: string) => `${sessionId}|${connectionId}`;
  return {
    conns,
    watches,
    marks,
    watchMarks,
    async connect(id, sub, _at, attached) {
      conns.set(id, sub);
      if (attached) marks.set(id, attached);
    },
    async connection(id) {
      const sub = conns.get(id);
      return sub ? { sub, ...(marks.get(id) ?? {}) } : null;
    },
    async watch(id, sessionId, _sub, at, attached) {
      if (!watches.has(sessionId)) watches.set(sessionId, new Set());
      watches.get(sessionId)!.add(id);
      watchMarks.set(watchKey(sessionId, id), attached ?? {});
      watchedAt.set(watchKey(sessionId, id), at);
    },
    async watchers(sessionId): Promise<Watcher[]> {
      return [...(watches.get(sessionId) ?? [])].map((connectionId) => ({
        connectionId,
        sub: conns.get(connectionId) ?? "",
        watchedAt: watchedAt.get(watchKey(sessionId, connectionId)) ?? "",
        ...(watchMarks.get(watchKey(sessionId, connectionId)) ?? {}),
      }));
    },
    async unwatch(id, sessionId) {
      watches.get(sessionId)?.delete(id);
      watchMarks.delete(watchKey(sessionId, id));
      watchedAt.delete(watchKey(sessionId, id));
    },
    async decksOf(sub) {
      return [...conns.entries()]
        .filter(([id, s]) => s === sub && marks.get(id)?.deck === true)
        .map(([connectionId]) => ({ connectionId, ...(marks.get(connectionId) ?? {}) }));
    },
    async disconnect(id) {
      conns.delete(id);
      marks.delete(id);
      for (const [sessionId, set] of watches) {
        set.delete(id);
        watchMarks.delete(watchKey(sessionId, id));
        watchedAt.delete(watchKey(sessionId, id));
      }
    },
  };
}

const meta = (id: string, ownerSub: string): SessionMeta => ({
  id,
  packId: "p",
  packVersion: "1",
  ownerSub,
  createdAt: "",
  updatedAt: "",
  seq: 3,
});
const member = (sub: string): SessionMember => ({ sub, role: "player", joinedAt: "" });

/** Every ask the socket raised, for the tests that care. */
const asked: Ask[] = [];
/** Every session patch the socket wrote, for the tests that care. */
const patched: Array<[string, Record<string, unknown>]> = [];

function deps(live = memoryLive()): WsDeps & { live: ReturnType<typeof memoryLive> } {
  asked.length = 0;
  patched.length = 0;
  return {
    live,
    store: {
      async getSnapshot() {
        return null;
      },
      async streamKeyOwner(hash) {
        if (hash === hashToken("watchkey")) return { sub: "user_1", kind: "watch" as const };
        if (hash === hashToken("presskey")) return { sub: "user_1", kind: "press" as const };
        return null;
      },
      async manifest(sub) {
        // s1 is named and titled, for the deck's picker; s2 has neither
        // and stands in for a run nobody happens to have open.
        const owned = sub === "user_1" ? ["open", "shared", "s1", "s2"] : [];
        const extra: Record<string, { name?: string; packTitle?: string }> = {
          s1: { name: "Thursday", packTitle: "The Long Kiln" },
        };
        return {
          packs: [],
          licenses: [],
          sessions: owned.map((id) => ({
            id,
            role: "owner" as const,
            packId: "p",
            packVersion: "1",
            ownerSub: sub,
            updatedAt: id === "open" ? "2026-09-11T00:10:00Z" : "2026-09-11T00:00:00Z",
            seq: 3,
            ...extra[id],
          })),
        };
      },
      async updateSession(id, _at, patch) {
        patched.push([id, patch]);
        return null;
      },
      async getSession(id) {
        if (id === "asking")
          return {
            meta: { ...meta(id, "user_1"), publicTokenHash: hashToken("livetok"), askPolicy: "ask" as const },
            members: [member("user_1")],
          };
        if (id === "open") return { meta: { ...meta(id, "user_1"), publicTokenHash: hashToken("livetok") }, members: [member("user_1")] };
        if (id === "shared")
          return {
            meta: meta(id, "user_1"),
            members: [member("user_1"), { sub: "user_2", role: "player" as const, joinedAt: "", name: "Ada" }],
          };
        // A second run this seat plays, for the check that a seat presses
        // the run it is sitting on and no other.
        if (id === "other") return { meta: meta(id, "user_1"), members: [member("user_1"), member("user_2")] };
        // Somebody at the table who only watches.
        if (id === "viewed")
          return { meta: meta(id, "user_1"), members: [member("user_1"), { sub: "user_2", role: "viewer" as const, joinedAt: "" }] };
        // The same run with a name on the owner's row, for the line the
        // server stamps a sender's name onto.
        if (id === "named")
          return {
            meta: meta(id, "user_1"),
            members: [
              { sub: "user_1", role: "owner" as const, joinedAt: "", name: "Mira" },
              { sub: "user_2", role: "player" as const, joinedAt: "", name: "Ada" },
            ],
          };
        if (id === "s1") return { meta: { ...meta(id, "user_1"), packTitle: "The Long Kiln" }, members: [member("user_1")] };
        // Owned and membered by somebody else entirely, for the tests
        // that check a press is refused on a run that is not the caller's.
        if (id === "s3") return { meta: meta(id, "user_2"), members: [member("user_2")] };
        if (id === "private") return { meta: meta(id, "user_9"), members: [member("user_9")] };
        return null;
      },
    },
    races: {
      async getRace(id): Promise<Race | null> {
        if (id === "race1")
          return {
            meta: {
              id,
              code: "ABCDEF",
              packId: "p",
              packVersion: "1",
              mode: "race",
              seed: "s",
              ownerSub: "user_1",
              createdAt: "",
              updatedAt: "",
              seq: 1,
            },
            entries: [{ sub: "user_1", joinedAt: "" }],
          };
        if (id === "race2")
          return {
            meta: {
              id,
              code: "GHJKLM",
              packId: "p",
              packVersion: "1",
              mode: "race",
              seed: "s",
              ownerSub: "user_9",
              createdAt: "",
              updatedAt: "",
              seq: 1,
            },
            entries: [{ sub: "user_9", joinedAt: "" }],
          };
        return null;
      },
    },
    verify: async (authorization) => {
      if (authorization === "Bearer good") return { sub: "user_1", sid: "s1" };
      if (authorization === "Bearer seated") return { sub: "user_2", sid: "s2" };
      throw new Error("bad token");
    },
    now: () => "2026-09-06T12:00:00.000Z",
  };
}

const ev = (routeKey: string, connectionId: string, extra: Partial<WsEvent> = {}): WsEvent => ({
  requestContext: { routeKey, connectionId },
  ...extra,
});

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

describe("attaching as a deck", () => {
  it("a signed-in socket may attach as a deck", async () => {
    const d = deps();
    const res = await route(ev("$connect", "c1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    expect(res.statusCode).toBe(200);
    expect(await d.live.connection("c1")).toMatchObject({ sub: "user_1", deck: true });
  });

  it("a live link may not attach as a deck", async () => {
    const d = deps();
    const res = await route(ev("$connect", "c9", { queryStringParameters: { t: "livetok", run: "open", as: "deck" } }), d);
    expect(res.statusCode).toBe(200);
    expect(await d.live.connection("c9")).not.toMatchObject({ deck: true });
  });

  it("tells a deck which runs are held when it says hello", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(connectionId, data) {
        posted.push([connectionId, data]);
        return "sent";
      },
    };
    // s1 is held by a signed-in page; s2 is nobody's.
    await live.connect("page", "user_1", "");
    await live.watch("page", "s1", "user_1", "");
    const d = { ...deps(live), poster };

    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    // Nothing at connect: the gateway would refuse the post.
    expect(posted).toEqual([]);
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "hello" }) }), d);

    const line = JSON.parse(posted.find(([id]) => id === "deck1")![1]);
    expect(line).toEqual({ t: "runs", runs: [{ id: "s1", name: "Thursday", packTitle: "The Long Kiln", held: true }], any: true });
  });

  it("says whether the account has any synced run at all", async () => {
    const base = deps();
    const posted: Array<[string, string]> = [];
    const d: WsDeps = {
      ...base,
      // This account's manifest is empty: nothing it owns has ever synced.
      store: {
        ...base.store,
        async manifest() {
          return { packs: [], licenses: [], sessions: [] };
        },
      },
      poster: {
        async post(connectionId, data) {
          posted.push([connectionId, data]);
          return "sent";
        },
      },
    };

    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "hello" }) }), d);

    const line = JSON.parse(posted.find(([id]) => id === "deck1")![1]);
    expect(line).toEqual({ t: "runs", runs: [], any: false });
  });

  it("still attaches a deck when its run list cannot be built", async () => {
    const base = deps();
    const posted: Array<[string, string]> = [];
    const d: WsDeps = {
      ...base,
      store: {
        ...base.store,
        async manifest() {
          throw new Error("dynamo is having a day");
        },
      },
      poster: {
        async post(connectionId, data) {
          posted.push([connectionId, data]);
          return "sent";
        },
      },
    };

    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    const res = await route(ev("$default", "deck1", { body: JSON.stringify({ t: "hello" }) }), d);

    expect(res.statusCode).toBe(200);
    expect(posted).toEqual([]);
  });
});

describe("a socket on a stream key", () => {
  it("watches the account's run in play, so a bot holds no run id and no link token", async () => {
    const d = deps();
    expect((await route(ev("$connect", "c1", { queryStringParameters: { k: "watchkey" } }), d)).statusCode).toBe(200);
    // "open" is the one that is both shared and most recently moved.
    expect(await d.live.watchers("open")).toMatchObject([{ connectionId: "c1", sub: "stream:user_1" }]);
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

describe("keepalive", () => {
  it("answers a ping with a pong to the sender alone, before any other branch", async () => {
    const d = deps();
    const posted: Array<[string, string]> = [];
    d.poster = {
      async post(connectionId, data) {
        posted.push([connectionId, data]);
        return "sent";
      },
    };
    await route(ev("$connect", "c1", { queryStringParameters: { token: "good" } }), d);
    expect((await route(ev("$default", "c1", { body: JSON.stringify({ t: "ping" }) }), d)).statusCode).toBe(200);
    expect(posted).toEqual([["c1", JSON.stringify({ t: "pong" })]]);
    // No watch, no store write: a heartbeat is not news to anyone.
    expect(await d.live.watchers("shared")).toEqual([]);
    expect(patched).toEqual([]);
  });

  it("ignores a pong from a client", async () => {
    const d = deps();
    const posted: Array<[string, string]> = [];
    d.poster = {
      async post(connectionId, data) {
        posted.push([connectionId, data]);
        return "sent";
      },
    };
    await route(ev("$connect", "c1", { queryStringParameters: { token: "good" } }), d);
    expect((await route(ev("$default", "c1", { body: JSON.stringify({ t: "pong" }) }), d)).statusCode).toBe(200);
    expect(posted).toEqual([]);
  });
});

describe("watching", () => {
  it("lets a member watch a session, and tells a non-member nothing", async () => {
    const d = deps();
    await route(ev("$connect", "c1", { queryStringParameters: { token: "good" } }), d);
    expect((await route(ev("$default", "c1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d)).statusCode).toBe(200);
    expect(await d.live.watchers("shared")).toMatchObject([{ connectionId: "c1", sub: "user_1" }]);
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
    expect(
      (
        await route(
          ev("$default", "c1", {
            body: Buffer.from(JSON.stringify({ t: "watch", id: "shared" })).toString("base64"),
            isBase64Encoded: true,
          }),
          d,
        )
      ).statusCode,
    ).toBe(200);
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

describe("decksOf", () => {
  it("finds an account's deck connections and forgets them on disconnect", async () => {
    const live = memoryLive();
    await live.connect("c1", "user_a", "2026-09-14T00:00:00.000Z", { deck: true });
    await live.connect("c2", "user_a", "2026-09-14T00:00:00.000Z");
    await live.connect("c3", "user_b", "2026-09-14T00:00:00.000Z", { deck: true });

    expect((await live.decksOf("user_a")).map((d) => d.connectionId)).toEqual(["c1"]);

    await live.disconnect("c1");
    expect(await live.decksOf("user_a")).toEqual([]);
  });
});

describe("the held-run list is pushed when it changes", () => {
  it("tells a deck when a run is opened and when the page goes", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster };
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    posted.length = 0;

    await route(ev("$default", "page", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    expect(JSON.parse(posted.at(-1)![1]).runs.map((r: { id: string }) => r.id)).toEqual(["s1"]);

    posted.length = 0;
    await route(ev("$disconnect", "page"), d);
    expect(JSON.parse(posted.at(-1)![1]).runs).toEqual([]);
  });

  /**
   * A deck watching a run is on it the same way an attached tool is: the
   * row says so, and the table hears it, exactly as it hears a tool
   * attach.
   */
  it("marks a deck's connection with the run it watches, and tells the table", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster };
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$default", "page", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    posted.length = 0;

    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);

    expect(await live.connection("deck1")).toMatchObject({ deck: true, run: "s1" });
    const toPage = posted.filter(([id]) => id === "page").map(([, l]) => JSON.parse(l));
    expect(toPage.find((l) => l.t === "gesture")).toMatchObject({ t: "gesture", kind: "tools", data: { decks: 1 } });
  });

  /**
   * Review finding: the gesture fired on a tool's hello and a deck's
   * watch, so a page that opened the run afterwards -- or came back from
   * a reload -- never learned the deck was there, and left its presses
   * hanging.
   */
  it("tells a page what is attached when it starts watching, deck and all", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster };
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    posted.length = 0;

    await route(ev("$default", "page", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    const toPage = posted.filter(([id]) => id === "page").map(([, l]) => JSON.parse(l));
    expect(toPage.find((l) => l.kind === "tools")).toMatchObject({ data: { decks: 1 } });
  });

  /**
   * The page draws a row per person, so a count is not enough: it has to
   * know which of the people at the table has the deck. An account with
   * two decks is still one person, so the names are deduplicated.
   */
  it("names the accounts whose decks are on the run, once each", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster };
    const decks: Array<[string, string]> = [
      ["deck1", "user_1"],
      ["deck2", "user_1"],
      ["deck3", "user_2"],
    ];
    for (const [id, sub] of decks) {
      await live.connect(id, sub, "", { deck: true, run: "s1" });
      await live.watch(id, "s1", sub, "", { deck: true, run: "s1" });
    }
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    posted.length = 0;

    await route(ev("$default", "page", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    const said = posted
      .filter(([id]) => id === "page")
      .map(([, l]) => JSON.parse(l) as { kind?: string; data?: { decks?: number; deckSubs?: string[] } })
      .filter((l) => l.kind === "tools");
    expect(said.at(-1)?.data?.decks).toBe(3);
    expect([...(said.at(-1)?.data?.deckSubs ?? [])].sort()).toEqual(["user_1", "user_2"]);
  });

  /**
   * Review finding: a deck moving to another run told only the run it
   * arrived at, so the page it left went on drawing a deck that had gone
   * and publishing a snapshot for it for the rest of the evening.
   */
  it("tells the run a deck left that it is on its own again", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster };
    await route(ev("$connect", "first", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$default", "first", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    posted.length = 0;

    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    const toFirst = posted
      .filter(([id]) => id === "first")
      .map(([, l]) => JSON.parse(l))
      .filter((l) => l.kind === "tools");
    expect(toFirst.at(-1)).toMatchObject({ id: "s1", data: { decks: 0 } });
  });
});

describe("telling the listeners", () => {
  it("passes a member's gesture to everyone else watching, and nothing from a stranger or a link", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const d = {
      ...deps(live),
      poster: {
        async post(connectionId: string, data: string) {
          posted.push([connectionId, data]);
          return "sent" as const;
        },
      },
    };
    await live.connect("c1", "user_1", "");
    await live.connect("c2", "user_2", "");
    await live.connect("c9", "user_9", "");
    await live.connect("cl", "public:shared", "");
    for (const c of ["c1", "c2", "c9", "cl"]) await live.watch(c, "shared", "", "");
    const send = (connectionId: string, body: unknown) =>
      route({ requestContext: { routeKey: "$default", connectionId }, body: JSON.stringify(body) }, d);
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

  /**
   * A tool attached to somebody's game is a watcher like any other: same
   * addresses, same keys, told the same moves. What differs is that it is
   * told in operations rather than in words, and that an effect meant for
   * one player reaches only that player.
   */
  describe("a tool attached to a game", () => {
    const profile = {
      control: {
        setup: [{ op: "flag.set", args: { name: "player.noRoll", value: true } }],
        rows: [
          { tag: "curse", label: "A curse", for: 90, ops: [{ op: "speffect.apply", args: { id: 6900 } }] },
          { entry: "mira-only", to: "Mira", ops: [{ op: "flag.set", args: { name: "player.noDeath", value: true } }] },
        ],
      },
    };

    function attached(live = memoryLive(), snapshot: unknown = profile) {
      const posted: Array<[string, string]> = [];
      const base = deps(live);
      const d: WsDeps = {
        ...base,
        store: {
          ...base.store,
          async getSnapshot() {
            return { at: "", snapshot };
          },
        },
        poster: {
          async post(connectionId: string, data: string) {
            posted.push([connectionId, data]);
            return "sent" as const;
          },
        },
      };
      return { live, posted, d };
    }

    it("is marked as one when it says so, and watches the run the key resolved", async () => {
      const { live, d } = attached();
      const connect = (q: Record<string, string>) =>
        route({ requestContext: { routeKey: "$connect", connectionId: "c1" }, queryStringParameters: q }, d);
      expect((await connect({ k: "watchkey", as: "control", seat: "Mira" })).statusCode).toBe(200);
      expect(live.marks.get("c1")).toEqual({ control: true, seat: "Mira", run: "open" });
      // Without saying so it is an ordinary watcher, whose row is
      // exactly what it always was; a seat alone does not make it one.
      live.marks.clear();
      await connect({ k: "watchkey", seat: "Mira" });
      expect(live.marks.get("c1")).toBeUndefined();
      expect(await live.watchers("open")).toMatchObject([{ connectionId: "c1", sub: "stream:user_1" }]);
    });

    it("attaches on a run's own live link, which is how a player who is not the host joins", async () => {
      const { live, d } = attached();
      const r = await route(
        {
          requestContext: { routeKey: "$connect", connectionId: "c2" },
          queryStringParameters: { t: "livetok", run: "open", as: "control", seat: "Kel" },
        },
        d,
      );
      expect(r.statusCode).toBe(200);
      expect(live.marks.get("c2")).toEqual({ control: true, seat: "Kel", run: "open" });
    });

    it("hears the run's terms when it says hello, and nothing when the run has none", async () => {
      const { live, posted, d } = attached();
      await live.connect("c1", "public:shared", "", { control: true, run: "shared" });
      const hello = () =>
        route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify({ t: "hello", ops: ["flag.set"] }) }, d);
      expect((await hello()).statusCode).toBe(200);
      expect(JSON.parse(posted[0]![1])).toEqual({
        t: "apply",
        id: "setup",
        label: "The run's terms",
        // A list of separate things: a term the tool has no name for
        // takes itself out rather than the other seven.
        each: true,
        ops: [{ op: "flag.set", args: { name: "player.noRoll", value: true } }],
      });

      // A run with no rules says so, rather than leaving a tool
      // connected and silent. An address names an account and the
      // server picks the run, so the run it picked is worth naming:
      // attaching perfectly to a run nobody is playing looks exactly
      // like attaching to the right one.
      const bare = attached(memoryLive(), { control: { rows: [] } });
      await bare.live.connect("c1", "public:shared", "", { control: true, run: "shared" });
      await route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify({ t: "hello" }) }, bare.d);
      expect(bare.posted).toHaveLength(1);
      const said = JSON.parse(bare.posted[0]![1]);
      expect(said.t).toBe("note");
      expect(said.text).toContain("no rules for a tool");
      expect(said.text).toContain("open to watchers");
    });

    it("takes no requests other than hello, the same as any other link", async () => {
      const { live, posted, d } = attached();
      await live.connect("c1", "public:shared", "", { control: true, run: "shared" });
      await live.watch("c1", "shared", "public:shared", "", { control: true, run: "shared" });
      const r = await route(
        {
          requestContext: { routeKey: "$default", connectionId: "c1" },
          body: JSON.stringify({ t: "gesture", id: "shared", kind: "rolling" }),
        },
        d,
      );
      expect(r.statusCode).toBe(200);
      expect(posted).toEqual([]);
    });

    it("remembers what a tool calls itself, and holds a profile to that program", async () => {
      const forOne = { control: { tool: "TarnishedTool", rows: [{ tag: "curse", ops: [{ op: "speffect.apply", args: { id: 1 } }] }] } };
      const { live, posted, d } = attached(memoryLive(), forOne);
      await live.connect("c1", "user_1", "");
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      await live.watch("tool", "shared", "public:shared", "", { control: true, run: "shared" });
      const hello = (app: string) =>
        route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app }) }, d);

      // Something else entirely: told why, rather than left to sit there
      // doing nothing.
      await hello("SomethingElse");
      expect(JSON.parse(posted[0]![1])).toMatchObject({ t: "note" });
      expect(JSON.parse(posted[0]![1]).text).toContain("TarnishedTool");

      await live.connect("c1", "user_1", "");
      await live.watch("c1", "shared", "user_1", "");
      const roll = () =>
        route(
          {
            requestContext: { routeKey: "$default", connectionId: "c1" },
            body: JSON.stringify({
              t: "gesture",
              id: "shared",
              kind: "outcome",
              data: { n: 1, unit: 1, tableId: "curse", entryId: "rot", tags: ["curse"] },
            }),
          },
          d,
        );
      posted.length = 0;
      await roll();
      expect(posted.filter(([c]) => c === "tool")).toEqual([]);

      // The program it was written for hears it.
      await hello("TarnishedTool");
      posted.length = 0;
      await roll();
      expect(posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l).ops)).toEqual([[{ op: "speffect.apply", args: { id: 1 } }]]);
    });

    it("is told to take a unit's effects back when that unit closes", async () => {
      const { live, posted, d } = attached();
      await live.connect("c1", "user_1", "");
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      for (const c of ["c1", "tool"]) await live.watch(c, "shared", "", "", live.marks.get(c));
      await route(
        {
          requestContext: { routeKey: "$default", connectionId: "c1" },
          body: JSON.stringify({ t: "gesture", id: "shared", kind: "unit-closed", data: { unit: 4, unitsDone: 4 } }),
        },
        d,
      );
      expect(posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l))).toEqual([{ t: "revert", group: "unit:4" }]);
    });

    /**
     * The game's word is a press, not an ask. It goes to the device holding
     * the run as the seat's own move, the way a seat's press does, and it
     * needs no ask key: "open" takes no asks, and the death still lands.
     */
    it("passes what the game says to the device holding the run, as that seat's press, with no ask key", async () => {
      const { live, posted, d } = attached();
      await live.connect("tool", "public:open", "", { control: true, seat: "Mira", run: "open" });
      await live.watch("tool", "open", "public:open", "", { control: true, seat: "Mira", run: "open" });
      await live.connect("page", "user_1", "2026-09-11T00:00:00Z");
      await live.watch("page", "open", "user_1", "2026-09-11T00:00:00Z");
      await live.connect("watcher", "public:open", "");
      await live.watch("watcher", "open", "public:open", "");
      posted.length = 0;
      const say = (kind: string) =>
        route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "event", kind }) }, d);

      expect((await say("died")).statusCode).toBe(200);
      expect(asked).toEqual([]);
      const drives = posted.filter(([, data]) => JSON.parse(data)["t"] === "drive");
      expect(drives.map(([c]) => c)).toEqual(["page"]);
      const drive = JSON.parse(drives[0]![1]) as Record<string, unknown>;
      expect(drive).toMatchObject({ t: "drive", from: "tool", run: "open", press: "move", move: "died", via: "the game", seat: "Mira" });
      // No offer named: a death happened when it happened, and the page
      // reads it against what it is offering now.
      expect(drive["seq"]).toBeUndefined();
      expect(typeof drive["ref"]).toBe("string");
      // A watcher hears the move the ordinary way, once the page has
      // taken it, and nothing here.
      expect(posted.filter(([c]) => c === "watcher")).toEqual([]);

      // A kind nobody knows is ignored rather than guessed at, so a later
      // tool saying more than this does not break against this server.
      posted.length = 0;
      expect((await say("teleported")).statusCode).toBe(200);
      expect(posted.filter(([, data]) => JSON.parse(data)["t"] === "drive")).toEqual([]);
      const note = JSON.parse(posted.find(([c]) => c === "tool")![1]) as { t: string; text: string };
      expect(note.t).toBe("note");
      expect(note.text).toContain("teleported");
    });

    it("carries the page's verdict back to the game as a note, in the page's words", async () => {
      const { live, posted, d } = attached();
      await live.connect("tool", "public:open", "", { control: true, run: "open" });
      await live.watch("tool", "open", "public:open", "", { control: true, run: "open" });
      await live.connect("page", "user_1", "2026-09-11T00:00:00Z");
      await live.watch("page", "open", "user_1", "2026-09-11T00:00:00Z");
      const verdict = (body: Record<string, unknown>) =>
        route(
          { requestContext: { routeKey: "$default", connectionId: "page" }, body: JSON.stringify({ t: "drove", to: "tool", ...body }) },
          d,
        );
      posted.length = 0;
      await verdict({ ref: "r1", ok: true });
      expect(JSON.parse(posted.find(([c]) => c === "tool")![1])).toEqual({ t: "note", text: "Counted." });
      posted.length = 0;
      await verdict({ ref: "r2", ok: false, say: "That is not on offer." });
      expect(JSON.parse(posted.find(([c]) => c === "tool")![1])).toEqual({ t: "note", text: "Not counted: That is not on offer." });
      // Only the run's owner answers its game.
      await live.connect("other", "user_2", "2026-09-11T00:00:00Z");
      posted.length = 0;
      await route(
        {
          requestContext: { routeKey: "$default", connectionId: "other" },
          body: JSON.stringify({ t: "drove", to: "tool", ref: "r3", ok: true }),
        },
        d,
      );
      expect(posted).toEqual([]);
    });

    /**
     * A run with rules for a tool looks exactly like a run without one
     * until something is drawn, and then it either happens in the game or
     * it does not. So the table is told who is attached while nothing is
     * happening, which is the only time it is useful to know.
     */
    it("tells the table whose games are on the other end, and again when one goes", async () => {
      const { live, posted, d } = attached();
      await live.connect("watcher", "public:open", "");
      await live.watch("watcher", "open", "public:open", "");
      await route(
        {
          requestContext: { routeKey: "$connect", connectionId: "tool" },
          queryStringParameters: { k: "watchkey", as: "control", seat: "Mira" },
        },
        d,
      );
      await route(
        { requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app: "TarnishedTool" }) },
        d,
      );

      const toWatcher = () =>
        posted
          .filter(([c]) => c === "watcher")
          .map(([, l]) => JSON.parse(l) as { kind?: string; data?: { tools?: unknown[]; count?: number } });
      const said = toWatcher().filter((g) => g.kind === "tools");
      expect(said.at(-1)?.data?.count).toBe(1);
      // Whose, as well as what: the page hangs each tool on a row.
      expect(said.at(-1)?.data?.tools).toEqual([{ seat: "Mira", app: "TarnishedTool", sub: "stream:user_1" }]);

      // And when it goes, so the badge does not outlive the tool.
      await route({ requestContext: { routeKey: "$disconnect", connectionId: "tool" } }, d);
      expect(
        toWatcher()
          .filter((g) => g.kind === "tools")
          .at(-1)?.data?.count,
      ).toBe(0);

      // A tool is never told about itself; it hears operations only.
      expect(
        posted
          .filter(([c]) => c === "tool")
          .map(([, l]) => JSON.parse(l) as { kind?: string })
          .some((g) => g.kind === "tools"),
      ).toBe(false);
    });

    /**
     * The terms go out on every attach, because a tool that restarted is
     * holding none of them: its restore log puts prior values back, it
     * does not re-apply. That is right for a setting and wrong for a
     * gift. A run whose terms hand over runes, or an item somebody
     * already has, handed them over again on every reconnect.
     */
    it("gives the parts of the terms that are given once exactly once", async () => {
      const gift = {
        control: {
          setup: [
            { op: "flag.set", args: { name: "player.noRoll", value: true } },
            { op: "runes.give", args: { amount: 50000 }, once: true },
          ],
        },
      };
      const { live, posted, d } = attached(memoryLive(), gift);
      const hello = () =>
        route(
          { requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app: "TarnishedTool" }) },
          d,
        );
      await live.connect("tool", "public:shared", "", { control: true, seat: "Mira", run: "shared" });

      await hello();
      const ops = () =>
        posted
          .filter(([c]) => c === "tool")
          .map(([, l]) => JSON.parse(l) as { t: string; ops?: Array<{ op: string }> })
          .filter((f) => f.t === "apply");
      expect(
        ops()
          .at(-1)
          ?.ops?.map((o) => o.op),
      ).toEqual(["flag.set", "runes.give"]);
      // Written down, so a reconnect knows.
      expect(patched.at(-1)).toEqual(["shared", { termsGiven: ["Mira"] }]);

      // Attaching again with that remembered: the setting, not the runes.
      const seen = {
        ...d,
        store: {
          ...d.store,
          async getSession(id: string) {
            const found = await (d.store.getSession as (i: string) => Promise<{ meta: Record<string, unknown> } | null>)(id);
            return found ? { ...found, meta: { ...found.meta, termsGiven: ["Mira"] } } : null;
          },
        },
      } as typeof d;
      await route(
        { requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app: "TarnishedTool" }) },
        seen,
      );
      expect(
        ops()
          .at(-1)
          ?.ops?.map((o) => o.op),
      ).toEqual(["flag.set"]);
    });

    /**
     * The pack's terms and the loadout chosen for the run are one list in
     * the profile and two effects on the wire, under two ids. A tool
     * re-applying an id takes the old one off first, which is why: the
     * button below hands the loadout out again, and one effect carrying
     * both would have made that press revert the terms and re-apply
     * them, gifts included.
     */
    it("sends the terms and the loadout as their own effects", async () => {
      const both = {
        control: {
          setup: [
            { op: "flag.set", args: { name: "player.noRoll", value: true } },
            { op: "runes.give", args: { amount: 50000 }, once: true, chosen: true },
          ],
        },
      };
      const { live, posted, d } = attached(memoryLive(), both);
      await live.connect("tool", "public:shared", "", { control: true, seat: "Mira", run: "shared" });
      await route(
        { requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app: "TarnishedTool" }) },
        d,
      );
      const applies = posted
        .filter(([c]) => c === "tool")
        .map(([, l]) => JSON.parse(l) as { t: string; id?: string; ops?: Array<{ op: string }> })
        .filter((f) => f.t === "apply");
      expect(applies.map((f) => f.id)).toEqual(["setup", "loadout"]);
      expect(applies[0]?.ops?.map((o) => o.op)).toEqual(["flag.set"]);
      expect(applies[1]?.ops?.map((o) => o.op)).toEqual(["runes.give"]);
      // Two records, because the two are re-sent on different occasions.
      expect(patched.at(-1)).toEqual(["shared", { loadoutGiven: ["Mira"] }]);
    });

    /**
     * Handing the loadout out again, on purpose.
     *
     * The record that stops a gift going twice exists for a reconnect. A
     * host who has picked a different loadout and pressed the button is
     * not reconnecting, so the record is dropped and rebuilt from what
     * actually went out.
     */
    it("hands the loadout out again when the owner asks, and leaves the terms where they are", async () => {
      const gift = {
        control: {
          setup: [
            { op: "flag.set", args: { name: "player.noRoll", value: true } },
            { op: "runes.give", args: { amount: 50000 }, once: true, chosen: true },
          ],
        },
      };
      const { live, posted, d } = attached(memoryLive(), gift);
      await live.connect("tool", "public:shared", "", { control: true, seat: "Mira", run: "shared" });
      await live.watch("tool", "shared", "public:shared", "", { control: true, seat: "Mira", run: "shared" });
      await route(
        { requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app: "TarnishedTool" }) },
        d,
      );
      const applies = () =>
        posted
          .filter(([c]) => c === "tool")
          .map(([, l]) => JSON.parse(l) as { t: string; id?: string; ops?: Array<{ op: string }> })
          .filter((f) => f.t === "apply");
      expect(applies().map((f) => f.id)).toEqual(["setup", "loadout"]);

      // The owner's socket, saying hand it out.
      await live.connect("host", "user_1", "");
      await live.watch("host", "shared", "", "");
      posted.length = 0;
      await route(
        {
          requestContext: { routeKey: "$default", connectionId: "host" },
          body: JSON.stringify({ t: "gesture", id: "shared", kind: "setup" }),
        },
        d,
      );

      // The runes again: that is the entire point of the button. And the
      // terms are not re-sent, which is the bug this fixes -- the press
      // that gave somebody the loadout handed them the pack's own gifts
      // a second time along with it.
      expect(applies().map((f) => f.id)).toEqual(["loadout"]);
      expect(
        applies()
          .at(-1)
          ?.ops?.map((o) => o.op),
      ).toEqual(["runes.give"]);
      // Written down again, so the next reconnect is short of them; and
      // the terms' own record is not touched, because they did not move.
      expect(patched.at(-1)).toEqual(["shared", { loadoutGiven: ["Mira"] }]);
      expect(patched.map(([, p]) => p)).not.toContainEqual({ termsGiven: [] });
    });

    /**
     * What was handed out, said in words to everyone at the table.
     *
     * The press re-equips every game attached and, until the gesture
     * carried a title, said so only on the screen it was made from. The
     * data travels the way every other gesture's does, to a player on
     * their own copy, to somebody watching by the link, and to a seat;
     * the tool hears the same press in operations, as it always has.
     */
    it("tells every watcher what was handed out, and the tool in operations", async () => {
      const gift = {
        control: {
          setup: [
            { op: "flag.set", args: { name: "player.noRoll", value: true } },
            { op: "runes.give", args: { amount: 50000 }, once: true, chosen: true },
          ],
        },
      };
      const { live, posted, d } = attached(memoryLive(), gift);
      await live.connect("tool", "public:named", "", { control: true, seat: "Ada", run: "named" });
      await live.watch("tool", "named", "public:named", "", { control: true, seat: "Ada", run: "named" });
      // A player at the table on their own copy, somebody watching by the
      // link, and the same player's seat on the run's own page.
      await live.connect("player", "user_2", "");
      await live.watch("player", "named", "", "");
      await live.connect("link", "public:named", "");
      await live.watch("link", "named", "public:named", "");
      await live.connect("seat", "user_2", "", { seated: true, run: "named" });
      await live.watch("seat", "named", "", "", { seated: true, run: "named" });
      await live.connect("host", "user_1", "");
      await live.watch("host", "named", "", "");
      posted.length = 0;

      const r = await route(
        {
          requestContext: { routeKey: "$default", connectionId: "host" },
          body: JSON.stringify({
            t: "gesture",
            id: "named",
            kind: "setup",
            data: { title: "Cleric", id: "com.example.setups.cleric" },
          }),
        },
        d,
      );
      expect(r.statusCode).toBe(200);

      // The same line for all three, the data as it was sent, and `from`
      // stamped by the server off the sender's member row.
      const line = {
        t: "gesture",
        id: "named",
        kind: "setup",
        data: { title: "Cleric", id: "com.example.setups.cleric" },
        from: "Mira",
        at: "2026-09-06T12:00:00.000Z",
      };
      for (const c of ["player", "link", "seat"]) expect(JSON.parse(posted.find(([id]) => id === c)![1])).toEqual(line);
      // The tool hears the loadout, not the words.
      expect(JSON.parse(posted.find(([c]) => c === "tool")![1])).toMatchObject({ t: "apply", id: "loadout" });
      // And the device that pressed it is not told what it already knows.
      expect(posted.map(([c]) => c)).not.toContain("host");
    });

    it("refuses to hand the loadout out for anybody but the owner", async () => {
      const gift = { control: { setup: [{ op: "runes.give", args: { amount: 50000 }, once: true, chosen: true }] } };
      const { live, posted, d } = attached(memoryLive(), gift);
      await live.connect("tool", "public:shared", "", { control: true, seat: "Mira", run: "shared" });
      await live.watch("tool", "shared", "public:shared", "", { control: true, seat: "Mira", run: "shared" });
      // user_2 is at the table and is not whose run it is.
      await live.connect("other", "user_2", "");
      await live.watch("other", "shared", "", "");
      posted.length = 0;
      const r = await route(
        {
          requestContext: { routeKey: "$default", connectionId: "other" },
          body: JSON.stringify({ t: "gesture", id: "shared", kind: "setup" }),
        },
        d,
      );
      expect(r.statusCode).toBe(200);
      // Nothing reached the tool, and nothing was passed on as a gesture
      // either: one player cannot re-equip the table.
      expect(posted).toEqual([]);
    });

    /**
     * A command is the other thing a press can mean: one setup file's
     * operations, once, now. A warp, a gift, a rule on for a minute. The
     * run is not played under them, so nothing about the run changes and
     * nothing is written down.
     */
    it("hands a command's operations to the tool, tells the table, and writes nothing", async () => {
      const { live, posted, d } = attached();
      await live.connect("tool", "public:shared", "", { control: true, seat: "Mira", run: "shared" });
      await live.watch("tool", "shared", "public:shared", "", { control: true, seat: "Mira", run: "shared" });
      await live.connect("host", "user_1", "");
      await live.watch("host", "shared", "", "");
      await live.connect("watcher", "user_2", "");
      await live.watch("watcher", "shared", "", "");
      posted.length = 0;
      patched.length = 0;
      const ops = [{ op: "warp.position", args: { block: 60, x: 1, y: 2, z: 3 } }];
      const r = await route(
        {
          requestContext: { routeKey: "$default", connectionId: "host" },
          body: JSON.stringify({
            t: "gesture",
            id: "shared",
            kind: "command",
            data: { id: "com.example.setups.warp", title: "To the next boss", ops },
          }),
        },
        d,
      );
      expect(r.statusCode).toBe(200);
      // The tool is told in operations, under the setup file's own id and
      // title, so a person reading its log sees the thing that was
      // pressed rather than an anonymous effect.
      expect(JSON.parse(posted.find(([c]) => c === "tool")![1])).toEqual({
        t: "apply",
        id: "com.example.setups.warp",
        label: "To the next boss",
        each: true,
        ops,
      });
      // The table is told in words, and the device that pressed is not
      // told what it already knows.
      expect(JSON.parse(posted.find(([c]) => c === "watcher")![1])).toMatchObject({ t: "gesture", kind: "command" });
      expect(posted.map(([c]) => c)).not.toContain("host");
      // The run is untouched: a command is not its terms and not its
      // loadout, so a tool reconnecting a minute later is handed exactly
      // what it would have been handed before the press.
      expect(patched).toEqual([]);
    });

    it("takes a command from the owner and from nobody else", async () => {
      const { live, posted, d } = attached();
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      await live.watch("tool", "shared", "public:shared", "", { control: true, run: "shared" });
      // user_2 is at the table and is not whose run it is.
      await live.connect("other", "user_2", "");
      await live.watch("other", "shared", "", "");
      posted.length = 0;
      const r = await route(
        {
          requestContext: { routeKey: "$default", connectionId: "other" },
          body: JSON.stringify({
            t: "gesture",
            id: "shared",
            kind: "command",
            data: { id: "com.example.setups.warp", title: "To the next boss", ops: [{ op: "warp.position" }] },
          }),
        },
        d,
      );
      expect(r.statusCode).toBe(200);
      // Not even the words, since a command one player cannot send is not
      // something the table should be shown happening.
      expect(posted).toEqual([]);
    });

    /**
     * The operations come off a key press rather than out of the run's
     * own profile, so they are read the way the profile is: a frame that
     * is not what it claims to be is dropped whole, and quietly, as
     * every other bad frame on this socket is.
     */
    it("drops a command that is not one, rather than sending half of it", async () => {
      const { live, posted, d } = attached();
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      await live.watch("tool", "shared", "public:shared", "", { control: true, run: "shared" });
      await live.connect("host", "user_1", "");
      await live.watch("host", "shared", "", "");
      await live.connect("watcher", "user_2", "");
      await live.watch("watcher", "shared", "", "");
      const bad: unknown[] = [
        {},
        { id: "c", title: "T" },
        { id: "c", title: "T", ops: [] },
        { id: "c", title: "T", ops: "warp.position" },
        { id: "c", title: "T", ops: [{ args: {} }] },
        { id: "c", title: "T", ops: [{ op: 7 }] },
        { id: "c", title: "T", ops: [{ op: "x".repeat(65) }] },
        { id: "c", title: "T", ops: [{ op: "warp.position", args: [1] }] },
        { id: "", title: "T", ops: [{ op: "warp.position" }] },
        { id: "c", title: "x".repeat(81), ops: [{ op: "warp.position" }] },
        { id: "c", title: "T", ops: Array.from({ length: 65 }, () => ({ op: "warp" })) },
      ];
      for (const data of bad) {
        posted.length = 0;
        const r = await route(
          {
            requestContext: { routeKey: "$default", connectionId: "host" },
            body: JSON.stringify({ t: "gesture", id: "shared", kind: "command", data }),
          },
          d,
        );
        expect(r.statusCode).toBe(200);
        expect(posted).toEqual([]);
      }
    });

    it("says nothing to a tool the run's profile was not written for, and still tells the table", async () => {
      const forOne = { control: { tool: "TarnishedTool", rows: [{ tag: "curse", ops: [{ op: "speffect.apply", args: { id: 1 } }] }] } };
      const { live, posted, d } = attached(memoryLive(), forOne);
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      await live.watch("tool", "shared", "public:shared", "", { control: true, run: "shared" });
      await route(
        { requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app: "SomethingElse" }) },
        d,
      );
      await live.connect("host", "user_1", "");
      await live.watch("host", "shared", "", "");
      await live.connect("watcher", "user_2", "");
      await live.watch("watcher", "shared", "", "");
      posted.length = 0;
      await route(
        {
          requestContext: { routeKey: "$default", connectionId: "host" },
          body: JSON.stringify({
            t: "gesture",
            id: "shared",
            kind: "command",
            data: { id: "com.example.setups.warp", title: "To the next boss", ops: [{ op: "warp.position" }] },
          }),
        },
        d,
      );
      // The words are no use to a program, and the operations are a
      // different program's vocabulary, so it hears neither.
      expect(posted.filter(([c]) => c === "tool")).toEqual([]);
      expect(JSON.parse(posted.find(([c]) => c === "watcher")![1])).toMatchObject({ t: "gesture", kind: "command" });
    });

    it("tells the game when nothing is holding the run, rather than counting a death nowhere", async () => {
      const { live, posted, d } = attached();
      await live.connect("tool", "public:open", "", { control: true, run: "open" });
      await live.watch("tool", "open", "public:open", "", { control: true, run: "open" });
      await route(
        { requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "event", kind: "died" }) },
        d,
      );
      expect(asked).toEqual([]);
      /**
       * This once answered 200 and sent nothing, so a death said by the
       * game counted nowhere while the tool's own log said it had been
       * said: the one thing it cannot work out from its end is that the
       * far end threw it away.
       */
      const notes = posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l) as { t: string; text?: string });
      expect(notes.at(-1)).toMatchObject({ t: "note" });
      expect(notes.at(-1)!.text).toContain("Nothing is holding that run");
    });

    it("holds a game to the same rate as anything else asking", async () => {
      const { live, posted, d } = attached();
      await live.connect("tool", "public:open", "", { control: true, seat: "Solo", run: "open" });
      await live.watch("tool", "open", "public:open", "", { control: true, seat: "Solo", run: "open" });
      await live.connect("page", "user_1", "2026-09-11T00:00:00Z");
      await live.watch("page", "open", "user_1", "2026-09-11T00:00:00Z");
      posted.length = 0;
      const say = () =>
        route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "event", kind: "died" }) }, d);
      await say();
      await say();
      expect(posted.filter(([c, data]) => c === "page" && JSON.parse(data)["t"] === "drive")).toHaveLength(1);
      const notes = posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l) as { t: string; text?: string });
      expect(notes.at(-1)!.text).toContain("Too many");
    });

    it("is told a result in operations, while a watcher beside it is told it in words", async () => {
      const { live, posted, d } = attached();
      await live.connect("c1", "user_1", "");
      await live.connect("watcher", "public:shared", "");
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      for (const c of ["c1", "watcher", "tool"]) await live.watch(c, "shared", "", "", live.marks.get(c));
      const gesture = {
        t: "gesture",
        id: "shared",
        kind: "outcome",
        data: { n: 4, tableId: "curse", entryId: "rot", tags: ["curse"], text: "Scarlet rot." },
      };
      await route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify(gesture) }, d);
      const by = (c: string) => posted.filter(([who]) => who === c).map(([, line]) => JSON.parse(line));
      expect(by("watcher")[0]).toMatchObject({ t: "gesture", kind: "outcome" });
      expect(by("tool")).toEqual([
        { t: "apply", id: "o4#0", label: "A curse", for: 90, ops: [{ op: "speffect.apply", args: { id: 6900 } }] },
      ]);
    });

    it("hears what is addressed to its own player, and not what is addressed to another", async () => {
      const { live, posted, d } = attached();
      await live.connect("c1", "user_1", "");
      await live.connect("mira", "public:shared", "", { control: true, seat: "Mira", run: "shared" });
      await live.connect("kel", "public:shared", "", { control: true, seat: "Kel", run: "shared" });
      for (const c of ["c1", "mira", "kel"]) await live.watch(c, "shared", "", "", live.marks.get(c));
      const gesture = { t: "gesture", id: "shared", kind: "outcome", data: { n: 1, tableId: "t", entryId: "mira-only" } };
      await route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify(gesture) }, d);
      expect(posted.map(([c]) => c)).toEqual(["mira"]);
    });

    it("is told to take everything off when the run ends", async () => {
      const { live, posted, d } = attached();
      await live.connect("c1", "user_1", "");
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      for (const c of ["c1", "tool"]) await live.watch(c, "shared", "", "", live.marks.get(c));
      await route(
        {
          requestContext: { routeKey: "$default", connectionId: "c1" },
          body: JSON.stringify({ t: "gesture", id: "shared", kind: "run-ended", data: { ending: "Cooled" } }),
        },
        d,
      );
      expect(posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l))).toEqual([{ t: "revert", id: "*" }]);
    });

    it("hears nothing at all from a run carrying no profile", async () => {
      const { live, posted, d } = attached(memoryLive(), { unit: 4 });
      await live.connect("c1", "user_1", "");
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      for (const c of ["c1", "tool"]) await live.watch(c, "shared", "", "", live.marks.get(c));
      await route(
        {
          requestContext: { routeKey: "$default", connectionId: "c1" },
          body: JSON.stringify({
            t: "gesture",
            id: "shared",
            kind: "outcome",
            data: { n: 1, tableId: "curse", entryId: "rot", tags: ["curse"] },
          }),
        },
        d,
      );
      expect(posted.filter(([c]) => c === "tool")).toEqual([]);
    });
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
    expect(await live.watchers("shared")).toMatchObject([{ connectionId: "c1", sub: "user_1" }]);
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
    expect(
      (await route({ requestContext: { routeKey: "$connect", connectionId: "c9" }, queryStringParameters: { t: "wrong", run: "open" } }, d))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await route(
          { requestContext: { routeKey: "$connect", connectionId: "c9" }, queryStringParameters: { t: "livetok", run: "shared" } },
          d,
        )
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await route(
          { requestContext: { routeKey: "$connect", connectionId: "c9" }, queryStringParameters: { t: "livetok", run: "open" } },
          d,
        )
      ).statusCode,
    ).toBe(200);
    expect(d.live.watches.get("open")?.has("c9")).toBe(true);
    // It cannot ask to watch anything else.
    await route({ requestContext: { routeKey: "$default", connectionId: "c9" }, body: JSON.stringify({ t: "watch", id: "shared" }) }, d);
    expect(d.live.watches.get("shared")?.has("c9") ?? false).toBe(false);
  });
});

describe("a deck's press", () => {
  it("forwards a press to the page and the verdict back to the deck, and not to a deck watching the same run", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster };
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    // The deck watches its own run, the same as the page does: it must
    // not end up looking like a device that could take the press.
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    await route(ev("$default", "page", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    posted.length = 0;

    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "drive", run: "s1", seq: 42, ref: "r1", press: "primary" }) }), d);
    const drives = posted.filter(([, data]) => JSON.parse(data)["t"] === "drive");
    expect(drives).toHaveLength(1);
    expect(drives[0]![0]).toBe("page");
    expect(JSON.parse(drives[0]![1])).toEqual({ t: "drive", from: "deck1", run: "s1", seq: 42, ref: "r1", press: "primary" });

    posted.length = 0;
    await route(ev("$default", "page", { body: JSON.stringify({ t: "drove", to: "deck1", ref: "r1", ok: true }) }), d);
    expect(JSON.parse(posted.find(([id]) => id === "deck1")![1])).toEqual({ t: "drove", ref: "r1", ok: true });

    // And the run's new seq where the page sends one: the deck's next
    // press is made against it, ahead of the doorbell that carries it.
    posted.length = 0;
    await route(ev("$default", "page", { body: JSON.stringify({ t: "drove", to: "deck1", ref: "r4", ok: true, seq: 43 }) }), d);
    expect(JSON.parse(posted.find(([id]) => id === "deck1")![1])).toEqual({ t: "drove", ref: "r4", ok: true, seq: 43 });
  });

  it("tells a deck when nothing is holding the run", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster };
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    posted.length = 0;
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "drive", run: "s1", seq: 1, ref: "r2", press: "primary" }) }), d);
    expect(JSON.parse(posted.at(-1)![1])).toEqual({ t: "drove", ref: "r2", ok: false, say: "Nothing is holding that run." });
  });

  /**
   * Review finding: a press posted to every writing watcher is applied
   * once per device with the run open, which is one move made twice.
   */
  it("posts a press to one device of the owner's, the one that opened the run last", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    let clock = "2026-09-14T00:00:00.000Z";
    const d = { ...deps(live), poster, now: () => clock };
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    await route(ev("$connect", "laptop", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$connect", "phone", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$default", "laptop", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    clock = "2026-09-14T00:05:00.000Z";
    await route(ev("$default", "phone", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    posted.length = 0;

    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "drive", run: "s1", seq: 7, ref: "r1", press: "primary" }) }), d);
    const drives = posted.filter(([, data]) => JSON.parse(data)["t"] === "drive");
    expect(drives.map(([id]) => id)).toEqual(["phone"]);
  });

  it("does not post a press to another member's browser", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster };
    const at = "2026-09-14T00:00:00.000Z";
    // The other member's page, signed in as themselves: it writes, but
    // what it writes is authored under their name and its verdict never
    // reaches the deck.
    await live.connect("theirs", "user_2", at);
    await live.watch("theirs", "shared", "user_2", at);
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    posted.length = 0;

    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "drive", run: "shared", seq: 3, ref: "r1", press: "primary" }) }), d);
    expect(posted.some(([id]) => id === "theirs")).toBe(false);
    expect(JSON.parse(posted.at(-1)![1])).toEqual({ t: "drove", ref: "r1", ok: false, say: "Nothing is holding that run." });
  });

  /**
   * Review finding: a read that rejected threw past this branch to the
   * handler's 500, which posts nothing, and the deck waited on a verdict
   * that was never coming.
   */
  it("says so when it cannot check a press, rather than dropping it", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const base = deps(live);
    const d = {
      ...base,
      poster,
      store: {
        ...base.store,
        async getSession() {
          throw new Error("the table is not answering");
        },
      },
    };
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    posted.length = 0;
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "drive", run: "s1", seq: 1, ref: "r1", press: "primary" }) }), d);
    expect(JSON.parse(posted.at(-1)![1])).toEqual({ t: "drove", ref: "r1", ok: false, say: "Could not check that right now." });
  });

  it("will not forward a press for somebody else's run", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster };
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    posted.length = 0;
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "drive", run: "s3", seq: 1, ref: "r3", press: "primary" }) }), d);
    expect(JSON.parse(posted.at(-1)![1])).toEqual({ t: "drove", ref: "r3", ok: false, say: "That run is not yours to press." });
  });
});

describe("driving is part of Plus", () => {
  it("refuses a press without Plus, and says so", async () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster, entitled: async () => false };
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$default", "page", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    posted.length = 0;

    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "drive", run: "s1", seq: 1, ref: "r1", press: "primary" }) }), d);
    expect(JSON.parse(posted.at(-1)![1])).toEqual({ t: "drove", ref: "r1", ok: false, say: "Driving a run from a deck is part of Plus." });
    expect(posted.some(([id]) => id === "page")).toBe(false);
  });

  it("lets a deck watch without Plus", async () => {
    // The runs list still arrives: reading is not gated, and a deck that
    // cannot press must still be able to show what is going on.
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    const d = { ...deps(live), poster, entitled: async () => false };
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "hello" }) }), d);
    expect(posted.some(([, data]) => JSON.parse(data)["t"] === "runs")).toBe(true);
  });
});

describe("a seat's press", () => {
  const wired = () => {
    const live = memoryLive();
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return "sent";
      },
    };
    return { live, posted, d: { ...deps(live), poster } };
  };

  it("a signed-in socket may attach as a seat, and is not a device holding the run", async () => {
    const { live, d } = wired();
    expect((await route(ev("$connect", "seat1", { queryStringParameters: { token: "seated", as: "seat" } }), d)).statusCode).toBe(200);
    expect(await live.connection("seat1")).toMatchObject({ sub: "user_2", seated: true });
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    expect(await live.watchers("shared")).toMatchObject([{ connectionId: "seat1", seated: true }]);
  });

  it("forwards a seat's press to the owner's page, stamped with the member's name", async () => {
    const { posted, d } = wired();
    await route(ev("$connect", "seat1", { queryStringParameters: { token: "seated", as: "seat" } }), d);
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    await route(ev("$default", "page", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    posted.length = 0;

    // Who the press is from is never read off the press: a seat naming
    // somebody else, or another account, is stamped with its own.
    await route(
      ev("$default", "seat1", {
        body: JSON.stringify({ t: "drive", run: "shared", seq: 3, ref: "r1", press: "primary", seat: "Somebody Else", who: "user_9" }),
      }),
      d,
    );
    const drives = posted.filter(([, data]) => JSON.parse(data)["t"] === "drive");
    expect(drives).toHaveLength(1);
    expect(drives[0]![0]).toBe("page");
    expect(JSON.parse(drives[0]![1])).toEqual({
      t: "drive",
      from: "seat1",
      run: "shared",
      seq: 3,
      ref: "r1",
      press: "primary",
      seat: "Ada",
      who: "user_2",
    });
  });

  it("carries the page's verdict back to the seat", async () => {
    const { posted, d } = wired();
    await route(ev("$connect", "seat1", { queryStringParameters: { token: "seated", as: "seat" } }), d);
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    posted.length = 0;
    await route(
      ev("$default", "page", { body: JSON.stringify({ t: "drove", to: "seat1", ref: "r1", ok: false, say: "That moved on." }) }),
      d,
    );
    expect(JSON.parse(posted.find(([id]) => id === "seat1")![1])).toEqual({ t: "drove", ref: "r1", ok: false, say: "That moved on." });
  });

  it("refuses a seat on a run it does not play, and one whose page is away", async () => {
    const { posted, d } = wired();
    await route(ev("$connect", "seat1", { queryStringParameters: { token: "seated", as: "seat" } }), d);
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    posted.length = 0;
    // s1 has one member, user_1; user_2 is nobody there.
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "drive", run: "s1", seq: 3, ref: "r2", press: "primary" }) }), d);
    expect(JSON.parse(posted.at(-1)![1])).toEqual({ t: "drove", ref: "r2", ok: false, say: "That run is not yours to press." });
    // A run this seat does play, with nobody holding it open.
    posted.length = 0;
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "drive", run: "shared", seq: 3, ref: "r3", press: "primary" }) }), d);
    expect(JSON.parse(posted.at(-1)![1])).toEqual({ t: "drove", ref: "r3", ok: false, say: "Nothing is holding that run." });
  });

  it("says whether the run's page is open, when asked and when one arrives", async () => {
    const { posted, d } = wired();
    await route(ev("$connect", "seat1", { queryStringParameters: { token: "seated", as: "seat" } }), d);
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    posted.length = 0;
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "held", id: "shared" }) }), d);
    expect(JSON.parse(posted.at(-1)![1])).toEqual({ t: "held", id: "shared", held: false });

    posted.length = 0;
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$default", "page", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    expect(posted.filter(([id, data]) => id === "seat1" && JSON.parse(data)["t"] === "held").map(([, data]) => JSON.parse(data))).toEqual([
      { t: "held", id: "shared", held: true },
    ]);
  });

  it("leaves what a page is told about attached tools alone", async () => {
    const { posted, d } = wired();
    await route(ev("$connect", "seat1", { queryStringParameters: { token: "seated", as: "seat" } }), d);
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    posted.length = 0;
    await route(ev("$default", "page", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    const tools = posted.map(([, data]) => JSON.parse(data)).filter((m) => m["t"] === "gesture" && m["kind"] === "tools");
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((m) => m["data"]["tools"].length === 0 && m["data"]["decks"] === 0 && m["data"]["deckSubs"].length === 0)).toBe(
      true,
    );
  });

  it("refuses a press on a run other than the one the seat is on", async () => {
    const { posted, d } = wired();
    await route(ev("$connect", "seat1", { queryStringParameters: { token: "seated", as: "seat" } }), d);
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "watch", id: "other" }) }), d);
    posted.length = 0;
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "drive", run: "shared", seq: 3, ref: "r4", press: "primary" }) }), d);
    expect(JSON.parse(posted.at(-1)![1])).toEqual({ t: "drove", ref: "r4", ok: false, say: "That run is not the one this seat is on." });
  });

  it("refuses a seat whose part at the table is only to watch", async () => {
    const { posted, d } = wired();
    await route(ev("$connect", "seat1", { queryStringParameters: { token: "seated", as: "seat" } }), d);
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "watch", id: "viewed" }) }), d);
    posted.length = 0;
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "drive", run: "viewed", seq: 3, ref: "r5", press: "primary" }) }), d);
    expect(JSON.parse(posted.at(-1)![1])).toEqual({ t: "drove", ref: "r5", ok: false, say: "That run is not yours to press." });
  });

  it("does not take a seat for the device that holds a deck's press", async () => {
    const { posted, d } = wired();
    // The owner's own account, seated on the run beside the page that holds
    // it. Named so it sorts before the page: two watches in the same
    // millisecond settle by connection id, so a seat that counted as a
    // writer would be the one picked, and this would catch it.
    await route(ev("$connect", "chair1", { queryStringParameters: { token: "good", as: "seat" } }), d);
    await route(ev("$connect", "page", { queryStringParameters: { token: "good" } }), d);
    await route(ev("$connect", "deck1", { queryStringParameters: { token: "good", as: "deck" } }), d);
    await route(ev("$default", "chair1", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    await route(ev("$default", "page", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "watch", id: "s1" }) }), d);
    posted.length = 0;
    await route(ev("$default", "deck1", { body: JSON.stringify({ t: "drive", run: "s1", seq: 3, ref: "r6", press: "primary" }) }), d);
    const drives = posted.filter(([, data]) => JSON.parse(data)["t"] === "drive");
    expect(drives).toHaveLength(1);
    expect(drives[0]![0]).toBe("page");
  });

  it("drops a verdict from an account that does not own the seat's run", async () => {
    const { posted, d } = wired();
    await route(ev("$connect", "seat1", { queryStringParameters: { token: "seated", as: "seat" } }), d);
    await route(ev("$default", "seat1", { body: JSON.stringify({ t: "watch", id: "shared" }) }), d);
    // The same member's ordinary page. It is not the run's owner, so it is
    // not the page that took the press and has no verdict to give.
    await route(ev("$connect", "mine", { queryStringParameters: { token: "seated" } }), d);
    posted.length = 0;
    await route(ev("$default", "mine", { body: JSON.stringify({ t: "drove", to: "seat1", ref: "r7", ok: true }) }), d);
    expect(posted.filter(([id]) => id === "seat1")).toEqual([]);
  });
});

describe("a handout on a run with a watch party", () => {
  /** The owner's socket on a run the owner owns, with the party's rows behind it. */
  function hosting(guilds: ReturnType<typeof memoryGuilds>, told: Array<{ sessionId: string }> = []) {
    const live = memoryLive();
    const d: WsDeps = {
      ...deps(live),
      poster: {
        async post() {
          return "sent" as const;
        },
      },
      guilds,
      party: async (job: { sessionId: string }) => void told.push(job),
    };
    return { live, d, told };
  }

  it("writes the title onto the party and tells the job, without touching the log", async () => {
    const guilds = memoryGuilds();
    await guilds.putParty({
      sessionId: "shared",
      guildId: "g1",
      channelId: "chan",
      threadId: "thread_1",
      link: "https://runlog.test/r/shared?t=tok",
      openedBy: "1001",
      openedByName: "Mira",
      openedAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-16T10:00:00.000Z",
    });
    const { live, d, told } = hosting(guilds);
    await live.connect("host", "user_1", "");
    await live.watch("host", "shared", "", "");
    await route(
      ev("$default", "host", {
        body: JSON.stringify({ t: "gesture", id: "shared", kind: "setup", data: { title: "The kiln kit", id: "s1" } }),
      }),
      d,
    );
    expect((await guilds.party("shared", "g1"))?.handouts).toEqual([{ id: "s1", title: "The kiln kit" }]);
    expect(told).toEqual([{ sessionId: "shared" }]);
  });

  it("writes nothing for a gesture that is not a handout", async () => {
    const guilds = memoryGuilds();
    const { live, d } = hosting(guilds);
    await live.connect("host", "user_1", "");
    await live.watch("host", "shared", "", "");
    await route(ev("$default", "host", { body: JSON.stringify({ t: "gesture", id: "shared", kind: "rolling", data: {} }) }), d);
    expect(await guilds.partiesOf("shared")).toEqual([]);
  });
});
