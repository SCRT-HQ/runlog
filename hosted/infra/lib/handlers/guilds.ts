import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { traced } from "./xray.js";

/**
 * What the API keeps for Discord: which Runlog account a Discord account
 * is (both ways round), which Runlog account a server belongs to, and the
 * packs that account has put in a server's vault for the bot to play.
 *
 * A Discord account links to one Runlog account and a Runlog account to
 * one Discord account; linking again replaces, on both sides, so a row
 * never points at a person who has moved on. A server belongs to one
 * account too, the one that claims it, and claiming again replaces the
 * owner. Discord's ids are the only things kept of Discord's — no token,
 * no email — and a person's rows go when the account does.
 *
 * The vault is the one place the hosting holds a pack's text for a
 * purpose other than handing it back to the person who sent it: the bot
 * reads it to play, and nobody, the owner included, is ever served it
 * from here. That is the rule the rest of the hosting keeps and this
 * module bends, in one direction, on purpose; hosted/infra/README.md says
 * why.
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

/** A linked-role verification begun from the profile: who began it, until when. Spent by the callback that ends it. */
export interface VerifyState {
  state: string;
  sub: string;
  createdAt: string;
  expiresAt: string;
}

export interface Connection {
  discordUserId: string;
  name: string;
  linkedAt: string;
}

export interface ClaimCode {
  code: string;
  guildId: string;
  /** Who asked, in Discord: someone who could manage the server at the time. */
  discordUserId: string;
  createdAt: string;
  expiresAt: string;
}

export interface Guild {
  guildId: string;
  /** What Discord calls it, when the bot could ask; the id stands in otherwise. */
  name?: string;
  ownerSub: string;
  claimedAt: string;
  updatedAt: string;
  /** The role that may host runs; absent, anyone who can manage the server. */
  hostRoleId?: string;
  /** Where runs open by default; absent, wherever the command was used. */
  channelId?: string;
  /** Where a run's card lives: following the thread as its last message (the default), or pinned at the top and edited in place. Copied onto each run as it starts. */
  cardMode?: CardMode;
}

export type CardMode = "follow" | "pinned";

/** A pack in a server's vault, as the profile lists it: never its text. */
export interface GuildPackMeta {
  id: string;
  title: string;
  version: string;
  format: "yaml" | "json";
  hash: string;
  bytes: number;
  /** The modes the pack offers, by id and label, computed by the app that sent it; the bot lists them without opening the pack. */
  modes: Array<{ id: string; label: string }>;
  updatedAt: string;
  delegatedBy: string;
}

/**
 * A run the bot hosts in a server: which session, whose (the host's
 * Runlog account owns it, like any run), where in Discord it lives, and
 * what the table is waiting on between two presses. The log itself is
 * the session's, in the same rows as any run; this row is what Discord
 * needs beside it.
 */
export interface GuildRun {
  sessionId: string;
  guildId: string;
  hostDiscordId: string;
  hostSub: string;
  hostName: string;
  packId: string;
  channelId: string;
  threadId: string;
  /** The message the buttons are on: the thread's last message, as a rule, since a move posts a fresh card at the bottom. */
  cardMessageId?: string;
  /** Whether that message carries nothing but the card, so retiring it means taking it down rather than stripping it. The opening message carries the live link too. */
  cardBare?: boolean;
  /** The server's choice when the run started: the card follows the thread, or stays pinned and is edited in place. Absent means follow. */
  cardMode?: CardMode;
  /** A block that began and is waiting on an answer: the engine's `Pending`, as plain data. */
  pending?: Record<string, unknown>;
  /** Discord user id → contestant id, for a moderated run's roster. */
  contestants: Record<string, string>;
  /** Seat number → who sits there, in a mode played by several; a seat's holder may press. */
  seats?: Record<string, { discordId: string; name: string }>;
  /** The log's seq the thread has heard up to: the card drawn and the lines posted. A move from the app lands past it. */
  seenSeq?: number;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
}

export interface GuildStore {
  putGuildRun(run: GuildRun): Promise<void>;
  guildRun(sessionId: string): Promise<GuildRun | null>;
  /** The run whose thread this is, for a command typed in it. */
  guildRunByThread(threadId: string): Promise<GuildRun | null>;

  putLinkCode(link: LinkCode): Promise<void>;
  /** The code's row, and the row is gone: a code is spent by being read. Null when missing or past its time. */
  takeLinkCode(code: string, at: string): Promise<LinkCode | null>;
  putVerifyState(state: VerifyState): Promise<void>;
  /** The verification's row, and the row is gone. Null when missing or past its time. */
  takeVerifyState(state: string, at: string): Promise<VerifyState | null>;
  /** Link, replacing whatever either side was linked to before. */
  connect(sub: string, connection: Connection): Promise<void>;
  connection(sub: string): Promise<Connection | null>;
  userForDiscord(discordUserId: string): Promise<string | null>;
  /** True when there was a link to remove. */
  disconnect(sub: string): Promise<boolean>;

  putClaimCode(claim: ClaimCode): Promise<void>;
  takeClaimCode(code: string, at: string): Promise<ClaimCode | null>;
  /** Claim, replacing a previous owner's claim if there was one. */
  claimGuild(guild: Omit<Guild, "updatedAt">): Promise<Guild>;
  guild(guildId: string): Promise<Guild | null>;
  guildsOf(sub: string): Promise<Guild[]>;
  updateGuild(guildId: string, at: string, patch: { name?: string; hostRoleId?: string | null; channelId?: string | null; cardMode?: CardMode | null }): Promise<Guild | null>;
  /** The server's row, its pointer, and every pack in its vault; how many rows went. */
  releaseGuild(guildId: string): Promise<number>;

  putGuildPack(guildId: string, meta: GuildPackMeta, source: string): Promise<void>;
  /** The row alone, so a caller holding a parsed copy can compare hashes before fetching the text. */
  guildPackMeta(guildId: string, packId: string): Promise<GuildPackMeta | null>;
  getGuildPack(guildId: string, packId: string): Promise<{ meta: GuildPackMeta; source: string } | null>;
  listGuildPacks(guildId: string): Promise<GuildPackMeta[]>;
  deleteGuildPack(guildId: string, packId: string): Promise<boolean>;

  /** Everything about this person — links and the servers they own — for the account's deletion; how many rows went. */
  forgetUser(sub: string): Promise<number>;
}

/** Servers one account may claim. Enough for a person with a community or two; not a way to resell. */
export const MAX_GUILDS_PER_SUB = 3;

const toEpoch = (at: string) => Math.floor(new Date(at).getTime() / 1000);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function dynamoGuilds({ table, bucket }: { table: string; bucket: string }): GuildStore {
  const ddb = DynamoDBDocumentClient.from(traced(new DynamoDBClient({})), { marshallOptions: { removeUndefinedValues: true } });
  const s3 = traced(new S3Client({}));
  const linkKey = (code: string) => ({ pk: `DISCORD#LINK#${code}`, sk: "LINK" });
  const claimKey = (code: string) => ({ pk: `DISCORD#CLAIM#${code}`, sk: "CLAIM" });
  const verifyKey = (state: string) => ({ pk: `DISCORD#VERIFY#${state}`, sk: "VERIFY" });
  const userKey = (sub: string) => ({ pk: `USER#${sub}`, sk: "CONNECTION#discord" });
  const discordKey = (id: string) => ({ pk: `DISCORD#${id}`, sk: "USER" });
  const guildKey = (guildId: string) => ({ pk: `GUILD#${guildId}`, sk: "META" });
  const guildPointer = (sub: string, guildId: string) => ({ pk: `USER#${sub}`, sk: `GUILD#${guildId}` });
  const packKey = (guildId: string, packId: string) => ({ pk: `GUILD#${guildId}`, sk: `PACK#${packId}` });
  const runKey = (sessionId: string) => ({ pk: `DISCORD#RUN#${sessionId}`, sk: "RUN" });
  const threadKey = (threadId: string) => ({ pk: `DISCORD#THREAD#${threadId}`, sk: "RUN" });
  /** The server's own list of its runs, so releasing the server or forgetting its owner can sweep them. */
  const runPointer = (guildId: string, sessionId: string) => ({ pk: `GUILD#${guildId}`, sk: `RUN#${sessionId}` });
  const runOf = (item: Record<string, unknown> | undefined): GuildRun | null => {
    if (!item || typeof item["sessionId"] !== "string" || typeof item["guildId"] !== "string") return null;
    const { pk: _pk, sk: _sk, kind: _kind, expiresAt: _ttl, ...rest } = item;
    return { ...(rest as unknown as GuildRun), contestants: typeof item["contestants"] === "object" && item["contestants"] !== null ? (item["contestants"] as Record<string, string>) : {} };
  };
  /** An ended run's Discord rows go a month after it ended; the run itself is the session's, kept as any run is. */
  const RUN_DAYS = 30;
  const deleteRun = async (run: GuildRun) => {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: table, Key: runKey(run.sessionId) } },
          { Delete: { TableName: table, Key: threadKey(run.threadId) } },
          { Delete: { TableName: table, Key: runPointer(run.guildId, run.sessionId) } },
        ],
      }),
    );
  };
  const runsOf = async (guildId: string): Promise<GuildRun[]> => {
    const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)", ExpressionAttributeValues: { ":pk": `GUILD#${guildId}`, ":sk": "RUN#" } }));
    const runs: GuildRun[] = [];
    for (const pointer of out.Items ?? []) {
      const id = str(pointer["sessionId"]);
      const run = id ? runOf((await ddb.send(new GetCommand({ TableName: table, Key: runKey(id) }))).Item) : null;
      if (run) runs.push(run);
    }
    return runs;
  };
  const objectKey = (guildId: string, packId: string, format: string) => `guilds/${guildId}/packs/${packId}.${format}`;

  const guildOf = (item: Record<string, unknown> | undefined): Guild | null => {
    if (!item || typeof item["guildId"] !== "string" || typeof item["ownerSub"] !== "string") return null;
    return {
      guildId: item["guildId"],
      ownerSub: item["ownerSub"],
      claimedAt: str(item["claimedAt"]) ?? "",
      updatedAt: str(item["updatedAt"]) ?? "",
      ...(str(item["name"]) ? { name: item["name"] as string } : {}),
      ...(str(item["hostRoleId"]) ? { hostRoleId: item["hostRoleId"] as string } : {}),
      ...(str(item["channelId"]) ? { channelId: item["channelId"] as string } : {}),
    };
  };
  const packOf = (item: Record<string, unknown> | undefined): GuildPackMeta | null => {
    if (!item || typeof item["id"] !== "string") return null;
    const modes = Array.isArray(item["modes"]) ? (item["modes"] as unknown[]).filter((m): m is { id: string; label: string } => typeof m === "object" && m !== null && typeof (m as { id?: unknown }).id === "string" && typeof (m as { label?: unknown }).label === "string") : [];
    return {
      id: item["id"],
      title: str(item["title"]) ?? item["id"],
      version: str(item["version"]) ?? "",
      format: item["format"] === "json" ? "json" : "yaml",
      hash: str(item["hash"]) ?? "",
      bytes: typeof item["bytes"] === "number" ? item["bytes"] : 0,
      modes,
      updatedAt: str(item["updatedAt"]) ?? "",
      delegatedBy: str(item["delegatedBy"]) ?? "",
    };
  };

  const connectionOf = async (sub: string): Promise<Connection | null> => {
    const out = await ddb.send(new GetCommand({ TableName: table, Key: userKey(sub) }));
    const item = out.Item;
    if (!item || typeof item["discordUserId"] !== "string") return null;
    return { discordUserId: item["discordUserId"], name: str(item["name"]) ?? "", linkedAt: str(item["linkedAt"]) ?? "" };
  };
  const userFor = async (discordUserId: string): Promise<string | null> => {
    const out = await ddb.send(new GetCommand({ TableName: table, Key: discordKey(discordUserId) }));
    return str(out.Item?.["sub"]) ?? null;
  };
  const getGuild = async (guildId: string): Promise<Guild | null> => guildOf((await ddb.send(new GetCommand({ TableName: table, Key: guildKey(guildId) }))).Item);
  const listPacks = async (guildId: string): Promise<GuildPackMeta[]> => {
    const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)", ExpressionAttributeValues: { ":pk": `GUILD#${guildId}`, ":sk": "PACK#" } }));
    return (out.Items ?? []).map(packOf).filter((p): p is GuildPackMeta => p !== null);
  };
  const disconnectRows = async (sub: string): Promise<number> => {
    const had = await connectionOf(sub);
    if (!had) return 0;
    await ddb.send(new TransactWriteCommand({ TransactItems: [{ Delete: { TableName: table, Key: userKey(sub) } }, { Delete: { TableName: table, Key: discordKey(had.discordUserId) } }] }));
    return 2;
  };
  const emptyVault = async (guildId: string): Promise<number> => {
    let rows = 0;
    for (const pack of await listPacks(guildId)) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(guildId, pack.id, pack.format) }));
      await ddb.send(new DeleteCommand({ TableName: table, Key: packKey(guildId, pack.id) }));
      rows += 1;
    }
    return rows;
  };
  const release = async (guildId: string): Promise<number> => {
    const guild = await getGuild(guildId);
    if (!guild) return 0;
    let rows = await emptyVault(guildId);
    for (const run of await runsOf(guildId)) {
      await deleteRun(run);
      rows += 3;
    }
    await ddb.send(new TransactWriteCommand({ TransactItems: [{ Delete: { TableName: table, Key: guildKey(guildId) } }, { Delete: { TableName: table, Key: guildPointer(guild.ownerSub, guildId) } }] }));
    return rows + 2;
  };

  return {
    async putGuildRun(run) {
      const ttl = run.endedAt ? { expiresAt: toEpoch(run.endedAt) + RUN_DAYS * 86400 } : {};
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: table, Item: { ...runKey(run.sessionId), kind: "discord-run", ...run, ...ttl } } },
            { Put: { TableName: table, Item: { ...threadKey(run.threadId), kind: "discord-thread", sessionId: run.sessionId, ...ttl } } },
            { Put: { TableName: table, Item: { ...runPointer(run.guildId, run.sessionId), kind: "discord-runpointer", sessionId: run.sessionId, ...ttl } } },
          ],
        }),
      );
    },
    async guildRun(sessionId) {
      return runOf((await ddb.send(new GetCommand({ TableName: table, Key: runKey(sessionId) }))).Item);
    },
    async guildRunByThread(threadId) {
      const pointer = (await ddb.send(new GetCommand({ TableName: table, Key: threadKey(threadId) }))).Item;
      const sessionId = str(pointer?.["sessionId"]);
      return sessionId ? runOf((await ddb.send(new GetCommand({ TableName: table, Key: runKey(sessionId) }))).Item) : null;
    },
    async putLinkCode(link) {
      await ddb.send(new PutCommand({ TableName: table, Item: { ...linkKey(link.code), kind: "discord-link", ...link, expiresAt: toEpoch(link.expiresAt), expiresAtIso: link.expiresAt } }));
    },
    async takeLinkCode(code, at) {
      const out = await ddb.send(new DeleteCommand({ TableName: table, Key: linkKey(code), ReturnValues: "ALL_OLD" }));
      const item = out.Attributes;
      if (!item || typeof item["discordUserId"] !== "string") return null;
      const expiresAt = str(item["expiresAtIso"]) ?? "";
      if (!expiresAt || expiresAt < at) return null;
      return { code, discordUserId: item["discordUserId"], name: str(item["name"]) ?? "", ...(str(item["guildId"]) ? { guildId: item["guildId"] as string } : {}), createdAt: str(item["createdAt"]) ?? at, expiresAt };
    },
    async putVerifyState(v) {
      await ddb.send(new PutCommand({ TableName: table, Item: { ...verifyKey(v.state), kind: "discord-verify", ...v, expiresAt: toEpoch(v.expiresAt), expiresAtIso: v.expiresAt } }));
    },
    async takeVerifyState(state, at) {
      const out = await ddb.send(new DeleteCommand({ TableName: table, Key: verifyKey(state), ReturnValues: "ALL_OLD" }));
      const item = out.Attributes;
      if (!item || typeof item["sub"] !== "string") return null;
      const expiresAt = str(item["expiresAtIso"]) ?? "";
      if (!expiresAt || expiresAt < at) return null;
      return { state, sub: item["sub"], createdAt: str(item["createdAt"]) ?? at, expiresAt };
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
      return (await disconnectRows(sub)) > 0;
    },

    async putClaimCode(claim) {
      await ddb.send(new PutCommand({ TableName: table, Item: { ...claimKey(claim.code), kind: "discord-claim", ...claim, expiresAt: toEpoch(claim.expiresAt), expiresAtIso: claim.expiresAt } }));
    },
    async takeClaimCode(code, at) {
      const out = await ddb.send(new DeleteCommand({ TableName: table, Key: claimKey(code), ReturnValues: "ALL_OLD" }));
      const item = out.Attributes;
      if (!item || typeof item["guildId"] !== "string" || typeof item["discordUserId"] !== "string") return null;
      const expiresAt = str(item["expiresAtIso"]) ?? "";
      if (!expiresAt || expiresAt < at) return null;
      return { code, guildId: item["guildId"], discordUserId: item["discordUserId"], createdAt: str(item["createdAt"]) ?? at, expiresAt };
    },
    async claimGuild(g) {
      const previous = await getGuild(g.guildId);
      const made: Guild = { ...g, updatedAt: g.claimedAt };
      const items: Array<{ Delete: { TableName: string; Key: Record<string, string> } } | { Put: { TableName: string; Item: Record<string, unknown> } }> = [];
      if (previous && previous.ownerSub !== g.ownerSub) {
        // The vault was the old owner's, from their shelf: it does not
        // change hands with the server. The new owner fills it from theirs.
        await emptyVault(g.guildId);
        items.push({ Delete: { TableName: table, Key: guildPointer(previous.ownerSub, g.guildId) } });
      }
      items.push({ Put: { TableName: table, Item: { ...guildKey(g.guildId), kind: "guild", ...made } } });
      items.push({ Put: { TableName: table, Item: { ...guildPointer(g.ownerSub, g.guildId), kind: "guildpointer", guildId: g.guildId, claimedAt: g.claimedAt } } });
      await ddb.send(new TransactWriteCommand({ TransactItems: items }));
      return made;
    },
    guild: getGuild,
    async guildsOf(sub) {
      const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)", ExpressionAttributeValues: { ":pk": `USER#${sub}`, ":sk": "GUILD#" } }));
      const guilds: Guild[] = [];
      for (const pointer of out.Items ?? []) {
        const id = str(pointer["guildId"]);
        const g = id ? await getGuild(id) : null;
        // A pointer whose server was claimed by someone else since is stale; it is not this person's.
        if (g && g.ownerSub === sub) guilds.push(g);
      }
      return guilds.sort((a, b) => a.claimedAt.localeCompare(b.claimedAt));
    },
    async updateGuild(guildId, at, patch) {
      const sets = ["updatedAt = :at"];
      const removes: string[] = [];
      const values: Record<string, unknown> = { ":at": at };
      if (patch.name !== undefined) {
        sets.push("#name = :name");
        values[":name"] = patch.name;
      }
      for (const field of ["hostRoleId", "channelId", "cardMode"] as const) {
        const v = patch[field];
        if (v === undefined) continue;
        if (v === null) removes.push(field);
        else {
          sets.push(`${field} = :${field}`);
          values[`:${field}`] = v;
        }
      }
      try {
        const out = await ddb.send(
          new UpdateCommand({
            TableName: table,
            Key: guildKey(guildId),
            UpdateExpression: `SET ${sets.join(", ")}${removes.length > 0 ? ` REMOVE ${removes.join(", ")}` : ""}`,
            ConditionExpression: "attribute_exists(pk)",
            ExpressionAttributeValues: values,
            ...(patch.name !== undefined ? { ExpressionAttributeNames: { "#name": "name" } } : {}),
            ReturnValues: "ALL_NEW",
          }),
        );
        return guildOf(out.Attributes);
      } catch (error) {
        if ((error as { name?: string }).name === "ConditionalCheckFailedException") return null;
        throw error;
      }
    },
    releaseGuild: release,

    async putGuildPack(guildId, meta, source) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey(guildId, meta.id, meta.format), Body: source, ContentType: "text/plain; charset=utf-8" }));
      await ddb.send(new PutCommand({ TableName: table, Item: { ...packKey(guildId, meta.id), kind: "guildpack", ...meta } }));
    },
    async guildPackMeta(guildId, packId) {
      return packOf((await ddb.send(new GetCommand({ TableName: table, Key: packKey(guildId, packId) }))).Item);
    },
    async getGuildPack(guildId, packId) {
      const meta = packOf((await ddb.send(new GetCommand({ TableName: table, Key: packKey(guildId, packId) }))).Item);
      if (!meta) return null;
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(guildId, packId, meta.format) }));
      const source = (await out.Body?.transformToString("utf8")) ?? "";
      return { meta, source };
    },
    listGuildPacks: listPacks,
    async deleteGuildPack(guildId, packId) {
      const meta = packOf((await ddb.send(new GetCommand({ TableName: table, Key: packKey(guildId, packId) }))).Item);
      if (!meta) return false;
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(guildId, packId, meta.format) }));
      await ddb.send(new DeleteCommand({ TableName: table, Key: packKey(guildId, packId) }));
      return true;
    },

    async forgetUser(sub) {
      let rows = await disconnectRows(sub);
      const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)", ExpressionAttributeValues: { ":pk": `USER#${sub}`, ":sk": "GUILD#" } }));
      for (const pointer of out.Items ?? []) {
        const id = str(pointer["guildId"]);
        if (!id) continue;
        const g = await getGuild(id);
        if (g && g.ownerSub === sub) rows += await release(id);
        else {
          await ddb.send(new DeleteCommand({ TableName: table, Key: guildPointer(sub, id) }));
          rows += 1;
        }
      }
      return rows;
    },
  };
}
