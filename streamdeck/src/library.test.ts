import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Reading the account's library on the deck's own bearer.
 *
 * The session is faked so nothing here touches the deck's rotating token,
 * and `fetch` is faked so nothing dials anywhere. What is held is the two
 * routes, the header on them, and what each answer turns into.
 */
const mock = vi.hoisted(() => ({
  token: "tok" as string | null,
  asked: [] as Array<{ url: string; authorization: string | undefined }>,
  answer: (_url: string) => new Response("{}", { status: 200 }),
}));
vi.mock("./session.ts", () => ({
  bearer: async () => mock.token,
  normalizeBase: (s: string) => s.trim().replace(/\/+$/, ""),
}));

vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
  mock.asked.push({ url, authorization: init?.headers?.authorization });
  return mock.answer(url);
});

const { fetchPack, libraryPacks } = await import("./library.ts");

/** The demo pack, which is the pack file the repository has to hand. */
const SOURCE = readFileSync(fileURLToPath(new URL("../../packs/demo/pack.yaml", import.meta.url)), "utf8");

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  mock.token = "tok";
  mock.asked = [];
});

describe("the packs the account holds", () => {
  it("asks the sync manifest with the bearer, and names each pack", async () => {
    mock.answer = () =>
      json({
        packs: [
          { id: "com.example.salt-and-signal", title: "Salt and Signal" },
          { id: "com.example.ember-trail", title: "Ember Trail" },
        ],
        sessions: [],
      });

    expect(await libraryPacks("https://runlog.test/")).toEqual([
      { id: "com.example.ember-trail", title: "Ember Trail" },
      { id: "com.example.salt-and-signal", title: "Salt and Signal" },
    ]);
    expect(mock.asked).toEqual([{ url: "https://runlog.test/api/sync/manifest", authorization: "Bearer tok" }]);
  });

  it("leaves out a pack the account deleted and one it cannot name", async () => {
    mock.answer = () =>
      json({
        packs: [
          { id: "com.example.gone", title: "Gone", deletedAt: "2026-09-15T00:00:00.000Z" },
          { id: "com.example.nameless" },
          { id: "com.example.ember-trail", title: "Ember Trail" },
        ],
      });
    expect((await libraryPacks("https://runlog.test")).map((p) => p.id)).toEqual(["com.example.ember-trail"]);
  });

  it("is no packs at all with nobody signed in, and asks nothing", async () => {
    mock.token = null;
    expect(await libraryPacks("https://runlog.test")).toEqual([]);
    expect(mock.asked).toEqual([]);
  });

  it("is no packs at all when the route refuses", async () => {
    mock.answer = () => new Response("nope", { status: 500 });
    expect(await libraryPacks("https://runlog.test")).toEqual([]);
  });
});

describe("one pack off the account", () => {
  it("parses the source the route answers with", async () => {
    mock.answer = () => json({ found: true, pack: { id: "com.scrthq.runlog.long-kiln", format: "yaml", source: SOURCE } });

    const pack = await fetchPack("https://runlog.test", "com.scrthq.runlog.long-kiln");
    expect(pack?.title).toBe("The Long Kiln");
    expect(Object.keys(pack?.moves ?? {}).length).toBeGreaterThan(0);
    expect(mock.asked[0]!.url).toBe("https://runlog.test/api/packs/com.scrthq.runlog.long-kiln");
  });

  it("is nothing for a pack the account has not synced", async () => {
    mock.answer = () => json({ found: false });
    expect(await fetchPack("https://runlog.test", "com.example.only-here")).toBe(null);
  });

  it("is nothing for a source that will not parse", async () => {
    mock.answer = () => json({ found: true, pack: { format: "yaml", source: "not: a pack" } });
    expect(await fetchPack("https://runlog.test", "com.example.broken")).toBe(null);
  });

  it("escapes an id that would not sit in an address as it is", async () => {
    mock.answer = () => json({ found: false });
    await fetchPack("https://runlog.test", "a b/c");
    expect(mock.asked[0]!.url).toBe("https://runlog.test/api/packs/a%20b%2Fc");
  });
});
