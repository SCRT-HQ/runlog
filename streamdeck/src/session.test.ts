import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSession, writeSession } from "@runlog/session";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __setSessionDirForTests, bearer, loadSession, normalizeBase, signIn, signOut } from "./session.ts";

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;

function useTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "runlog-deck-session-"));
  __setSessionDirForTests(dir);
  return dir;
}

afterEach(() => {
  __setSessionDirForTests(null);
  vi.unstubAllGlobals();
});

describe("the deck's session", () => {
  it("signs in through the device flow against the deck's own client", async () => {
    useTempDir();
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/auth/deck"))
        return new Response(JSON.stringify({ clientId: "client_deck", issuer: "https://api.workos.com" }));
      if (String(url).includes("/authorize/device"))
        return new Response(
          JSON.stringify({ device_code: "d", user_code: "ABCD-EFGH", verification_uri: "https://x/y", interval: 0, expires_in: 60 }),
        );
      return new Response(
        JSON.stringify({
          access_token: "a." + Buffer.from(JSON.stringify({ exp: 9999999999 })).toString("base64url") + ".s",
          refresh_token: "r",
        }),
      );
    });
    vi.stubGlobal("fetch", fetch);
    const said: string[] = [];
    const s = await signIn(
      { apiBase: "https://api.test" },
      (l) => said.push(l),
      () => {},
    );
    expect(s.clientId).toBe("client_deck");
    expect(said.join("\n")).toContain("ABCD-EFGH");
  });

  it("renews near expiry and saves the rotated refresh token, not just the access token it returns", async () => {
    const dir = useTempDir();
    writeSession(dir, {
      clientId: "client_deck",
      issuer: "https://api.workos.test",
      accessToken: "stale",
      refreshToken: "r1",
      expiresAt: new Date(0).toISOString(),
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: jwt(9999999999), refresh_token: "r2" })));
    vi.stubGlobal("fetch", fetch);

    const token = await bearer({ apiBase: "https://api.test" });

    expect(token).toBe(jwt(9999999999));
    // The proof that matters: a fresh read off disk sees the rotated
    // refresh token, not the one the session started with. WorkOS rotates
    // it on every renewal, so a renewal that is not written back kills
    // the next one.
    expect(readSession(dir)?.refreshToken).toBe("r2");
  });

  it("renews once when two callers ask at the same moment, since the refresh token rotates", async () => {
    const dir = useTempDir();
    writeSession(dir, {
      clientId: "client_deck",
      issuer: "https://api.workos.test",
      accessToken: "stale",
      refreshToken: "r1",
      expiresAt: new Date(0).toISOString(),
    });
    // The second POST would carry the token the first one just spent, and
    // WorkOS refuses that - which is the deck thrown to "Sign in again"
    // for nothing. So this counts the calls, not just the answers.
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: jwt(9999999999), refresh_token: "r2" })));
    vi.stubGlobal("fetch", fetch);

    const [first, second] = await Promise.all([bearer({ apiBase: "https://api.test" }), bearer({ apiBase: "https://api.test" })]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toBe(jwt(9999999999));
    expect(second).toBe(first);
    expect(readSession(dir)?.refreshToken).toBe("r2");
  });

  it("starts a fresh renewal after the shared one settles", async () => {
    const dir = useTempDir();
    writeSession(dir, {
      clientId: "client_deck",
      issuer: "https://api.workos.test",
      accessToken: "stale",
      refreshToken: "r1",
      expiresAt: new Date(0).toISOString(),
    });
    // The token this hands back has already lapsed, so the second ask
    // needs a renewal of its own: the in-flight promise is shared, not
    // cached.
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: jwt(1), refresh_token: "r2" })));
    vi.stubGlobal("fetch", fetch);

    await bearer({ apiBase: "https://api.test" });
    await bearer({ apiBase: "https://api.test" });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("leaves the file alone when a renewal is refused, since a network blip is not a sign-out", async () => {
    const dir = useTempDir();
    writeSession(dir, {
      clientId: "client_deck",
      issuer: "https://api.workos.test",
      accessToken: "stale",
      refreshToken: "r1",
      expiresAt: new Date(0).toISOString(),
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    vi.stubGlobal("fetch", fetch);

    const token = await bearer({ apiBase: "https://api.test" });

    expect(token).toBeNull();
    expect(readSession(dir)?.refreshToken).toBe("r1");
  });

  it("forgets the session on sign-out; bearer then asks to sign in again", async () => {
    const dir = useTempDir();
    writeSession(dir, {
      clientId: "client_deck",
      issuer: "https://api.workos.test",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    signOut();

    expect(loadSession()).toBeNull();
    expect(await bearer({ apiBase: "https://api.test" })).toBeNull();
    expect(readSession(dir)).toBeNull();
  });
});

// A streamer pastes the address out of a browser bar, slash and all, and
// every caller joins a path onto it.
describe("the address a path is joined onto", () => {
  it("loses its trailing slashes and its whitespace", () => {
    expect(normalizeBase("https://runlog.dev.scrthq.com/")).toBe("https://runlog.dev.scrthq.com");
    expect(normalizeBase("  https://runlog.scrthq.com///  ")).toBe("https://runlog.scrthq.com");
  });
  it("leaves an address that is already clean alone", () => {
    expect(normalizeBase("https://runlog.scrthq.com")).toBe("https://runlog.scrthq.com");
    expect(normalizeBase("http://localhost:5173")).toBe("http://localhost:5173");
  });
});
