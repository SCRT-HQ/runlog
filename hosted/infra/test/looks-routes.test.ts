import { describe, expect, it } from "vitest";
import {
  createThemeRecordFromPreset,
  LOOK_CHANNEL_LIMITS,
  LOOK_READ_KEY_PATTERN,
  LOOK_SECRET_PATTERN,
  presentationSnapshotKey,
  resolveThemeRecord,
  type PresentationSnapshotV1,
} from "@runlog/themes";
import { hashToken } from "../lib/handlers/auth";
import { lookRoute, publicLook, type LookOutcome, type LookRouteDeps } from "../lib/handlers/lookRoutes";
import { memoryLooks } from "./memory-looks";

function snapshotOf(presetId: "ember" | "glaze" | "daylight"): PresentationSnapshotV1 {
  const made = createThemeRecordFromPreset({ id: "fx", name: "Kiln", presetId });
  if (!made.ok) throw new Error("fixture");
  const resolved = resolveThemeRecord(made.value);
  if (!resolved.ok) throw new Error("fixture");
  return resolved.value;
}
const AT = "2026-09-25T10:00:30.000Z";

function setup(extra: Partial<LookRouteDeps> = {}) {
  const store = memoryLooks();
  let n = 0;
  const outcomes: LookOutcome[] = [];
  const rings: Array<[string, number]> = [];
  // Pattern-shaped and distinct: 12 bytes are 16 characters, 24 are 32, 32 are 43.
  const mint = (bytes: number) => String.fromCharCode(97 + (n++ % 26)).repeat(Math.ceil((bytes * 4) / 3));
  const deps: LookRouteDeps = {
    store,
    allowed: async () => true,
    mint,
    ring: async (id, revision) => {
      rings.push([id, revision]);
    },
    seen: (o) => outcomes.push(o),
    ...extra,
  };
  const call = (
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string>; sub?: string; viaKey?: boolean; bytes?: number } = {},
  ) =>
    lookRoute(
      {
        method,
        path,
        header: (name) => opts.headers?.[name],
        body: opts.body,
        bytes: opts.bytes ?? (opts.body === undefined ? 0 : Buffer.byteLength(JSON.stringify(opts.body))),
        sub: opts.sub ?? "user_1",
        at: AT,
        viaKey: opts.viaKey ?? false,
      },
      deps,
    );
  const create = async () => (await call("POST", "/api/looks")).body as { channel: { id: string }; readKey: string; secret: string };
  const publish = (id: string, secret: string, base: number, snapshot: unknown, opts: { sub?: string; bytes?: number } = {}) =>
    call("PUT", `/api/looks/${id}`, {
      body: { snapshot },
      headers: { "x-runlog-publisher": secret, "if-match": `"${base}"` },
      ...opts,
    });
  const read = async (readKey: string) => (await publicLook(readKey, store)).body;
  return { store, call, create, publish, read, outcomes, rings };
}

describe("making a theme link", () => {
  it("answers the read key and the secret once, and keeps only their hashes", async () => {
    const t = setup();
    const made = await t.create();
    expect(made.readKey).toMatch(LOOK_READ_KEY_PATTERN);
    expect(made.secret).toMatch(LOOK_SECRET_PATTERN);
    expect(made.channel).toEqual({ id: made.channel.id, revision: 0, createdAt: AT, updatedAt: AT, publishedAt: null });
    const row = t.store.rows.get(`user_1/${made.channel.id}`)!;
    expect(row.readKeyHash).toBe(hashToken(made.readKey));
    expect(row.secretHash).toBe(hashToken(made.secret));
    const listed = await t.call("GET", "/api/looks");
    expect(listed.body).toEqual({ channels: [made.channel], limit: LOOK_CHANNEL_LIMITS.maxChannels });
    expect(JSON.stringify(listed.body)).not.toContain(made.readKey);
    expect(JSON.stringify(listed.body)).not.toContain(row.secretHash);
  });

  it("asks for Plus to make or move a link, and never to publish, list or revoke one", async () => {
    const open = setup();
    const made = await open.create();
    const gated = setup({ store: open.store, allowed: async () => false });
    expect((await gated.call("POST", "/api/looks")).status).toBe(402);
    expect((await gated.call("POST", `/api/looks/${made.channel.id}/transfer`)).status).toBe(402);
    expect((await gated.call("POST", `/api/looks/${made.channel.id}/relink`)).status).toBe(402);
    expect((await gated.call("GET", "/api/looks")).status).toBe(200);
    expect((await gated.publish(made.channel.id, made.secret, 0, snapshotOf("ember"))).status).toBe(200);
    expect((await gated.call("DELETE", `/api/looks/${made.channel.id}`)).body).toEqual({ revoked: true });
  });

  it("refuses a command-line key on every owner route", async () => {
    const t = setup();
    for (const [method, path] of [
      ["GET", "/api/looks"],
      ["POST", "/api/looks"],
      ["PUT", "/api/looks/lk_AAAAAAAAAAAAAAAA"],
      ["POST", "/api/looks/lk_AAAAAAAAAAAAAAAA/transfer"],
      ["DELETE", "/api/looks/lk_AAAAAAAAAAAAAAAA"],
    ] as const) {
      const out = await t.call(method, path, { viaKey: true });
      expect([method, path, out.status, out.body["code"]]).toEqual([method, path, 422, "signed-in-only"]);
    }
  });

  it("stops at the account's cap", async () => {
    const t = setup();
    for (let i = 0; i < LOOK_CHANNEL_LIMITS.maxChannels; i += 1) expect((await t.call("POST", "/api/looks")).status).toBe(200);
    const full = await t.call("POST", "/api/looks");
    expect(full.status).toBe(422);
    expect(full.body).toMatchObject({ code: "channel-limit", limit: LOOK_CHANNEL_LIMITS.maxChannels });
  });
});

describe("publishing a look", () => {
  it("takes a look from the current secret, rings the followers, and serves presentation values only", async () => {
    const t = setup();
    const made = await t.create();
    expect(await t.read(made.readKey)).toEqual({ found: true, look: null });
    const out = await t.publish(made.channel.id, made.secret, 0, snapshotOf("ember"));
    expect(out).toEqual({ status: 200, body: { revision: 1, publishedAt: AT } });
    expect(t.rings).toEqual([[made.channel.id, 1]]);
    const seen = await t.read(made.readKey);
    expect(Object.keys(seen).sort()).toEqual(["found", "look"]);
    const look = seen["look"] as Record<string, unknown>;
    expect(Object.keys(look).sort()).toEqual(["revision", "schemaVersion", "snapshot"]);
    expect(presentationSnapshotKey(look["snapshot"] as PresentationSnapshotV1)).toBe(presentationSnapshotKey(snapshotOf("ember")));
    expect(JSON.stringify(seen)).not.toMatch(/lk_|user_1|Kiln|2026-/);
  });

  it("tells another account, another device and an old revision apart", async () => {
    const t = setup();
    const made = await t.create();
    await t.publish(made.channel.id, made.secret, 0, snapshotOf("ember"));
    expect((await t.publish(made.channel.id, made.secret, 1, snapshotOf("glaze"), { sub: "user_2" })).status).toBe(410);
    const other = await t.publish(made.channel.id, "z".repeat(43), 1, snapshotOf("glaze"));
    expect(other).toMatchObject({ status: 409, body: { code: "not-publisher" } });
    const stale = await t.publish(made.channel.id, made.secret, 0, snapshotOf("glaze"));
    expect(stale).toMatchObject({ status: 409, body: { code: "stale-revision", revision: 1 } });
    expect(t.store.rows.get(`user_1/${made.channel.id}`)!.revision).toBe(1);
  });

  it("refuses a replay from the old device after a transfer, whatever revision it names", async () => {
    const t = setup();
    const made = await t.create();
    await t.publish(made.channel.id, made.secret, 0, snapshotOf("ember"));
    const moved = await t.call("POST", `/api/looks/${made.channel.id}/transfer`);
    const secret = moved.body["secret"] as string;
    expect(secret).toMatch(LOOK_SECRET_PATTERN);
    expect(secret).not.toBe(made.secret);
    expect(moved.body["channel"]).toMatchObject({ id: made.channel.id, revision: 1 });
    expect(await t.publish(made.channel.id, made.secret, 1, snapshotOf("glaze"))).toMatchObject({
      status: 409,
      body: { code: "not-publisher" },
    });
    expect((await t.publish(made.channel.id, secret, 1, snapshotOf("daylight"))).body).toEqual({ revision: 2, publishedAt: AT });
    const look = (await t.read(made.readKey))["look"] as { snapshot: PresentationSnapshotV1 };
    expect(presentationSnapshotKey(look.snapshot)).toBe(presentationSnapshotKey(snapshotOf("daylight")));
  });

  it("refuses an oversized or malformed look before anything is stored", async () => {
    const t = setup();
    const made = await t.create();
    await t.publish(made.channel.id, made.secret, 0, snapshotOf("ember"));
    const id = made.channel.id;
    const ember = snapshotOf("ember");
    expect((await t.publish(id, made.secret, 1, ember, { bytes: LOOK_CHANNEL_LIMITS.maxRequestBytes + 1 })).status).toBe(413);
    const cases: Array<[string, Promise<{ status: number; body: Record<string, unknown> }>, number, string]> = [
      [
        "no secret",
        t.call("PUT", `/api/looks/${id}`, { body: { snapshot: ember }, headers: { "if-match": '"1"' } }),
        422,
        "secret-required",
      ],
      [
        "no revision",
        t.call("PUT", `/api/looks/${id}`, { body: { snapshot: ember }, headers: { "x-runlog-publisher": made.secret } }),
        428,
        "precondition-required",
      ],
      [
        "an extra key",
        t.call("PUT", `/api/looks/${id}`, {
          body: { snapshot: ember, name: "Kiln" },
          headers: { "x-runlog-publisher": made.secret, "if-match": '"1"' },
        }),
        422,
        "invalid-look",
      ],
      [
        "a css payload",
        t.publish(id, made.secret, 1, { ...ember, colors: { ...ember.colors, "surface.page": "url(https://example.invalid/x)" } }),
        422,
        "invalid-look",
      ],
      [
        "a font off the list",
        t.publish(id, made.secret, 1, { ...ember, fonts: { ...ember.fonts, ui: "comic-sans" } }),
        422,
        "invalid-look",
      ],
      [
        "no snapshot at all",
        t.call("PUT", `/api/looks/${id}`, { body: "1.d.ffffff", headers: { "x-runlog-publisher": made.secret, "if-match": '"1"' } }),
        422,
        "invalid-look",
      ],
    ];
    for (const [label, pending, status, code] of cases) {
      const out = await pending;
      expect([label, out.status, out.body["code"]]).toEqual([label, status, code]);
    }
    const row = t.store.rows.get(`user_1/${id}`)!;
    expect(row.revision).toBe(1);
    expect(presentationSnapshotKey(row.snapshot!)).toBe(presentationSnapshotKey(ember));
    expect(t.outcomes.filter((o) => o.outcome === "invalid").length).toBeGreaterThanOrEqual(3);
  });

  it("refuses an oversized body on its size alone, before the secret or the revision is read", async () => {
    const t = setup();
    const made = await t.create();
    const big = { bytes: LOOK_CHANNEL_LIMITS.maxRequestBytes + 1 };
    const shapes: Array<Record<string, string>> = [{}, { "x-runlog-publisher": made.secret }, { "if-match": '"0"' }];
    for (const headers of shapes) {
      const out = await t.call("PUT", `/api/looks/${made.channel.id}`, { body: undefined, headers, ...big });
      expect(out.status).toBe(413);
    }
    expect(t.store.rows.get(`user_1/${made.channel.id}`)!.revision).toBe(0);
  });

  it("holds a burst to thirty publishes a minute and says when to come back", async () => {
    const t = setup();
    const made = await t.create();
    let base = 0;
    for (let i = 0; i < LOOK_CHANNEL_LIMITS.publishesPerMinute; i += 1) {
      const out = await t.publish(made.channel.id, made.secret, base, i % 2 ? snapshotOf("glaze") : snapshotOf("ember"));
      expect(out.status).toBe(200);
      base = out.body["revision"] as number;
    }
    const limited = await t.publish(made.channel.id, made.secret, base, snapshotOf("daylight"));
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: "rate-limited", retryAfter: 30 });
    expect(limited.headers).toEqual({ "retry-after": "30" });
    expect(t.store.rows.get(`user_1/${made.channel.id}`)!.revision).toBe(LOOK_CHANNEL_LIMITS.publishesPerMinute);
  });

  it("never names a key, a secret or a look in what it measures", async () => {
    const t = setup();
    const made = await t.create();
    await t.publish(made.channel.id, made.secret, 0, snapshotOf("ember"));
    await t.publish(made.channel.id, "z".repeat(43), 1, snapshotOf("glaze"));
    const said = JSON.stringify(t.outcomes);
    expect(said).not.toContain(made.readKey);
    expect(said).not.toContain(made.secret);
    expect(said).not.toContain(snapshotOf("ember").colors["surface.page"]);
    expect(t.outcomes.map((o) => o.outcome)).toEqual(["created", "published", "not-publisher"]);
  });
});

describe("moving and ending a link", () => {
  it("New link cuts off the old address at once and rings its widgets", async () => {
    const t = setup();
    const made = await t.create();
    await t.publish(made.channel.id, made.secret, 0, snapshotOf("ember"));
    const relinked = await t.call("POST", `/api/looks/${made.channel.id}/relink`);
    const readKey = relinked.body["readKey"] as string;
    expect(readKey).toMatch(LOOK_READ_KEY_PATTERN);
    expect(await t.read(made.readKey)).toEqual({ found: false });
    expect((await t.read(readKey))["found"]).toBe(true);
    expect(t.rings.at(-1)).toEqual([made.channel.id, 1]);
    // The secret did not move: the same device goes on publishing.
    expect((await t.publish(made.channel.id, made.secret, 1, snapshotOf("glaze"))).status).toBe(200);
  });

  it("Revoke ends the link for every widget, and a second revoke changes nothing", async () => {
    const t = setup();
    const made = await t.create();
    await t.publish(made.channel.id, made.secret, 0, snapshotOf("ember"));
    expect((await t.call("DELETE", `/api/looks/${made.channel.id}`)).body).toEqual({ revoked: true });
    expect(t.rings.at(-1)).toEqual([made.channel.id, 0]);
    expect(await t.read(made.readKey)).toEqual({ found: false });
    expect((await t.call("DELETE", `/api/looks/${made.channel.id}`)).body).toEqual({ revoked: false });
    expect((await t.call("POST", `/api/looks/${made.channel.id}/transfer`)).status).toBe(410);
    expect((await t.call("POST", `/api/looks/${made.channel.id}/relink`)).status).toBe(410);
  });

  it("does not let another account move, relink or revoke a link", async () => {
    const t = setup();
    const made = await t.create();
    expect((await t.call("POST", `/api/looks/${made.channel.id}/transfer`, { sub: "user_2" })).status).toBe(410);
    expect((await t.call("POST", `/api/looks/${made.channel.id}/relink`, { sub: "user_2" })).status).toBe(410);
    expect((await t.call("DELETE", `/api/looks/${made.channel.id}`, { sub: "user_2" })).body).toEqual({ revoked: false });
    expect(t.store.rows.get(`user_1/${made.channel.id}`)!.secretHash).toBe(hashToken(made.secret));
  });

  it("answers nothing for a key of the wrong shape, and no route for anything else", async () => {
    const t = setup();
    expect(await t.read("short")).toEqual({ found: false });
    expect(await t.read("r".repeat(32))).toEqual({ found: false });
    expect((await t.call("PATCH", "/api/looks")).status).toBe(410);
    expect((await t.call("PUT", "/api/looks/public")).status).toBe(410);
    expect((await t.call("POST", "/api/looks/lk_AAAAAAAAAAAAAAAA/other")).status).toBe(410);
  });
});
