import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * What the API keeps for billing: which Stripe customer a person is, the
 * reverse of that so a webhook can find the person, the features Stripe
 * says they have, and which webhook events have been handled so a replay
 * does nothing twice. Money itself never comes through here; Stripe holds
 * the cards and the charges, and this holds the receipts.
 */

export interface BillingStore {
  customerOf(sub: string): Promise<string | null>;
  setCustomer(sub: string, customerId: string, at: string): Promise<void>;
  userForCustomer(customerId: string): Promise<string | null>;
  putEntitlements(sub: string, features: string[], at: string): Promise<void>;
  /** The features Stripe last said this person has; none until they have bought anything. */
  entitlements(sub: string): Promise<string[]>;
  /**
   * The feature flags last seen on this person's session, kept so a rule
   * about someone else — the fee on a sale, read for the publisher — can
   * see a flag that only rides in that person's own token.
   */
  putFlags(sub: string, flags: string[], at: string): Promise<void>;
  flags(sub: string): Promise<string[]>;
  /** True the first time an event id is seen; false on a replay. */
  seenWebhook(eventId: string, at: string): Promise<boolean>;
}

const WEBHOOK_DAYS = 7;
const expiresAfter = (at: string, days: number) => Math.floor(new Date(at).getTime() / 1000) + days * 86400;

export function dynamoBilling({ table }: { table: string }): BillingStore {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const upk = (sub: string) => `USER#${sub}`;
  return {
    async customerOf(sub) {
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: upk(sub), sk: "PROFILE" } }));
      const id = out.Item?.["stripeCustomerId"];
      return typeof id === "string" ? id : null;
    },
    async setCustomer(sub, customerId, at) {
      await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { pk: upk(sub), sk: "PROFILE" },
          UpdateExpression: "SET stripeCustomerId = :c, kind = if_not_exists(kind, :k), createdAt = if_not_exists(createdAt, :at), lastSeenAt = if_not_exists(lastSeenAt, :at)",
          ExpressionAttributeValues: { ":c": customerId, ":k": "profile", ":at": at },
        }),
      );
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `CUSTOMER#${customerId}`, sk: "USER", kind: "customer", sub, createdAt: at } }));
    },
    async userForCustomer(customerId) {
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: `CUSTOMER#${customerId}`, sk: "USER" } }));
      const sub = out.Item?.["sub"];
      return typeof sub === "string" ? sub : null;
    },
    async putEntitlements(sub, features, at) {
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: upk(sub), sk: "ENTITLEMENTS", kind: "entitlements", features, updatedAt: at } }));
    },
    async entitlements(sub) {
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: upk(sub), sk: "ENTITLEMENTS" } }));
      const features = out.Item?.["features"];
      return Array.isArray(features) ? features.filter((f): f is string => typeof f === "string") : [];
    },
    async putFlags(sub, flags, at) {
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: upk(sub), sk: "FLAGS", kind: "flags", flags, updatedAt: at } }));
    },
    async flags(sub) {
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: upk(sub), sk: "FLAGS" } }));
      const flags = out.Item?.["flags"];
      return Array.isArray(flags) ? flags.filter((f): f is string => typeof f === "string") : [];
    },
    async seenWebhook(eventId, at) {
      try {
        await ddb.send(
          new PutCommand({
            TableName: table,
            Item: { pk: `WEBHOOK#${eventId}`, sk: "SEEN", kind: "webhook", at, expiresAt: expiresAfter(at, WEBHOOK_DAYS) },
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        );
        return true;
      } catch (error) {
        if ((error as { name?: string }).name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },
  };
}
