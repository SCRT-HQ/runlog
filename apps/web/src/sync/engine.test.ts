import { beforeEach, describe, expect, it } from "vitest";
import type { StoredLicense, StoredPack, StoredRun, SyncState } from "../storage/db.ts";
import { createEngine, type SyncDb } from "./engine.ts";
import {
  SyncError,
  type Api,
  type Manifest,
  type RemoteLicense,
  type RemotePack,
  type SessionEvent,
  type SessionMeta,
  type SessionPointer,
} from "./client.ts";
import type { Entry } from "./diff.ts";
import { hashText } from "./hash.ts";
import { syncBus, type SyncNews } from "./bus.ts";
import { generateLicenseKey, seal } from "@runlog/rules-schema";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

/** Storage as four Maps. */
function fakeDb() {
  const runs = new Map<string, StoredRun>();
  const packs = new Map<string, StoredPack>();
  const licenses = new Map<string, StoredLicense>();
  const state = new Map<string, SyncState>();
  const db: SyncDb = {
    listRuns: async () => [...runs.values()],
    loadRun: async (id) => runs.get(id) ?? null,
    saveRun: async (r) => runs.set(r.runId, r),
    purgeRun: async (id) => runs.delete(id),
    listAllPacks: async () => [...packs.values()],
    loadPack: async (id) => packs.get(id) ?? null,
    savePack: async (p) => packs.set(p.id, p),
    purgePack: async (id) => packs.delete(id),
    listLicenses: async () => [...licenses.values()],
    saveLicense: async (l) => licenses.set(l.packId, l),
    purgeLicense: async (id) => licenses.delete(id),
    listSyncState: async () => [...state.values()],
    putSyncState: async (s) => state.set(s.id, s),
    forgetSyncState: async (id) => state.delete(id),
  };
  return { db, runs, packs, licenses, state };
}

/** A session on the fake server: numbered events, and the ids it has seen. */
interface FakeSession {
  meta: SessionMeta;
  events: SessionEvent[];
  seen: Set<string>;
}

/** The server as three Maps, counting what was asked of it. */
function fakeApi(opts: { offline?: boolean; beforeLicenses?: boolean; sub?: string } = {}) {
  const sessions = new Map<string, FakeSession>();
  const packs = new Map<string, RemotePack>();
  const licenses = new Map<string, RemoteLicense>();
  const calls: string[] = [];
  const me = opts.sub ?? "user";
  const entryOf = (x: { updatedAt: string; hash: string; deletedAt?: string }, id: string): Entry => ({ id, updatedAt: x.updatedAt, hash: x.hash, ...(x.deletedAt ? { deletedAt: x.deletedAt } : {}) });

  /** Number a batch the way the server does, dropping ids already held. */
  const append = (s: FakeSession, author: string, events: unknown[], at: string): SessionEvent[] => {
    const added: SessionEvent[] = [];
    for (const raw of events) {
      const e = raw as Record<string, unknown> & { id: string; t: string; at: string };
      if (s.seen.has(e.id)) continue;
      s.seen.add(e.id);
      s.meta.seq += 1;
      const stored = { ...e, seq: s.meta.seq, author } as SessionEvent;
      s.events.push(stored);
      added.push(stored);
    }
    s.meta.updatedAt = at;
    return added;
  };
  /** What another device did behind this one's back. */
  const othersMove = (id: string, author: string, events: unknown[], at = "2026-01-09") =>
    append(sessions.get(id)!, author, events, at);

  const api: Api = {
    me: async () => ({ sub: me, sid: "", env: "test", profile: { createdAt: "", lastSeenAt: "" }, entitlements: [] }),
    putProfile: async () => ({ createdAt: "", lastSeenAt: "" }),
    deleteMe: async () => {},
    exportMe: async () => ({ url: "", bytes: 0, expiresAt: "" }),
    manifest: async (): Promise<Manifest> => {
      calls.push("manifest");
      if (opts.offline) throw new SyncError("offline");
      return {
        sessions: [...sessions.values()].map(
          (s): SessionPointer => ({
            id: s.meta.id,
            role: s.meta.ownerSub === me ? "owner" : "player",
            packId: s.meta.packId,
            packVersion: s.meta.packVersion,
            ownerSub: s.meta.ownerSub,
            updatedAt: s.meta.updatedAt,
            seq: s.meta.seq,
            ...(s.meta.deletedAt ? { deletedAt: s.meta.deletedAt } : {}),
          }),
        ),
        packs: [...packs.values()].map((p) => entryOf(p, p.id)),
        // A server from before licenses leaves the field out altogether.
        ...(opts.beforeLicenses ? {} : { licenses: [...licenses.values()].map((l) => entryOf(l, l.id)) }),
      };
    },

    createSession: async (s) => {
      calls.push(`createSession ${s.id}`);
      if (sessions.has(s.id)) return null;
      const meta: SessionMeta = {
        id: s.id,
        packId: s.packId,
        packVersion: s.packVersion,
        ownerSub: me,
        createdAt: "2026-01-02",
        updatedAt: "2026-01-02",
        seq: 0,
        ...(s.name ? { name: s.name } : {}),
      };
      const fresh: FakeSession = { meta, events: [], seen: new Set() };
      sessions.set(s.id, fresh);
      return { session: meta, events: append(fresh, me, s.events, "2026-01-02") };
    },
    getSession: async (id, after) => {
      calls.push(`getSession ${id} after ${after}`);
      const s = sessions.get(id);
      if (!s || s.meta.deletedAt) return null;
      return {
        session: s.meta,
        members: [{ sub: s.meta.ownerSub, role: "owner", joinedAt: "2026-01-02" }],
        events: s.events.filter((e) => e.seq > after),
      };
    },
    appendEvents: async (id, events) => {
      calls.push(`append ${id} x${events.length}`);
      const s = sessions.get(id)!;
      return { appended: append(s, me, events, "2026-01-03"), seq: s.meta.seq };
    },
    patchSession: async (id, patch) => {
      calls.push(`patch ${id} ${JSON.stringify(patch)}`);
      const s = sessions.get(id);
      if (s && patch.name !== undefined) s.meta.name = patch.name || undefined;
    },
    deleteSession: async (id) => {
      calls.push(`deleteSession ${id}`);
      const s = sessions.get(id);
      if (s) s.meta.deletedAt = "2026-01-10";
    },
    createInvite: async () => {
      throw new SyncError("error");
    },
    listInvites: async () => [],
    revokeInvite: async () => {},
    acceptInvite: async () => {
      throw new SyncError("error");
    },
    myInvites: async () => [],
    declineInvite: async () => {},
    removeMember: async () => {},
    people: async () => [],
    listKeys: async () => [],
    createKey: async () => {
      throw new SyncError("error");
    },
    revokeKey: async () => {},
    listClaims: async () => [],
    removeClaim: async () => {},
    claimNonce: async () => ({ nonce: "n" }),
    claim: async () => {
      throw new SyncError("error");
    },

    checkout: async () => ({ available: false as const }),
    portal: async () => ({ available: false as const }),
    refreshEntitlements: async () => [],
    myPublisher: async () => null,
    becomePublisher: async () => {
      throw new SyncError("error");
    },
    connectPublisher: async () => ({ available: false as const }),
    refreshPublisherConnect: async () => null,
    publisherDashboard: async () => ({ available: false as const }),
    startPurchase: async () => ({ available: false as const }),
    purchase: async () => null,
    purchaseFile: async () => new Uint8Array(),
    myPurchases: async () => [],
    sales: async () => [],
    reissueSale: async () => {
      throw new SyncError("error");
    },
    revokeSale: async () => {
      throw new SyncError("error");
    },
    publisherPacks: async () => [],
    publisherMembers: async () => ({ members: [], invitations: [] }),
    invitePublisherMember: async () => ({ available: false as const }),
    revokePublisherInvitation: async () => {},
    removePublisherMember: async () => {},
    inviteFriend: async () => ({ available: false as const }),
    myInvitations: async () => [],
    revokeFriendInvitation: async () => {},
    shareRun: async () => ({ link: "" }),
    unshareRun: async () => {},
    watchPublicRun: async () => ({ sessionId: "", role: "viewer" as const }),
    reactions: async () => [],
    react: async () => [],
    putSnapshot: async () => {},
    putPublisherPack: async () => {
      throw new SyncError("error");
    },
    listPublisherPack: async () => ({ available: false as const }),
    unlistPublisherPack: async () => null,
    deletePublisherPack: async () => {},
    createRace: async () => {
      throw new SyncError("error");
    },
    myRaces: async () => [],
    joinRace: async () => {
      throw new SyncError("error");
    },
    getRace: async () => null,
    putRaceEntry: async () => null,
    patchRace: async () => null,
    inviteToRace: async () => {
      throw new SyncError("error");
    },

    getPack: async (id) => packs.get(id) ?? null,
    putPack: async (p) => {
      calls.push(`putPack ${p.id}`);
      packs.set(p.id, p);
      return entryOf(p, p.id);
    },
    deletePack: async (id) => {
      calls.push(`deletePack ${id}`);
      packs.delete(id);
    },
    getLicense: async (id) => licenses.get(id) ?? null,
    putLicense: async (l) => {
      calls.push(`putLicense ${l.id}`);
      licenses.set(l.id, l);
      return entryOf(l, l.id);
    },
    deleteLicense: async (id) => {
      calls.push(`deleteLicense ${id}`);
      licenses.delete(id);
    },
  };
  return { api, sessions, packs, licenses, calls, othersMove };
}

const started = (runId: string) => ({ t: "RunStarted", at: "2026-01-01", id: `${runId}-0`, packId: "kiln", packVersion: "1", mode: "std", runId });
const move = (id: string) => ({ t: "UnitEntered", at: "2026-01-01", id });
const run = (runId: string, updatedAt: string, events: unknown[] = [started(runId)], extra: Partial<StoredRun> = {}): StoredRun => ({
  runId,
  packId: "kiln",
  packVersion: "1",
  events,
  updatedAt,
  ...extra,
});
const seqs = (events: unknown[]) => events.map((e) => (e as { seq?: number }).seq);

const pack = (id: string, over: Partial<StoredPack> = {}): StoredPack => ({
  id,
  title: id,
  version: "1",
  source: `id: ${id}`,
  format: "yaml",
  filename: `${id}.yaml`,
  importedAt: "2026-01-01",
  updatedAt: "2026-01-01",
  ...over,
});

describe("the sync engine", () => {
  let news: SyncNews[];
  beforeEach(() => {
    news = [];
    syncBus.subscribe((n) => news.push(n));
  });

  it("starts a session for a run the server has never seen, and numbers its log", async () => {
    const local = fakeDb();
    const server = fakeApi();
    local.runs.set("r1", run("r1", "2026-01-02", [started("r1"), move("m1")]));
    const engine = createEngine(server.api, local.db);

    const first = await engine.sync();
    expect(first.status).toBe("synced");
    expect(first.pushed).toBe(1);
    expect(server.sessions.get("r1")?.meta.seq).toBe(2);
    expect(seqs(local.runs.get("r1")!.events)).toEqual([1, 2]);
    expect(local.runs.get("r1")?.role).toBe("owner");

    const second = await engine.sync();
    expect(second.pushed + second.pulled).toBe(0);
    expect(server.calls.filter((c) => c.startsWith("append") || c.startsWith("createSession"))).toHaveLength(1);
  });

  it("starts a run again when the server no longer lists it, and one run's trouble does not stop the rest", async () => {
    const local = fakeDb();
    const server = fakeApi();
    // r1 was numbered by a server that has since lost it (another account, a wipe): its log has numbers, the manifest has no r1.
    local.runs.set("r1", run("r1", "2026-01-02", [{ ...started("r1"), seq: 1 }, { ...move("m1"), seq: 2 }, move("m2")], { seq: 2, role: "owner" }));
    local.runs.set("r2", run("r2", "2026-01-03", [started("r2"), move("n1")]));
    const engine = createEngine(server.api, local.db);
    const report = await engine.sync();
    expect(report.status).toBe("synced");
    expect(server.calls).toContain("createSession r1");
    expect(server.calls).toContain("createSession r2");
    expect(seqs(local.runs.get("r1")!.events)).toEqual([1, 2, 3]);
    expect(seqs(local.runs.get("r2")!.events)).toEqual([1, 2]);

    // A run whose append blows up is left for next time; the run behind it still goes.
    const flaky = fakeApi();
    const troubled = fakeDb();
    troubled.runs.set("a1", run("a1", "2026-01-02", [started("a1"), move("x1")]));
    troubled.runs.set("a2", run("a2", "2026-01-03", [started("a2"), move("y1")]));
    await createEngine(flaky.api, troubled.db).sync();
    troubled.runs.set("a1", run("a1", "2026-01-04", [...troubled.runs.get("a1")!.events, move("x2")], { seq: 2, role: "owner" }));
    troubled.runs.set("a2", run("a2", "2026-01-04", [...troubled.runs.get("a2")!.events, move("y2")], { seq: 2, role: "owner" }));
    const broken = { ...flaky.api, appendEvents: async (id: string, events: SessionEvent[]) => { if (id === "a1") throw new Error("boom"); return flaky.api.appendEvents(id, events); } };
    const again = await createEngine(broken, troubled.db).sync();
    expect(again.status).toBe("error");
    expect(seqs(troubled.runs.get("a2")!.events)).toEqual([1, 2, 3]);
    expect(seqs(troubled.runs.get("a1")!.events)).toEqual([1, 2, undefined]);
  });

  it("sends only what is pending, and takes back the numbers", async () => {
    const local = fakeDb();
    const server = fakeApi();
    local.runs.set("r1", run("r1", "2026-01-02", [started("r1"), move("m1")]));
    const engine = createEngine(server.api, local.db);
    await engine.sync();
    // Two more moves here, unnumbered.
    const numbered = local.runs.get("r1")!.events;
    local.runs.set("r1", run("r1", "2026-01-04", [...numbered, move("m2"), move("m3")]));
    const report = await engine.sync();
    expect(report.pushed).toBe(1);
    expect(server.calls).toContain("append r1 x2");
    expect(seqs(local.runs.get("r1")!.events)).toEqual([1, 2, 3, 4]);
  });

  it("takes another device's moves and tells the app, keeping its own pending ones", async () => {
    const local = fakeDb();
    const server = fakeApi();
    local.runs.set("r1", run("r1", "2026-01-02"));
    const engine = createEngine(server.api, local.db);
    await engine.sync();
    news.length = 0;
    // Meanwhile, elsewhere: two moves by someone else. Here: one, unsent.
    server.othersMove("r1", "user_2", [move("theirs-1"), move("theirs-2")]);
    local.runs.set("r1", run("r1", "2026-01-05", [...local.runs.get("r1")!.events, move("mine")]));
    const report = await engine.sync();
    expect(report.pulled).toBe(1);
    const events = local.runs.get("r1")!.events as Array<{ id: string; seq?: number; author?: string }>;
    expect(events.map((e) => e.id)).toEqual(["r1-0", "theirs-1", "theirs-2", "mine"]);
    expect(events.map((e) => e.author)).toEqual(["user", "user_2", "user_2", "user"]);
    expect(news).toContainEqual({ t: "pulled", kind: "run", ids: ["r1"] });
  });

  it("does not tell the app about its own moves coming back numbered", async () => {
    const local = fakeDb();
    const server = fakeApi();
    local.runs.set("r1", run("r1", "2026-01-02", [started("r1"), move("m1")]));
    await createEngine(server.api, local.db).sync();
    expect(news.filter((n) => n.t === "pulled" && n.kind === "run")).toEqual([]);
  });

  it("gives an old log ids the same way twice, so a second device adds nothing twice", async () => {
    const legacy = [
      { t: "RunStarted", at: "2026-01-01", packId: "kiln", packVersion: "1", mode: "std" },
      { t: "UnitEntered", at: "2026-01-01" },
    ];
    const server = fakeApi();
    const a = fakeDb();
    a.runs.set("r1", run("r1", "2026-01-02", legacy));
    await createEngine(server.api, a.db).sync();
    const b = fakeDb();
    b.runs.set("r1", run("r1", "2026-01-02", legacy));
    await createEngine(server.api, b.db).sync();
    expect(server.sessions.get("r1")?.meta.seq).toBe(2);
    expect(seqs(b.runs.get("r1")!.events)).toEqual([1, 2]);
  });

  it("brings a session this device has never seen, whole", async () => {
    const local = fakeDb();
    const server = fakeApi();
    const other = fakeDb();
    other.runs.set("r9", run("r9", "2026-01-02", [started("r9"), move("x")]));
    await createEngine(server.api, other.db).sync();
    const report = await createEngine(server.api, local.db).sync();
    expect(report.pulled).toBe(1);
    expect(seqs(local.runs.get("r9")!.events)).toEqual([1, 2]);
    expect(local.runs.get("r9")?.seq).toBe(2);
    expect(news).toContainEqual({ t: "pulled", kind: "run", ids: ["r9"] });
  });

  it("goes quiet when offline, and writes nothing", async () => {
    const local = fakeDb();
    local.runs.set("r1", run("r1", "2026-01-02"));
    const report = await createEngine(fakeApi({ offline: true }).api, local.db).sync();
    expect(report.status).toBe("offline");
    expect(local.state.size).toBe(0);
    expect(seqs(local.runs.get("r1")!.events)).toEqual([undefined]);
  });

  it("never sends a pack the player did not switch on", async () => {
    const local = fakeDb();
    const server = fakeApi();
    local.packs.set("private", pack("private"));
    local.packs.set("shared", pack("shared", { sync: true }));
    await createEngine(server.api, local.db).sync();
    expect(server.calls).toContain("putPack shared");
    expect(server.calls).not.toContain("putPack private");
    expect(server.packs.has("private")).toBe(false);
  });

  it("carries where a pack came from to the account and back", async () => {
    const local = fakeDb();
    const server = fakeApi();
    local.packs.set("kiln", pack("kiln", { sync: true, origin: "catalog", catalog: { id: "dev.runlog.kiln", version: "1.0.0" } }));
    await createEngine(server.api, local.db).sync();
    expect(server.packs.get("kiln")).toMatchObject({ origin: "catalog", catalog: { id: "dev.runlog.kiln", version: "1.0.0" } });
    const other = fakeDb();
    await createEngine(server.api, other.db).sync();
    expect(other.packs.get("kiln")).toMatchObject({ origin: "catalog", catalog: { id: "dev.runlog.kiln", version: "1.0.0" } });
  });

  it("never sends a sealed copy, switch or no switch, and does not mention its deletion", async () => {
    const local = fakeDb();
    const server = fakeApi();
    local.packs.set("bought", pack("bought", { sync: true, sealed: true }));
    local.packs.set("gone", pack("gone", { sealed: true, deletedAt: "2026-01-02", source: "" }));
    await createEngine(server.api, local.db).sync();
    expect(server.calls.filter((c) => c.includes("bought") || c.includes("gone"))).toEqual([]);
  });

  it("keeps a sealed copy through the server's tombstone or free copy of the same pack", async () => {
    // Forgetting the free built-in left a tombstone under its id on the
    // server; buying the same pack put a sealed copy under that id here.
    const local = fakeDb();
    const server = fakeApi();
    local.packs.set("kiln", pack("kiln", { sealed: true, origin: "listing", source: "sealed text" }));
    local.runs.set("r1", run("r1", "2026-01-02"));
    server.packs.set("kiln", { id: "kiln", title: "Kiln", version: "1", format: "yaml", filename: "kiln.yaml", importedAt: "2026-01-01", updatedAt: "2026-01-03", hash: "h", source: "", deletedAt: "2026-01-03" } as RemotePack);
    await createEngine(server.api, local.db).sync();
    expect(local.packs.get("kiln")).toMatchObject({ sealed: true, source: "sealed text" });
    // A live free copy on the server does not overwrite the bought one either.
    server.packs.set("kiln", { id: "kiln", title: "Kiln", version: "1", format: "yaml", filename: "kiln.yaml", importedAt: "2026-01-01", updatedAt: "2026-01-04", hash: "h2", source: "free text" });
    await createEngine(server.api, local.db).sync();
    expect(local.packs.get("kiln")).toMatchObject({ sealed: true, source: "sealed text" });
    expect(server.calls.filter((c) => c.includes("kiln"))).toEqual([]);
  });

  it("carries a license key to the account, and brings one back", async () => {
    const local = fakeDb();
    const server = fakeApi();
    local.licenses.set("bought", { packId: "bought", key: "AAAAA-BBBBB", ref: "order-1", updatedAt: "2026-01-02" });
    server.licenses.set("other", { id: "other", key: "CCCCC-DDDDD", title: "Other", updatedAt: "2026-01-03", hash: "x" });
    const report = await createEngine(server.api, local.db).sync();
    expect(report.status).toBe("synced");
    expect(server.licenses.get("bought")?.key).toBe("AAAAA-BBBBB");
    expect(server.licenses.get("bought")?.ref).toBe("order-1");
    expect(local.licenses.get("other")).toMatchObject({ packId: "other", key: "CCCCC-DDDDD", title: "Other" });
    expect(news).toContainEqual({ t: "pulled", kind: "license", ids: ["other"] });
  });

  it("still syncs against a server that has not heard of licenses", async () => {
    const local = fakeDb();
    const server = fakeApi({ beforeLicenses: true });
    local.runs.set("r1", run("r1", "2026-01-02"));
    const report = await createEngine(server.api, local.db).sync();
    expect(report.status).toBe("synced");
    expect(report.pushed).toBe(1);
  });

  it("carries a deletion across, then purges the tombstone", async () => {
    const local = fakeDb();
    const server = fakeApi();
    local.runs.set("r1", run("r1", "2026-01-02"));
    await createEngine(server.api, local.db).sync();
    local.runs.set("r1", { ...run("r1", "2026-01-05", []), deletedAt: "2026-01-05" });
    await createEngine(server.api, local.db).sync();
    expect(server.calls).toContain("deleteSession r1");
    expect(local.runs.has("r1")).toBe(false);
  });

  it("drops its copy when the owner ended the session elsewhere", async () => {
    const local = fakeDb();
    const server = fakeApi();
    local.runs.set("r1", run("r1", "2026-01-02"));
    await createEngine(server.api, local.db).sync();
    await server.api.deleteSession("r1");
    await createEngine(server.api, local.db).sync();
    expect(local.runs.has("r1")).toBe(false);
  });

  it("runs one pass at a time and honors a request made mid-pass once", async () => {
    const local = fakeDb();
    const server = fakeApi();
    const engine = createEngine(server.api, local.db);
    const a = engine.sync();
    const b = engine.sync();
    const c = engine.sync();
    await Promise.all([a, b, c]);
    expect(server.calls.filter((x) => x === "manifest")).toHaveLength(2);
  });

  it("hashes a pack's stored text as it is", async () => {
    expect((await hashText("id: x")).length).toBe(16);
  });
});

describe("purchases", () => {
  it("brings a bought copy onto a device that signs in, once, with its key", async () => {
    const key = generateLicenseKey();
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const document = YAML.parse(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8")) as Record<string, unknown>;
    const id = String(document["id"]);
    const sealed = await seal(document, key, { ref: "SALE1", title: "The Kiln" });
    const local = fakeDb();
    const server = fakeApi();
    const fetched: string[] = [];
    const news: SyncNews[] = [];
    const off = syncBus.subscribe((n) => news.push(n));
    const api = {
      ...server.api,
      myPurchases: async () => [{ ref: "SALE1", packId: id, title: "The Kiln", status: "fulfilled" as const, key }],
      purchaseFile: async (ref: string) => {
        fetched.push(ref);
        return sealed;
      },
    };
    const report = await createEngine(api, local.db).sync();
    expect(report.pulled).toBeGreaterThanOrEqual(1);
    const pack = local.packs.get(id);
    expect(pack?.sealed).toBe(true);
    expect(pack?.origin).toBe("listing");
    expect(pack?.catalog).toEqual({ id, version: String(document["version"]) });
    expect(local.licenses.get(id)?.key).toBe(key);
    expect(news).toContainEqual({ t: "pulled", kind: "pack", ids: [id] });
    // A second pass does not fetch it again.
    await createEngine(api, local.db).sync();
    expect(fetched).toEqual(["SALE1"]);
    off();
  });
});
