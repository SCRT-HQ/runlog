import { beforeEach, describe, expect, it, vi } from "vitest";
import { dynamoGuilds } from "../lib/handlers/guilds";

// Hoisted with the mock, which is hoisted above the import below.
const table = vi.hoisted(() => ({
  sent: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  row: null as Record<string, unknown> | null,
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
          if (c.kind === "get") return { Item: table.row ?? undefined };
          if (c.kind === "put") table.row = c.input["Item"] as Record<string, unknown>;
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

const guilds = dynamoGuilds({ table: "t", bucket: "b" });
const puts = () => table.sent.filter((s) => s.kind === "put").map((s) => s.input["Item"] as Record<string, unknown>);
const transacts = () =>
  table.sent
    .filter((s) => s.kind === "transact")
    .flatMap((s) => (s.input["TransactItems"] as Array<Record<string, { Item?: Record<string, unknown> }>>) ?? [])
    .flatMap((i) => (i["Put"]?.Item ? [i["Put"]!.Item!] : []));

beforeEach(() => {
  table.sent.length = 0;
  table.row = null;
});

const OPEN = "2026-09-16T10:00:00.000Z";
const party = {
  sessionId: "01RUN",
  guildId: "g1",
  channelId: "chan",
  threadId: "thread_1",
  link: "https://runlog.test/r/01RUN?t=livetok",
  openedBy: "1001",
  openedByName: "Mira",
  openedAt: OPEN,
  updatedAt: OPEN,
};

describe("a party's rows", () => {
  it("writes the party, its thread pointer and the server's pointer in one transaction", async () => {
    await guilds.putParty(party);
    const written = transacts();
    expect(written.map((i) => [i["pk"], i["sk"]])).toEqual([
      ["DISCORD#PARTY#01RUN", "GUILD#g1"],
      ["DISCORD#PARTYTHREAD#thread_1", "PARTY"],
      ["GUILD#g1", "PARTY#01RUN"],
    ]);
    expect(written[0]?.["link"]).toBe("https://runlog.test/r/01RUN?t=livetok");
  });

  it("reads a run's parties off the one partition", async () => {
    await guilds.partiesOf("01RUN");
    const query = table.sent.find((s) => s.kind === "query")?.input as Record<string, unknown>;
    expect((query["ExpressionAttributeValues"] as Record<string, string>)[":pk"]).toBe("DISCORD#PARTY#01RUN");
  });

  it("claims a tick only where none is claimed, and reads a refusal as false rather than throwing", async () => {
    expect(await guilds.claimPartyTick("01RUN", "g1", "2026-09-16T10:00:10.000Z")).toBe(true);
    const update = table.sent.find((s) => s.kind === "update")?.input as Record<string, unknown>;
    expect(update["ConditionExpression"]).toBe("attribute_exists(pk) AND attribute_not_exists(tickAt)");
  });

  it("keeps the live link under its own key, with a time to live", async () => {
    await guilds.putLiveLink("01RUN", "https://runlog.test/r/01RUN?t=livetok", OPEN);
    const row = puts().at(-1)!;
    expect([row["pk"], row["sk"]]).toEqual(["DISCORD#LIVE#01RUN", "LINK"]);
    expect(typeof row["expiresAt"]).toBe("number");
  });

  it("hands back the settings a patch wrote, which a reader used to drop", async () => {
    table.row = {
      pk: "GUILD#g1",
      sk: "META",
      guildId: "g1",
      ownerSub: "user_1",
      claimedAt: OPEN,
      updatedAt: OPEN,
      cardMode: "pinned",
      threadMode: "private",
      watchParties: "packs",
      watchPackIds: ["com.example.kiln"],
    };
    const g = await guilds.guild("g1");
    expect(g?.cardMode).toBe("pinned");
    expect(g?.threadMode).toBe("private");
    expect(g?.watchParties).toBe("packs");
    expect(g?.watchPackIds).toEqual(["com.example.kiln"]);
  });
});
