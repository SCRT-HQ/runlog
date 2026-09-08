import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { traced } from "./xray.js";

/**
 * What the API keeps for Discord: the codes `/link` mints, and which
 * Runlog account a Discord account is linked to, both ways round.
 *
 * A Discord account links to one Runlog account and a Runlog account to
 * one Discord account; linking again replaces, on both sides, so a row
 * never points at a person who has moved on. Discord's user id is the
 * only thing kept of Discord's — no token, no email, no avatar — and it
 * goes when the account does. Servers and the runs hosted in them come
 * later and will live here too; the name says so.
 */

export interface LinkCode {
  code: string;
  discordUserId: string;
  /** The name Discord showed, so the profile can say who was linked. */
  name: string;
  /** The server the code was asked for in, if any. */
  guildId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface Connection {
  discordUserId: string;
  name: string;
  linkedAt: string;
}

export interface GuildStore {
  putLinkCode(link: LinkCode): Promise<void>;
  /** The code's row, and the row is gone: a code is spent by being read. Null when missing or past its time. */
  takeLinkCode(code: string, at: string): Promise<LinkCode | null>;
  /** Link, replacing whatever either side was linked to before. */
  connect(sub: string, connection: Connection): Promise<void>;
  connection(sub: string): Promise<Connection | null>;
  userForDiscord(discordUserId: string): Promise<string | null>;
  /** True when there was a link to remove. */
  disconnect(sub: string): Promise<boolean>;
  /** Everything about this person, for the account's deletion; how many rows went. */
  forgetUser(sub: string): Promise<number>;
}

const toEpoch = (at: string) => Math.floor(new Date(at).getTime() / 1000);

export function dynamoGuilds({ table }: { table: string }): GuildStore {
  const ddb = DynamoDBDocumentClient.from(traced(new DynamoDBClient({})), { marshallOptions: { removeUndefinedValues: true } });
  const linkKey = (code: string) => ({ pk: `DISCORD#LINK#${code}`, sk: "LINK" });
  const userKey = (sub: string) => ({ pk: `USER#${sub}`, sk: "CONNECTION#discord" });
  const discordKey = (id: string) => ({ pk: `DISCORD#${id}`, sk: "USER" });

  const connectionOf = async (sub: string): Promise<Connection | null> => {
    const out = await ddb.send(new GetCommand({ TableName: table, Key: userKey(sub) }));
    const item = out.Item;
    if (!item || typeof item["discordUserId"] !== "string") return null;
    return { discordUserId: item["discordUserId"], name: typeof item["name"] === "string" ? item["name"] : "", linkedAt: typeof item["linkedAt"] === "string" ? item["linkedAt"] : "" };
  };
  const userFor = async (discordUserId: string): Promise<string | null> => {
    const out = await ddb.send(new GetCommand({ TableName: table, Key: discordKey(discordUserId) }));
    const sub = out.Item?.["sub"];
    return typeof sub === "string" ? sub : null;
  };

  return {
    async putLinkCode(link) {
      await ddb.send(new PutCommand({ TableName: table, Item: { ...linkKey(link.code), kind: "discord-link", ...link, expiresAt: toEpoch(link.expiresAt), expiresAtIso: link.expiresAt } }));
    },
    async takeLinkCode(code, at) {
      const out = await ddb.send(new DeleteCommand({ TableName: table, Key: linkKey(code), ReturnValues: "ALL_OLD" }));
      const item = out.Attributes;
      if (!item || typeof item["discordUserId"] !== "string") return null;
      const expiresAt = typeof item["expiresAtIso"] === "string" ? item["expiresAtIso"] : "";
      if (!expiresAt || expiresAt < at) return null;
      return {
        code,
        discordUserId: item["discordUserId"],
        name: typeof item["name"] === "string" ? item["name"] : "",
        ...(typeof item["guildId"] === "string" ? { guildId: item["guildId"] } : {}),
        createdAt: typeof item["createdAt"] === "string" ? item["createdAt"] : at,
        expiresAt,
      };
    },
    async connect(sub, c) {
      // Whatever either side pointed at before goes, so no row is left
      // pointing at someone who has moved on: the Discord account's old
      // owner, and this account's old Discord account.
      const [previousOwner, previous] = await Promise.all([userFor(c.discordUserId), connectionOf(sub)]);
      const items: Array<{ Delete: { TableName: string; Key: Record<string, string> } } | { Put: { TableName: string; Item: Record<string, unknown> } }> = [];
      if (previousOwner && previousOwner !== sub) items.push({ Delete: { TableName: table, Key: userKey(previousOwner) } });
      if (previous && previous.discordUserId !== c.discordUserId) items.push({ Delete: { TableName: table, Key: discordKey(previous.discordUserId) } });
      items.push({ Put: { TableName: table, Item: { ...userKey(sub), kind: "connection", ...c } } });
      items.push({ Put: { TableName: table, Item: { ...discordKey(c.discordUserId), kind: "discord-user", sub, linkedAt: c.linkedAt } } });
      await ddb.send(new TransactWriteCommand({ TransactItems: items }));
    },
    connection: connectionOf,
    userForDiscord: userFor,
    async disconnect(sub) {
      const had = await connectionOf(sub);
      if (!had) return false;
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            { Delete: { TableName: table, Key: userKey(sub) } },
            { Delete: { TableName: table, Key: discordKey(had.discordUserId) } },
          ],
        }),
      );
      return true;
    },
    async forgetUser(sub) {
      const had = await connectionOf(sub);
      if (!had) return 0;
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            { Delete: { TableName: table, Key: userKey(sub) } },
            { Delete: { TableName: table, Key: discordKey(had.discordUserId) } },
          ],
        }),
      );
      return 2;
    },
  };
}
