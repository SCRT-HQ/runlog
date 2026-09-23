import { describe, expect, it } from "vitest";
import { createApi, SyncError } from "./client.ts";

const answering = (status: number, body: unknown) =>
  createApi(
    "https://runlog.test/api",
    async () => "token",
    async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );

describe("reading the account's claimed servers", () => {
  it("reads a list, with the allowed count defaulting to three for an older server", async () => {
    const guild = { guildId: "g1", name: "The Kiln Room", ownerSub: "A", claimedAt: "", updatedAt: "" };
    expect(await answering(200, { guilds: [guild], server: true, open: true }).myGuilds()).toEqual({
      guilds: [guild],
      server: true,
      open: true,
      allowed: 3,
    });
  });

  it.each([
    ["a refusal", 403, { error: "not yours" }],
    ["a body without a list", 200, {}],
    ["a list that is not a list", 200, { guilds: "none" }],
  ])("fails on %s rather than reporting no servers", async (_label, status, body) => {
    await expect(answering(status, body).myGuilds()).rejects.toBeInstanceOf(SyncError);
  });
});
