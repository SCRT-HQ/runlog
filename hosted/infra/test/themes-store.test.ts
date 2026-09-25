import { beforeEach, describe, expect, it, vi } from "vitest";
import { createThemeRecordFromPreset } from "@runlog/themes";
import { dynamoThemes, type ThemeWriteInput } from "../lib/handlers/themes";
import { memoryThemes } from "./memory-themes";

const table = vi.hoisted(() => ({
  sent: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  gets: [] as Array<Record<string, unknown> | undefined>,
  pages: [] as Array<{ Items: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }>,
  cancel: null as null | Array<{ Code: string }>,
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
          if (c.kind === "get") return { Item: table.gets.shift() };
          if (c.kind === "query") return table.pages.shift() ?? { Items: [] };
          if (c.kind === "update") return { Attributes: { n: table.count } };
          if (c.kind === "transact" && table.cancel) {
            const error = Object.assign(new Error("canceled"), {
              name: "TransactionCanceledException",
              CancellationReasons: table.cancel,
            });
            table.cancel = null;
            throw error;
          }
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

const themes = dynamoThemes({ table: "t" });
const AT = "2026-09-23T10:00:30.000Z";
const made = createThemeRecordFromPreset({ id: "t1", name: "Kiln", presetId: "ember" });
if (!made.ok) throw new Error("fixture");
const record = made.value;
const items = () =>
  (table.sent.find((s) => s.kind === "transact")?.input["TransactItems"] ?? []) as Array<Record<string, Record<string, unknown>>>;

beforeEach(() => {
  table.sent.length = 0;
  table.gets.length = 0;
  table.pages.length = 0;
  table.cancel = null;
  table.count = 1;
});

describe("the theme store", () => {
  it("creates in one transaction: the head counted under the cap, the row only if absent, the receipt only once", async () => {
    const out = await themes.write({
      sub: "user_1",
      id: "t1",
      at: AT,
      key: "k".repeat(20),
      fingerprint: "f1",
      expect: { kind: "absent" },
      change: { kind: "put", record },
    });
    expect(out).toEqual({ kind: "written", theme: { state: "live", id: "t1", revision: 1, updatedAt: AT, record } });
    const [head, row, receipt] = items();
    expect(head!["Update"]).toMatchObject({
      Key: { pk: "USER#user_1", sk: "THEMELIB" },
      ConditionExpression: "attribute_not_exists(#live) OR #live < :max",
      ExpressionAttributeValues: expect.objectContaining({ ":max": 200, ":delta": 1 }),
    });
    expect(row!["Put"]).toMatchObject({
      Item: { pk: "USER#user_1", sk: "THEME#t1", kind: "theme", revision: 1, state: "live" },
      ConditionExpression: "attribute_not_exists(pk)",
    });
    expect(row!["Put"]!["Item"]).not.toHaveProperty("expiresAt");
    expect(receipt!["Put"]).toMatchObject({
      Item: { pk: "USER#user_1", sk: `THEMEOP#${"k".repeat(20)}`, fingerprint: "f1", status: 200 },
      ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now",
    });
    expect((receipt!["Put"]!["Item"] as Record<string, unknown>)["expiresAt"]).toBe(Math.floor(Date.parse(AT) / 1000) + 7 * 86400);
  });

  it("updates only from the revision the client edited, and keeps the count", async () => {
    await themes.write({
      sub: "user_1",
      id: "t1",
      at: AT,
      key: "k".repeat(20),
      fingerprint: "f2",
      expect: { kind: "revision", revision: 3 },
      change: { kind: "put", record },
    });
    const [head, row] = items();
    expect(head!["Update"]!["ConditionExpression"]).toBeUndefined();
    expect(head!["Update"]!["ExpressionAttributeValues"]).toMatchObject({ ":delta": 0 });
    expect(row!["Put"]).toMatchObject({
      Item: { revision: 4 },
      ConditionExpression: "#rev = :base AND #state = :live",
      ExpressionAttributeValues: { ":base": 3, ":live": "live" },
    });
  });

  it("deletes into a tombstone that never expires and lowers the count", async () => {
    const out = await themes.write({
      sub: "user_1",
      id: "t1",
      at: AT,
      key: "k".repeat(20),
      fingerprint: "f3",
      expect: { kind: "revision", revision: 4 },
      change: { kind: "delete" },
    });
    expect(out).toEqual({ kind: "written", theme: { state: "deleted", id: "t1", revision: 5, updatedAt: AT, deletedAt: AT } });
    const [head, row] = items();
    expect(head!["Update"]!["ExpressionAttributeValues"]).toMatchObject({ ":delta": -1 });
    expect(row!["Put"]!["Item"]).not.toHaveProperty("record");
    expect(row!["Put"]!["Item"]).not.toHaveProperty("expiresAt");
  });

  it("answers a canceled transaction by which condition failed", async () => {
    const input = {
      sub: "user_1",
      id: "t1",
      at: AT,
      key: "k".repeat(20),
      fingerprint: "f1",
      expect: { kind: "absent" as const },
      change: { kind: "put" as const, record },
    };
    table.cancel = [{ Code: "None" }, { Code: "None" }, { Code: "ConditionalCheckFailed" }];
    table.gets.push({
      pk: "USER#user_1",
      sk: `THEMEOP#${"k".repeat(20)}`,
      fingerprint: "f1",
      status: 200,
      body: '{"theme":{"id":"t1"}}',
      expiresAt: 9e9,
    });
    expect(await themes.write(input)).toEqual({
      kind: "replay",
      receipt: { fingerprint: "f1", status: 200, body: { theme: { id: "t1" } } },
    });
    table.cancel = [{ Code: "None" }, { Code: "ConditionalCheckFailed" }, { Code: "None" }];
    table.gets.push({
      pk: "USER#user_1",
      sk: "THEME#t1",
      kind: "theme",
      state: "deleted",
      id: "t1",
      revision: 2,
      updatedAt: AT,
      deletedAt: AT,
    });
    expect(await themes.write(input)).toEqual({
      kind: "conflict",
      current: { state: "deleted", id: "t1", revision: 2, updatedAt: AT, deletedAt: AT },
    });
    expect(table.sent.at(-1)!.input).toMatchObject({ Key: { pk: "USER#user_1", sk: "THEME#t1" }, ConsistentRead: true });
    table.cancel = [{ Code: "ConditionalCheckFailed" }, { Code: "None" }, { Code: "None" }];
    expect(await themes.write(input)).toEqual({ kind: "full" });
  });

  it("pages theme rows only, fifty at a time, from after an id", async () => {
    table.pages.push({
      Items: [{ pk: "USER#user_1", sk: "THEME#t1", kind: "theme", state: "live", id: "t1", revision: 1, updatedAt: AT, record }],
      LastEvaluatedKey: { pk: "USER#user_1", sk: "THEME#t1" },
    });
    const out = await themes.page("user_1", "t0");
    expect(out).toEqual({ themes: [{ state: "live", id: "t1", revision: 1, updatedAt: AT, record }], next: "t1" });
    expect(table.sent[0]!.input).toMatchObject({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :theme)",
      ExpressionAttributeValues: { ":pk": "USER#user_1", ":theme": "THEME#" },
      Limit: 50,
      ExclusiveStartKey: { pk: "USER#user_1", sk: "THEME#t0" },
      ConsistentRead: true,
    });
  });

  it("leaves out a row that no longer reads, keeps the rest and the next page, and logs a count without its content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = {
      pk: "USER#user_1",
      sk: "THEME#t2",
      kind: "theme",
      state: "live",
      id: "t2",
      revision: 1,
      updatedAt: AT,
      record: { name: "Private Words" },
    };
    table.pages.push({
      Items: [{ pk: "USER#user_1", sk: "THEME#t1", kind: "theme", state: "live", id: "t1", revision: 1, updatedAt: AT, record }, bad],
      LastEvaluatedKey: { pk: "USER#user_1", sk: "THEME#t2" },
    });
    const out = await themes.page("user_1");
    expect(out).toEqual({ themes: [{ state: "live", id: "t1", revision: 1, updatedAt: AT, record }], next: "t2", skipped: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("theme row skipped", { reason: "does-not-read", count: 1 });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Private Words|t2/);
    warn.mockRestore();
  });

  it("reads the head, counts a minute, and ignores an expired receipt", async () => {
    table.gets.push({ libraryRevision: 7, live: 3 });
    expect(await themes.head("user_1")).toEqual({ libraryRevision: 7, live: 3 });
    expect(table.sent.at(-1)!.input).toMatchObject({ Key: { pk: "USER#user_1", sk: "THEMELIB" }, ConsistentRead: true });
    table.gets.push(undefined);
    expect(await themes.head("user_1")).toEqual({ libraryRevision: 0, live: 0 });
    expect(table.sent.at(-1)!.input).toMatchObject({ ConsistentRead: true });
    table.count = 31;
    expect(await themes.countWrite("user_1", AT)).toBe(31);
    expect(table.sent.at(-1)!.input).toMatchObject({ Key: { pk: "USER#user_1", sk: "COUNT#themes#2026-09-23T10:00" } });
    table.gets.push({ fingerprint: "f", status: 200, body: "{}", expiresAt: Math.floor(Date.parse(AT) / 1000) - 1 });
    expect(await themes.receipt("user_1", "k".repeat(20), AT)).toBeNull();
    expect(table.sent.at(-1)!.input).toMatchObject({
      Key: { pk: "USER#user_1", sk: `THEMEOP#${"k".repeat(20)}` },
      ConsistentRead: true,
    });
  });
});

describe("the theme store's keys", () => {
  it("keeps every row of a write, and every read, inside the caller's own partition", async () => {
    await themes.write({
      sub: "user_2",
      id: "t1",
      at: AT,
      key: "k".repeat(20),
      fingerprint: "f1",
      expect: { kind: "absent" },
      change: { kind: "put", record },
    });
    const [head, row, receipt] = items();
    expect([head!["Update"]!["Key"], row!["Put"]!["Item"], receipt!["Put"]!["Item"]]).toEqual([
      expect.objectContaining({ pk: "USER#user_2" }),
      expect.objectContaining({ pk: "USER#user_2" }),
      expect.objectContaining({ pk: "USER#user_2" }),
    ]);
    await themes.page("user_2");
    await themes.head("user_2");
    await themes.receipt("user_2", "k".repeat(20), AT);
    const reads = table.sent.filter((s) => s.kind !== "transact").map((s) => s.input);
    expect(
      reads.map(
        (r) =>
          (r["Key"] as Record<string, unknown> | undefined)?.["pk"] ?? (r["ExpressionAttributeValues"] as Record<string, unknown>)[":pk"],
      ),
    ).toEqual(["USER#user_2", "USER#user_2", "USER#user_2"]);
    expect(reads.every((r) => r["ConsistentRead"] === true)).toBe(true);
  });

  it("follows the pages of a long library to the end", async () => {
    const row = (id: string) => ({
      pk: "USER#user_1",
      sk: `THEME#${id}`,
      kind: "theme",
      state: "deleted",
      id,
      revision: 2,
      updatedAt: AT,
      deletedAt: AT,
    });
    table.pages.push({ Items: [row("a"), row("b")], LastEvaluatedKey: { pk: "USER#user_1", sk: "THEME#b" } }, { Items: [row("c")] });
    const first = await themes.page("user_1");
    expect(first.themes.map((t) => t.id)).toEqual(["a", "b"]);
    expect(first.next).toBe("b");
    const second = await themes.page("user_1", first.next);
    expect(second.themes.map((t) => t.id)).toEqual(["c"]);
    expect(second).not.toHaveProperty("next");
    expect(table.sent[0]!.input).not.toHaveProperty("ExclusiveStartKey");
    expect(table.sent[1]!.input).toMatchObject({ ExclusiveStartKey: { pk: "USER#user_1", sk: "THEME#b" } });
  });
});

describe("the theme store in memory", () => {
  const put = (over: Partial<ThemeWriteInput> = {}): ThemeWriteInput => ({
    sub: "user_1",
    id: "t1",
    at: AT,
    key: "k".repeat(20),
    fingerprint: "f1",
    expect: { kind: "absent" },
    change: { kind: "put", record },
    ...over,
  });

  it("never lets one account read or change another's theme", async () => {
    const mem = memoryThemes();
    await mem.write(put());
    expect(await mem.page("user_2")).toEqual({ themes: [] });
    expect(await mem.head("user_2")).toEqual({ libraryRevision: 0, live: 0 });
    expect(await mem.receipt("user_2", "k".repeat(20), AT)).toBeNull();
    expect(await mem.write(put({ sub: "user_2", key: "m".repeat(20), expect: { kind: "revision", revision: 1 } }))).toEqual({
      kind: "conflict",
      current: null,
    });
    expect((await mem.write(put({ sub: "user_2", key: "m".repeat(20) }))).kind).toBe("written");
    expect((await mem.page("user_1")).themes).toEqual([{ state: "live", id: "t1", revision: 1, updatedAt: AT, record }]);
  });

  it("refuses a write from a revision the theme has moved past", async () => {
    const mem = memoryThemes();
    await mem.write(put());
    await mem.write(put({ key: "a".repeat(20), expect: { kind: "revision", revision: 1 } }));
    const out = await mem.write(put({ key: "b".repeat(20), expect: { kind: "revision", revision: 1 } }));
    expect(out).toEqual({ kind: "conflict", current: { state: "live", id: "t1", revision: 2, updatedAt: AT, record } });
    expect(await mem.write(put({ key: "c".repeat(20) }))).toMatchObject({ kind: "conflict", current: { revision: 2 } });
  });

  it("answers a retry with the same key from the receipt and writes once", async () => {
    const mem = memoryThemes();
    const first = await mem.write(put());
    const again = await mem.write(put());
    expect(again).toEqual({
      kind: "replay",
      receipt: { fingerprint: "f1", status: 200, body: { theme: (first as { theme: unknown }).theme } },
    });
    expect(await mem.head("user_1")).toEqual({ libraryRevision: 1, live: 1 });
  });

  it("refuses a create past the cap and still takes updates and deletes", async () => {
    const mem = memoryThemes(2);
    await mem.write(put({ id: "a", key: "a".repeat(20), change: { kind: "put", record: { ...record, id: "a" } } }));
    await mem.write(put({ id: "b", key: "b".repeat(20), change: { kind: "put", record: { ...record, id: "b" } } }));
    expect(await mem.write(put({ id: "c", key: "c".repeat(20), change: { kind: "put", record: { ...record, id: "c" } } }))).toEqual({
      kind: "full",
    });
    expect(
      (await mem.write(put({ id: "a", key: "d".repeat(20), expect: { kind: "revision", revision: 1 }, change: { kind: "delete" } }))).kind,
    ).toBe("written");
    expect((await mem.write(put({ id: "c", key: "e".repeat(20), change: { kind: "put", record: { ...record, id: "c" } } }))).kind).toBe(
      "written",
    );
    expect(await mem.head("user_1")).toEqual({ libraryRevision: 4, live: 2 });
  });

  it("keeps a tombstone forever and never writes the deleted id live again", async () => {
    const mem = memoryThemes();
    await mem.write(put());
    await mem.write(put({ key: "a".repeat(20), expect: { kind: "revision", revision: 1 }, change: { kind: "delete" } }));
    const tomb = { state: "deleted", id: "t1", revision: 2, updatedAt: AT, deletedAt: AT };
    const later = "2027-09-23T10:00:30.000Z";
    expect(await mem.write(put({ key: "b".repeat(20), at: later }))).toEqual({ kind: "conflict", current: tomb });
    expect(await mem.write(put({ key: "c".repeat(20), at: later, expect: { kind: "revision", revision: 2 } }))).toEqual({
      kind: "conflict",
      current: tomb,
    });
    expect(
      await mem.write(put({ key: "d".repeat(20), at: later, expect: { kind: "revision", revision: 2 }, change: { kind: "delete" } })),
    ).toEqual({ kind: "conflict", current: tomb });
    expect((await mem.page("user_1")).themes).toEqual([tomb]);
  });

  it("pages past fifty themes in id order", async () => {
    const mem = memoryThemes();
    for (let i = 0; i < 60; i += 1) {
      const id = `t${String(i).padStart(2, "0")}`;
      await mem.write(put({ id, key: `${id}${"k".repeat(20)}`, change: { kind: "put", record: { ...record, id } } }));
    }
    const first = await mem.page("user_1");
    expect(first.themes).toHaveLength(50);
    expect(first.next).toBe("t49");
    const second = await mem.page("user_1", first.next);
    expect(second.themes.map((t) => t.id)).toEqual(Array.from({ length: 10 }, (_, i) => `t${50 + i}`));
    expect(second).not.toHaveProperty("next");
  });
});

describe("the theme store's guards", () => {
  it("lets a write take over a receipt only once it has expired", async () => {
    await themes.write({
      sub: "user_1",
      id: "t1",
      at: AT,
      key: "k".repeat(20),
      fingerprint: "f1",
      expect: { kind: "absent" },
      change: { kind: "put", record },
    });
    const receipt = items()[2]!["Put"]!;
    expect(receipt).toMatchObject({
      ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now",
      ExpressionAttributeValues: { ":now": Math.floor(Date.parse(AT) / 1000) },
    });
  });

  it("writes afresh in memory over an expired receipt with the same key", async () => {
    const mem = memoryThemes();
    await mem.write({
      sub: "user_1",
      id: "t1",
      at: AT,
      key: "k".repeat(20),
      fingerprint: "f1",
      expect: { kind: "absent" },
      change: { kind: "put", record },
    });
    const later = "2026-10-23T10:00:30.000Z";
    const out = await mem.write({
      sub: "user_1",
      id: "t1",
      at: later,
      key: "k".repeat(20),
      fingerprint: "f2",
      expect: { kind: "revision", revision: 1 },
      change: { kind: "put", record },
    });
    expect(out).toMatchObject({ kind: "written", theme: { revision: 2 } });
    expect(await mem.receipt("user_1", "k".repeat(20), later)).toMatchObject({ fingerprint: "f2" });
  });

  it.each([
    ["dynamo", () => themes],
    ["memory", () => memoryThemes()],
  ] as const)("refuses an id or key the contract does not allow (%s)", async (_name, make) => {
    const store = make();
    const good = {
      sub: "user_1",
      id: "t1",
      at: AT,
      key: "k".repeat(20),
      fingerprint: "f1",
      expect: { kind: "absent" as const },
      change: { kind: "delete" as const },
    };
    await expect(store.write({ ...good, id: "../x" })).rejects.toThrow();
    await expect(store.write({ ...good, key: "short" })).rejects.toThrow();
    await expect(store.page("user_1", "a#b")).rejects.toThrow();
    await expect(store.receipt("user_1", "no spaces allowed here", AT)).rejects.toThrow();
    expect(table.sent).toEqual([]);
  });
});
