import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { createThemeRecordFromPreset, type ThemeRecordV1 } from "@runlog/themes";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { route, type Deps } from "../hosted/infra/lib/handlers/api.ts";
import { memoryThemes } from "../hosted/infra/test/memory-themes.ts";
import { createTransport } from "../apps/web/src/sync/client.ts";
import { createThemeApi } from "../apps/web/src/sync/themeApi.ts";
import { openThemeRepository, type ThemeRepository } from "../apps/web/src/theme/themeStorage.ts";
import { createThemeSync, type ThemeSync, type ThemeSyncReport } from "../apps/web/src/theme/sync/worker.ts";

function record(id: string, name = id): ThemeRecordV1 {
  const made = createThemeRecordFromPreset({ id, name, presetId: "ember" });
  if (!made.ok) throw new Error("fixture");
  return made.value;
}

let seconds = 0;
const themes = memoryThemes();
// Any reach past the theme routes into another store is a failure of this test's premise.
// `allowed` names the few calls a route outside the theme routes may make (the export).
const refuse = (allowed: Record<string, unknown> = {}) =>
  new Proxy(allowed, {
    get: (target, name) =>
      name === "then"
        ? undefined
        : name in target
          ? target[name as string]
          : () => {
              throw new Error(`theme routes reached ${String(name)}`);
            },
  });
const exports: string[] = [];
const deps = {
  store: refuse({
    touchProfile: async (sub: string) => ({ sub }),
    manifest: async () => ({ packs: [], licenses: [], sessions: [] }),
    listPeople: async () => [],
    listApiKeys: async () => [],
    listClaims: async () => [],
    saveExport: async (_sub: string, body: string) => {
      exports.push(body);
      return { url: "https://runlog.test/export", expiresAt: "2026-09-24T10:00:00.000Z" };
    },
  }),
  races: refuse({ listRaces: async () => [] }),
  billing: refuse(),
  publishers: refuse(),
  listings: refuse(),
  sales: refuse({ listPurchases: async () => [] }),
  gates: false,
  env: "test",
  cliClientId: "c",
  deckClientId: "d",
  appUrl: "https://runlog.test/",
  token: () => "t",
  now: () => new Date(Date.parse("2026-09-23T10:00:00.000Z") + (seconds += 1) * 1000).toISOString(),
  verify: async (authorization?: string) => {
    if (authorization === "Bearer alice") return { sub: "user_a", sid: "s1" };
    if (authorization === "Bearer bob") return { sub: "user_b", sid: "s2" };
    if (authorization === "Bearer carol") return { sub: "user_c", sid: "s3" };
    throw new Error("bad token");
  },
  themes,
} as unknown as Deps;

// `up: false` fails before the request leaves; `loseNext` lets one write land and then drops its answer.
const network = { up: true, loseNext: false };
const sent: Array<{ method: string; path: string; key: string | undefined; status: number }> = [];
const fetchImpl: typeof fetch = async (input, init = {}) => {
  if (!network.up) throw new TypeError("offline");
  const url = new URL(String(input));
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const method = init.method ?? "GET";
  const event = {
    version: "2.0",
    routeKey: "$default",
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    ...(url.search ? { queryStringParameters: Object.fromEntries(url.searchParams) } : {}),
    headers,
    requestContext: { http: { method, path: url.pathname } },
    isBase64Encoded: false,
    ...(typeof init.body === "string" ? { body: init.body } : {}),
  } as unknown as APIGatewayProxyEventV2;
  const out = (await route(event, deps)) as APIGatewayProxyStructuredResultV2;
  sent.push({ method, path: url.pathname, key: headers["idempotency-key"], status: out.statusCode ?? 200 });
  if (network.loseNext && method !== "GET") {
    network.loseNext = false;
    throw new TypeError("the answer was lost");
  }
  return new Response(out.body ?? "", { status: out.statusCode ?? 200, headers: out.headers as Record<string, string> });
};

interface Device {
  repo: ThemeRepository;
  sync: ThemeSync;
  reports: ThemeSyncReport[];
}
const devices: Device[] = [];
async function device(sub: string, token: string): Promise<Device> {
  const repo = await openThemeRepository({ kind: "account", id: sub }, new IDBFactory());
  const reports: ThemeSyncReport[] = [];
  const sync = createThemeSync({
    repository: repo,
    api: createThemeApi(createTransport("https://runlog.test/api", async () => token, fetchImpl)),
    onLibraryChanged: () => undefined,
    onReport: (r) => reports.push(r),
    setTimer: () => null,
    clearTimer: () => undefined,
    lock: (run) => run(),
  });
  const d = { repo, sync, reports };
  devices.push(d);
  return d;
}
const pass = async (d: Device) => {
  d.sync.wake("focus");
  await d.sync.idle();
};
const names = async (d: Device) => (await d.repo.listLibrary()).map((r) => r.record.name).sort();

afterEach(() => {
  network.up = true;
  network.loseNext = false;
  sent.splice(0);
  for (const d of devices.splice(0)) {
    d.sync.stop();
    d.repo.close();
  }
});

describe("two devices, one account, the real handler", () => {
  it("carries a theme across, keeps a conflicting edit as a copy, and recovers an edit made against a delete", async () => {
    const [laptop, desktop] = [await device("user_a", "alice"), await device("user_a", "alice")];
    await laptop.repo.saveTheme({ record: record("t1", "Kiln"), expectedLocalRevision: null });
    await pass(laptop);
    await pass(desktop);
    expect(await names(desktop)).toEqual(["Kiln"]);

    const l = await laptop.repo.loadTheme("t1");
    const d = await desktop.repo.loadTheme("t1");
    if (l?.kind !== "saved" || d?.kind !== "saved") throw new Error("rows");
    await laptop.repo.saveTheme({ record: record("t1", "Kiln warm"), expectedLocalRevision: l.localRevision });
    await desktop.repo.saveTheme({ record: record("t1", "Kiln cold"), expectedLocalRevision: d.localRevision });
    await pass(laptop);
    await pass(desktop);
    await pass(laptop);
    expect(await names(laptop)).toEqual(["Kiln cold (conflict copy)", "Kiln warm"]);
    expect(await names(desktop)).toEqual(["Kiln cold (conflict copy)", "Kiln warm"]);

    const l2 = await laptop.repo.loadTheme("t1");
    const d2 = await desktop.repo.loadTheme("t1");
    if (l2?.kind !== "saved" || d2?.kind !== "saved") throw new Error("rows");
    await laptop.repo.deleteTheme({ id: "t1", expectedLocalRevision: l2.localRevision });
    await pass(laptop);
    network.up = false;
    await desktop.repo.saveTheme({ record: record("t1", "Kiln late"), expectedLocalRevision: d2.localRevision });
    await pass(desktop);
    expect(desktop.reports.at(-1)!.phase).toBe("offline");
    network.up = true;
    desktop.sync.wake("online");
    await desktop.sync.idle();
    expect(await desktop.repo.loadTheme("t1")).toMatchObject({ kind: "deleted" });
    expect(await names(desktop)).toEqual(["Kiln cold (conflict copy)", "Kiln late (recovered)"]);
    expect(themes.rows.get("user_a/t1")).toMatchObject({ state: "deleted" });

    // The laptop reads the recovered copy and never brings the deleted id back.
    await pass(laptop);
    expect(await laptop.repo.loadTheme("t1")).toMatchObject({ kind: "deleted" });
    expect(await names(laptop)).toEqual(["Kiln cold (conflict copy)", "Kiln late (recovered)"]);
    expect(themes.rows.get("user_a/t1")).toMatchObject({ state: "deleted" });
    for (const d of [laptop, desktop]) expect(await d.repo.listOutbox()).toEqual([]);
  });

  it("confirms a write whose answer was lost without writing a second revision", async () => {
    const [laptop, desktop] = [await device("user_a", "alice"), await device("user_a", "alice")];

    // Replayed from the receipt: the same key goes out again and the server answers from it.
    await laptop.repo.saveTheme({ record: record("lost1", "Lost once"), expectedLocalRevision: null });
    const before = themes.heads.get("user_a")?.libraryRevision ?? 0;
    network.loseNext = true;
    await pass(laptop);
    expect(laptop.reports.at(-1)!.phase).toBe("offline");
    expect(themes.rows.get("user_a/lost1")).toMatchObject({ state: "live", revision: 1 });
    await pass(laptop);
    const puts = sent.filter((s) => s.method === "PUT" && s.path === "/api/themes/lost1");
    expect(puts).toHaveLength(2);
    expect(puts[1]!.key).toBe(puts[0]!.key);
    expect(puts.map((p) => p.status)).toEqual([200, 200]);
    expect(themes.rows.get("user_a/lost1")).toMatchObject({ state: "live", revision: 1 });
    expect(themes.heads.get("user_a")!.libraryRevision).toBe(before + 1);
    expect(await laptop.repo.listOutbox()).toEqual([]);

    // The receipt gone: the server's copy matches what was sent, so the conflict confirms and no copy is made.
    await laptop.repo.saveTheme({ record: record("lost2", "Lost twice"), expectedLocalRevision: null });
    network.loseNext = true;
    await pass(laptop);
    const first = sent.filter((s) => s.method === "PUT" && s.path === "/api/themes/lost2")[0]!;
    themes.receipts.delete(`user_a/${first.key}`);
    await pass(laptop);
    const puts2 = sent.filter((s) => s.method === "PUT" && s.path === "/api/themes/lost2");
    expect(puts2.map((p) => p.status)).toEqual([200, 409]);
    expect(puts2[1]!.key).toBe(first.key);
    expect(themes.rows.get("user_a/lost2")).toMatchObject({ state: "live", revision: 1 });
    expect(themes.heads.get("user_a")!.libraryRevision).toBe(before + 2);
    expect(await laptop.repo.listOutbox()).toEqual([]);
    const libraryNames = await names(laptop);
    expect(libraryNames.filter((n) => n.startsWith("Lost"))).toEqual(["Lost once", "Lost twice"]);
    expect(laptop.reports.at(-1)!.notices).toEqual([]);

    await pass(desktop);
    expect((await names(desktop)).filter((n) => n.startsWith("Lost"))).toEqual(["Lost once", "Lost twice"]);
  });

  it("keeps another account's library apart", async () => {
    const [mine, theirs] = [await device("user_a", "alice"), await device("user_b", "bob")];
    await mine.repo.saveTheme({ record: record("private", "Private"), expectedLocalRevision: null });
    await pass(mine);
    await pass(theirs);
    expect(await names(theirs)).toEqual([]);
    expect(themes.rows.has("user_b/private")).toBe(false);
    expect(themes.rows.get("user_a/private")).toMatchObject({ state: "live" });
  });

  it("exports the account's live themes and not its deleted ones", async () => {
    const phone = await device("user_c", "carol");
    await phone.repo.saveTheme({ record: record("kept", "Kept"), expectedLocalRevision: null });
    const gone = await phone.repo.saveTheme({ record: record("gone", "Gone"), expectedLocalRevision: null });
    if (!gone.ok) throw new Error("save");
    await pass(phone);
    await phone.repo.deleteTheme({ id: "gone", expectedLocalRevision: gone.value.localRevision });
    await pass(phone);
    expect(themes.rows.get("user_c/gone")).toMatchObject({ state: "deleted" });

    const answer = await fetchImpl("https://runlog.test/api/me/export", {
      method: "POST",
      headers: { authorization: "Bearer carol" },
    });
    expect(answer.status).toBe(200);
    const doc = JSON.parse(exports.at(-1)!) as { account: { id: string }; themes: Array<{ id: string; record: ThemeRecordV1 }> };
    expect(doc.account.id).toBe("user_c");
    expect(doc.themes.map((t) => [t.id, t.record.name])).toEqual([["kept", "Kept"]]);
  });
});
