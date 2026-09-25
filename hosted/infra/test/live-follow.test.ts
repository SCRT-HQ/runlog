import { beforeEach, describe, expect, it, vi } from "vitest";
import { dynamoLive, lookRinger, type Poster } from "../lib/handlers/live";
import { memoryLive } from "./memory-live";

const table = vi.hoisted(() => ({
  sent: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  pages: [] as Array<{ Items: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }>,
}));
vi.mock("@aws-sdk/lib-dynamodb", () => {
  class Cmd {
    constructor(
      readonly input: Record<string, unknown>,
      readonly kind: string,
    ) {}
  }
  const of = (kind: string) =>
    class extends Cmd {
      constructor(input: Record<string, unknown>) {
        super(input, kind);
      }
    };
  return {
    DynamoDBDocumentClient: {
      from: () => ({
        async send(c: Cmd) {
          table.sent.push({ kind: c.kind, input: c.input });
          if (c.kind === "query") return table.pages.shift() ?? { Items: [] };
          return {};
        },
      }),
    },
    PutCommand: of("put"),
    QueryCommand: of("query"),
    DeleteCommand: of("delete"),
  };
});

const AT = "2026-09-25T10:00:00.000Z";
const ID = "lk_AAAAAAAAAAAAAAAA";
beforeEach(() => {
  table.sent.length = 0;
  table.pages.length = 0;
});

describe("a theme link's followers", () => {
  it("keeps a follow as two rows that expire with the connection", async () => {
    await dynamoLive({ table: "t" }).follow("c1", ID, AT);
    const items = table.sent.filter((s) => s.kind === "put").map((s) => s.input["Item"] as Record<string, unknown>);
    const ttl = Math.floor(Date.parse(AT) / 1000) + 2 * 3600;
    expect(items).toEqual([
      { pk: `FOLLOW#${ID}`, sk: "CONN#c1", kind: "follow", followedAt: AT, expiresAt: ttl },
      { pk: "CONN#c1", sk: `FOLLOW#${ID}`, kind: "follow", followedAt: AT, expiresAt: ttl },
    ]);
  });

  it("lists followers that have not expired", async () => {
    const now = Math.floor(Date.now() / 1000);
    table.pages.push({
      Items: [
        { pk: `FOLLOW#${ID}`, sk: "CONN#c1", expiresAt: now + 60 },
        { pk: `FOLLOW#${ID}`, sk: "CONN#c2", expiresAt: now - 60 },
      ],
    });
    expect(await dynamoLive({ table: "t" }).followers(ID)).toEqual(["c1"]);
  });

  it("drops both follow rows when the connection goes", async () => {
    table.pages.push({
      Items: [
        { pk: "CONN#c1", sk: "CONN" },
        { pk: "CONN#c1", sk: `FOLLOW#${ID}` },
      ],
    });
    await dynamoLive({ table: "t" }).disconnect("c1");
    const deleted = table.sent.filter((s) => s.kind === "delete").map((s) => s.input["Key"]);
    expect(deleted).toEqual(
      expect.arrayContaining([
        { pk: "CONN#c1", sk: "CONN" },
        { pk: "CONN#c1", sk: `FOLLOW#${ID}` },
        { pk: `FOLLOW#${ID}`, sk: "CONN#c1" },
      ]),
    );
  });

  it("drops every follow on a link, both rows, across pages", async () => {
    table.pages.push(
      { Items: [{ pk: `FOLLOW#${ID}`, sk: "CONN#c1" }], LastEvaluatedKey: { pk: `FOLLOW#${ID}`, sk: "CONN#c1" } },
      { Items: [{ pk: `FOLLOW#${ID}`, sk: "CONN#c2" }] },
    );
    await dynamoLive({ table: "t" }).unfollowAll(ID);
    const queries = table.sent.filter((s) => s.kind === "query").map((s) => s.input["ExclusiveStartKey"]);
    expect(queries).toEqual([undefined, { pk: `FOLLOW#${ID}`, sk: "CONN#c1" }]);
    const deleted = table.sent.filter((s) => s.kind === "delete").map((s) => s.input["Key"]);
    expect(deleted).toEqual([
      { pk: `FOLLOW#${ID}`, sk: "CONN#c1" },
      { pk: "CONN#c1", sk: `FOLLOW#${ID}` },
      { pk: `FOLLOW#${ID}`, sk: "CONN#c2" },
      { pk: "CONN#c2", sk: `FOLLOW#${ID}` },
    ]);
  });

  it("rings every follower with the revision alone, and cleans up one that is gone", async () => {
    const live = memoryLive();
    await live.connect("c1", "public:run1", AT);
    await live.connect("c2", "public:run1", AT);
    await live.follow("c1", ID, AT);
    await live.follow("c2", ID, AT);
    const posted: Array<[string, string]> = [];
    const poster: Poster = {
      async post(id, data) {
        posted.push([id, data]);
        return id === "c2" ? "gone" : "sent";
      },
    };
    await lookRinger(live, poster)(ID, 4);
    expect(posted).toEqual([
      ["c1", '{"t":"look","revision":4}'],
      ["c2", '{"t":"look","revision":4}'],
    ]);
    expect(await live.followers(ID)).toEqual(["c1"]);
  });

  it("never throws: a failed ring costs a poll, not a publish", async () => {
    const live = memoryLive();
    await live.follow("c1", ID, AT);
    const poster: Poster = {
      async post() {
        throw new Error("gateway down");
      },
    };
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(lookRinger(live, poster)(ID, 1)).resolves.toBeUndefined();
    said.mockRestore();
  });
});
