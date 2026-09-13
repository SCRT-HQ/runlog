import { describe, expect, it } from "vitest";
import { notifier, type Attached, type LiveStore, type Poster, type Watcher } from "../lib/handlers/live";
import { hashToken } from "../lib/handlers/auth";
import { route, type WsDeps, type WsEvent } from "../lib/handlers/ws";
import type { Race } from "../lib/handlers/races";
import type { Ask, SessionMember, SessionMeta } from "../lib/handlers/store";

/**
 * The socket is a doorbell: it carries a "changed" and nothing else. What
 * it must get right is who may ring it and who hears it. A stranger
 * cannot open one, a member cannot watch a session they are not in, and a
 * connection that has gone is cleaned up the first time it is missed.
 */

function memoryLive(): LiveStore & { conns: Map<string, string>; watches: Map<string, Set<string>>; marks: Map<string, Attached> } {
  const conns = new Map<string, string>();
  const watches = new Map<string, Set<string>>();
  const marks = new Map<string, Attached>();
  return {
    conns,
    watches,
    marks,
    async connect(id, sub, _at, attached) {
      conns.set(id, sub);
      if (attached) marks.set(id, attached);
    },
    async connection(id) {
      const sub = conns.get(id);
      return sub ? { sub, ...(marks.get(id) ?? {}) } : null;
    },
    async watch(id, sessionId, _sub, _at, attached) {
      if (!watches.has(sessionId)) watches.set(sessionId, new Set());
      watches.get(sessionId)!.add(id);
      if (attached) marks.set(id, attached);
    },
    async watchers(sessionId): Promise<Watcher[]> {
      return [...(watches.get(sessionId) ?? [])].map((connectionId) => ({ connectionId, sub: conns.get(connectionId) ?? "", ...(marks.get(connectionId) ?? {}) }));
    },
    async disconnect(id) {
      conns.delete(id);
      marks.delete(id);
      for (const set of watches.values()) set.delete(id);
    },
  };
}

const meta = (id: string, ownerSub: string): SessionMeta => ({ id, packId: "p", packVersion: "1", ownerSub, createdAt: "", updatedAt: "", seq: 3 });
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
      async addAsk(_id, ask) {
        asked.push(ask);
        return asked;
      },
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
      async updateSession(id, _at, patch) {
        patched.push([id, patch]);
        return null;
      },
      async getSession(id) {
        if (id === "asking") return { meta: { ...meta(id, "user_1"), publicTokenHash: hashToken("livetok"), askPolicy: "ask" as const }, members: [member("user_1")] };
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
        store: { ...base.store, async getSnapshot() { return { at: "", snapshot }; } },
        poster: { async post(connectionId: string, data: string) { posted.push([connectionId, data]); return "sent" as const; } },
      };
      return { live, posted, d };
    }

    it("is marked as one when it says so, and watches the run the key resolved", async () => {
      const { live, d } = attached();
      const connect = (q: Record<string, string>) => route({ requestContext: { routeKey: "$connect", connectionId: "c1" }, queryStringParameters: q }, d);
      expect((await connect({ k: "watchkey", as: "control", seat: "Mira" })).statusCode).toBe(200);
      expect(live.marks.get("c1")).toEqual({ control: true, seat: "Mira", run: "open" });
      // Without saying so it is an ordinary watcher, whose row is
      // exactly what it always was; a seat alone does not make it one.
      live.marks.clear();
      await connect({ k: "watchkey", seat: "Mira" });
      expect(live.marks.get("c1")).toBeUndefined();
      expect(await live.watchers("open")).toEqual([{ connectionId: "c1", sub: "stream:user_1" }]);
    });

    it("attaches on a run's own live link, which is how a player who is not the host joins", async () => {
      const { live, d } = attached();
      const r = await route({ requestContext: { routeKey: "$connect", connectionId: "c2" }, queryStringParameters: { t: "livetok", run: "open", as: "control", seat: "Kel" } }, d);
      expect(r.statusCode).toBe(200);
      expect(live.marks.get("c2")).toEqual({ control: true, seat: "Kel", run: "open" });
    });

    it("hears the run's terms when it says hello, and nothing when the run has none", async () => {
      const { live, posted, d } = attached();
      await live.connect("c1", "public:shared", "", { control: true, run: "shared" });
      const hello = () => route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify({ t: "hello", ops: ["flag.set"] }) }, d);
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
      const r = await route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify({ t: "gesture", id: "shared", kind: "rolling" }) }, d);
      expect(r.statusCode).toBe(200);
      expect(posted).toEqual([]);
    });

    it("remembers what a tool calls itself, and holds a profile to that program", async () => {
      const forOne = { control: { tool: "TarnishedTool", rows: [{ tag: "curse", ops: [{ op: "speffect.apply", args: { id: 1 } }] }] } };
      const { live, posted, d } = attached(memoryLive(), forOne);
      await live.connect("c1", "user_1", "");
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      await live.watch("tool", "shared", "public:shared", "", { control: true, run: "shared" });
      const hello = (app: string) => route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app }) }, d);

      // Something else entirely: told why, rather than left to sit there
      // doing nothing.
      await hello("SomethingElse");
      expect(JSON.parse(posted[0]![1])).toMatchObject({ t: "note" });
      expect(JSON.parse(posted[0]![1]).text).toContain("TarnishedTool");

      await live.connect("c1", "user_1", "");
      await live.watch("c1", "shared", "user_1", "");
      const roll = () => route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify({ t: "gesture", id: "shared", kind: "outcome", data: { n: 1, unit: 1, tableId: "curse", entryId: "rot", tags: ["curse"] } }) }, d);
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
      await route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify({ t: "gesture", id: "shared", kind: "unit-closed", data: { unit: 4, unitsDone: 4 } }) }, d);
      expect(posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l))).toEqual([{ t: "revert", group: "unit:4" }]);
    });

    it("raises an ask when the game says what happened, and only where the host takes them", async () => {
      const { live, posted, d } = attached();
      await live.connect("tool", "public:asking", "", { control: true, seat: "Mira", run: "asking" });
      await live.watch("tool", "asking", "public:asking", "", { control: true, seat: "Mira", run: "asking" });
      await live.connect("watcher", "public:asking", "");
      await live.watch("watcher", "asking", "public:asking", "");
      const say = (kind: string, run = "asking") =>
        route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "event", kind, run }) }, d);

      expect((await say("died")).statusCode).toBe(200);
      expect(asked).toEqual([expect.objectContaining({ kind: "move", move: "died", name: "Mira", via: "the game" })]);
      // Everyone watching hears it land, the same as any other ask.
      expect(JSON.parse(posted.at(-1)![1])).toMatchObject({ t: "gesture", kind: "ask", data: { move: "died", name: "Mira" } });

      // A kind nobody knows is ignored rather than guessed at, so a later
      // tool saying more than this does not break against this server.
      asked.length = 0;
      expect((await say("teleported")).statusCode).toBe(200);
      expect(asked).toEqual([]);
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
      await route({ requestContext: { routeKey: "$connect", connectionId: "tool" }, queryStringParameters: { k: "watchkey", as: "control", seat: "Mira" } }, d);
      await route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app: "TarnishedTool" }) }, d);

      const toWatcher = () => posted.filter(([c]) => c === "watcher").map(([, l]) => JSON.parse(l) as { kind?: string; data?: { tools?: unknown[]; count?: number } });
      const said = toWatcher().filter((g) => g.kind === "tools");
      expect(said.at(-1)?.data?.count).toBe(1);
      expect(said.at(-1)?.data?.tools).toEqual([{ seat: "Mira", app: "TarnishedTool" }]);

      // And when it goes, so the badge does not outlive the tool.
      await route({ requestContext: { routeKey: "$disconnect", connectionId: "tool" } }, d);
      expect(toWatcher().filter((g) => g.kind === "tools").at(-1)?.data?.count).toBe(0);

      // A tool is never told about itself; it hears operations only.
      expect(posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l) as { kind?: string }).some((g) => g.kind === "tools")).toBe(false);
    });

    /**
     * The terms go out on every attach, because a tool that restarted is
     * holding none of them: its restore log puts prior values back, it
     * does not re-apply. That is right for a setting and wrong for a
     * gift. A run whose terms hand over runes, or an item somebody
     * already has, handed them over again on every reconnect.
     */
    it("gives the parts of the terms that are given once exactly once", async () => {
      const gift = { control: { setup: [{ op: "flag.set", args: { name: "player.noRoll", value: true } }, { op: "runes.give", args: { amount: 50000 }, once: true }] } };
      const { live, posted, d } = attached(memoryLive(), gift);
      const hello = () => route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app: "TarnishedTool" }) }, d);
      await live.connect("tool", "public:shared", "", { control: true, seat: "Mira", run: "shared" });

      await hello();
      const ops = () => posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l) as { t: string; ops?: Array<{ op: string }> }).filter((f) => f.t === "apply");
      expect(ops().at(-1)?.ops?.map((o) => o.op)).toEqual(["flag.set", "runes.give"]);
      // Written down, so a reconnect knows.
      expect(patched.at(-1)).toEqual(["shared", { termsGiven: ["Mira"] }]);

      // Attaching again with that remembered: the setting, not the runes.
      const seen = { ...d, store: { ...d.store, async getSession(id: string) { const found = await (d.store.getSession as (i: string) => Promise<{ meta: Record<string, unknown> } | null>)(id); return found ? { ...found, meta: { ...found.meta, termsGiven: ["Mira"] } } : null; } } } as typeof d;
      await route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "hello", app: "TarnishedTool" }) }, seen);
      expect(ops().at(-1)?.ops?.map((o) => o.op)).toEqual(["flag.set"]);
    });

    it("says nothing where the host has not switched asks on, since attaching is not permission", async () => {
      const { live, posted, d } = attached();
      await live.connect("tool", "public:open", "", { control: true, run: "open" });
      await live.watch("tool", "open", "public:open", "", { control: true, run: "open" });
      await route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "event", kind: "died" }) }, d);
      expect(asked).toEqual([]);
      /**
       * And the tool is told so. This answered 200 and sent nothing, so a
       * death said by the game counted nowhere while the tool's own log
       * said it had been said: the one thing it cannot work out from its
       * end is that the far end threw it away.
       */
      const notes = posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l) as { t: string; text?: string });
      expect(notes.at(-1)).toMatchObject({ t: "note" });
      expect(notes.at(-1)!.text).toContain("not taking asks");
    });

    it("tells a tool whether what it said was counted or is waiting for the table", async () => {
      const { live, posted, d } = attached();
      // A seat of its own: the rate a tool is held to is per name, and the
      // tests above have already spoken for the others.
      await live.connect("tool", "public:asking", "", { control: true, seat: "Rennala", run: "asking" });
      await live.watch("tool", "asking", "public:asking", "", { control: true, seat: "Rennala", run: "asking" });
      await route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "event", kind: "died" }) }, d);
      const notes = posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l) as { t: string; text?: string });
      // This run asks rather than takes, so the honest answer is "waiting".
      expect(notes.at(-1)).toMatchObject({ t: "note" });
      expect(notes.at(-1)!.text).toContain("waiting");
    });

    it("holds a tool to the same rate as anything else asking", async () => {
      const { live, d } = attached();
      await live.connect("tool", "public:asking", "", { control: true, seat: "Solo", run: "asking" });
      await live.watch("tool", "asking", "public:asking", "", { control: true, seat: "Solo", run: "asking" });
      const say = () => route({ requestContext: { routeKey: "$default", connectionId: "tool" }, body: JSON.stringify({ t: "event", kind: "died" }) }, d);
      await say();
      await say();
      expect(asked).toHaveLength(1);
    });

    it("is told a result in operations, while a watcher beside it is told it in words", async () => {
      const { live, posted, d } = attached();
      await live.connect("c1", "user_1", "");
      await live.connect("watcher", "public:shared", "");
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      for (const c of ["c1", "watcher", "tool"]) await live.watch(c, "shared", "", "", live.marks.get(c));
      const gesture = { t: "gesture", id: "shared", kind: "outcome", data: { n: 4, tableId: "curse", entryId: "rot", tags: ["curse"], text: "Scarlet rot." } };
      await route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify(gesture) }, d);
      const by = (c: string) => posted.filter(([who]) => who === c).map(([, line]) => JSON.parse(line));
      expect(by("watcher")[0]).toMatchObject({ t: "gesture", kind: "outcome" });
      expect(by("tool")).toEqual([{ t: "apply", id: "o4#0", label: "A curse", for: 90, ops: [{ op: "speffect.apply", args: { id: 6900 } }] }]);
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
      await route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify({ t: "gesture", id: "shared", kind: "run-ended", data: { ending: "Cooled" } }) }, d);
      expect(posted.filter(([c]) => c === "tool").map(([, l]) => JSON.parse(l))).toEqual([{ t: "revert", id: "*" }]);
    });

    it("hears nothing at all from a run carrying no profile", async () => {
      const { live, posted, d } = attached(memoryLive(), { unit: 4 });
      await live.connect("c1", "user_1", "");
      await live.connect("tool", "public:shared", "", { control: true, run: "shared" });
      for (const c of ["c1", "tool"]) await live.watch(c, "shared", "", "", live.marks.get(c));
      await route({ requestContext: { routeKey: "$default", connectionId: "c1" }, body: JSON.stringify({ t: "gesture", id: "shared", kind: "outcome", data: { n: 1, tableId: "curse", entryId: "rot", tags: ["curse"] } }) }, d);
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
