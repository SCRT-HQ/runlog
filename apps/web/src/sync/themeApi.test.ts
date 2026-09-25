import { afterEach, describe, expect, it, vi } from "vitest";
import { createThemeRecordFromPreset } from "@runlog/themes";
import { LoginRequiredError, NoSessionError, RefreshError, RefreshTimeoutError } from "@workos-inc/authkit-js";
import { createTransport, SyncError } from "./client.ts";
import { createThemeApi } from "./themeApi.ts";

const made = createThemeRecordFromPreset({ id: "t1", name: "Kiln", presetId: "ember" });
if (!made.ok) throw new Error("fixture");
const record = made.value;
const live = { state: "live", id: "t1", revision: 2, updatedAt: "2026-09-23T10:00:00.000Z", record };
const KEY = "8c2f5e0a-1f7e-4c7e-9a51-3d2b1c0f9e8d";

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function apiWith(...answers: Array<Response | Error>) {
  const fetchImpl = vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error("no answer queued");
    if (next instanceof Error) throw next;
    return next;
  });
  return { api: createThemeApi(createTransport("https://runlog.test/api/", async () => "tok", fetchImpl)), fetchImpl };
}

describe("the theme client", () => {
  it("creates with If-None-Match and updates with If-Match, both with the key", async () => {
    const { api, fetchImpl } = apiWith(reply(200, { theme: { ...live, revision: 1 } }), reply(200, { theme: live, replayed: true }));
    expect(await api.putTheme({ record, base: null, key: KEY })).toEqual({ kind: "ok", theme: { ...live, revision: 1 }, replayed: false });
    expect(await api.putTheme({ record, base: 1, key: KEY })).toEqual({ kind: "ok", theme: live, replayed: true });
    const [first, second] = fetchImpl.mock.calls as unknown as [[string, RequestInit], [string, RequestInit]];
    expect(first[0]).toBe("https://runlog.test/api/themes/t1");
    expect(first[1]).toMatchObject({ method: "PUT", headers: expect.objectContaining({ "if-none-match": "*", "idempotency-key": KEY }) });
    expect(second[1].headers).toMatchObject({ "if-match": '"1"' });
    expect(JSON.parse(String(second[1].body))).toEqual({ record });
  });

  it("deletes with If-Match", async () => {
    const { api, fetchImpl } = apiWith(
      reply(200, {
        theme: { state: "deleted", id: "t1", revision: 3, updatedAt: "2026-09-23T10:00:00.000Z", deletedAt: "2026-09-23T10:00:00.000Z" },
      }),
    );
    expect((await api.deleteTheme({ id: "t1", base: 2, key: KEY })).kind).toBe("ok");
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({
      method: "DELETE",
      headers: expect.objectContaining({ "if-match": '"2"' }),
    });
  });

  it("classifies 409, 413, 422, 428 and 429 instead of throwing", async () => {
    const { api } = apiWith(
      reply(409, { theme: live }),
      reply(409, { theme: null }),
      reply(413, { error: "big" }),
      reply(422, { error: "full", code: "library-full", limit: 200 }),
      reply(422, { error: "bad", code: "invalid-theme", issues: [{ path: "$.name", message: "Expected a name" }] }),
      reply(428, { error: "precondition", code: "precondition-required" }),
      reply(429, { code: "rate-limited", retryAfter: 12 }, { "retry-after": "12" }),
    );
    expect(await api.putTheme({ record, base: 1, key: KEY })).toEqual({ kind: "conflict", current: live });
    expect(await api.putTheme({ record, base: 1, key: KEY })).toEqual({ kind: "conflict", current: null });
    expect(await api.putTheme({ record, base: 1, key: KEY })).toEqual({ kind: "too-large" });
    expect(await api.putTheme({ record, base: null, key: KEY })).toEqual({ kind: "library-full", limit: 200 });
    expect(await api.putTheme({ record, base: 1, key: KEY })).toEqual({
      kind: "rejected",
      code: "invalid-theme",
      message: "bad",
      issues: [{ path: "$.name", message: "Expected a name" }],
    });
    expect(await api.putTheme({ record, base: 1, key: KEY })).toMatchObject({ kind: "rejected", code: "precondition-required" });
    expect(await api.putTheme({ record, base: 1, key: KEY })).toEqual({ kind: "rate-limited", retryAfterMs: 12_000 });
  });

  it("reads a key-reused 422 as its own answer, not a refusal", async () => {
    const { api } = apiWith(
      reply(422, { error: "that Idempotency-Key was used for a different change", code: "key-reused" }),
      reply(422, { error: "that Idempotency-Key was used for a different change", code: "key-reused" }),
    );
    expect(await api.putTheme({ record, base: 1, key: KEY })).toEqual({ kind: "key-reused" });
    expect(await api.deleteTheme({ id: "t1", base: 1, key: KEY })).toEqual({ kind: "key-reused" });
  });

  it("treats a busy 503 exactly like a 429: transient, off the status and Retry-After header", async () => {
    const { api, fetchImpl } = apiWith(
      reply(
        503,
        { error: "another change to this library landed at the same moment; send this one again", code: "busy", retryAfter: 1 },
        { "retry-after": "1" },
      ),
      // The header alone, no retryAfter in the body: still keyed off the header, not the body's code.
      reply(503, { code: "busy" }, { "retry-after": "4" }),
    );
    expect(await api.putTheme({ record, base: 1, key: KEY })).toEqual({ kind: "rate-limited", retryAfterMs: 1_000 });
    expect(await api.deleteTheme({ id: "t1", base: 1, key: KEY })).toEqual({ kind: "rate-limited", retryAfterMs: 4_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws offline, unauthorized and error as typed failures", async () => {
    await expect(apiWith(new TypeError("network")).api.putTheme({ record, base: 1, key: KEY })).rejects.toMatchObject({ kind: "offline" });
    await expect(apiWith(reply(401, {}), reply(401, {})).api.putTheme({ record, base: 1, key: KEY })).rejects.toMatchObject({
      kind: "unauthorized",
    });
    await expect(apiWith(reply(500, { error: "down" })).api.putTheme({ record, base: 1, key: KEY })).rejects.toBeInstanceOf(SyncError);
    await expect(
      apiWith(reply(200, { theme: { ...live, owner: "user_1" } })).api.putTheme({ record, base: 1, key: KEY }),
    ).rejects.toMatchObject({ kind: "error" });
  });

  it("lists a page, and an unchanged answer", async () => {
    const { api, fetchImpl } = apiWith(
      reply(200, { libraryRevision: 7, live: 1, limit: 200, unchanged: false, themes: [live], next: "dDE" }),
      reply(200, { libraryRevision: 7, live: 1, limit: 200, unchanged: true }),
    );
    expect(await api.listThemes({ after: "dDA" })).toEqual({
      libraryRevision: 7,
      live: 1,
      limit: 200,
      unchanged: false,
      themes: [live],
      skipped: 0,
      next: "dDE",
    });
    expect(await api.listThemes({ since: 7 })).toEqual({
      libraryRevision: 7,
      live: 1,
      limit: 200,
      unchanged: true,
      themes: [],
      skipped: 0,
      next: null,
    });
    expect((fetchImpl.mock.calls as unknown as Array<[string]>).map(([u]) => u)).toEqual([
      "https://runlog.test/api/themes?after=dDA",
      "https://runlog.test/api/themes?since=7",
    ]);
  });
});

describe("a list page with a theme that does not read", () => {
  it("leaves that theme out, keeps the rest, and counts it", async () => {
    const { api } = apiWith(
      reply(200, {
        libraryRevision: 7,
        live: 2,
        limit: 200,
        unchanged: false,
        themes: [live, { ...live, id: "t2", record: { name: "broken" } }],
        next: null,
      }),
    );
    expect(await api.listThemes({})).toMatchObject({ themes: [live], skipped: 1, libraryRevision: 7 });
  });

  it("adds the rows the server left out to the ones it could not read itself", async () => {
    const page = { libraryRevision: 7, live: 3, limit: 200, unchanged: false, next: null };
    const { api } = apiWith(
      reply(200, { ...page, themes: [live, { ...live, id: "t2", record: { name: "broken" } }], skipped: 2 }),
      reply(200, { ...page, themes: [live], skipped: "many" }),
      reply(200, { ...page, themes: [live] }),
    );
    expect(await api.listThemes({})).toMatchObject({ themes: [live], skipped: 3 });
    expect(await api.listThemes({})).toMatchObject({ themes: [live], skipped: 1 });
    expect(await api.listThemes({})).toMatchObject({ themes: [live], skipped: 0 });
  });
});

describe("the transport's failures", () => {
  const html = (status: number) => new Response("<html>Bad gateway</html>", { status, headers: { "content-type": "text/html" } });
  const transportWith = (getAccessToken: () => Promise<string>, ...answers: Response[]) => {
    const fetchImpl = vi.fn(async () => {
      const next = answers.shift();
      if (!next) throw new Error("no answer queued");
      return next;
    });
    return { send: createTransport("https://runlog.test/api/", getAccessToken, fetchImpl), fetchImpl };
  };
  const token = async () => "tok";

  it.each([502, 504])("reads a gateway's HTML %i as a passing error, not a sign-out", async (status) => {
    const { send } = transportWith(token, html(status), html(status));
    await expect(send("GET", "/themes")).rejects.toMatchObject({ kind: "error" });
  });

  it("keeps a real 401 a sign-out", async () => {
    const { send } = transportWith(token, reply(401, {}), reply(401, {}));
    await expect(send("GET", "/themes")).rejects.toMatchObject({ kind: "unauthorized" });
  });

  describe("when the token cannot be had", () => {
    const online = (value: boolean) => vi.stubGlobal("navigator", { onLine: value });
    afterEach(() => vi.unstubAllGlobals());

    it("is offline when the browser is offline", async () => {
      online(false);
      const { send, fetchImpl } = transportWith(async () => {
        throw new TypeError("Failed to fetch");
      });
      await expect(send("GET", "/themes")).rejects.toMatchObject({ kind: "offline" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("is a sign-out when the session names someone else, online or not", async () => {
      for (const value of [true, false]) {
        online(value);
        const { send } = transportWith(async () => {
          throw new Error("signed out");
        });
        await expect(send("GET", "/themes")).rejects.toMatchObject({ kind: "unauthorized" });
      }
    });

    it.each([
      ["no session", () => new LoginRequiredError()],
      ["no session to sign out", () => new NoSessionError()],
      ["a refresh the server refused", () => new RefreshError("invalid grant", { status: 400, isTransient: false })],
    ])("is a sign-out when the SDK says %s", async (_what, error) => {
      online(true);
      const { send } = transportWith(async () => {
        throw error();
      });
      await expect(send("GET", "/themes")).rejects.toMatchObject({ kind: "unauthorized" });
    });

    it.each([
      ["a network failure", () => new TypeError("Failed to fetch")],
      ["a refresh timeout", () => new RefreshTimeoutError()],
      ["a refresh the server could not answer", () => new RefreshError("busy", { status: 503, isTransient: true })],
      ["any other failure", () => new Error("something else")],
    ])("is a passing error, retried later, on %s while online", async (_what, error) => {
      online(true);
      const { send, fetchImpl } = transportWith(async () => {
        throw error();
      });
      await expect(send("GET", "/themes")).rejects.toMatchObject({ kind: "error" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
