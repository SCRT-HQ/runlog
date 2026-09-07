import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Publishers: who lists packs, and where their money goes.
 *
 * A publisher is an organization — in WorkOS, so it can have members and
 * a subscription of its own — with a Stripe connected account that takes
 * the sales directly. What is kept here is small: the organization, who
 * founded it, the connected account and whether Stripe has finished with
 * it. Listings and sales come later and hang under the same key.
 */

export interface Publisher {
  id: string;
  name: string;
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
  /** The Stripe connected account, once payouts have been started. */
  connectAccountId?: string;
  /** Stripe has what it needs: charges are enabled and details are submitted. */
  connectReady: boolean;
}

export interface PublisherStore {
  createPublisher(publisher: Omit<Publisher, "createdAt" | "updatedAt" | "connectReady">, at: string): Promise<Publisher>;
  getPublisher(id: string): Promise<Publisher | null>;
  /** The publisher this person belongs to, if any. One per person for now. */
  publisherOf(sub: string): Promise<Publisher | null>;
  /** The publisher a connected account belongs to, for Stripe's callbacks. */
  publisherForAccount(accountId: string): Promise<string | null>;
  setConnect(id: string, at: string, patch: { connectAccountId?: string; connectReady?: boolean }): Promise<Publisher | null>;
  /** Record a person's membership here, so the API knows them without asking WorkOS each time. */
  addMember(id: string, sub: string, role: "admin" | "member", at: string): Promise<void>;
  removeMember(id: string, sub: string): Promise<void>;
  roleOf(id: string, sub: string): Promise<"admin" | "member" | null>;
}

export function dynamoPublishers({ table }: { table: string }): PublisherStore {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const opk = (id: string) => `ORG#${id}`;
  const strip = (row: Record<string, unknown>): Publisher => {
    const { pk: _pk, sk: _sk, kind: _kind, ...rest } = row;
    const p = rest as unknown as Publisher;
    return { ...p, connectReady: p.connectReady === true };
  };
  return {
    async createPublisher(publisher, at) {
      const row = { ...publisher, pk: opk(publisher.id), sk: "META", kind: "org", createdAt: at, updatedAt: at, connectReady: false };
      await ddb.send(new PutCommand({ TableName: table, Item: row, ConditionExpression: "attribute_not_exists(pk)" }));
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `USER#${publisher.ownerSub}`, sk: `ORG#${publisher.id}`, kind: "orgpointer", id: publisher.id, role: "admin", joinedAt: at } }));
      return strip(row);
    },
    async getPublisher(id) {
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: opk(id), sk: "META" } }));
      return out.Item ? strip(out.Item) : null;
    },
    async publisherOf(sub) {
      const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)", ExpressionAttributeValues: { ":pk": `USER#${sub}`, ":sk": "ORG#" }, Limit: 1 }));
      const id = out.Items?.[0]?.["id"];
      return typeof id === "string" ? this.getPublisher(id) : null;
    },
    async publisherForAccount(accountId) {
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: `CONNECT#${accountId}`, sk: "ORG" } }));
      const id = out.Item?.["orgId"];
      return typeof id === "string" ? id : null;
    },
    async addMember(id, sub, role, at) {
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `USER#${sub}`, sk: `ORG#${id}`, kind: "orgpointer", id, role, joinedAt: at } }));
    },
    async removeMember(id, sub) {
      await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: `USER#${sub}`, sk: `ORG#${id}` } }));
    },
    async roleOf(id, sub) {
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: `USER#${sub}`, sk: `ORG#${id}` } }));
      const role = out.Item?.["role"];
      return role === "admin" || role === "member" ? role : null;
    },
    async setConnect(id, at, patch) {
      const existing = (await ddb.send(new GetCommand({ TableName: table, Key: { pk: opk(id), sk: "META" } }))).Item;
      if (!existing) return null;
      const row = { ...existing, ...patch, updatedAt: at };
      await ddb.send(new PutCommand({ TableName: table, Item: row }));
      if (patch.connectAccountId) {
        await ddb.send(new PutCommand({ TableName: table, Item: { pk: `CONNECT#${patch.connectAccountId}`, sk: "ORG", kind: "connect", orgId: id, createdAt: at } }));
      }
      return strip(row);
    },
  };
}
