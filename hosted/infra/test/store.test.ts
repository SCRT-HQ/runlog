import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dynamoStore } from "../lib/handlers/store";

/**
 * What a session patch actually writes.
 *
 * The store is otherwise reached through the handlers, whose own tests
 * hand them a Map and are therefore no evidence at all about this file:
 * a field the patch type accepts and the real `updateSession` never
 * writes passes every one of them and is simply lost in the account.
 *
 * Which is what happened to `termsGiven`. The record exists so that a
 * tool which drops and reconnects is not handed the runes again; the
 * type carried it, the handler set it, and the Put left it out, so a
 * deployed run gave them away on every reconnection while the suite
 * stayed green.
 */

// Hoisted with the mock, which is hoisted above the import below.
const table = vi.hoisted(() => ({
  sent: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  row: null as Record<string, unknown> | null,
  pages: [] as Array<{ Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }>,
  batches: [] as Array<{ UnprocessedItems?: Record<string, unknown[]> }>,
  /** Answer every batch with all of its items unprocessed. */
  throttled: false,
  buckets: [] as string[],
}));

// The bucket half of account deletion: an empty listing, so a deletion
// test sees only what the table was sent.
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...real,
    S3Client: class {
      readonly middlewareStack = { remove() {}, use() {} };
      readonly config = {};
      async send(c: { constructor: { name: string } }) {
        table.buckets.push(c.constructor.name);
        return {};
      }
    },
  };
});

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
          if (c.kind === "get") return { Item: table.row ?? undefined };
          if (c.kind === "put") table.row = c.input["Item"] as Record<string, unknown>;
          if (c.kind === "query") return table.pages.shift() ?? {};
          if (c.kind === "batch" && table.throttled) return { UnprocessedItems: c.input["RequestItems"] };
          if (c.kind === "batch") return table.batches.shift() ?? {};
          return {};
        },
      }),
    },
    GetCommand: of("get"),
    PutCommand: of("put"),
    QueryCommand: of("query"),
    DeleteCommand: of("delete"),
    BatchWriteCommand: of("batch"),
    UpdateCommand: of("update"),
    TransactWriteCommand: of("transact"),
  };
});

const store = dynamoStore({ table: "t", bucket: "b" });
const put = () => table.sent.filter((s) => s.kind === "put").at(-1)?.input["Item"] as Record<string, unknown> | undefined;

beforeEach(() => {
  table.sent.length = 0;
  table.pages.length = 0;
  table.batches.length = 0;
  table.throttled = false;
  table.buckets.length = 0;
  table.row = { pk: "SESSION#r1", sk: "META", kind: "session", id: "r1", ownerSub: "user_1", seq: 3, updatedAt: "t0" };
});

describe("patching a session", () => {
  it("writes who has had the parts of the terms that are given once", async () => {
    await store.updateSession("r1", "t1", { termsGiven: ["Mira", "the table"] });
    expect(put()?.["termsGiven"]).toEqual(["Mira", "the table"]);
  });

  /** Its own record, because the two are re-sent on different occasions. */
  it("writes the loadout's separately from the terms'", async () => {
    await store.updateSession("r1", "t1", { termsGiven: ["Mira"] });
    await store.updateSession("r1", "t2", { loadoutGiven: ["Kel"] });
    expect(put()?.["termsGiven"]).toEqual(["Mira"]);
    expect(put()?.["loadoutGiven"]).toEqual(["Kel"]);
  });

  /**
   * Nobody was reachable when the loadout went out. That is an empty
   * list, not an absent one: dropped to absent, everyone attached would
   * be handed the gifts a second time on their next attach.
   */
  it("writes an empty record rather than treating it as nothing to say", async () => {
    await store.updateSession("r1", "t1", { loadoutGiven: ["Kel"] });
    await store.updateSession("r1", "t2", { loadoutGiven: [] });
    expect(put()?.["loadoutGiven"]).toEqual([]);
  });

  it("leaves a record alone where the patch says nothing about it", async () => {
    await store.updateSession("r1", "t1", { termsGiven: ["Mira"] });
    await store.updateSession("r1", "t2", { name: "Thursday" });
    expect(put()?.["termsGiven"]).toEqual(["Mira"]);
    expect(put()?.["name"]).toBe("Thursday");
  });

  it("answers with the meta, without the keys that are the table's business", async () => {
    const meta = await store.updateSession("r1", "t1", { termsGiven: ["Mira"] });
    expect(meta?.termsGiven).toEqual(["Mira"]);
    expect((meta as unknown as Record<string, unknown>)["pk"]).toBeUndefined();
  });

  it("answers null for a session that is not there", async () => {
    table.row = null;
    expect(await store.updateSession("gone", "t1", { termsGiven: ["Mira"] })).toBeNull();
  });
});

describe("the account partition beside the themes", () => {
  it("leaves theme rows out of the manifest and follows every page", async () => {
    table.pages.push(
      {
        Items: [{ pk: "USER#u", sk: "LICENSE#p", kind: "license", id: "p", updatedAt: "t", hash: "h" }],
        LastEvaluatedKey: { pk: "USER#u", sk: "LICENSE#p" },
      },
      { Items: [{ pk: "USER#u", sk: "PACK#p", kind: "pack", id: "p", updatedAt: "t", hash: "h" }] },
    );
    const out = await store.manifest("u");
    expect(out.licenses.map((l) => l.id)).toEqual(["p"]);
    expect(out.packs.map((p) => p.id)).toEqual(["p"]);
    const queries = table.sent.filter((s) => s.kind === "query").map((s) => s.input);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatchObject({
      KeyConditionExpression: "pk = :pk AND sk < :themes",
      ExpressionAttributeValues: { ":pk": "USER#u", ":themes": "THEME" },
    });
    expect(queries[1]).toMatchObject({ ExclusiveStartKey: { pk: "USER#u", sk: "LICENSE#p" } });
  });

  it("deletes every row of an account, theme rows and tombstones included, across pages", async () => {
    table.row = null;
    table.pages.push(
      { Items: [] }, // listApiKeys
      { Items: [] }, // listClaims
      { Items: [{ pk: "USER#u", sk: "PACK#p" }], LastEvaluatedKey: { pk: "USER#u", sk: "PACK#p" } },
      {
        Items: [
          { pk: "USER#u", sk: "THEME#t1" },
          { pk: "USER#u", sk: "THEMELIB" },
        ],
      },
    );
    expect(await store.deleteUser("u")).toBe(3);
    expect(batchKeys()).toEqual([["PACK#p", "THEME#t1", "THEMELIB"]]);
    expect(table.buckets).toEqual(["ListObjectsV2Command"]);
  });

  it("resends only what a throttled batch left, then finishes", async () => {
    vi.useFakeTimers();
    table.row = null;
    table.pages.push(
      { Items: [] },
      { Items: [] },
      {
        Items: [
          { pk: "USER#u", sk: "PACK#p" },
          { pk: "USER#u", sk: "THEME#t1" },
          { pk: "USER#u", sk: "THEMELIB" },
        ],
      },
    );
    table.batches.push({ UnprocessedItems: { t: [{ DeleteRequest: { Key: { pk: "USER#u", sk: "THEME#t1" } } }] } }, {});
    const done = store.deleteUser("u");
    await vi.runAllTimersAsync();
    expect(await done).toBe(3);
    expect(batchKeys()).toEqual([["PACK#p", "THEME#t1", "THEMELIB"], ["THEME#t1"]]);
  });

  it("gives up with only a count when a batch never goes through", async () => {
    vi.useFakeTimers();
    table.row = null;
    table.throttled = true;
    table.pages.push(
      { Items: [] },
      { Items: [] },
      {
        Items: [
          { pk: "USER#u", sk: "THEME#t1" },
          { pk: "USER#u", sk: "THEMELIB" },
        ],
      },
    );
    const done = store.deleteUser("u");
    const failed = expect(done).rejects.toThrow("account deletion left 2 rows undeleted; run it again");
    await vi.runAllTimersAsync();
    await failed;
    expect(batchKeys()).toHaveLength(8);
    expect(table.buckets).toEqual([]);
  });
});

const batchKeys = () =>
  table.sent
    .filter((s) => s.kind === "batch")
    .map((s) =>
      (s.input["RequestItems"] as Record<string, Array<{ DeleteRequest: { Key: { sk: string } } }>>)["t"]!.map(
        (b) => b.DeleteRequest.Key.sk,
      ),
    );

afterEach(() => {
  vi.useRealTimers();
});
