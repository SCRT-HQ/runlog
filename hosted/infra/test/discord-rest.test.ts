import { describe, expect, it } from "vitest";
import { discordOAuth, guildEntitledFrom } from "../lib/handlers/discord/rest";

/** Discord's store, as the entitlements endpoint answers for one server. */
const answering = (rows: unknown, calls: string[] = []) =>
  (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const SKU = "1234567890123456789";
const GUILD = "1546694567334776912";

describe("a verification on a person's behalf", () => {
  const seen: Array<{ url: string; method: string; headers: Record<string, string>; body: string | null }> = [];
  const discord = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, method: init?.method ?? "GET", headers: (init?.headers as Record<string, string>) ?? {}, body: typeof init?.body === "string" ? init.body : null });
    if (url.endsWith("/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer" }), { status: 200 });
    if (url.endsWith("/users/@me")) return new Response(JSON.stringify({ id: "100000000000000001", username: "mira", global_name: "Mira" }), { status: 200 });
    if (url.includes("/role-connection")) return new Response(JSON.stringify({ platform_name: "Runlog" }), { status: 200 });
    return new Response("", { status: 404 });
  }) as typeof fetch;

  it("trades the code with the secret, asks who they are with their token, and writes the connection", async () => {
    const oauth = discordOAuth("app", "s".repeat(32), discord);
    expect(await oauth.exchange("code1", "https://runlog.test/api/discord/linked-role/callback")).toBe("tok");
    expect(seen[0]).toMatchObject({ url: "https://discord.com/api/v10/oauth2/token", method: "POST" });
    expect(seen[0]!.body).toBe(new URLSearchParams({ client_id: "app", client_secret: "s".repeat(32), grant_type: "authorization_code", code: "code1", redirect_uri: "https://runlog.test/api/discord/linked-role/callback" }).toString());
    expect(await oauth.me("tok")).toEqual({ id: "100000000000000001", name: "Mira" });
    expect(seen[1]).toMatchObject({ url: "https://discord.com/api/v10/users/@me", headers: { authorization: "Bearer tok" } });
    expect(await oauth.pushRoleConnection("tok", { platformUsername: "Mira", metadata: { linked: 1, since: "2026-09-06T12:00:00.000Z" } })).toBe(true);
    expect(seen[2]).toMatchObject({ url: "https://discord.com/api/v10/users/@me/applications/app/role-connection", method: "PUT", headers: { authorization: "Bearer tok" } });
    expect(JSON.parse(seen[2]!.body!)).toEqual({ platform_name: "Runlog", platform_username: "Mira", metadata: { linked: 1, since: "2026-09-06T12:00:00.000Z" } });
  });

  it("answers null, and false, when Discord will not", async () => {
    const down = (async () => new Response("", { status: 401 })) as typeof fetch;
    const oauth = discordOAuth("app", "s".repeat(32), down);
    expect(await oauth.exchange("code1", "https://runlog.test/cb")).toBeNull();
    expect(await oauth.me("tok")).toBeNull();
    expect(await oauth.pushRoleConnection("tok", { platformUsername: "x", metadata: {} })).toBe(false);
  });
});

describe("a server's entitlement through Discord's store", () => {
  it("holds while an entitlement to the SKU is live, and not once it ended, was deleted, or is for something else", async () => {
    expect(await guildEntitledFrom("t", "app", GUILD, SKU, answering([{ sku_id: SKU, ends_at: null }]), NOW)).toBe(true);
    expect(await guildEntitledFrom("t", "app", GUILD, SKU, answering([{ sku_id: SKU, ends_at: "2026-10-01T00:00:00.000Z" }]), NOW)).toBe(true);
    expect(await guildEntitledFrom("t", "app", GUILD, SKU, answering([{ sku_id: SKU, ends_at: "2026-09-01T00:00:00.000Z" }]), NOW)).toBe(false);
    expect(await guildEntitledFrom("t", "app", GUILD, SKU, answering([{ sku_id: SKU, deleted: true }]), NOW)).toBe(false);
    expect(await guildEntitledFrom("t", "app", GUILD, SKU, answering([{ sku_id: "9999999999999999999" }]), NOW)).toBe(false);
    expect(await guildEntitledFrom("t", "app", GUILD, SKU, answering([]), NOW)).toBe(false);
  });

  it("asks for the one server and the one SKU, leaving ended entitlements out, and asks nothing for ids that are not Discord's", async () => {
    const calls: string[] = [];
    await guildEntitledFrom("t", "app", GUILD, SKU, answering([], calls), NOW);
    expect(calls).toEqual([`https://discord.com/api/v10/applications/app/entitlements?guild_id=${GUILD}&sku_ids=${SKU}&exclude_ended=true`]);
    expect(await guildEntitledFrom("t", "app", "g1", SKU, answering([{ sku_id: SKU }], calls), NOW)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("holds nothing when Discord does not answer", async () => {
    const down = (async () => new Response("", { status: 500 })) as typeof fetch;
    expect(await guildEntitledFrom("t", "app", GUILD, SKU, down, NOW)).toBe(false);
  });
});
