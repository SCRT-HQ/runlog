import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { traced } from "./xray.js";

/**
 * The ledger: every sale of a listed pack, and what was delivered.
 *
 * A sale begins when a buyer is sent to Checkout and is fulfilled when
 * Stripe says it was paid: the master is sealed under a fresh license key
 * for this buyer alone, the file goes to the bucket, a download token is
 * minted for the mail, and a signed-in buyer's account gets the key so it
 * follows them. The publisher reads the ledger, reissues a lost key, or
 * revokes one; nothing here holds a signing key.
 */

export interface Sale {
  ref: string;
  orgId: string;
  packId: string;
  title: string;
  /** Who bought it: an account, an address, or both. */
  buyerSub?: string;
  buyerEmail?: string;
  amount: number;
  currency: string;
  /** The platform's share, in the smallest unit. */
  fee: number;
  status: "pending" | "fulfilled" | "revoked";
  createdAt: string;
  fulfilledAt?: string;
  revokedAt?: string;
  /** The license key issued; kept so it can be reissued. */
  key?: string;
  /** Where the sealed copy is. */
  sealedKey?: string;
  /** The version of the master that copy was sealed from: a master at another version is sealed again on the next fetch. */
  sealedVersion?: string;
  /** SHA-256 of the download token in the mail; the token itself is nowhere. */
  tokenHash?: string;
  stripeAccount: string;
  stripeSessionId?: string;
}

export interface SaleStore {
  putSale(sale: Sale): Promise<void>;
  getSale(ref: string): Promise<Sale | null>;
  /** Newest first. */
  listSales(orgId: string): Promise<Sale[]>;
  /** A buyer's purchases, newest first, by their account. */
  listPurchases(sub: string): Promise<Sale[]>;
  putSealed(orgId: string, ref: string, data: Uint8Array): Promise<string>;
  getSealed(key: string): Promise<Uint8Array>;
}

export function dynamoSales({ table, bucket }: { table: string; bucket: string }): SaleStore {
  const ddb = DynamoDBDocumentClient.from(traced(new DynamoDBClient({})), { marshallOptions: { removeUndefinedValues: true } });
  const s3 = traced(new S3Client({}));
  const strip = (row: Record<string, unknown>): Sale => {
    const { pk: _pk, sk: _sk, kind: _kind, ...rest } = row;
    return rest as unknown as Sale;
  };
  return {
    async putSale(sale) {
      await ddb.send(new PutCommand({ TableName: table, Item: { ...sale, pk: `ORG#${sale.orgId}`, sk: `SALE#${sale.ref}`, kind: "sale" } }));
      await ddb.send(new PutCommand({ TableName: table, Item: { pk: `SALE#${sale.ref}`, sk: "SALE", kind: "salepointer", orgId: sale.orgId } }));
      if (sale.buyerSub) {
        await ddb.send(new PutCommand({ TableName: table, Item: { pk: `USER#${sale.buyerSub}`, sk: `PURCHASE#${sale.ref}`, kind: "purchase", ref: sale.ref, orgId: sale.orgId, createdAt: sale.createdAt } }));
      }
    },
    async getSale(ref) {
      const pointer = await ddb.send(new GetCommand({ TableName: table, Key: { pk: `SALE#${ref}`, sk: "SALE" } }));
      const orgId = pointer.Item?.["orgId"];
      if (typeof orgId !== "string") return null;
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: `ORG#${orgId}`, sk: `SALE#${ref}` } }));
      return out.Item ? strip(out.Item) : null;
    },
    async listSales(orgId) {
      const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)", ExpressionAttributeValues: { ":pk": `ORG#${orgId}`, ":sk": "SALE#" }, ScanIndexForward: false }));
      return (out.Items ?? []).map(strip);
    },
    async listPurchases(sub) {
      const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)", ExpressionAttributeValues: { ":pk": `USER#${sub}`, ":sk": "PURCHASE#" }, ScanIndexForward: false }));
      const sales = await Promise.all((out.Items ?? []).map((r) => this.getSale(String(r["ref"]))));
      return sales.filter((s): s is Sale => s !== null);
    },
    async putSealed(orgId, ref, data) {
      const key = `orgs/${orgId}/sales/${ref}.rlpack`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: "application/octet-stream" }));
      return key;
    },
    async getSealed(key) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return (await out.Body?.transformToByteArray()) ?? new Uint8Array();
    },
  };
}
