import { describe, expect, it } from "vitest";
import { guildEntitledFrom } from "../lib/handlers/discord/rest";

/** Discord's store, as the entitlements endpoint answers for one server. */
const answering = (rows: unknown, calls: string[] = []) =>
  (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const SKU = "1234567890123456789";
const GUILD = "1546694567334776912";

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
