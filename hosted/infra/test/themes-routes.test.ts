import { describe, expect, it } from "vitest";
import { createThemeRecordFromPreset, type RemoteThemeV1, type ThemeRecordV1 } from "@runlog/themes";
import { themeRoute, type ThemeOutcome, type ThemeRequest } from "../lib/handlers/themeRoutes";
import { memoryThemes } from "./memory-themes";

const AT = "2026-09-23T10:00:30.000Z";
const KEY = "key-0000000000000001";
function record(id: string, name = "Kiln"): ThemeRecordV1 {
  const made = createThemeRecordFromPreset({ id, name, presetId: "ember" });
  if (!made.ok) throw new Error("fixture");
  return made.value;
}
function req(
  method: string,
  path: string,
  init: { headers?: Record<string, string>; body?: unknown; query?: Record<string, string>; sub?: string; at?: string } = {},
): ThemeRequest {
  const raw = init.body === undefined ? "" : JSON.stringify(init.body);
  return {
    method,
    path,
    query: init.query ?? {},
    header: (name) => init.headers?.[name],
    body: init.body,
    bytes: Buffer.byteLength(raw),
    sub: init.sub ?? "user_1",
    at: init.at ?? AT,
  };
}
const create = (id: string, key = KEY, rec = record(id)) =>
  req("PUT", `/api/themes/${id}`, { headers: { "idempotency-key": key, "if-none-match": "*" }, body: { record: rec } });

describe("the theme routes", () => {
  it("creates at revision 1, updates from the revision edited, and refuses a stale one with the current theme", async () => {
    const store = memoryThemes();
    const made = await themeRoute(create("t1"), store);
    expect(made).toMatchObject({ status: 200, body: { theme: { state: "live", id: "t1", revision: 1 } } });
    const next = await themeRoute(
      req("PUT", "/api/themes/t1", {
        headers: { "idempotency-key": "key-0000000000000002", "if-match": '"1"' },
        body: { record: record("t1", "Kiln 2") },
      }),
      store,
    );
    expect(next).toMatchObject({ status: 200, body: { theme: { revision: 2, record: { name: "Kiln 2" } } } });
    const stale = await themeRoute(
      req("PUT", "/api/themes/t1", {
        headers: { "idempotency-key": "key-0000000000000003", "if-match": '"1"' },
        body: { record: record("t1", "Kiln 3") },
      }),
      store,
    );
    expect(stale).toMatchObject({ status: 409, body: { theme: { revision: 2, record: { name: "Kiln 2" } } } });
  });

  it("asks for a precondition and a key rather than overwrite blind", async () => {
    const store = memoryThemes();
    expect(
      (await themeRoute(req("PUT", "/api/themes/t1", { headers: { "idempotency-key": KEY }, body: { record: record("t1") } }), store))
        .status,
    ).toBe(428);
    expect(
      await themeRoute(req("PUT", "/api/themes/t1", { headers: { "if-none-match": "*" }, body: { record: record("t1") } }), store),
    ).toMatchObject({ status: 422, body: { code: "key-required" } });
    expect(
      (await themeRoute(req("DELETE", "/api/themes/t1", { headers: { "idempotency-key": KEY, "if-none-match": "*" } }), store)).status,
    ).toBe(428);
    for (const ifMatch of ['"0"', '"1.5"', "*", 'W/"1"', '"99999999999999999"'])
      expect(
        (await themeRoute(req("DELETE", "/api/themes/t1", { headers: { "idempotency-key": KEY, "if-match": ifMatch } }), store)).status,
      ).toBe(428);
    expect(
      await themeRoute(req("DELETE", "/api/themes/t1", { headers: { "idempotency-key": "short", "if-match": '"1"' } }), store),
    ).toMatchObject({ status: 422, body: { code: "key-required" } });
    expect(
      await themeRoute(req("DELETE", "/api/themes/t1", { headers: { "idempotency-key": `${KEY}#x`, "if-match": '"1"' } }), store),
    ).toMatchObject({ status: 422, body: { code: "key-required" } });
  });

  it("refuses an address that is not a theme id before the store sees it", async () => {
    const store = memoryThemes();
    for (const path of ["/api/themes/THEMELIB%23x", "/api/themes/%E0%A4%A", "/api/themes/_lead", `/api/themes/${"a".repeat(129)}`])
      expect(await themeRoute(req("DELETE", path, { headers: { "idempotency-key": KEY, "if-match": '"1"' } }), store)).toMatchObject({
        status: 422,
        body: { code: "invalid-theme" },
      });
    expect(store.receipts.size).toBe(0);
    expect(store.counts.size).toBe(0);
  });

  it("keeps a deleted id deleted: no create, no update, and the tombstone is listed", async () => {
    const store = memoryThemes();
    await themeRoute(create("t1"), store);
    const gone = await themeRoute(
      req("DELETE", "/api/themes/t1", { headers: { "idempotency-key": "key-0000000000000009", "if-match": '"1"' } }),
      store,
    );
    expect(gone).toMatchObject({ status: 200, body: { theme: { state: "deleted", revision: 2 } } });
    expect(await themeRoute(create("t1", "key-000000000000000a"), store)).toMatchObject({
      status: 409,
      body: { theme: { state: "deleted", revision: 2 } },
    });
    const revive = req("PUT", "/api/themes/t1", {
      headers: { "idempotency-key": "key-000000000000000b", "if-match": '"2"' },
      body: { record: record("t1") },
    });
    expect(await themeRoute(revive, store)).toMatchObject({ status: 409, body: { theme: { state: "deleted" } } });
    expect(await themeRoute(req("GET", "/api/themes"), store)).toMatchObject({
      status: 200,
      body: { themes: [{ id: "t1", state: "deleted" }], live: 0 },
    });
  });

  it("answers a retried write from its receipt, without counting it again, and refuses a reused key", async () => {
    const store = memoryThemes();
    const first = await themeRoute(create("t1"), store);
    const again = await themeRoute(create("t1"), store);
    expect(again).toEqual({ ...first, body: { ...first.body, replayed: true } });
    expect([...store.counts.values()]).toEqual([1]);
    expect(await themeRoute(create("t1", KEY, record("t1", "Other")), store)).toMatchObject({ status: 422, body: { code: "key-reused" } });
    // The same key on a delete of the same id is a different change too.
    expect(
      await themeRoute(req("DELETE", "/api/themes/t1", { headers: { "idempotency-key": KEY, "if-match": '"1"' } }), store),
    ).toMatchObject({
      status: 422,
      body: { code: "key-reused" },
    });
    expect(store.rows.get("user_1/t1")).toMatchObject({ state: "live", revision: 1 });
  });

  it("refuses a reused key the store only finds inside the write", async () => {
    // Two requests with one key race: neither sees a receipt, and the
    // second write meets the first's. Its fingerprint still decides.
    const store = memoryThemes();
    await themeRoute(create("t1"), store);
    const blind = { ...store, receipt: async () => null };
    expect(await themeRoute(create("t1", KEY, record("t1", "Other")), blind)).toMatchObject({ status: 422, body: { code: "key-reused" } });
    expect(await themeRoute(create("t1"), blind)).toMatchObject({ status: 200, body: { theme: { revision: 1 }, replayed: true } });
  });

  it("answers two writes that meet in one instant with a short wait, not a fault", async () => {
    const store = memoryThemes();
    const seen: ThemeOutcome[] = [];
    const clash = Object.assign(new Error("Transaction canceled"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "TransactionConflict" }, { Code: "None" }, { Code: "None" }],
    });
    const busy = {
      ...store,
      write: async () => {
        throw clash;
      },
    };
    expect(await themeRoute(create("t1"), busy, (o) => seen.push(o))).toMatchObject({
      status: 503,
      body: { code: "busy", retryAfter: 1 },
      headers: { "retry-after": "1" },
    });
    expect(seen).toEqual([{ outcome: "busy" }]);
    // Any other failure is still a fault.
    const broken = {
      ...store,
      write: async () => {
        throw Object.assign(new Error("boom"), {
          name: "TransactionCanceledException",
          CancellationReasons: [{ Code: "ThrottlingError" }],
        });
      },
    };
    await expect(themeRoute(create("t2", "key-0000000000000002"), broken)).rejects.toThrow("boom");
  });

  it("holds the count at 200 live themes for creates, never for updates or deletes", async () => {
    const store = memoryThemes(2);
    await themeRoute(create("a", "key-00000000000000a1"), store);
    await themeRoute(create("b", "key-00000000000000b1"), store);
    expect(await themeRoute(create("c", "key-00000000000000c1"), store)).toMatchObject({
      status: 422,
      body: { code: "library-full", limit: 200 },
    });
    const update = req("PUT", "/api/themes/a", {
      headers: { "idempotency-key": "key-00000000000000a2", "if-match": '"1"' },
      body: { record: record("a", "A2") },
    });
    expect((await themeRoute(update, store)).status).toBe(200);
    await themeRoute(req("DELETE", "/api/themes/b", { headers: { "idempotency-key": "key-00000000000000b2", "if-match": '"1"' } }), store);
    expect((await themeRoute(create("c", "key-00000000000000c2"), store)).status).toBe(200);
  });

  it("allows 30 writes a minute and says how long to wait", async () => {
    const store = memoryThemes();
    for (let i = 0; i < 30; i++) expect((await themeRoute(create(`t${i}`, `key-${String(i).padStart(16, "0")}`), store)).status).toBe(200);
    const limited = await themeRoute(create("t30", "key-0000000000000030"), store);
    expect(limited).toMatchObject({ status: 429, body: { code: "rate-limited", retryAfter: 30 }, headers: { "retry-after": "30" } });
    const nextMinute = req("PUT", "/api/themes/t30", {
      headers: { "idempotency-key": "key-0000000000000031", "if-none-match": "*" },
      body: { record: record("t30") },
      at: "2026-09-23T10:01:00.000Z",
    });
    expect((await themeRoute(nextMinute, store)).status).toBe(200);
  });

  it("refuses a theme that does not read, names the field, and refuses one over 64 KiB", async () => {
    const store = memoryThemes();
    const bad = await themeRoute(
      req("PUT", "/api/themes/t1", {
        headers: { "idempotency-key": KEY, "if-none-match": "*" },
        body: { record: { ...record("t1"), name: "" } },
      }),
      store,
    );
    expect(bad).toMatchObject({ status: 422, body: { code: "invalid-theme", issues: [{ path: "$.name" }] } });
    expect(
      await themeRoute(
        req("PUT", "/api/themes/t2", { headers: { "idempotency-key": KEY, "if-none-match": "*" }, body: { record: record("t1") } }),
        store,
      ),
    ).toMatchObject({ status: 422, body: { code: "id-mismatch" } });
    expect(
      await themeRoute(req("PUT", "/api/themes/t1", { headers: { "idempotency-key": KEY, "if-none-match": "*" }, body: undefined }), store),
    ).toMatchObject({ status: 422, body: { code: "invalid-theme" } });
    const huge = req("PUT", "/api/themes/t1", {
      headers: { "idempotency-key": KEY, "if-none-match": "*" },
      body: { record: record("t1"), pad: "x".repeat(70_000) },
    });
    expect((await themeRoute(huge, store)).status).toBe(413);
    expect(store.rows.size).toBe(0);
  });

  it("says how many rows a page left out because they no longer read, and says nothing when none were", async () => {
    const store = memoryThemes();
    await themeRoute(create("t1", KEY, record("t1")), store);
    await themeRoute(create("t2", "key-0000000000000002", record("t2")), store);
    const whole = await themeRoute(req("GET", "/api/themes"), store);
    expect(whole.body).not.toHaveProperty("skipped");
    store.unreadable.add("user_1/t2");
    const partial = await themeRoute(req("GET", "/api/themes"), store);
    expect(partial).toMatchObject({ status: 200, body: { unchanged: false, skipped: 1, themes: [{ id: "t1" }] } });
    expect(partial.body["themes"]).toHaveLength(1);
  });

  it("lists in pages of at most 50 and answers unchanged from the head alone", async () => {
    const store = memoryThemes();
    const unlimited = { ...store, countWrite: async () => 1 };
    for (let i = 0; i < 60; i++) {
      const id = `t${String(i).padStart(2, "0")}`;
      await themeRoute(create(id, `key-${String(i).padStart(16, "0")}`, record(id)), unlimited);
    }
    const first = await themeRoute(req("GET", "/api/themes"), store);
    expect(first.body).toMatchObject({ libraryRevision: 60, live: 60, limit: 200, unchanged: false });
    // Follow the cursor to the end; a page may be short, or the last one empty.
    const listed: RemoteThemeV1[] = [];
    let page = first;
    for (let pages = 0; ; pages++) {
      expect(pages).toBeLessThan(10);
      const themes = page.body["themes"] as RemoteThemeV1[];
      expect(themes.length).toBeLessThanOrEqual(50);
      listed.push(...themes);
      if (page.body["next"] === undefined) break;
      page = await themeRoute(req("GET", "/api/themes", { query: { after: String(page.body["next"]) } }), store);
      expect(page.status).toBe(200);
    }
    expect(listed.map((t) => t.id)).toEqual(Array.from({ length: 60 }, (_, i) => `t${String(i).padStart(2, "0")}`));
    expect(await themeRoute(req("GET", "/api/themes", { query: { since: "60" } }), store)).toMatchObject({
      status: 200,
      body: { unchanged: true, libraryRevision: 60 },
    });
    expect(await themeRoute(req("GET", "/api/themes", { query: { since: "59" } }), store)).toMatchObject({
      status: 200,
      body: { unchanged: false },
    });
    for (const query of <Record<string, string>[]>[
      { since: "-1" },
      { since: "1.5" },
      { since: "" },
      { after: "%%%" },
      { after: "" },
      { after: Buffer.from("THEMEOP#x").toString("base64url") },
    ])
      expect(await themeRoute(req("GET", "/api/themes", { query }), store)).toMatchObject({ status: 422, body: { code: "invalid-query" } });
  });

  it("keeps each account's themes in its own partition", async () => {
    const store = memoryThemes();
    await themeRoute(create("t1"), store);
    expect(await themeRoute(req("GET", "/api/themes", { sub: "user_2" }), store)).toMatchObject({ body: { themes: [], live: 0 } });
    const reach = req("DELETE", "/api/themes/t1", { sub: "user_2", headers: { "idempotency-key": KEY, "if-match": '"1"' } });
    expect(await themeRoute(reach, store)).toMatchObject({ status: 409, body: { theme: null } });
    expect(store.rows.get("user_1/t1")).toMatchObject({ state: "live", revision: 1 });
  });

  it("reports outcomes by category, with no name or colors", async () => {
    const store = memoryThemes();
    const seen: ThemeOutcome[] = [];
    await themeRoute(create("t1", KEY, record("t1", "Secret Palette")), store, (o) => seen.push(o));
    await themeRoute(create("t1", KEY, record("t1", "Secret Palette")), store, (o) => seen.push(o));
    expect(seen).toEqual([
      { outcome: "written", revision: 1 },
      { outcome: "replayed", revision: 1 },
    ]);
    expect(JSON.stringify(seen)).not.toMatch(/Secret|#[0-9a-f]{6}/i);
  });

  it("has no other methods", async () => {
    expect((await themeRoute(req("POST", "/api/themes"), memoryThemes())).status).toBe(410);
    expect((await themeRoute(req("PATCH", "/api/themes/t1"), memoryThemes())).status).toBe(410);
    expect((await themeRoute(req("GET", "/api/themes/t1"), memoryThemes())).status).toBe(410);
    expect((await themeRoute(req("PUT", "/api/themes/t1/more"), memoryThemes())).status).toBe(410);
  });
});
