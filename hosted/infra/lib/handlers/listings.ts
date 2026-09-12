import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { traced } from "./xray.js";

/**
 * What publishers list, and what the marketplace shows.
 *
 * A product is a publisher's pack as uploaded: the signed master text in
 * the bucket, the head the app computed from it (title, tags, what it
 * needs, how it plays), the marketplace summary, and a price if it has one.
 * A listing is the public card the marketplace reads: one row per listed
 * pack under a single partition, so the feed is one query. The server
 * parses no pack; the head and the summary are the app's word, sent
 * alongside the text.
 */

export interface ListingHead {
  title: string;
  version: string;
  author?: string;
  description?: string;
  category: string;
  tags: string[];
  features: string[];
  requires: Array<{ label: string; kind: string; optional: boolean }>;
  players: number;
  license: { id: string; redistributable: boolean };
}

export interface Price {
  /** In the currency's smallest unit. */
  amount: number;
  currency: string;
}

export interface Product {
  packId: string;
  orgId: string;
  head: ListingHead;
  /** The marketplace summary, as the app generated it: a Doc, kept as JSON. */
  summary: unknown;
  price?: Price;
  /** On the publisher's connected account. */
  stripeProductId?: string;
  stripePriceId?: string;
  masterKey: string;
  masterBytes: number;
  status: "draft" | "listed";
  createdAt: string;
  updatedAt: string;
}

export interface ListingCard {
  packId: string;
  orgId: string;
  publisherName: string;
  head: ListingHead;
  price: "free" | Price;
  updatedAt: string;
}

export interface ListingStore {
  putProduct(product: Product): Promise<void>;
  getProduct(orgId: string, packId: string): Promise<Product | null>;
  listProducts(orgId: string): Promise<Product[]>;
  deleteProduct(orgId: string, packId: string): Promise<void>;
  putCard(card: ListingCard): Promise<void>;
  getCard(packId: string): Promise<ListingCard | null>;
  deleteCard(packId: string): Promise<void>;
  listCards(): Promise<ListingCard[]>;
  putMaster(orgId: string, packId: string, source: string): Promise<{ key: string; bytes: number }>;
  getMaster(key: string): Promise<string>;
}

export function dynamoListings({ table, bucket }: { table: string; bucket: string }): ListingStore {
  const ddb = DynamoDBDocumentClient.from(traced(new DynamoDBClient({})), { marshallOptions: { removeUndefinedValues: true } });
  const s3 = traced(new S3Client({}));
  const opk = (orgId: string) => `ORG#${orgId}`;
  const CARDS = "LISTINGS";
  const strip = <T>(row: Record<string, unknown>): T => {
    const { pk: _pk, sk: _sk, kind: _kind, ...rest } = row;
    return rest as unknown as T;
  };
  return {
    async putProduct(product) {
      await ddb.send(new PutCommand({ TableName: table, Item: { ...product, summary: JSON.stringify(product.summary), pk: opk(product.orgId), sk: `PRODUCT#${product.packId}`, kind: "product" } }));
    },
    async getProduct(orgId, packId) {
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: opk(orgId), sk: `PRODUCT#${packId}` } }));
      if (!out.Item) return null;
      const p = strip<Product>(out.Item);
      return { ...p, summary: typeof p.summary === "string" ? JSON.parse(p.summary) : p.summary };
    },
    async listProducts(orgId) {
      const out = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)", ExpressionAttributeValues: { ":pk": opk(orgId), ":sk": "PRODUCT#" } }));
      return (out.Items ?? []).map((r) => {
        const p = strip<Product>(r);
        return { ...p, summary: typeof p.summary === "string" ? JSON.parse(p.summary) : p.summary };
      });
    },
    async deleteProduct(orgId, packId) {
      await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: opk(orgId), sk: `PRODUCT#${packId}` } }));
    },
    async putCard(card) {
      await ddb.send(new PutCommand({ TableName: table, Item: { ...card, pk: CARDS, sk: `PACK#${card.packId}`, kind: "listing" } }));
    },
    async getCard(packId) {
      const out = await ddb.send(new GetCommand({ TableName: table, Key: { pk: CARDS, sk: `PACK#${packId}` } }));
      return out.Item ? strip<ListingCard>(out.Item) : null;
    },
    async deleteCard(packId) {
      await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: CARDS, sk: `PACK#${packId}` } }));
    },
    async listCards() {
      const out: ListingCard[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const page = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": CARDS }, ExclusiveStartKey: start }));
        for (const r of page.Items ?? []) out.push(strip<ListingCard>(r));
        start = page.LastEvaluatedKey;
      } while (start);
      return out;
    },
    async putMaster(orgId, packId, source) {
      const key = `orgs/${orgId}/masters/${packId}.yaml`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: source, ContentType: "text/plain; charset=utf-8" }));
      return { key, bytes: Buffer.byteLength(source) };
    },
    async getMaster(key) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return (await out.Body?.transformToString()) ?? "";
    },
  };
}

/** The head as the app sends it, checked for shape; null when it is not one. */
export function headOf(v: unknown): ListingHead | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const s = (x: unknown, max = 200): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
  if (!s(r["title"]) || !s(r["version"], 50) || !s(r["category"], 60)) return null;
  const strs = (x: unknown, max: number) => (Array.isArray(x) ? x.filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 60).slice(0, max) : []);
  const license = r["license"];
  if (!license || typeof license !== "object" || !s((license as Record<string, unknown>)["id"], 40)) return null;
  const requires = Array.isArray(r["requires"])
    ? r["requires"]
        .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
        .map((q) => ({ label: String(q["label"] ?? "").slice(0, 120), kind: String(q["kind"] ?? "other").slice(0, 20), optional: q["optional"] === true }))
        .filter((q) => q.label)
        .slice(0, 30)
    : [];
  const players = Number(r["players"]);
  return {
    title: r["title"],
    version: r["version"],
    ...(s(r["author"], 120) ? { author: r["author"] } : {}),
    ...(s(r["description"], 1000) ? { description: r["description"] } : {}),
    category: r["category"].toLowerCase(),
    tags: strs(r["tags"], 20),
    features: strs(r["features"], 20),
    requires,
    players: Number.isInteger(players) && players > 0 && players < 100 ? players : 1,
    license: { id: (license as Record<string, string>)["id"]!, redistributable: (license as Record<string, unknown>)["redistributable"] === true },
  };
}

/** A price as the publisher asks for it: whole cents, a currency Stripe knows, within reason. */
export function priceOf(v: unknown): Price | "free" | null {
  if (v === undefined || v === null) return "free";
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const amount = r["amount"];
  const currency = typeof r["currency"] === "string" ? r["currency"].toLowerCase() : "usd";
  if (amount === 0 || amount === undefined) return "free";
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 100 || amount > 100_000) return null;
  if (!/^[a-z]{3}$/.test(currency)) return null;
  return { amount, currency };
}
