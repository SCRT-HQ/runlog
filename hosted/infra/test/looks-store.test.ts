import { beforeEach, describe, expect, it, vi } from "vitest";
import { createThemeRecordFromPreset, presentationSnapshotKey, resolveThemeRecord, type PresentationSnapshotV1 } from "@runlog/themes";
import { dynamoLooks, lookSummary } from "../lib/handlers/looks";
import { memoryLooks } from "./memory-looks";

const table = vi.hoisted(() => ({
  sent: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  gets: [] as Array<Record<string, unknown> | undefined>,
  pages: [] as Array<{ Items: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }>,
  fail: null as null | Error,
  count: 1,
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
          if ((c.kind === "update" || c.kind === "transact") && table.fail) {
            const error = table.fail;
            table.fail = null;
            throw error;
          }
          if (c.kind === "get") return { Item: table.gets.shift() };
          if (c.kind === "query") return table.pages.shift() ?? { Items: [] };
          if (c.kind === "update") return { Attributes: { n: table.count } };
          return {};
        },
      }),
    },
    GetCommand: of("get"),
    PutCommand: of("put"),
    QueryCommand: of("query"),
    DeleteCommand: of("delete"),
    UpdateCommand: of("update"),
    TransactWriteCommand: of("transact"),
  };
});

function snapshotOf(presetId: "ember" | "glaze"): PresentationSnapshotV1 {
  const made = createThemeRecordFromPreset({ id: "fx", name: "Kiln", presetId });
  if (!made.ok) throw new Error("fixture");
  const resolved = resolveThemeRecord(made.value);
  if (!resolved.ok) throw new Error("fixture");
  return resolved.value;
}
const looks = dynamoLooks({ table: "t" });
const AT = "2026-09-25T10:00:30.000Z";
const ID = "lk_AAAAAAAAAAAAAAAA";
const KEY_HASH = "a".repeat(64);
const SECRET_HASH = "b".repeat(64);
const row = (extra: Record<string, unknown> = {}) => ({
  pk: "USER#user_1",
  sk: `LOOK#${ID}`,
  kind: "look",
  sub: "user_1",
  id: ID,
  readKeyHash: KEY_HASH,
  secretHash: SECRET_HASH,
  revision: 2,
  snapshot: presentationSnapshotKey(snapshotOf("ember")),
  createdAt: AT,
  updatedAt: AT,
  publishedAt: AT,
  ...extra,
});
const failed = (name: string, reasons?: Array<{ Code: string }>) =>
  Object.assign(new Error(name), { name, ...(reasons ? { CancellationReasons: reasons } : {}) });
const items = () =>
  (table.sent.find((s) => s.kind === "transact")?.input["TransactItems"] ?? []) as Array<Record<string, Record<string, unknown>>>;

beforeEach(() => {
  table.sent.length = 0;
  table.gets.length = 0;
  table.pages.length = 0;
  table.fail = null;
  table.count = 1;
});

describe("the theme link store", () => {
  it("creates in one transaction: the account's head under the cap, the row, and the read key's pointer", async () => {
    expect(await looks.create({ sub: "user_1", id: ID, readKeyHash: KEY_HASH, secretHash: SECRET_HASH, at: AT })).toBe("created");
    const [head, channel, pointer] = items();
    expect(head!["Update"]).toMatchObject({
      Key: { pk: "USER#user_1", sk: "LOOKLIB" },
      ConditionExpression: "attribute_not_exists(#live) OR #live < :max",
      ExpressionAttributeValues: expect.objectContaining({ ":max": 10, ":one": 1 }),
    });
    expect(channel!["Put"]).toMatchObject({
      Item: { pk: "USER#user_1", sk: `LOOK#${ID}`, kind: "look", readKeyHash: KEY_HASH, secretHash: SECRET_HASH, revision: 0 },
      ConditionExpression: "attribute_not_exists(pk)",
    });
    expect(channel!["Put"]!["Item"]).not.toHaveProperty("expiresAt");
    expect(pointer!["Put"]).toMatchObject({
      Item: { pk: `LOOKKEY#${KEY_HASH}`, sk: "LOOKKEY", kind: "lookkey", sub: "user_1", id: ID },
      ConditionExpression: "attribute_not_exists(pk)",
    });
  });

  it("answers full when the head is at the cap", async () => {
    table.fail = failed("TransactionCanceledException", [{ Code: "ConditionalCheckFailed" }, { Code: "None" }, { Code: "None" }]);
    expect(await looks.create({ sub: "user_1", id: ID, readKeyHash: KEY_HASH, secretHash: SECRET_HASH, at: AT })).toBe("full");
  });

  it("publishes only for the current secret and the revision the device saw", async () => {
    table.count = 3;
    const out = await looks.publish({ sub: "user_1", id: ID, secretHash: SECRET_HASH, base: 2, snapshot: snapshotOf("glaze"), at: AT });
    expect(out).toEqual({ kind: "published", revision: 3 });
    const update = table.sent.find((s) => s.kind === "update")!.input;
    expect(update).toMatchObject({
      Key: { pk: "USER#user_1", sk: `LOOK#${ID}` },
      ConditionExpression: "attribute_exists(pk) AND #secret = :secret AND #rev = :base",
      ExpressionAttributeValues: expect.objectContaining({ ":secret": SECRET_HASH, ":base": 2, ":next": 3 }),
    });
    expect((update["ExpressionAttributeValues"] as Record<string, unknown>)[":snapshot"]).toBe(
      presentationSnapshotKey(snapshotOf("glaze")),
    );
  });

  it("tells a refused publish apart with one consistent read: gone, another device's, or stale", async () => {
    const attempt = () => looks.publish({ sub: "user_1", id: ID, secretHash: SECRET_HASH, base: 1, snapshot: snapshotOf("glaze"), at: AT });
    table.fail = failed("ConditionalCheckFailedException");
    table.gets.push(undefined);
    expect(await attempt()).toEqual({ kind: "gone" });
    table.fail = failed("ConditionalCheckFailedException");
    table.gets.push(row({ secretHash: "c".repeat(64), revision: 1 }));
    // The secret is checked before the revision: an old device naming the right revision is still not the publisher.
    expect(await attempt()).toEqual({ kind: "not-publisher" });
    table.fail = failed("ConditionalCheckFailedException");
    table.gets.push(row({ revision: 5 }));
    expect(await attempt()).toEqual({ kind: "stale", revision: 5 });
    const reads = table.sent.filter((s) => s.kind === "get").map((s) => s.input);
    expect(reads.every((r) => r["ConsistentRead"] === true)).toBe(true);
  });

  it("reads rows, lists and pointers consistently, and never reads another account's partition", async () => {
    table.gets.push(row());
    const got = await looks.get("user_1", ID);
    expect(got).toMatchObject({ sub: "user_1", id: ID, revision: 2, publishedAt: AT });
    expect(presentationSnapshotKey(got!.snapshot!)).toBe(presentationSnapshotKey(snapshotOf("ember")));
    table.gets.push(undefined);
    expect(await looks.get("user_2", ID)).toBeNull();
    table.gets.push({ pk: `LOOKKEY#${KEY_HASH}`, sk: "LOOKKEY", sub: "user_1", id: ID });
    expect(await looks.byReadKey(KEY_HASH)).toEqual({ sub: "user_1", id: ID });
    table.pages.push({ Items: [row()] });
    expect((await looks.list("user_1")).map((r) => r.id)).toEqual([ID]);
    const keys = table.sent.filter((s) => s.kind === "get").map((s) => s.input["Key"]);
    expect(keys).toEqual([
      { pk: "USER#user_1", sk: `LOOK#${ID}` },
      { pk: "USER#user_2", sk: `LOOK#${ID}` },
      { pk: `LOOKKEY#${KEY_HASH}`, sk: "LOOKKEY" },
    ]);
    const query = table.sent.find((s) => s.kind === "query")!.input;
    expect(query).toMatchObject({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :look)",
      ExpressionAttributeValues: { ":pk": "USER#user_1", ":look": "LOOK#" },
      ConsistentRead: true,
    });
    for (const s of table.sent.filter((x) => x.kind === "get")) expect(s.input["ConsistentRead"]).toBe(true);
  });

  it("refuses a stored snapshot that does not read rather than serve it", async () => {
    table.gets.push(row({ snapshot: '{"schemaVersion":1}' }));
    await expect(looks.get("user_1", ID)).rejects.toThrow(/does not read/);
  });

  it("refuses an id or a hash that could reach another row kind", async () => {
    await expect(looks.get("user_1", "THEME#x")).rejects.toThrow();
    await expect(looks.byReadKey("LOOKLIB")).rejects.toThrow();
  });

  it("moves the read key in one transaction: the row, the old pointer out, the new pointer in", async () => {
    table.gets.push(row());
    const out = await looks.relink({ sub: "user_1", id: ID, readKeyHash: "d".repeat(64), at: AT });
    expect(out).toEqual({ oldReadKeyHash: KEY_HASH });
    const [update, gone, fresh] = items();
    expect(update!["Update"]).toMatchObject({
      ConditionExpression: "#key = :old",
      ExpressionAttributeValues: expect.objectContaining({ ":old": KEY_HASH, ":new": "d".repeat(64) }),
    });
    expect(gone!["Delete"]).toMatchObject({ Key: { pk: `LOOKKEY#${KEY_HASH}`, sk: "LOOKKEY" } });
    expect(fresh!["Put"]).toMatchObject({
      Item: { pk: `LOOKKEY#${"d".repeat(64)}`, sub: "user_1", id: ID },
      ConditionExpression: "attribute_not_exists(pk)",
    });
  });

  it("rotates the secret only on a row that exists", async () => {
    expect(await looks.rotateSecret({ sub: "user_1", id: ID, secretHash: "e".repeat(64), at: AT })).toBe(true);
    expect(table.sent.at(-1)!.input).toMatchObject({ ConditionExpression: "attribute_exists(pk)" });
    table.fail = failed("ConditionalCheckFailedException");
    expect(await looks.rotateSecret({ sub: "user_1", id: ID, secretHash: "e".repeat(64), at: AT })).toBe(false);
  });

  it("removes a link with its pointer and gives its place back; removeAll takes every one", async () => {
    table.gets.push(row());
    expect(await looks.remove("user_1", ID)).toBe(true);
    const [channel, pointer, head] = items();
    expect(channel!["Delete"]).toMatchObject({ Key: { pk: "USER#user_1", sk: `LOOK#${ID}` } });
    expect(pointer!["Delete"]).toMatchObject({ Key: { pk: `LOOKKEY#${KEY_HASH}`, sk: "LOOKKEY" } });
    expect(head!["Update"]).toMatchObject({
      Key: { pk: "USER#user_1", sk: "LOOKLIB" },
      ExpressionAttributeValues: expect.objectContaining({ ":minus": -1 }),
    });
    table.sent.length = 0;
    table.pages.push({ Items: [row(), row({ id: "lk_BBBBBBBBBBBBBBBB", sk: "LOOK#lk_BBBBBBBBBBBBBBBB", readKeyHash: "f".repeat(64) })] });
    table.gets.push(row(), row({ id: "lk_BBBBBBBBBBBBBBBB", sk: "LOOK#lk_BBBBBBBBBBBBBBBB", readKeyHash: "f".repeat(64) }));
    expect(await looks.removeAll("user_1")).toEqual([ID, "lk_BBBBBBBBBBBBBBBB"]);
    const deletedPointers = table.sent
      .filter((s) => s.kind === "transact")
      .flatMap((s) => s.input["TransactItems"] as Array<Record<string, Record<string, unknown>>>)
      .map((i) => (i["Delete"]?.["Key"] as { pk?: string } | undefined)?.pk)
      .filter((pk): pk is string => Boolean(pk?.startsWith("LOOKKEY#")));
    expect(deletedPointers).toEqual([`LOOKKEY#${KEY_HASH}`, `LOOKKEY#${"f".repeat(64)}`]);
  });

  it("lists past a 1 MB page", async () => {
    const B = "lk_BBBBBBBBBBBBBBBB";
    table.pages.push({ Items: [row()], LastEvaluatedKey: { pk: "USER#user_1", sk: `LOOK#${ID}` } });
    table.pages.push({ Items: [row({ id: B, sk: `LOOK#${B}`, readKeyHash: "f".repeat(64) })] });
    expect((await looks.list("user_1")).map((r) => r.id)).toEqual([ID, B]);
    const queries = table.sent.filter((s) => s.kind === "query").map((s) => s.input);
    expect(queries[1]).toMatchObject({ ExclusiveStartKey: { pk: "USER#user_1", sk: `LOOK#${ID}` }, ConsistentRead: true });
  });

  it("refuses a stored row whose times are not ISO instants", async () => {
    table.gets.push(row({ updatedAt: "2026-09-25" }));
    await expect(looks.get("user_1", ID)).rejects.toThrow(/does not read/);
    table.gets.push(row({ publishedAt: "yesterday" }));
    await expect(looks.get("user_1", ID)).rejects.toThrow(/does not read/);
    await expect(looks.create({ sub: "user_1", id: ID, readKeyHash: KEY_HASH, secretHash: SECRET_HASH, at: "now" })).rejects.toThrow();
  });

  it("removes every link on account deletion even when one stored look no longer reads", async () => {
    const broken = row({ snapshot: '{"schemaVersion":1}' });
    table.pages.push({ Items: [broken] });
    table.gets.push(broken);
    expect(await looks.removeAll("user_1")).toEqual([ID]);
    const [channel, pointer] = items();
    expect(channel!["Delete"]).toMatchObject({ ConditionExpression: "attribute_exists(pk) AND #key = :key" });
    expect(pointer!["Delete"]).toMatchObject({ Key: { pk: `LOOKKEY#${KEY_HASH}`, sk: "LOOKKEY" } });
  });

  it("counts publishes per link per minute with a short-lived row", async () => {
    table.count = 7;
    expect(await looks.countPublish("user_1", ID, AT)).toBe(7);
    expect(table.sent.at(-1)!.input).toMatchObject({
      Key: { pk: "USER#user_1", sk: `COUNT#look#${ID}#2026-09-25T10:00` },
      ExpressionAttributeValues: expect.objectContaining({ ":one": 1, ":ttl": Math.floor(Date.parse(AT) / 1000) + 120 }),
    });
  });

  it("summarizes a row with no hash in it", () => {
    const summary = lookSummary({
      sub: "user_1",
      id: ID,
      readKeyHash: KEY_HASH,
      secretHash: SECRET_HASH,
      revision: 2,
      snapshot: snapshotOf("ember"),
      createdAt: AT,
      updatedAt: AT,
      publishedAt: AT,
    });
    expect(summary).toEqual({ id: ID, revision: 2, createdAt: AT, updatedAt: AT, publishedAt: AT });
  });
});

describe("the in-memory theme link store the route tests use", () => {
  it("keeps accounts apart and checks the secret before the revision", async () => {
    const mem = memoryLooks();
    await mem.create({ sub: "user_1", id: ID, readKeyHash: KEY_HASH, secretHash: SECRET_HASH, at: AT });
    expect(await mem.get("user_2", ID)).toBeNull();
    expect(await mem.publish({ sub: "user_2", id: ID, secretHash: SECRET_HASH, base: 0, snapshot: snapshotOf("ember"), at: AT })).toEqual({
      kind: "gone",
    });
    expect(
      await mem.publish({ sub: "user_1", id: ID, secretHash: "c".repeat(64), base: 0, snapshot: snapshotOf("ember"), at: AT }),
    ).toEqual({
      kind: "not-publisher",
    });
    expect(await mem.publish({ sub: "user_1", id: ID, secretHash: SECRET_HASH, base: 0, snapshot: snapshotOf("ember"), at: AT })).toEqual({
      kind: "published",
      revision: 1,
    });
    expect(await mem.publish({ sub: "user_1", id: ID, secretHash: SECRET_HASH, base: 0, snapshot: snapshotOf("glaze"), at: AT })).toEqual({
      kind: "stale",
      revision: 1,
    });
    expect(await mem.removeAll("user_1")).toEqual([ID]);
    expect(await mem.byReadKey(KEY_HASH)).toBeNull();
  });

  it("stops at the account's cap", async () => {
    const mem = memoryLooks(1);
    await mem.create({ sub: "user_1", id: ID, readKeyHash: KEY_HASH, secretHash: SECRET_HASH, at: AT });
    expect(
      await mem.create({ sub: "user_1", id: "lk_BBBBBBBBBBBBBBBB", readKeyHash: "f".repeat(64), secretHash: SECRET_HASH, at: AT }),
    ).toBe("full");
  });
});
