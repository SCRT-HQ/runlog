import { describe, expect, it, vi } from "vitest";
import { snapshotForBuiltin } from "../theme/appearance.ts";
import { createTransport } from "./client.ts";
import { createLookApi, fetchPublicLook } from "./lookApi.ts";

const ID = "lk_AAAAAAAAAAAAAAAA";
const READ = "r".repeat(32);
const SECRET = "s".repeat(43);
const AT = "2026-09-25T10:00:00.000Z";
const summary = { id: ID, revision: 0, createdAt: AT, updatedAt: AT, publishedAt: null };

function server(answers: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const sent: Array<{ method: string; url: string; headers: Record<string, string>; body: string | undefined }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    sent.push({
      method: init.method ?? "GET",
      url,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? init.body : undefined,
    });
    const next = answers.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json", ...next.headers },
    });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}
const apiOver = (s: ReturnType<typeof server>) =>
  createLookApi(createTransport("https://runlog.test/api", async () => "token", s.fetchImpl));

describe("the theme link client", () => {
  it("makes a link and reads the key and secret it is given once", async () => {
    const s = server([{ status: 200, body: { channel: summary, readKey: READ, secret: SECRET } }]);
    expect(await apiOver(s).create()).toEqual({ kind: "ok", channel: summary, readKey: READ, secret: SECRET });
    expect(s.sent[0]).toMatchObject({ method: "POST", url: "https://runlog.test/api/looks" });
  });

  it("says plan and full rather than throwing", async () => {
    const s = server([
      { status: 402, body: { plan: "plus", upgrade: true } },
      { status: 422, body: { code: "channel-limit", limit: 10 } },
    ]);
    const api = apiOver(s);
    expect(await api.create()).toEqual({ kind: "plan" });
    expect(await api.create()).toEqual({ kind: "full", limit: 10 });
  });

  it("sends the secret in a header and never in the address", async () => {
    const s = server([{ status: 200, body: { revision: 1, publishedAt: AT } }]);
    expect(await apiOver(s).publish({ id: ID, secret: SECRET, base: 0, snapshot: snapshotForBuiltin("ember") })).toEqual({
      kind: "ok",
      revision: 1,
    });
    const request = s.sent[0]!;
    expect(request).toMatchObject({ method: "PUT", url: `https://runlog.test/api/looks/${ID}` });
    expect(request.headers["x-runlog-publisher"]).toBe(SECRET);
    expect(request.headers["if-match"]).toBe('"0"');
    expect(request.url).not.toContain(SECRET);
    expect(request.body).not.toContain(SECRET);
    expect(JSON.parse(request.body!)).toEqual({ snapshot: snapshotForBuiltin("ember") });
  });

  it.each([
    [
      { status: 409, body: { code: "stale-revision", revision: 4 } },
      { kind: "stale", revision: 4 },
    ],
    [{ status: 409, body: { code: "not-publisher" } }, { kind: "not-publisher" }],
    [{ status: 410, body: { code: "gone" } }, { kind: "gone" }],
    [
      { status: 429, body: { code: "rate-limited", retryAfter: 12 }, headers: { "retry-after": "12" } },
      { kind: "rate-limited", retryAfterMs: 12_000 },
    ],
    [
      { status: 413, body: { error: "a look is at most 4 KB", code: "too-large" } },
      { kind: "rejected", code: "too-large" },
    ],
    [
      { status: 422, body: { code: "invalid-look" } },
      { kind: "rejected", code: "invalid-look" },
    ],
  ])("reads the publish answer %j", async (answer, outcome) => {
    const s = server([answer]);
    expect(await apiOver(s).publish({ id: ID, secret: SECRET, base: 3, snapshot: snapshotForBuiltin("ember") })).toEqual(outcome);
  });

  it("calls a link gone only when the server says so, and any other 410 an error to retry", async () => {
    const noRoute = { status: 410, body: { error: "no such route" } };
    const s = server([noRoute, noRoute, noRoute]);
    const api = apiOver(s);
    await expect(api.publish({ id: ID, secret: SECRET, base: 3, snapshot: snapshotForBuiltin("ember") })).rejects.toThrow(/410/);
    await expect(api.transfer(ID)).rejects.toThrow(/410/);
    await expect(api.relink(ID)).rejects.toThrow(/410/);
  });

  it("moves, relinks and revokes by id", async () => {
    const s = server([
      { status: 200, body: { channel: { ...summary, revision: 2 }, secret: "t".repeat(43) } },
      { status: 200, body: { channel: { ...summary, revision: 2 }, readKey: "q".repeat(32) } },
      { status: 410, body: { code: "gone" } },
      { status: 200, body: { revoked: true } },
    ]);
    const api = apiOver(s);
    expect(await api.transfer(ID)).toEqual({ kind: "ok", channel: { ...summary, revision: 2 }, secret: "t".repeat(43) });
    expect(await api.relink(ID)).toEqual({ kind: "ok", channel: { ...summary, revision: 2 }, readKey: "q".repeat(32) });
    expect(await api.relink(ID)).toEqual({ kind: "gone" });
    expect(await api.revoke(ID)).toBe(true);
    expect(s.sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `POST /api/looks/${ID}/transfer`,
      `POST /api/looks/${ID}/relink`,
      `POST /api/looks/${ID}/relink`,
      `DELETE /api/looks/${ID}`,
    ]);
  });

  it("refuses an answer that carries a malformed key", async () => {
    const s = server([{ status: 200, body: { channel: summary, readKey: "short", secret: SECRET } }]);
    await expect(apiOver(s).create()).rejects.toThrow(/does not read/);
  });
});

describe("a widget's read of a theme link", () => {
  it("sends the read key in a header, with no account and no key in the address", async () => {
    const s = server([
      { status: 200, body: { found: true, look: { schemaVersion: 1, revision: 2, snapshot: snapshotForBuiltin("glaze") } } },
    ]);
    const answer = await fetchPublicLook("https://runlog.test/api/", READ, s.fetchImpl);
    expect(answer.kind === "look" && answer.look.revision).toBe(2);
    expect(s.sent[0]!.url).toBe("https://runlog.test/api/looks/public");
    expect(s.sent[0]!.headers["x-runlog-look"]).toBe(READ);
    expect(s.sent[0]!.headers["authorization"]).toBeUndefined();
  });

  it("tells a revoked link from one not yet published", async () => {
    const s = server([
      { status: 200, body: { found: false } },
      { status: 200, body: { found: true, look: null } },
    ]);
    expect(await fetchPublicLook("https://runlog.test/api", READ, s.fetchImpl)).toEqual({ kind: "gone" });
    expect(await fetchPublicLook("https://runlog.test/api", READ, s.fetchImpl)).toEqual({ kind: "unpublished" });
  });

  it("throws on a look that does not read, so the widget keeps the last good one", async () => {
    const glaze = snapshotForBuiltin("glaze");
    const bad = { ...glaze, colors: { ...glaze.colors, "surface.page": "url(https://example.invalid/x)" } };
    const s = server([{ status: 200, body: { found: true, look: { schemaVersion: 1, revision: 3, snapshot: bad } } }]);
    await expect(fetchPublicLook("https://runlog.test/api", READ, s.fetchImpl)).rejects.toThrow();
  });

  it("is offline when the network is", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    await expect(fetchPublicLook("https://runlog.test/api", READ, fetchImpl)).rejects.toMatchObject({ kind: "offline" });
  });
});
