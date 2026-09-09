import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { hashToken, verify as verifyToken, type Caller } from "./auth.js";
import { dynamoStore, PACK_ORIGINS, shownName, type ApiKey, type LicenseMeta, type Reaction, type PackMeta, type PackOrigin, type Role, type SessionMember, type SessionMeta, type Store } from "./store.js";
import { sesMailer, type Mailer } from "./email.js";
import { fingerprintOf, verifyProof } from "./proof.js";
import { apiGatewayPoster, dynamoLive, notifier, type Notify } from "./live.js";
import { dynamoRaces, newCode, normalizeCode, CODE_LENGTH, type RaceProgress, type RaceStore } from "./races.js";
import { dynamoBilling, type BillingStore } from "./billing.js";
import { looksLike, secretsReader } from "./secrets.js";
import { dynamoGuilds, MAX_GUILDS_PER_SUB, type GuildStore } from "./guilds.js";
import { handleInteraction } from "./discord/interactions.js";
import { discordRest, guildNameFrom, type DiscordRest } from "./discord/rest.js";
import { ulid } from "./ids.js";
import { isInteraction } from "./discord/types.js";
import { verifyInteraction } from "./discord/verify.js";
import { featuresOfSummary, realStripe, type StripeLike } from "./stripe.js";
import { dynamoPublishers, type PublisherStore } from "./publishers.js";
import { realWorkOS, type WorkOSLike } from "./workos.js";
import { dynamoListings, headOf, priceOf, type ListingCard, type ListingStore, type Product } from "./listings.js";
import { dynamoSales, type Sale, type SaleStore } from "./sales.js";
import { generateLicenseKey, seal } from "./container.js";
import { annotate } from "./xray.js";
import YAML from "yaml";
import { randomUUID } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";

/** The longest name or email the profile row will hold. */
const MAX_SNAPSHOT_CHARS = 320;

/**
 * The API, such as it is.
 *
 * It exists for one thing: a signed-in player's sessions, the packs they
 * choose, and the license keys they have typed, on every device they use.
 * A session may have several people in it; everything else is the caller's
 * own, and nothing is stored for anyone who has not signed in.
 *
 * Two conventions matter more than the routes. Every request is checked
 * first, and a bad or missing token is a 401 — never a 403. Nothing here
 * answers 404 either: unknown routes are 410, a missing item is a 200 that
 * says so. CloudFront serves this API under the same domain as the app and
 * rewrites every 403 and 404 into the app's index page, so those two codes
 * would arrive as HTML with a 200 on the front. The client is written to
 * survive that anyway, but the API should not need surviving.
 */

const MAX_BYTES = 5 * 1024 * 1024;
/** More events than any move makes; a batch beyond this is not a move. */
const MAX_EVENTS = 500;
const MAX_NAME = 200;
/** A command-line key: the prefix says what it is at a glance, the rest is 32 random bytes. */
const KEY_PREFIX = "rl_";

/** What a watcher may send back: a few emoji, nothing typed. */
const REACTIONS = new Set(["👏", "🔥", "😮", "😂", "💀", "❤️"]);

/**
 * The metrics document a stream plugin reads: the owner's snapshot with
 * its log left out and its clocks stamped, so a plugin can tick them
 * from `at` without knowing the pack. The shape is the snapshot's own
 * (`v: 1`), which the app's widgets draw, so a plugin draws what a
 * widget would. Nothing here is the pack's text; a snapshot never
 * carries it.
 */
export function metricsOf(
  run: { id: string; packId: string; packTitle: string | null; name: string | null; endedAt: string | null },
  snap: { at: string; snapshot: unknown } | null,
  serverAt: string,
): Record<string, unknown> {
  const s = isRecord(snap?.snapshot) ? snap.snapshot : null;
  if (!s) return { ready: false, run, serverAt };
  const { log: _log, ...rest } = s;
  return { ready: true, run, serverAt, at: snap!.at, ...rest };
}

/**
 * What a release-scoped key may reach: who it is, its claims (signing
 * refuses an unclaimed key), its own library's packs, and the publisher's
 * packs and listings. Nothing that reads play, moves money, or changes who
 * is at the table.
 */
function releaseMayReach(method: string, path: string): boolean {
  if (method === "GET" && (path === "/api/me" || path === "/api/claims" || path === "/api/publishers/me" || path === "/api/publishers/packs")) return true;
  if (method === "POST" && path === "/api/claims/nonce") return true;
  if (path.startsWith("/api/packs/")) return method === "PUT" || method === "GET";
  if (/^\/api\/publishers\/packs\/[^/]+$/.test(path)) return method === "PUT" || method === "GET";
  if (/^\/api\/publishers\/packs\/[^/]+\/listing$/.test(path)) return method === "POST";
  return false;
}
const MAX_KEYS = 20;
const hashKey = (value: string) => createHash("sha256").update(value).digest("hex");

/** Invitations one person may send in an hour. Generous for a table, mean for a spammer. */
const MAX_INVITES_PER_HOUR = 20;
const INVITE_DAYS = 7;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An address with its middle hidden: enough to recognise, not enough to copy. */
function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  const shown = user.slice(0, 1);
  return `${shown}${"*".repeat(Math.max(2, user.length - 1))}@${domain}`;
}
/** A license key is typed from a receipt; nothing that long is one. */
const MAX_KEY_CHARS = 200;
const ROUTE_GONE = "no such route";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A page for a link that gets pasted: the run's name for the preview a
 * chat draws, and a refresh that sends a browser on to the app. No script,
 * since the edge's policy allows none inline; nothing of the run but its
 * name and its pack's title, and those only with the token.
 */
function livePage(input: { appUrl: string; id: string; token: string; title: string | null; pack: string | null } | { appUrl: string; closed: true }): Result {
  const home = input.appUrl.replace(/\/$/, "");
  const body =
    "closed" in input
      ? `<h1>Not open</h1><p>This link is not open any more, or never was. Ask whoever sent it for a fresh one, or <a href="${esc(home)}/">open Runlog</a>.</p>`
      : (() => {
          const name = input.title ?? (input.pack ? `A ${input.pack} run` : "A run");
          const target = `${home}/#run/${encodeURIComponent(input.id)}?t=${encodeURIComponent(input.token)}`;
          const description = `Watch ${input.pack ?? "this run"} as it happens, live on Runlog.`;
          return `<meta http-equiv="refresh" content="0; url=${esc(target)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Runlog">
<meta property="og:title" content="${esc(name)} · live">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(`${home}/r/${encodeURIComponent(input.id)}?t=${encodeURIComponent(input.token)}`)}">
<meta property="og:image" content="${esc(home)}/og.png">
<meta name="twitter:card" content="summary_large_image">
<h1>${esc(name)}</h1><p>${esc(description)} <a href="${esc(target)}">Open it</a>.</p>`;
        })();
  const title = "closed" in input ? "Not open · Runlog" : `${esc(input.title ?? input.pack ?? "A run")} · live on Runlog`;
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    body: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body>${body}</body></html>
`,
  };
}

/** What the app's beacon says: a screen's family, the app's version, and the country the edge saw. */
export interface View {
  screen: string;
  version: string;
  country: string;
}

/** The screens the beacon may name: families, never an id. Mirrors apps/web/src/hosted/beacon.ts. */
const SCREENS = ["welcome", "library", "play", "rules", "catalog", "guide", "design", "profile", "live", "widget"] as const;

export interface Deps {
  store: Store;
  /** Where a counted view goes: a metric in production, a list in a test. Absent, nothing is counted. */
  count?: (view: View) => void;
  races: RaceStore;
  billing: BillingStore;
  publishers: PublisherStore;
  listings: ListingStore;
  sales: SaleStore;
  /** The Connect webhook endpoint's signing secret, when filled. */
  connectWebhookSecret?: () => Promise<string | null>;
  /** The platform's share of a sale, in basis points, by whether the publisher subscribes to hosted licensing. */
  fees?: { subscribed: number; unsubscribed: number };
  /** Sale references and download tokens are random by default; a test hands in its own. */
  ref?: () => string;
  /** WorkOS, when the environment's key is filled; without it a publisher is a row here and no organization there. */
  workos?: () => Promise<WorkOSLike | null>;
  /** Whether plans gate anything; surfaced to the app as `gates`. */
  gates: boolean;
  /** The prices for sale, by plan key; an absent key is a plan that cannot be bought here. */
  prices?: Record<string, string>;
  /** What Stripe calls the features the gates read. */
  features?: { plus: string; hostedLicensing: string; server?: string };
  /** Stripe, when the environment's key is filled; null means billing is off. */
  stripe?: () => Promise<StripeLike | null>;
  /** The webhook endpoint's signing secret, when filled. */
  webhookSecret?: () => Promise<string | null>;
  verify: (authorization: string | undefined) => Promise<Caller>;
  env: string;
  /** The WorkOS client the command line signs in with; public, handed to `runlog login`. */
  cliClientId?: string;
  now?: () => string;
  mailer?: Mailer;
  /** Where the app is, for the links in mail. */
  appUrl?: string;
  /** Tokens are random by default; a test hands in its own. */
  token?: () => string;
  /** Tell the sockets watching a session that it changed. Absent where there is no live push. */
  notify?: Notify;
  /** Discord's rows: link codes and which account a Discord account is. Absent, nothing about Discord is offered. */
  guilds?: GuildStore;
  /**
   * The Discord application the bot is, when the stage names one; the token
   * is read when first needed. `guildName` asks Discord what a server is
   * called, for the profile; absent, or answering null, the id stands in.
   */
  discord?: {
    applicationId: string;
    publicKey: string;
    token: () => Promise<string | null>;
    guildName?: (guildId: string) => Promise<string | null>;
    /** Whether the server plan is on sale; off, the app shows it as coming and only a `server` flag or grant holds it. */
    open?: boolean;
    /** Discord itself, for the thread and the messages of a hosted run; null until the token is filled. */
    rest?: () => Promise<DiscordRest | null>;
  };
  /** Link codes are random by default; a test hands in its own. */
  code?: () => string;
  /** Event and run ids are ULIDs by default; a test hands in its own. */
  mintId?: () => string;
}

type Result = APIGatewayProxyResultV2;

function json(status: number, body: unknown): Result {
  return {
    statusCode: status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

/**
 * A table's members as they are shown now.
 *
 * A seat keeps the name it was taken with, and a new name goes round the
 * tables when it is chosen; but a seat taken before there was a name to
 * choose kept the full one, and stayed that way. The profiles are the
 * truth, so a table is read against them: what it shows is what each
 * person is shown as today, first name and all.
 */
async function asShownNow(store: Store, members: SessionMember[]): Promise<SessionMember[]> {
  return Promise.all(
    members.map(async (m) => {
      const profile = await store.getProfile(m.sub).catch(() => null);
      const name = profile ? shownName(profile) : undefined;
      return name ? { ...m, name } : m;
    }),
  );
}

function header(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const headers = event.headers ?? {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function parse(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";

export async function route(event: APIGatewayProxyEventV2, deps: Deps): Promise<Result> {
  const now = deps.now ?? (() => new Date().toISOString());

  const method = event.requestContext.http.method.toUpperCase();
  const path = event.rawPath.replace(/\/+$/, "");
  // What a trace can be filtered by: the shape of the request, never its
  // contents — no body, no token, no email belongs in an annotation.
  annotate({ method, route: path });
  const { store } = deps;
  const newRef = deps.ref ?? (() => randomBytes(10).toString("base64url").replace(/[-_]/g, "x").toUpperCase());

  /**
   * A paid sale, delivered: the master sealed under a fresh key for this
   * buyer alone, the file kept, a token minted for the mail, and — for a
   * buyer with an account — the key filed where sync will carry it.
   */
  async function fulfil(sale: Sale, from: { email?: string; sessionId?: string }): Promise<Sale> {
    const product = await deps.listings.getProduct(sale.orgId, sale.packId);
    if (!product) throw new Error(`sale ${sale.ref}: its pack is gone`);
    const master = await deps.listings.getMaster(product.masterKey);
    const document = product.masterKey.endsWith(".json") ? (JSON.parse(master) as unknown) : (YAML.parse(master) as unknown);
    const key = generateLicenseKey();
    const sealed = await seal(document, key, { ref: sale.ref, title: sale.title });
    const sealedKey = await deps.sales.putSealed(sale.orgId, sale.ref, sealed);
    const token = newRef() + newRef();
    const at = now();
    const fulfilled: Sale = {
      ...sale,
      ...(from.email ? { buyerEmail: from.email } : {}),
      ...(from.sessionId ? { stripeSessionId: from.sessionId } : {}),
      status: "fulfilled",
      fulfilledAt: at,
      key,
      sealedKey,
      sealedVersion: product.head.version,
      tokenHash: hashKey(token),
    };
    await deps.sales.putSale(fulfilled);
    if (fulfilled.buyerSub) {
      await store.putLicense(fulfilled.buyerSub, { id: sale.packId, updatedAt: at, hash: "", ref: sale.ref, title: sale.title }, key);
    }
    if (deps.mailer && fulfilled.buyerEmail) {
      const publisher = await deps.publishers.getPublisher(sale.orgId);
      const link = `${(deps.appUrl ?? "/").replace(/\/$/, "")}/?purchase=${encodeURIComponent(sale.ref)}&t=${encodeURIComponent(token)}`;
      await deps.mailer.purchase(fulfilled.buyerEmail, { pack: sale.title, publisher: publisher?.name ?? "the publisher", link, key, ref: sale.ref });
    }
    return fulfilled;
  }

  /**
   * The sealed copy, as bytes. Revoked is gone. A master the publisher has
   * replaced since the copy was sealed is sealed again under the same key,
   * so a buyer's fetch is always the pack as it now stands: an update is
   * a fetch, and the key they hold keeps opening it.
   */
  async function deliver(sale: Sale): Promise<Result> {
    if (sale.status === "revoked") return json(410, { error: "this copy was revoked; ask its publisher" });
    if (sale.status !== "fulfilled" || !sale.sealedKey || !sale.key) return json(200, { found: false, status: sale.status });
    let sealedKey = sale.sealedKey;
    const product = await deps.listings.getProduct(sale.orgId, sale.packId);
    // A sale from before versions were recorded is sealed once more, and then remembers.
    if (product && product.head.version !== sale.sealedVersion) {
      const master = await deps.listings.getMaster(product.masterKey);
      const document = product.masterKey.endsWith(".json") ? (JSON.parse(master) as unknown) : (YAML.parse(master) as unknown);
      const sealed = await seal(document, sale.key, { ref: sale.ref, title: product.head.title });
      sealedKey = await deps.sales.putSealed(sale.orgId, sale.ref, sealed);
      await deps.sales.putSale({ ...sale, sealedKey, sealedVersion: product.head.version, title: product.head.title });
    }
    const data = await deps.sales.getSealed(sealedKey);
    return {
      statusCode: 200,
      headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${sale.packId}.rlpack"`, "cache-control": "no-store" },
      body: Buffer.from(data).toString("base64"),
      isBase64Encoded: true,
    };
  }

  // What the command line needs before it can sign in: which WorkOS client
  // to run the device flow against. A client id is public — it is in every
  // sign-in URL — and the CLI asking rather than carrying one means one
  // package serves dev and production alike.
  if (method === "GET" && path === "/api/auth/cli") {
    return json(200, { clientId: deps.cliClientId ?? null, issuer: "https://api.workos.com" });
  }

  // Discord pressing. No bearer: Discord signs the timestamp and the raw
  // body with the application's key, and a bad signature is a 401 (never
  // 403: the edge would rewrite that into the app). The body is verified
  // as the bytes that arrived, before anything parses it. Discord waits
  // three seconds for the answer, so the handler answers in one turn.
  if (method === "POST" && path === "/api/discord/interactions") {
    if (!deps.discord || !deps.guilds) return json(401, { error: "discord is not configured here" });
    const raw = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body, "utf8")) : Buffer.alloc(0);
    if (!verifyInteraction(deps.discord.publicKey, header(event, "x-signature-ed25519"), header(event, "x-signature-timestamp"), raw)) return json(401, { error: "bad signature" });
    let interaction: unknown;
    try {
      interaction = JSON.parse(raw.toString("utf8"));
    } catch {
      return json(400, { error: "not an interaction" });
    }
    if (!isInteraction(interaction)) return json(400, { error: "not an interaction" });
    return json(
      200,
      await handleInteraction(interaction, {
        guilds: deps.guilds,
        appUrl: deps.appUrl ?? "/",
        now,
        gates: deps.gates,
        serverFeature: deps.features?.server ?? "server",
        // The table: the bot plays runs through the same store the app's
        // devices write, and rings the same bell.
        store,
        ...(deps.notify ? { notify: deps.notify } : {}),
        rest: deps.discord.rest ? await deps.discord.rest() : null,
        mintId: deps.mintId ?? ulid,
        token: deps.token ?? (() => randomBytes(24).toString("base64url")),
        // What the server's owner has: bought, or flagged on their session and remembered.
        grants: async (sub) => {
          const [bought, kept] = await Promise.all([deps.billing.entitlements(sub), deps.billing.flags(sub)]);
          return [...new Set([...bought, ...kept])];
        },
        ...(deps.code ? { code: deps.code } : {}),
      }),
    );
  }

  // Stripe calling back. No bearer: the signature over the raw body is
  // the credential, and a bad one is a 401 (never 403: the edge would
  // rewrite that into the app). Every event is answered 200 once it is
  // recognised, handled or not, so Stripe stops retrying; one seen twice
  // does nothing the second time.
  if (method === "POST" && path === "/api/stripe/webhook") {
    const secret = deps.webhookSecret ? await deps.webhookSecret() : null;
    const stripe = deps.stripe ? await deps.stripe() : null;
    if (!secret || !stripe) return json(200, { available: false });
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    let hook;
    try {
      hook = stripe.constructEvent(raw, header(event, "stripe-signature") ?? "", secret);
    } catch {
      return json(401, { error: "the signature does not match" });
    }
    if (!(await deps.billing.seenWebhook(hook.id, now()))) return json(200, { duplicate: true });
    if (hook.type === "account.updated") {
      const account = hook.data.object;
      const id = typeof account["id"] === "string" ? account["id"] : "";
      const orgId = id ? await deps.publishers.publisherForAccount(id) : null;
      if (orgId) {
        await deps.publishers.setConnect(orgId, now(), { connectReady: account["charges_enabled"] === true && account["details_submitted"] === true });
        return json(200, { applied: true });
      }
      return json(200, { applied: false });
    }
    if (hook.type === "entitlements.active_entitlement_summary.updated") {
      const summary = featuresOfSummary(hook.data.object);
      const sub = summary ? await deps.billing.userForCustomer(summary.customer) : null;
      if (summary && sub) {
        await deps.billing.putEntitlements(sub, summary.features, now());
        return json(200, { applied: true, features: summary.features });
      }
      return json(200, { applied: false });
    }
    return json(200, { ignored: hook.type });
  }

  // The one read that needs no account: what an invitation link is for,
  // shown before the sign-in it will ask for. Names the run and who asked;
  // never the members, never the email it was sent to.
  const peek = path.match(/^\/api\/invites\/([^/]+)$/);
  if (peek && method === "GET") {
    const invite = await store.getInvite(decodeURIComponent(peek[1]!));
    if (!invite || invite.expiresAt < now()) return json(200, { found: false });
    const found = await store.getSession(invite.sessionId);
    if (!found || found.meta.deletedAt) return json(200, { found: false });
    // Signed in already? Say whether this link is theirs, so the app can
    // tell somebody on the wrong account before they press anything. The
    // address it went to is shown masked: enough to recognise, no more.
    let forYou: boolean | null = null;
    let alreadyIn = false;
    try {
      const who = await deps.verify(header(event, "authorization"));
      const profile = await store.touchProfile(who.sub, now());
      forYou = (profile.email ?? "").trim().toLowerCase() === invite.email;
      alreadyIn = found.members.some((m) => m.sub === who.sub);
    } catch {
      /* nobody signed in: the link is for whoever signs in as its address */
    }
    return json(200, {
      found: true,
      invite: {
        role: invite.role,
        packId: found.meta.packId,
        packTitle: found.meta.packTitle ?? null,
        session: found.meta.name ?? null,
        inviter: invite.invitedByName ?? null,
        accepted: Boolean(invite.acceptedBy),
        sentTo: maskEmail(invite.email),
        forYou,
        alreadyIn,
      },
    });
  }

  // ---- a count, and nothing else ----
  // The app's beacon: which screen, which version, and the country the
  // edge saw. No identifier arrives and none is made; the request's
  // address is dropped with the request. A browser that asked not to be
  // tracked, by Global Privacy Control or Do Not Track, is not counted.
  if (method === "POST" && path === "/api/beacon") {
    if (header(event, "sec-gpc") === "1" || header(event, "dnt") === "1") return json(200, { counted: false });
    const body = parse(event);
    if (!isRecord(body) || body["t"] !== "view") return json(422, { error: "a view, as JSON" });
    const screen = (SCREENS as readonly string[]).includes(String(body["screen"])) ? String(body["screen"]) : null;
    if (!screen) return json(422, { error: `screen: one of ${SCREENS.join(", ")}` });
    const version = str(body["v"]) && /^\d+\.\d+\.\d+$/.test(body["v"]) ? body["v"] : "unknown";
    const seen = (header(event, "cloudfront-viewer-country") ?? "").toUpperCase();
    const country = /^[A-Z]{2}$/.test(seen) ? seen : "ZZ";
    deps.count?.({ screen, version, country });
    return json(200, { counted: true });
  }

  // Who signed a pack: the other read that needs no account. The badge
  // asks it for any signature it sees; the answer is a name and when the
  // key was claimed, or nothing.
  const author = path.match(/^\/api\/authors\/([^/]+)$/);
  if (author && method === "GET") {
    const claim = await store.getClaim(decodeURIComponent(author[1]!));
    if (!claim) return json(200, { found: false });
    // A claimant who publishes is named as their publisher too.
    const publisher = await deps.publishers.publisherOf(claim.sub);
    return json(200, { found: true, claim: { fingerprint: claim.fingerprint, publicKey: claim.publicKey, name: claim.name ?? null, claimedAt: claim.claimedAt, ...(publisher ? { publisher: { id: publisher.id, name: publisher.name } } : {}) } });
  }

  // Stripe calling back from a connected account: a sale was paid. The
  // signature is checked with the Connect endpoint's own secret; the rest
  // is as the platform webhook: 401 for a bad signature, once per event.
  if (method === "POST" && path === "/api/stripe/connect-webhook") {
    const secret = deps.connectWebhookSecret ? await deps.connectWebhookSecret() : null;
    const stripe = deps.stripe ? await deps.stripe() : null;
    if (!secret || !stripe) return json(200, { available: false });
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    let hook;
    try {
      hook = stripe.constructEvent(raw, header(event, "stripe-signature") ?? "", secret);
    } catch {
      return json(401, { error: "the signature does not match" });
    }
    if (!(await deps.billing.seenWebhook(hook.id, now()))) return json(200, { duplicate: true });
    if (hook.type === "checkout.session.completed") {
      const session = hook.data.object;
      const metadata = isRecord(session["metadata"]) ? session["metadata"] : {};
      const ref = typeof metadata["sale_ref"] === "string" ? metadata["sale_ref"] : typeof session["client_reference_id"] === "string" ? session["client_reference_id"] : "";
      const sale = ref ? await deps.sales.getSale(ref) : null;
      if (!sale) return json(200, { applied: false });
      if (sale.status !== "pending") return json(200, { applied: false, already: sale.status });
      const details = isRecord(session["customer_details"]) ? session["customer_details"] : {};
      const email = sale.buyerEmail ?? (typeof details["email"] === "string" ? details["email"].toLowerCase() : undefined);
      const fulfilled = await fulfil(sale, { ...(email ? { email } : {}), ...(typeof session["id"] === "string" ? { sessionId: session["id"] } : {}) });
      return json(200, { applied: true, ref: fulfilled.ref });
    }
    return json(200, { ignored: hook.type });
  }

  // The buyer's copy: by the token in the mail, or as the signed-in buyer
  // below. A revoked sale answers 410; nothing else is said about it.
  const purchaseFile = path.match(/^\/api\/purchases\/([^/]+)\/file$/);
  if (purchaseFile && method === "GET" && event.queryStringParameters?.["t"]) {
    const sale = await deps.sales.getSale(decodeURIComponent(purchaseFile[1]!));
    const token = event.queryStringParameters["t"] ?? "";
    if (!sale || !sale.tokenHash || hashKey(token) !== sale.tokenHash) return json(200, { found: false });
    return deliver(sale);
  }

  // The catalog's feed: what is listed, for anyone. A minute at the edge
  // and in the browser is plenty; nothing here is per-person.
  const publicCache = { "cache-control": "public, max-age=60" };
  const withCache = (r: Result): Result => (typeof r === "string" ? r : { ...r, headers: { ...(r.headers ?? {}), ...publicCache } });
  if (method === "GET" && path === "/api/listings") {
    return withCache(json(200, { listings: await deps.listings.listCards() }));
  }
  const listing = path.match(/^\/api\/listings\/([^/]+)(\/file)?$/);
  if (listing && method === "GET") {
    const card = await deps.listings.getCard(decodeURIComponent(listing[1]!));
    if (!card) return json(200, { found: false });
    const product = await deps.listings.getProduct(card.orgId, card.packId);
    if (listing[2] === "/file") {
      // A free listing's text is public. A priced one is delivered sealed,
      // to its buyer, by the checkout that follows.
      if (card.price !== "free" || !product) return json(410, { error: "this pack is sold, not given; buy it from the catalog" });
      return withCache({ statusCode: 200, headers: { "content-type": "text/yaml; charset=utf-8" }, body: await deps.listings.getMaster(product.masterKey) });
    }
    return withCache(json(200, { found: true, listing: card, summary: product?.summary ?? null }));
  }

  // ---- the short live link, pasted somewhere: a preview, then the app ----
  const shortLive = path.match(/^\/r\/([^/]+)$/);
  if (shortLive && method === "GET") {
    const id = decodeURIComponent(shortLive[1]!);
    const t = event.queryStringParameters?.["t"] ?? "";
    const appUrl = deps.appUrl ?? "/";
    const found = await store.getSession(id);
    if (!found || !t || found.meta.deletedAt || !found.meta.publicTokenHash || hashToken(t) !== found.meta.publicTokenHash) return livePage({ appUrl, closed: true });
    return livePage({ appUrl, id, token: t, title: found.meta.name ?? null, pack: found.meta.packTitle ?? null });
  }

  // ---- a watcher's reaction: one of a few emoji, to everyone watching and the table ----
  const publicReact = path.match(/^\/api\/public\/runs\/([^/]+)\/reactions$/);
  if (publicReact && method === "POST") {
    const id = decodeURIComponent(publicReact[1]!);
    const t = event.queryStringParameters?.["t"] ?? "";
    const found = await store.getSession(id);
    if (!found || !t || !found.meta.publicTokenHash || hashToken(t) !== found.meta.publicTokenHash) return json(200, { found: false });
    if (found.meta.deletedAt || found.meta.endedAt) return json(410, { error: "this run is over" });
    const body = parse(event);
    const emoji = isRecord(body) && str(body["emoji"]) ? body["emoji"] : "";
    if (!REACTIONS.has(emoji)) return json(422, { error: "emoji: one of " + [...REACTIONS].join(" ") });
    const name = isRecord(body) && str(body["name"]) ? body["name"].trim().slice(0, 40) : "";
    const reaction: Reaction = { emoji, at: now(), ...(name ? { name } : {}) };
    const reactions = await store.addReaction(id, reaction);
    await deps.notify?.(id, found.meta.seq);
    return json(200, { reactions });
  }

  // ---- the same run as numbers, for a stream plugin: the owner's snapshot, flat ----
  const publicMetrics = path.match(/^\/api\/public\/runs\/([^/]+)\/metrics$/);
  if (publicMetrics && method === "GET") {
    const id = decodeURIComponent(publicMetrics[1]!);
    const t = event.queryStringParameters?.["t"] ?? "";
    const found = await store.getSession(id);
    // A plugin's page is anywhere, so the answer says any origin may read it: the token is the key.
    const open = (status: number, body: unknown): Result => ({ statusCode: status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: JSON.stringify(body) });
    if (!found || !t || !found.meta.publicTokenHash || hashToken(t) !== found.meta.publicTokenHash) return open(200, { found: false });
    if (found.meta.deletedAt) return open(410, { found: false, deletedAt: found.meta.deletedAt });
    const m = found.meta;
    const snap = await store.getSnapshot(id);
    return open(200, { found: true, ...metricsOf({ id: m.id, packId: m.packId, packTitle: m.packTitle ?? null, name: m.name ?? null, endedAt: m.endedAt ?? null }, snap, now()) });
  }

  // ---- a run open to anyone with its link: no account, the token is the key ----
  const publicRun = path.match(/^\/api\/public\/runs\/([^/]+)$/);
  if (publicRun && method === "GET") {
    const id = decodeURIComponent(publicRun[1]!);
    const t = event.queryStringParameters?.["t"] ?? "";
    const found = await store.getSession(id);
    // Not shared, wrong token, or never there: all the same nothing.
    if (!found || !t || !found.meta.publicTokenHash || hashToken(t) !== found.meta.publicTokenHash) return json(200, { found: false });
    if (found.meta.deletedAt) return json(410, { deletedAt: found.meta.deletedAt });
    const m = found.meta;
    const run = { id: m.id, packId: m.packId, packVersion: m.packVersion, packTitle: m.packTitle ?? null, name: m.name ?? null, seq: m.seq, updatedAt: m.updatedAt, endedAt: m.endedAt ?? null };
    // The pack, where a stranger may hold it: the owner's copy when its
    // license says so, or a free listing's master. Otherwise the snapshot
    // the owner's device keeps, which carries the state and never the text.
    let source: { format: "yaml" | "json"; source: string } | null = null;
    const owned = await store.getPack(m.ownerSub, m.packId);
    if (owned && !owned.meta.deletedAt && owned.meta.shareable === true && owned.source) source = { format: owned.meta.format, source: owned.source };
    let listing: { id: string; price: unknown } | null = null;
    if (!source) {
      const card = await deps.listings.getCard(m.packId);
      if (card) {
        listing = { id: card.packId, price: card.price };
        if (card.price === "free") {
          const product = await deps.listings.getProduct(card.orgId, card.packId);
          if (product) source = { format: "yaml", source: await deps.listings.getMaster(product.masterKey) };
        }
      }
    }
    const reactions = await store.listReactions(id);
    if (source) {
      const after = Number(event.queryStringParameters?.["after"] ?? 0);
      const events = await store.eventsAfter(id, Number.isFinite(after) && after > 0 ? after : 0);
      return json(200, { found: true, access: "full", run, pack: source, events, listing, reactions });
    }
    const snapshot = await store.getSnapshot(id);
    return json(200, { found: true, access: "snapshot", run, snapshot, listing, reactions });
  }

  // Who is asking: a session token from the app, or a command-line key.
  // A key is the same bearer header with a prefix of its own; it is looked
  // up by hash, so the table never holds a key anyone could use.
  let caller: Caller;
  const bearer = header(event, "authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer?.startsWith(KEY_PREFIX)) {
    const found = await store.callerForApiKey(hashKey(bearer), now());
    if (!found) return json(401, { error: "that key is not known here; make a new one on your profile" });
    caller = { sub: found.sub, sid: `key:${found.id}`, ...(found.scope ? { scope: found.scope } : {}) };
    // Not 403: CloudFront turns a 403 into the app's index page with a 200 on the front.
    if (found.scope === "release" && !releaseMayReach(method, path)) return json(422, { error: "this key only checks, signs, publishes and releases packs; make a full key on your profile for the rest", scope: "release" });
  } else {
    try {
      caller = await deps.verify(header(event, "authorization"));
    } catch {
      return json(401, { error: "sign in again" });
    }
  }

  // Who you are, and what is known here about you. Reading it is also
  // being seen: the profile row is created on first sight and its
  // `lastSeenAt` moves every time.
  /**
   * What a person has: what Stripe granted them, and what a WorkOS feature
   * flag on their session grants — a flag named like a feature counts as
   * that feature. The flags are remembered per person so a rule that reads
   * someone else's standing (the fee on a sale, for the publisher) sees them.
   */
  const grantsOf = async (sub: string, flags?: string[]): Promise<string[]> => {
    const [bought, kept] = await Promise.all([deps.billing.entitlements(sub), deps.billing.flags(sub)]);
    return [...new Set([...bought, ...kept, ...(flags ?? [])])];
  };
  // ---- the invitations waiting for this account, so nobody needs the mail ----
  // Found by the address the profile holds, which is what an invitation is
  // addressed to; an account whose profile has no address yet has nothing
  // waiting that the app can show.
  if (method === "GET" && path === "/api/me/invites") {
    const profile = await store.touchProfile(caller.sub, now());
    const email = (profile.email ?? "").trim().toLowerCase();
    if (!email) return json(200, { invites: [] });
    const at = now();
    const waiting = (await store.invitesFor(email)).filter((i) => !i.acceptedBy && i.expiresAt >= at);
    const invites = [];
    for (const invite of waiting.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))) {
      const found = await store.getSession(invite.sessionId);
      if (!found || found.meta.deletedAt) continue;
      invites.push({
        token: invite.token,
        role: invite.role,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        packId: found.meta.packId,
        packTitle: found.meta.packTitle ?? null,
        session: found.meta.name ?? null,
        inviter: invite.invitedByName ?? null,
        alreadyIn: found.members.some((m) => m.sub === caller.sub),
      });
    }
    return json(200, { invites });
  }
  const decline = path.match(/^\/api\/me\/invites\/([^/]+)$/);
  if (decline && method === "DELETE") {
    const token = decodeURIComponent(decline[1]!);
    const invite = await store.getInvite(token);
    if (!invite) return json(200, { declined: true });
    const profile = await store.touchProfile(caller.sub, now());
    if ((profile.email ?? "").trim().toLowerCase() !== invite.email) return json(422, { error: "that invitation is not yours to decline" });
    await store.revokeInvite(invite.sessionId, token);
    return json(200, { declined: true });
  }

  /**
   * The server tier, as this copy offers it: at all, where there is a bot
   * to use it with; and for sale, where the stage has opened it. Until
   * then the app shows the plan as coming, and the `server` feature flag
   * on a session is the one way onto it — a flag named like the feature
   * is the feature, the way a `plus` flag comps Plus.
   */
  const servers = Boolean(deps.discord && deps.guilds);
  const serversOpen = servers && deps.discord?.open === true;

  if (method === "GET" && path === "/api/me") {
    const at = now();
    const flags = caller.flags ?? [];
    const [profile, kept] = await Promise.all([store.touchProfile(caller.sub, at), deps.billing.flags(caller.sub)]);
    if (!caller.sid.startsWith("key:") && (flags.length !== kept.length || flags.some((f) => !kept.includes(f)))) await deps.billing.putFlags(caller.sub, flags, at);
    const entitlements = await grantsOf(caller.sub, flags);
    return json(200, { sub: caller.sub, sid: caller.sid, ...(caller.scope ? { scope: caller.scope } : {}), env: deps.env, profile, entitlements, gates: deps.gates, servers, serversOpen });
  }

  /**
   * The one gate: hosting a table. Moderated play on one device stays
   * free; people on their own devices — an invitation, a race — need Plus
   * where plans are on. Off, nothing is asked.
   */
  const plusFeature = deps.features?.plus ?? "plus";
  const needsPlus = async (): Promise<Result | null> => {
    if (!deps.gates) return null;
    const have = await grantsOf(caller.sub, caller.flags);
    if (have.includes(plusFeature)) return null;
    return json(402, { error: "hosting a table — people in your run on their own devices — is part of Plus", plan: "plus", upgrade: true });
  };

  // ---- billing: a customer, a Checkout, the Portal, and a re-read ----
  if (path.startsWith("/api/billing/") && method === "POST") {
    const stripe = deps.stripe ? await deps.stripe() : null;
    if (!stripe) return json(200, { available: false });
    const appUrl = (deps.appUrl ?? "/").replace(/\/$/, "");
    const customer = async (): Promise<string> => {
      const existing = await deps.billing.customerOf(caller.sub);
      if (existing) return existing;
      const profile = await store.touchProfile(caller.sub, now());
      const made = await stripe.createCustomer({ ...(profile.email ? { email: profile.email } : {}), ...(profile.name ? { name: profile.name } : {}), metadata: { workos_user_id: caller.sub } });
      await deps.billing.setCustomer(caller.sub, made.id, now());
      return made.id;
    };
    if (path === "/api/billing/checkout") {
      const body = parse(event);
      const key = isRecord(body) && str(body["price"]) ? body["price"] : "";
      const price = deps.prices?.[key];
      if (!price) return json(422, { error: "price: one of the plans on sale here" });
      const url = (await stripe.checkout({ customer: await customer(), price, successUrl: `${appUrl}/?billing=done`, cancelUrl: `${appUrl}/?billing=cancelled`, clientReferenceId: caller.sub })).url;
      return json(200, { url });
    }
    if (path === "/api/billing/portal") {
      const url = (await stripe.portal({ customer: await customer(), returnUrl: `${appUrl}/?billing=managed` })).url;
      return json(200, { url });
    }
    if (path === "/api/billing/refresh") {
      const existing = await deps.billing.customerOf(caller.sub);
      if (!existing) return json(200, { entitlements: [] });
      const features = await stripe.activeEntitlements(existing);
      await deps.billing.putEntitlements(caller.sub, features, now());
      return json(200, { entitlements: features });
    }
    return json(410, { error: ROUTE_GONE });
  }

  // The name and email the app saw at sign-in. The token does not carry
  // them and the API has no WorkOS credential of its own, so the app
  // reports them; they are the person's own row and nothing is decided
  // on them, which is why that is acceptable.
  if (method === "PUT" && path === "/api/me/profile") {
    const body = parse(event);
    if (!isRecord(body)) return json(422, { error: "a profile, as JSON" });
    const { name, handle, email, termsVersion } = body;
    if ((name !== undefined && !str(name)) || (handle !== undefined && !str(handle)) || (email !== undefined && !str(email)) || (termsVersion !== undefined && !str(termsVersion))) {
      return json(422, { error: "name, handle, email and termsVersion are strings when given" });
    }
    // The chosen name is what others see, so it is a name: letters, digits,
    // spaces and a few marks, two to twenty-four long, and never an address.
    if (handle !== undefined && handle.trim() !== "" && !/^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,23}$/u.test(handle.trim())) {
      return json(422, { error: "a shown name is 2 to 24 letters, digits, spaces, dots, dashes or underscores" });
    }
    if ((name ?? "").length > MAX_SNAPSHOT_CHARS || (email ?? "").length > MAX_SNAPSHOT_CHARS || (termsVersion ?? "").length > MAX_SNAPSHOT_CHARS) {
      return json(413, { error: "that is not a name" });
    }
    // Accepting the terms is the one thing here that is a decision rather
    // than a snapshot, so it is stamped with the time, server-side.
    const profile = await store.touchProfile(caller.sub, now(), {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(handle !== undefined ? { handle: handle.trim() } : {}),
      ...(email !== undefined ? { email: email.trim() } : {}),
      ...(termsVersion !== undefined ? { termsVersion: termsVersion.trim() } : {}),
    });
    // A name is shown on every seat this person holds, and a seat keeps
    // the name it was taken with; a new name goes round the tables.
    if (handle !== undefined || name !== undefined) {
      const shown = shownName(profile);
      const { sessions } = await store.manifest(caller.sub);
      await Promise.all(sessions.filter((s) => !s.deletedAt).map((s) => store.setMemberName(s.id, caller.sub, shown)));
    }
    return json(200, { profile });
  }

  // Everything of yours on this side, gone. The app keeps its local copies;
  // this is the server forgetting, not the player losing anything.
  // ---- everything the account holds, as one file ----
  // The right to a copy, made real: every row and body the account has,
  // written where deleting the account sweeps it, handed back as a link.
  if (method === "POST" && path === "/api/me/export") {
    if (caller.sid.startsWith("key:")) return json(422, { error: "an export is asked for from the app, signed in" });
    const at = now();
    const profile = await store.touchProfile(caller.sub, at);
    const manifest = await store.manifest(caller.sub);
    const packs = [];
    for (const meta of manifest.packs) {
      if (meta.deletedAt) continue;
      const found = await store.getPack(caller.sub, meta.id);
      if (found) packs.push({ ...found.meta, source: found.source });
    }
    const licenses = [];
    for (const meta of manifest.licenses) {
      if (meta.deletedAt) continue;
      const found = await store.getLicense(caller.sub, meta.id);
      if (found) licenses.push({ ...found.meta, key: found.key });
    }
    const sessions = [];
    for (const pointer of manifest.sessions) {
      if (pointer.deletedAt) continue;
      const found = await store.getSession(pointer.id);
      if (!found || found.meta.deletedAt) continue;
      const invites = pointer.role === "owner" ? await store.listInvites(pointer.id) : [];
      const events = await store.eventsAfter(pointer.id, 0);
      sessions.push({ role: pointer.role, ...found.meta, members: await asShownNow(store, found.members), events, invites });
    }
    const doc = {
      exportedAt: at,
      account: { id: caller.sub, profile },
      sessions,
      packs,
      licenses,
      purchases: await deps.sales.listPurchases(caller.sub),
      races: await deps.races.listRaces(caller.sub),
      people: await store.listPeople(caller.sub),
      keys: await store.listApiKeys(caller.sub),
      claims: await store.listClaims(caller.sub),
    };
    const body = JSON.stringify(doc, null, 2);
    const saved = await store.saveExport(caller.sub, body, at);
    return json(200, { url: saved.url, bytes: Buffer.byteLength(body), expiresAt: saved.expiresAt });
  }

  if (method === "DELETE" && path === "/api/me") {
    const rows = await store.deleteUser(caller.sub);
    const linked = deps.guilds ? await deps.guilds.forgetUser(caller.sub) : 0;
    return json(200, { deleted: rows + linked });
  }

  // ---- other accounts this one is linked to ----
  // Discord first. The link is made from Discord's side: `/link` there
  // mints a code bound to the Discord account that pressed, and handing
  // the code in here, signed in, binds it to this account. Nothing of
  // Discord's is kept but its user id and the name it showed.
  if (path === "/api/connections" && method === "GET") {
    const discord = deps.guilds ? await deps.guilds.connection(caller.sub) : null;
    return json(200, { available: Boolean(deps.discord && deps.guilds), discord });
  }
  if (path === "/api/connections/discord") {
    if (!deps.guilds) return json(200, { available: false });
    if (method === "POST") {
      const body = parse(event);
      const code = isRecord(body) && str(body["code"]) ? normalizeCode(body["code"]) : "";
      if (!code) return json(422, { error: "code: the one /link gave you" });
      const link = await deps.guilds.takeLinkCode(code, now());
      if (!link) return json(422, { error: "that code is not known here, or its ten minutes are up; run /link in Discord again" });
      const connection = { discordUserId: link.discordUserId, name: link.name, linkedAt: now() };
      await deps.guilds.connect(caller.sub, connection);
      return json(200, { linked: true, discord: connection });
    }
    if (method === "DELETE") return json(200, { unlinked: await deps.guilds.disconnect(caller.sub) });
  }

  // ---- servers: a Discord server claimed for this account, and its vault ----
  // The claim is made from Discord's side (`/setup claim`, by someone who
  // can manage the server) and handed in here; the account that hands it
  // in owns the server: pays for its plan, and puts packs of its own in
  // its vault for the bot to play. A pack in the vault is never served
  // back, to its owner or anyone: the profile lists what is there, and
  // only the bot reads the text.
  if (deps.guilds && path.startsWith("/api/guilds")) {
    const guilds = deps.guilds;
    const serverFeature = deps.features?.server ?? "server";
    const hasServerPlan = async () => !deps.gates || (await grantsOf(caller.sub, caller.flags)).includes(serverFeature);
    if (path === "/api/guilds/claim" && method === "POST") {
      const body = parse(event);
      const code = isRecord(body) && str(body["code"]) ? normalizeCode(body["code"]) : "";
      if (!code) return json(422, { error: "code: the one /setup claim gave you" });
      const claim = await guilds.takeClaimCode(code, now());
      if (!claim) return json(422, { error: "that code is not known here, or its ten minutes are up; run /setup claim in Discord again" });
      const mine = await guilds.guildsOf(caller.sub);
      if (!mine.some((g) => g.guildId === claim.guildId) && mine.length >= MAX_GUILDS_PER_SUB) return json(422, { error: `that is enough servers for one account (${MAX_GUILDS_PER_SUB}); release one from your profile first` });
      const name = deps.discord?.guildName ? await deps.discord.guildName(claim.guildId) : null;
      const guild = await guilds.claimGuild({ guildId: claim.guildId, ownerSub: caller.sub, claimedAt: now(), ...(name ? { name } : {}) });
      const upgrade = !(await hasServerPlan());
      return json(200, { claimed: true, guild, plan: serverFeature, upgrade });
    }
    if (path === "/api/guilds" && method === "GET") {
      return json(200, { guilds: await guilds.guildsOf(caller.sub), server: await hasServerPlan(), plan: serverFeature, open: serversOpen });
    }
    const one = path.match(/^\/api\/guilds\/([^/]+)$/);
    if (one && method === "DELETE") {
      const guild = await guilds.guild(decodeURIComponent(one[1]!));
      if (!guild || guild.ownerSub !== caller.sub) return json(200, { found: false });
      return json(200, { released: await guilds.releaseGuild(guild.guildId) });
    }
    const packs = path.match(/^\/api\/guilds\/([^/]+)\/packs(?:\/([^/]+))?$/);
    if (packs) {
      const guild = await guilds.guild(decodeURIComponent(packs[1]!));
      if (!guild || guild.ownerSub !== caller.sub) return json(200, { found: false });
      const packId = packs[2] ? decodeURIComponent(packs[2]) : null;
      if (!packId && method === "GET") return json(200, { guild, packs: await guilds.listGuildPacks(guild.guildId) });
      if (packId && method === "PUT") {
        const body = parse(event);
        if (!isRecord(body)) return json(422, { error: "a pack, as JSON" });
        const { title, version, format, hash, source, modes } = body;
        if (!str(title) || !title.trim() || title.length > MAX_NAME || !str(version) || !str(hash) || (format !== "yaml" && format !== "json") || !str(source)) {
          return json(422, { error: "title, version, hash, format (yaml or json) and source are strings" });
        }
        if (Buffer.byteLength(source) > MAX_BYTES) return json(413, { error: "this pack is too large for a vault" });
        const modeList = Array.isArray(modes) ? modes.filter((m): m is { id: string; label: string } => isRecord(m) && str(m["id"]) && str(m["label"])).map((m) => ({ id: m.id, label: m.label })).slice(0, 50) : [];
        const meta = { id: packId, title: title.trim(), version, format: format === "json" ? ("json" as const) : ("yaml" as const), hash, bytes: Buffer.byteLength(source), modes: modeList, updatedAt: now(), delegatedBy: caller.sub };
        await guilds.putGuildPack(guild.guildId, meta, source);
        return json(200, { kept: true, pack: meta });
      }
      if (packId && method === "DELETE") return json(200, { removed: await guilds.deleteGuildPack(guild.guildId, packId) });
    }
    return json(410, { error: ROUTE_GONE });
  }

  if (method === "GET" && path === "/api/sync/manifest") {
    return json(200, await store.manifest(caller.sub));
  }

  const pack = path.match(/^\/api\/packs\/([^/]+)$/);
  if (pack) {
    const id = decodeURIComponent(pack[1]!);
    if (method === "GET") {
      const found = await store.getPack(caller.sub, id);
      if (!found) return json(200, { found: false });
      if (found.meta.deletedAt) return json(410, { deletedAt: found.meta.deletedAt });
      return json(200, { found: true, pack: { ...found.meta, source: found.source } });
    }
    if (method === "PUT") {
      const body = parse(event);
      if (!isRecord(body)) return json(422, { error: "a pack, as JSON" });
      const { title, version, format, filename, importedAt, updatedAt, hash, source, origin, catalog, shareable } = body;
      if (!str(title) || !str(version) || !str(filename) || !str(importedAt) || !str(updatedAt) || !str(hash) || !str(source)) {
        return json(422, { error: "title, version, filename, importedAt, updatedAt, hash and source are all required" });
      }
      if (format !== "yaml" && format !== "json") return json(422, { error: "format is yaml or json" });
      if (origin !== undefined && !(PACK_ORIGINS as readonly unknown[]).includes(origin)) return json(422, { error: `origin is one of ${PACK_ORIGINS.join(", ")}` });
      if (catalog !== undefined && !(isRecord(catalog) && str(catalog["id"]) && str(catalog["version"]) && catalog["id"].length <= MAX_NAME && catalog["version"].length <= MAX_NAME)) {
        return json(422, { error: "catalog is {id, version}" });
      }
      if (Buffer.byteLength(source) > MAX_BYTES) return json(413, { error: "this pack is too large to sync" });
      const conflict = await mismatch(event, (await store.getPack(caller.sub, id))?.meta);
      if (conflict) return conflict;
      const meta: PackMeta = {
        id,
        title,
        version,
        format,
        filename,
        importedAt,
        updatedAt,
        hash,
        bytes: Buffer.byteLength(source),
        ...(origin !== undefined ? { origin: origin as PackOrigin } : {}),
        ...(catalog !== undefined ? { catalog: { id: (catalog as Record<string, string>)["id"]!, version: (catalog as Record<string, string>)["version"]! } } : {}),
        ...(typeof shareable === "boolean" ? { shareable } : {}),
      };
      await store.putPack(caller.sub, meta, source);
      return json(200, { entry: meta });
    }
    if (method === "DELETE") {
      const meta = await store.deletePack(caller.sub, id, now());
      return json(200, { deletedAt: meta.deletedAt });
    }
  }

  // ---- sessions: a run with people in it, appended in server order ----
  const sessionEvents = (v: unknown): Record<string, unknown>[] | null => {
    if (!Array.isArray(v) || v.length > MAX_EVENTS) return null;
    if (!v.every((e) => isRecord(e) && str(e["t"]) && str(e["at"]) && str(e["id"]))) return null;
    if (Buffer.byteLength(JSON.stringify(v)) > MAX_BYTES) return null;
    return v as Record<string, unknown>[];
  };
  const tooLong = (v: unknown) => str(v) && v.length > MAX_NAME;

  const accept = path.match(/^\/api\/invites\/([^/]+)\/accept$/);
  if (accept && method === "POST") {
    const token = decodeURIComponent(accept[1]!);
    const invite = await store.getInvite(token);
    if (!invite || invite.expiresAt < now()) return json(410, { error: "that invitation has expired or was withdrawn" });
    const profile = await store.touchProfile(caller.sub, now());
    // Somebody already at the table — the owner opening their own link,
    // say — does not spend it; the person it was sent to still can.
    const existing = await store.getSession(invite.sessionId);
    if (existing?.members.some((m) => m.sub === caller.sub)) return json(200, { sessionId: invite.sessionId, alreadyIn: true });
    // And it goes to the address it was sent to. The app's own snapshot of
    // the address is what is compared, which guards against the wrong
    // account by accident, not against a determined holder of the link.
    // A fresh account may not have sent its snapshot yet — the profile page
    // is where it used to happen — so the accept carries one too, and it
    // is kept the same way the profile route would keep it.
    const body = parse(event);
    const carried = isRecord(body) && str(body["email"]) && EMAIL.test(body["email"].trim()) ? body["email"].trim() : "";
    let known = (profile.email ?? "").trim();
    if (!known && carried) {
      await store.touchProfile(caller.sub, now(), { email: carried });
      known = carried;
    }
    if (known.toLowerCase() !== invite.email) {
      return json(422, { error: `this invitation was sent to ${maskEmail(invite.email)}; sign in with that address to join`, sentTo: maskEmail(invite.email) });
    }
    const joined = await store.acceptInvite(token, caller.sub, shownName(profile), known, now());
    if (!joined) return json(410, { error: "that invitation was already used by somebody else" });
    // The table has one more at it: whoever is watching should see the seat fill.
    await deps.notify?.(joined.sessionId, (await store.getSession(joined.sessionId))?.meta.seq ?? 0);
    return json(200, { sessionId: joined.sessionId });
  }

  // ---- a watcher takes a seat on their own account, by the live link ----
  const publicWatch = path.match(/^\/api\/public\/runs\/([^/]+)\/watch$/);
  if (publicWatch && method === "POST") {
    const id = decodeURIComponent(publicWatch[1]!);
    const t = event.queryStringParameters?.["t"] ?? "";
    const found = await store.getSession(id);
    if (!found || !t || !found.meta.publicTokenHash || hashToken(t) !== found.meta.publicTokenHash) return json(200, { found: false });
    if (found.meta.deletedAt) return json(410, { deletedAt: found.meta.deletedAt });
    const profile = await store.touchProfile(caller.sub, now());
    const seat = await store.joinAsViewer(id, caller.sub, shownName(profile), now());
    if (!seat) return json(410, { error: "this run is gone" });
    // One more at the table; whoever is watching sees the seat fill.
    await deps.notify?.(id, found.meta.seq);
    return json(200, { sessionId: id, role: seat.role });
  }

  // ---- command-line keys ----
  if (path === "/api/keys") {
    if (method === "GET") return json(200, { keys: await store.listApiKeys(caller.sub) });
    if (method === "POST") {
      // Not from a key: a key that could mint keys would be a key nobody could revoke.
      if (caller.sid.startsWith("key:")) return json(422, { error: "make keys from the app, signed in" });
      const body = parse(event);
      const name = isRecord(body) && str(body["name"]) ? body["name"].trim() : "";
      if (!name || name.length > MAX_NAME) return json(422, { error: "name: what this key is for" });
      const scope = isRecord(body) ? body["scope"] : undefined;
      if (scope !== undefined && scope !== "full" && scope !== "release") return json(422, { error: "scope: full or release" });
      if ((await store.listApiKeys(caller.sub)).length >= MAX_KEYS) return json(422, { error: "that is enough keys; revoke one first" });
      const secret = KEY_PREFIX + randomBytes(32).toString("base64url");
      const id = randomBytes(8).toString("hex");
      const key: ApiKey = { id, name, prefix: secret.slice(0, KEY_PREFIX.length + 6), createdAt: now(), ...(scope === "release" ? { scope: "release" as const } : {}) };
      await store.createApiKey(caller.sub, key, hashKey(secret));
      // The one time the secret is shown.
      return json(200, { key, secret });
    }
  }
  const apiKey = path.match(/^\/api\/keys\/([^/]+)$/);
  if (apiKey && method === "DELETE") {
    return json(200, { revoked: await store.revokeApiKey(caller.sub, decodeURIComponent(apiKey[1]!)) });
  }

  // ---- claims: proving a signing key is yours ----
  if (path === "/api/claims/nonce" && method === "POST") {
    const nonce = randomBytes(24).toString("base64url");
    await store.issueNonce(caller.sub, nonce, now());
    return json(200, { nonce, expiresInSeconds: 600 });
  }
  if (path === "/api/claims") {
    if (method === "GET") return json(200, { claims: (await store.listClaims(caller.sub)).map(({ fingerprint, publicKey, name, claimedAt }) => ({ fingerprint, publicKey, name: name ?? null, claimedAt })) });
    if (method === "POST") {
      const body = parse(event);
      if (!isRecord(body)) return json(422, { error: "a claim, as JSON" });
      const { publicKey, nonce, signature } = body;
      if (!str(publicKey) || !str(nonce) || !str(signature)) return json(422, { error: "publicKey, nonce and signature are all required" });
      if (!(await store.takeNonce(caller.sub, nonce))) return json(422, { error: "that nonce is not yours, or was used, or expired; ask for another" });
      if (!(await verifyProof(publicKey, nonce, signature))) return json(422, { error: "the signature does not verify under that key" });
      const fingerprint = await fingerprintOf(publicKey);
      const existing = await store.getClaim(fingerprint);
      if (existing && existing.sub !== caller.sub) return json(409, { error: "that key is claimed by another account" });
      const profile = await store.touchProfile(caller.sub, now());
      const claim = { fingerprint, publicKey, sub: caller.sub, ...(shownName(profile) ? { name: shownName(profile) } : {}), claimedAt: existing?.claimedAt ?? now() };
      await store.claim(claim);
      return json(200, { claim: { fingerprint, publicKey, name: claim.name ?? null, claimedAt: claim.claimedAt } });
    }
  }
  const unclaim = path.match(/^\/api\/claims\/([^/]+)$/);
  if (unclaim && method === "DELETE") {
    return json(200, { removed: await store.unclaim(caller.sub, decodeURIComponent(unclaim[1]!)) });
  }

  if (path === "/api/people" && method === "GET") {
    return json(200, { people: await store.listPeople(caller.sub) });
  }

  // ---- buying: a Checkout on the publisher's account, and what was bought ----
  const buy = path.match(/^\/api\/listings\/([^/]+)\/checkout$/);
  if (buy && method === "POST") {
    const packId = decodeURIComponent(buy[1]!);
    const card = await deps.listings.getCard(packId);
    if (!card || card.price === "free") return json(200, { found: false });
    const stripe = deps.stripe ? await deps.stripe() : null;
    if (!stripe) return json(200, { available: false });
    const [publisher, product] = await Promise.all([deps.publishers.getPublisher(card.orgId), deps.listings.getProduct(card.orgId, packId)]);
    if (!publisher?.connectReady || !publisher.connectAccountId || !product?.stripePriceId) return json(422, { error: "this pack cannot be sold just now; its publisher's payouts are not set up" });
    // Bought already: the copy is theirs, on their profile and on every device they sign in on.
    const owned = (await deps.sales.listPurchases(caller.sub)).some((s) => s.packId === packId && s.status === "fulfilled");
    if (owned) return json(409, { error: "you already own this pack; it is on your profile under Purchases", owned: true });
    // The platform's share: none for a publisher who subscribes to hosted licensing.
    const fees = deps.fees ?? { subscribed: 0, unsubscribed: 500 };
    const subscribed = (await grantsOf(publisher.ownerSub)).includes(deps.features?.hostedLicensing ?? "hosted-licensing");
    const fee = Math.round((card.price.amount * (subscribed ? fees.subscribed : fees.unsubscribed)) / 10_000);
    const profile = await store.touchProfile(caller.sub, now());
    const ref = newRef();
    const appUrl = (deps.appUrl ?? "/").replace(/\/$/, "");
    const sale: Sale = {
      ref,
      orgId: card.orgId,
      packId,
      title: card.head.title,
      buyerSub: caller.sub,
      ...(profile.email ? { buyerEmail: profile.email.toLowerCase() } : {}),
      amount: card.price.amount,
      currency: card.price.currency,
      fee,
      status: "pending",
      createdAt: now(),
      stripeAccount: publisher.connectAccountId,
    };
    await deps.sales.putSale(sale);
    const session = await stripe.checkoutSale({
      account: publisher.connectAccountId,
      price: product.stripePriceId,
      fee,
      successUrl: `${appUrl}/?purchase=${encodeURIComponent(ref)}`,
      cancelUrl: `${appUrl}/?purchase=cancelled`,
      ref,
      ...(profile.email ? { email: profile.email } : {}),
      metadata: { sale_ref: ref, pack_id: packId, org_id: card.orgId, buyer_sub: caller.sub },
    });
    await deps.sales.putSale({ ...sale, stripeSessionId: session.sessionId });
    return json(200, { url: session.url, ref });
  }
  if (path === "/api/me/purchases" && method === "GET") {
    const purchases = await deps.sales.listPurchases(caller.sub);
    return json(200, { purchases: purchases.map((s) => ({ ref: s.ref, packId: s.packId, title: s.title, status: s.status, amount: s.amount, currency: s.currency, createdAt: s.createdAt, ...(s.status === "fulfilled" ? { key: s.key } : {}) })) });
  }
  const purchase = path.match(/^\/api\/purchases\/([^/]+)(\/file)?$/);
  if (purchase && method === "GET") {
    const sale = await deps.sales.getSale(decodeURIComponent(purchase[1]!));
    // Not the buyer reads what a stranger would.
    if (!sale || sale.buyerSub !== caller.sub) return json(200, { found: false });
    if (purchase[2]) return deliver(sale);
    return json(200, { found: true, purchase: { ref: sale.ref, packId: sale.packId, title: sale.title, status: sale.status, ...(sale.status === "fulfilled" ? { key: sale.key } : {}) } });
  }

  // ---- an invitation to the platform itself: one address, WorkOS's mail ----
  if (path === "/api/invitations" && method === "GET") {
    const workos = deps.workos ? await deps.workos() : null;
    if (!workos) return json(200, { available: false, invitations: [] });
    return json(200, { invitations: await workos.invitationsBy(caller.sub) });
  }
  const platformInvitation = path.match(/^\/api\/invitations\/([^/]+)$/);
  if (platformInvitation && method === "DELETE") {
    const workos = deps.workos ? await deps.workos() : null;
    if (!workos) return json(200, { available: false });
    // Only the sender takes an invitation back.
    const id = decodeURIComponent(platformInvitation[1]!);
    const mine = (await workos.invitationsBy(caller.sub)).some((i) => i.id === id);
    if (!mine) return json(200, { found: false });
    await workos.revokeInvitation(id);
    return json(200, { revoked: true });
  }
  if (path === "/api/invitations" && method === "POST") {
    if (caller.sid.startsWith("key:")) return json(422, { error: "invite people from the app, signed in" });
    const body = parse(event);
    const email = isRecord(body) && str(body["email"]) ? body["email"].trim() : "";
    if (!email || email.length > MAX_NAME || !email.includes("@")) return json(422, { error: "email: where the invitation goes" });
    const workos = deps.workos ? await deps.workos() : null;
    if (!workos) return json(200, { available: false });
    const sent = await workos.invite({ email, inviterUserId: caller.sub });
    return json(200, { sent: true, email: sent.email, expiresAt: sent.expiresAt });
  }

  // ---- publishers: an organization, and a connected account for its sales ----
  if (path.startsWith("/api/publishers")) {
    const appUrl = (deps.appUrl ?? "/").replace(/\/$/, "");
    let mine = await deps.publishers.publisherOf(caller.sub);
    // Someone WorkOS admitted through an invitation has a membership there
    // and no row here yet: the first time they come, the row is written
    // from WorkOS's book, and from then on they are a member the API knows.
    if (!mine && !caller.sid.startsWith("key:") && deps.workos) {
      const workos = await deps.workos();
      if (workos) {
        for (const m of await workos.membershipsOf(caller.sub)) {
          const org = await deps.publishers.getPublisher(m.organizationId);
          if (!org) continue;
          await deps.publishers.addMember(org.id, caller.sub, m.role, now());
          mine = org;
          break;
        }
      }
    }
    const myRole = mine ? (mine.ownerSub === caller.sub ? "admin" : ((await deps.publishers.roleOf(mine.id, caller.sub)) ?? "member")) : null;
    const admin = myRole === "admin";

    // ---- their packs: uploaded masters, and what is listed ----
    const packRoute = path.match(/^\/api\/publishers\/packs(?:\/([^/]+)(\/listing)?)?$/);
    if (packRoute) {
      if (!mine) return json(200, { publisher: null });
      const productView = (p: Product) => ({ packId: p.packId, head: p.head, price: p.price ?? null, status: p.status, bytes: p.masterBytes, createdAt: p.createdAt, updatedAt: p.updatedAt });
      const packId = packRoute[1] ? decodeURIComponent(packRoute[1]) : null;
      if (!packId) {
        if (method !== "GET") return json(410, { error: ROUTE_GONE });
        return json(200, { packs: (await deps.listings.listProducts(mine.id)).map(productView) });
      }
      if (packId.length > MAX_NAME) return json(422, { error: "that is not a pack id" });
      const existing = await deps.listings.getProduct(mine.id, packId);
      if (!packRoute[2]) {
        if (method === "PUT") {
          const body = parse(event);
          if (!isRecord(body)) return json(422, { error: "a pack, as JSON" });
          const { source, head, summary } = body;
          const h = headOf(head);
          if (!str(source) || !source.trim() || !h) return json(422, { error: "source, and a head with title, version, category and license, are all required" });
          if (Buffer.byteLength(source) > MAX_BYTES) return json(413, { error: "this pack is too large to list" });
          if (summary !== undefined && Buffer.byteLength(JSON.stringify(summary)) > 200_000) return json(413, { error: "the summary is too large" });
          const at = now();
          const master = await deps.listings.putMaster(mine.id, packId, source);
          const product: Product = {
            ...(existing ?? { packId, orgId: mine.id, status: "draft" as const, createdAt: at }),
            head: h,
            summary: summary ?? existing?.summary ?? null,
            masterKey: master.key,
            masterBytes: master.bytes,
            updatedAt: at,
          };
          await deps.listings.putProduct(product);
          // A listed pack's card follows the new head at once.
          if (product.status === "listed") {
            await deps.listings.putCard({ packId, orgId: mine.id, publisherName: mine.name, head: h, price: product.price ?? "free", updatedAt: at });
          }
          return json(200, { pack: productView(product) });
        }
        if (method === "DELETE") {
          if (!existing) return json(200, { found: false });
          if (existing.stripePriceId && existing.stripeProductId && mine.connectAccountId && deps.stripe) {
            const stripe = await deps.stripe();
            if (stripe) await stripe.retirePrice({ account: mine.connectAccountId, priceId: existing.stripePriceId });
          }
          await deps.listings.deleteCard(packId);
          await deps.listings.deleteProduct(mine.id, packId);
          return json(200, { deleted: true });
        }
        if (method === "GET") return existing ? json(200, { pack: productView(existing) }) : json(200, { found: false });
        return json(410, { error: ROUTE_GONE });
      }
      // …/listing: list it, at a price or free, or take it down.
      if (!existing) return json(200, { found: false });
      if (method === "POST") {
        const body = parse(event);
        const price = priceOf(isRecord(body) ? body : {});
        if (!price) return json(422, { error: "amount: whole cents from 100 to 100000, or none for free" });
        const at = now();
        let stripeProductId = existing.stripeProductId;
        let stripePriceId = existing.stripePriceId;
        if (price !== "free") {
          const stripe = deps.stripe ? await deps.stripe() : null;
          if (!stripe) return json(200, { available: false, error: "selling is not switched on here yet; a free listing works" });
          if (!mine.connectReady || !mine.connectAccountId) return json(422, { error: "set up payouts before listing a pack for sale" });
          const same = existing.price && existing.price.amount === price.amount && existing.price.currency === price.currency && stripePriceId;
          if (!same) {
            if (stripePriceId) await stripe.retirePrice({ account: mine.connectAccountId, priceId: stripePriceId });
            const made = await stripe.createListing({ account: mine.connectAccountId, name: existing.head.title, packId, amount: price.amount, currency: price.currency, ...(stripeProductId ? { productId: stripeProductId } : {}) });
            stripeProductId = made.productId;
            stripePriceId = made.priceId;
          }
        }
        const product: Product = {
          ...existing,
          ...(price === "free" ? { price: undefined } : { price }),
          ...(stripeProductId ? { stripeProductId } : {}),
          ...(price === "free" ? { stripePriceId: undefined } : stripePriceId ? { stripePriceId } : {}),
          status: "listed",
          updatedAt: at,
        };
        await deps.listings.putProduct(product);
        const card: ListingCard = { packId, orgId: mine.id, publisherName: mine.name, head: existing.head, price, updatedAt: at };
        await deps.listings.putCard(card);
        return json(200, { pack: productView(product), listing: card });
      }
      if (method === "DELETE") {
        await deps.listings.deleteCard(packId);
        await deps.listings.putProduct({ ...existing, status: "draft", updatedAt: now() });
        return json(200, { pack: productView({ ...existing, status: "draft" }) });
      }
      return json(410, { error: ROUTE_GONE });
    }

    const view = (p: typeof mine) => (p ? { id: p.id, name: p.name, owner: p.ownerSub === caller.sub, role: p.ownerSub === caller.sub ? "admin" : (myRole ?? "member"), connectStarted: Boolean(p.connectAccountId), connectReady: p.connectReady, createdAt: p.createdAt } : null);
    if (path === "/api/publishers/me" && method === "GET") return json(200, { publisher: view(mine) });
    if (path === "/api/publishers" && method === "POST") {
      if (mine) return json(409, { error: "you already publish as " + mine.name, publisher: view(mine) });
      const body = parse(event);
      const name = isRecord(body) && str(body["name"]) ? body["name"].trim() : "";
      if (!name || name.length > MAX_NAME) return json(422, { error: "name: what the catalog will call you" });
      const at = now();
      // The organization lives in WorkOS where the key is filled, so its
      // members' tokens carry it; the row here is what the API reads.
      const workos = deps.workos ? await deps.workos() : null;
      let id = `org_local_${randomUUID()}`;
      if (workos) {
        id = (await workos.createOrganization(name)).id;
        await workos.addMember(id, caller.sub, "admin");
      }
      const made = await deps.publishers.createPublisher({ id, name, ownerSub: caller.sub }, at);
      return json(200, { publisher: view(made) });
    }
    if (!mine) return json(200, { publisher: null });

    // ---- the people in it: members by WorkOS's book, invitations pending ----
    if (path === "/api/publishers/members" && method === "GET") {
      const workos = deps.workos ? await deps.workos() : null;
      if (!workos) return json(200, { available: false, members: [{ userId: mine.ownerSub, role: "admin", me: mine.ownerSub === caller.sub }], invitations: [] });
      const [members, invitations] = await Promise.all([workos.listMembers(mine.id), workos.listInvitations(mine.id)]);
      const owner = mine.ownerSub;
      return json(200, {
        members: members.map((m) => ({ userId: m.userId, role: m.userId === owner ? "admin" : m.role, owner: m.userId === owner, me: m.userId === caller.sub, ...(m.email ? { email: m.email } : {}), ...(m.name ? { name: m.name } : {}) })),
        invitations,
      });
    }
    if (path === "/api/publishers/members/invite" && method === "POST") {
      if (!admin) return json(422, { error: "only an admin of the publisher invites people" });
      const body = parse(event);
      const email = isRecord(body) && str(body["email"]) ? body["email"].trim() : "";
      const role = isRecord(body) && body["role"] === "admin" ? "admin" : "member";
      if (!email || email.length > MAX_NAME || !email.includes("@")) return json(422, { error: "email: where the invitation goes" });
      const workos = deps.workos ? await deps.workos() : null;
      if (!workos) return json(200, { available: false });
      const sent = await workos.invite({ email, organizationId: mine.id, role, inviterUserId: caller.sub });
      return json(200, { invitation: sent });
    }
    const invitation = path.match(/^\/api\/publishers\/invitations\/([^/]+)$/);
    if (invitation && method === "DELETE") {
      if (!admin) return json(422, { error: "only an admin of the publisher revokes an invitation" });
      const workos = deps.workos ? await deps.workos() : null;
      if (!workos) return json(200, { available: false });
      await workos.revokeInvitation(decodeURIComponent(invitation[1]!));
      return json(200, { revoked: true });
    }
    const member = path.match(/^\/api\/publishers\/members\/([^/]+)$/);
    if (member && method === "DELETE") {
      const userId = decodeURIComponent(member[1]!);
      if (!admin) return json(422, { error: "only an admin of the publisher removes people" });
      if (userId === mine.ownerSub) return json(422, { error: "the founder stays; hand the publisher over first" });
      const workos = deps.workos ? await deps.workos() : null;
      if (workos) {
        const found = (await workos.listMembers(mine.id)).find((m) => m.userId === userId);
        if (found) await workos.removeMember(found.membershipId);
      }
      await deps.publishers.removeMember(mine.id, userId);
      return json(200, { removed: true });
    }

    // ---- the ledger: what sold, reissue a lost key, revoke one ----
    const ledger = path.match(/^\/api\/publishers\/sales(?:\/([^/]+)\/(reissue|revoke))?$/);
    if (ledger) {
      const saleView = (s: Sale) => ({ ref: s.ref, packId: s.packId, title: s.title, buyerEmail: s.buyerEmail ?? null, amount: s.amount, currency: s.currency, fee: s.fee, status: s.status, createdAt: s.createdAt, fulfilledAt: s.fulfilledAt ?? null, revokedAt: s.revokedAt ?? null, ...(s.status !== "pending" ? { key: s.key ?? null } : {}) });
      if (!ledger[1]) {
        if (method !== "GET") return json(410, { error: ROUTE_GONE });
        return json(200, { sales: (await deps.sales.listSales(mine.id)).map(saleView) });
      }
      if (method !== "POST") return json(410, { error: ROUTE_GONE });
      const sale = await deps.sales.getSale(decodeURIComponent(ledger[1]));
      if (!sale || sale.orgId !== mine.id) return json(200, { found: false });
      if (ledger[2] === "revoke") {
        const revoked: Sale = { ...sale, status: "revoked", revokedAt: now() };
        await deps.sales.putSale(revoked);
        return json(200, { sale: saleView(revoked) });
      }
      // Reissue: the same key, a fresh link, the mail again.
      if (sale.status !== "fulfilled" || !sale.key) return json(422, { error: "only a fulfilled sale can be reissued" });
      const token = newRef() + newRef();
      const reissued: Sale = { ...sale, tokenHash: hashKey(token) };
      await deps.sales.putSale(reissued);
      const link = `${appUrl}/?purchase=${encodeURIComponent(sale.ref)}&t=${encodeURIComponent(token)}`;
      if (deps.mailer && sale.buyerEmail) await deps.mailer.purchase(sale.buyerEmail, { pack: sale.title, publisher: mine.name, link, key: sale.key, ref: sale.ref });
      return json(200, { sale: saleView(reissued), link });
    }

    if (mine.ownerSub !== caller.sub) return json(422, { error: "only the one who founded the publisher sets up its payouts" });
    const stripe = deps.stripe ? await deps.stripe() : null;
    if (path === "/api/publishers/connect" && method === "POST") {
      if (!stripe) return json(200, { available: false });
      // Stripe's refusals here are configuration, not faults — Connect not
      // enabled on the platform, a country it does not serve — and its
      // words are the useful ones, so they come back as a 422.
      try {
        let account = mine.connectAccountId;
        if (!account) {
          const profile = await store.touchProfile(caller.sub, now());
          account = (await stripe.createConnectedAccount({ ...(profile.email ? { email: profile.email } : {}), metadata: { runlog_publisher: mine.id } })).id;
          await deps.publishers.setConnect(mine.id, now(), { connectAccountId: account });
        }
        const link = await stripe.onboardingLink({ account, returnUrl: `${appUrl}/?publisher=connected`, refreshUrl: `${appUrl}/?publisher=connect-again` });
        return json(200, { url: link.url });
      } catch (error) {
        const said = (error as { type?: string; message?: string }).type === "StripeInvalidRequestError" ? (error as { message?: string }).message : undefined;
        if (!said) throw error;
        return json(422, { error: `Stripe said: ${said}` });
      }
    }
    if (path === "/api/publishers/connect/refresh" && method === "POST") {
      if (!stripe || !mine.connectAccountId) return json(200, { publisher: view(mine) });
      const state = await stripe.connectedAccount(mine.connectAccountId);
      const updated = await deps.publishers.setConnect(mine.id, now(), { connectReady: state.chargesEnabled && state.detailsSubmitted });
      return json(200, { publisher: view(updated) });
    }
    if (path === "/api/publishers/dashboard" && method === "POST") {
      if (!stripe || !mine.connectAccountId) return json(200, { available: false });
      return json(200, { url: (await stripe.dashboardLink(mine.connectAccountId)).url });
    }
    return json(410, { error: ROUTE_GONE });
  }

  // ---- races: one run per racer, the same seed, progress reported ----
  const progressOf = (v: unknown): RaceProgress | null => {
    if (!isRecord(v)) return null;
    const { unit, unitsDone, status, ending, elapsedMs } = v;
    const int = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1_000_000;
    if (!int(unit) || !int(unitsDone) || (status !== "active" && status !== "ended")) return null;
    if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
    if (ending !== undefined && (!str(ending) || ending.length > MAX_NAME)) return null;
    return { unit: unit as number, unitsDone: unitsDone as number, status, elapsedMs: Math.round(elapsedMs), updatedAt: now(), ...(str(ending) ? { ending } : {}) };
  };

  if (path === "/api/races") {
    if (method === "GET") return json(200, { races: await deps.races.listRaces(caller.sub) });
    if (method === "POST") {
      const gate = await needsPlus();
      if (gate) return gate;
      const body = parse(event);
      if (!isRecord(body)) return json(422, { error: "a race, as JSON" });
      const { id, packId, packVersion, packTitle, name, mode, seed, sessionId } = body;
      if (!str(id) || !str(packId) || !str(packVersion) || !str(mode) || !str(seed) || !seed.trim()) {
        return json(422, { error: "id, packId, packVersion, mode and a seed are all required" });
      }
      if ([id, packId, packVersion, mode, seed, name, packTitle, sessionId].some(tooLong)) return json(422, { error: "that is too long" });
      if ((name !== undefined && !str(name)) || (packTitle !== undefined && !str(packTitle)) || (sessionId !== undefined && !str(sessionId))) {
        return json(422, { error: "name, packTitle and sessionId are strings when given" });
      }
      const at = now();
      const profile = await store.touchProfile(caller.sub, at);
      // A code is drawn again if it is taken; five misses would be a sign
      // of something other than bad luck.
      let code = "";
      for (let tries = 0; tries < 5; tries++) {
        const candidate = newCode();
        if (!(await deps.races.raceByCode(candidate))) {
          code = candidate;
          break;
        }
      }
      if (!code) return json(500, { error: "could not find a free code; try again" });
      const created = await deps.races.createRace(
        { id, code, packId, packVersion, mode, seed: seed.trim(), ownerSub: caller.sub, ...(str(name) && name.trim() ? { name: name.trim() } : {}), ...(str(packTitle) ? { packTitle } : {}) },
        at,
        { ...(shownName(profile) ? { name: shownName(profile) } : {}), ...(str(sessionId) ? { sessionId } : {}) },
      );
      if (!created) return json(409, { error: "that race already exists" });
      return json(200, { race: created.meta, entries: created.entries });
    }
    return json(410, { error: ROUTE_GONE });
  }
  if (path === "/api/races/join" && method === "POST") {
    const body = parse(event);
    const code = isRecord(body) && str(body["code"]) ? normalizeCode(body["code"]) : "";
    if (code.length !== CODE_LENGTH) return json(422, { error: "code: six letters" });
    const id = await deps.races.raceByCode(code);
    const profile = await store.touchProfile(caller.sub, now());
    const joined = id ? await deps.races.joinRace(id, caller.sub, shownName(profile), now()) : null;
    if (!joined) return json(410, { error: "no race answers to that code, or it has ended" });
    await deps.notify?.(joined.meta.id, joined.meta.seq);
    return json(200, { race: joined.meta, entries: joined.entries });
  }
  const race = path.match(/^\/api\/races\/([^/]+)(\/entries\/me|\/invites)?$/);
  if (race) {
    const id = decodeURIComponent(race[1]!);
    const found = await deps.races.getRace(id);
    const me = found?.entries.find((e) => e.sub === caller.sub);
    // Not in it reads what a stranger would: nothing.
    if (!found || !me) return json(200, { found: false });
    const sub = race[2] ?? "";
    if (sub === "/entries/me") {
      if (method !== "PUT") return json(410, { error: ROUTE_GONE });
      const body = parse(event);
      if (!isRecord(body)) return json(422, { error: "an entry, as JSON" });
      const { sessionId, name, progress } = body;
      if ((sessionId !== undefined && (!str(sessionId) || tooLong(sessionId))) || (name !== undefined && (!str(name) || tooLong(name)))) {
        return json(422, { error: "sessionId and name are short strings when given" });
      }
      const p = progress !== undefined ? progressOf(progress) : undefined;
      if (progress !== undefined && !p) return json(422, { error: "progress: unit, unitsDone, status, elapsedMs" });
      const updated = await deps.races.updateEntry(id, caller.sub, now(), {
        ...(str(sessionId) ? { sessionId } : {}),
        ...(str(name) ? { name: name.trim() } : {}),
        ...(p ? { progress: p } : {}),
      });
      if (!updated) return json(200, { found: false });
      await deps.notify?.(id, updated.meta.seq);
      return json(200, { race: updated.meta, entries: updated.entries });
    }
    if (sub === "/invites") {
      if (method !== "POST") return json(410, { error: ROUTE_GONE });
      if (found.meta.ownerSub !== caller.sub) return json(422, { error: "only the one who started the race invites" });
      const body = parse(event);
      const email = isRecord(body) && str(body["email"]) ? body["email"].trim().toLowerCase() : "";
      if (!EMAIL.test(email) || email.length > MAX_NAME) return json(422, { error: "email: an address to send it to" });
      if ((await store.countInvite(caller.sub, now())) > MAX_INVITES_PER_HOUR) {
        return json(429, { error: "that is a lot of invitations in an hour; try again later" });
      }
      const profile = await store.touchProfile(caller.sub, now());
      const link = `${(deps.appUrl ?? "/").replace(/\/$/, "")}/?race=${found.meta.code}`;
      if (deps.mailer) {
        await deps.mailer.invite(email, {
          inviter: shownName(profile) ?? "Somebody",
          session: found.meta.name ?? `a ${found.meta.packTitle ?? found.meta.packId} race`,
          pack: found.meta.packTitle ?? found.meta.packId,
          link,
          role: "racer",
        });
      }
      return json(200, { link, code: found.meta.code });
    }
    if (method === "GET") return json(200, { found: true, race: found.meta, entries: found.entries });
    if (method === "PATCH") {
      if (found.meta.ownerSub !== caller.sub) return json(422, { error: "only the one who started the race changes it" });
      const body = parse(event);
      if (!isRecord(body)) return json(422, { error: "a patch, as JSON" });
      const { name, ended } = body;
      if ((name !== undefined && !str(name)) || tooLong(name)) return json(422, { error: "name is a short string when given" });
      const updated = await deps.races.updateRace(id, now(), { ...(name !== undefined ? { name: name.trim() } : {}), ...(ended === true ? { endedAt: now() } : {}) });
      if (!updated) return json(200, { found: false });
      await deps.notify?.(id, updated.meta.seq);
      return json(200, { race: updated.meta, entries: updated.entries });
    }
    return json(410, { error: ROUTE_GONE });
  }

  if (path === "/api/sessions") {
    if (method === "GET") return json(200, { sessions: (await store.manifest(caller.sub)).sessions });
    if (method === "POST") {
      const body = parse(event);
      if (!isRecord(body)) return json(422, { error: "a session, as JSON" });
      const { id, packId, packVersion, packTitle, name, events } = body;
      const log = sessionEvents(events);
      if (!str(id) || !str(packId) || !str(packVersion) || !log || log.length === 0) {
        return json(422, { error: "id, packId, packVersion and a non-empty events list are all required" });
      }
      const first = log[0]!;
      if (first["t"] !== "RunStarted" || (first["runId"] !== undefined && first["runId"] !== id)) {
        return json(422, { error: "a log starts with RunStarted, and names this session if it names any" });
      }
      if ((name !== undefined && !str(name)) || tooLong(name)) return json(422, { error: "name is a short string when given" });
      if ((packTitle !== undefined && !str(packTitle)) || tooLong(packTitle)) return json(422, { error: "packTitle is a short string when given" });
      const created = await store.createSession(
        { id, packId, packVersion, ownerSub: caller.sub, ...(name ? { name } : {}), ...(packTitle ? { packTitle } : {}) },
        now(),
        shownName(await store.touchProfile(caller.sub, now())),
        log,
      );
      if (!created) return json(409, { error: "that session already exists; fetch it and append" });
      return json(200, { session: created.meta, events: created.events });
    }
  }

  const session = path.match(/^\/api\/sessions\/([^/]+)(\/events|\/invites|\/invites\/[^/]+|\/members\/[^/]+|\/public|\/snapshot|\/reactions)?$/);
  if (session) {
    const id = decodeURIComponent(session[1]!);
    const found = await store.getSession(id);
    if (!found) return json(200, { found: false });
    const me = found.members.find((m) => m.sub === caller.sub);
    // Not a member reads exactly what a stranger would: nothing, and no
    // hint that the id is real. The same 200 as "never existed".
    if (!me) return json(200, { found: false });
    if (found.meta.deletedAt) return json(410, { deletedAt: found.meta.deletedAt });

    const sub = session[2] ?? "";
    // What a member sees of the session: the hash of a link's token is not theirs to see.
    const metaView = ({ publicTokenHash, ...rest }: SessionMeta) => ({ ...rest, shared: Boolean(publicTokenHash) });

    if (sub === "/reactions" && method === "GET") return json(200, { reactions: await store.listReactions(id) });
    if (sub === "/reactions" && method === "POST") {
      if (found.meta.endedAt) return json(410, { error: "this run is over" });
      const body = parse(event);
      const emoji = isRecord(body) && str(body["emoji"]) ? body["emoji"] : "";
      if (!REACTIONS.has(emoji)) return json(422, { error: "emoji: one of " + [...REACTIONS].join(" ") });
      const who = shownName(await store.touchProfile(caller.sub, now()));
      const reactions = await store.addReaction(id, { emoji, at: now(), ...(who ? { name: who } : {}) });
      await deps.notify?.(id, found.meta.seq);
      return json(200, { reactions });
    }

    // ---- open to anyone with the link: the owner switches it on, and off ----
    if (sub === "/public") {
      if (me.role !== "owner") return json(422, { error: "only the owner shares a live link" });
      if (method === "POST") {
        const gate = await needsPlus();
        if (gate) return gate;
        const token = (deps.token ?? (() => randomBytes(24).toString("base64url")))();
        await store.updateSession(id, now(), { publicTokenHash: hashToken(token) });
        // The short form: a page with a preview that sends a browser on to the app.
        const link = `${(deps.appUrl ?? "/").replace(/\/$/, "")}/r/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`;
        return json(200, { shared: true, token, link });
      }
      if (method === "DELETE") {
        await store.updateSession(id, now(), { publicTokenHash: null });
        return json(200, { shared: false });
      }
      return json(410, { error: ROUTE_GONE });
    }
    // ---- the snapshot the owner's device keeps for strangers who may not hold the pack ----
    if (sub === "/snapshot") {
      if (method !== "PUT") return json(410, { error: ROUTE_GONE });
      if (me.role !== "owner") return json(422, { error: "only the owner writes the snapshot" });
      const body = parse(event);
      if (!isRecord(body) || !isRecord(body["snapshot"])) return json(422, { error: "snapshot: an object" });
      if (Buffer.byteLength(JSON.stringify(body["snapshot"])) > 200_000) return json(413, { error: "the snapshot is too large" });
      await store.putSnapshot(id, now(), body["snapshot"]);
      await deps.notify?.(id, found.meta.seq);
      return json(200, { kept: true });
    }
    if (sub === "/invites") {
      if (method === "GET") {
        if (me.role !== "owner") return json(422, { error: "only the owner sees the invitations" });
        const invites = (await store.listInvites(id)).filter((i) => i.expiresAt >= now());
        return json(200, { invites: invites.map(({ token, email, role, createdAt, expiresAt, acceptedBy, acceptedAt }) => ({ token, email, role, createdAt, expiresAt, accepted: Boolean(acceptedBy), ...(acceptedAt ? { acceptedAt } : {}) })) });
      }
      if (method === "POST") {
        if (me.role !== "owner") return json(422, { error: "only the owner invites" });
        const gate = await needsPlus();
        if (gate) return gate;
        const body = parse(event);
        if (!isRecord(body)) return json(422, { error: "an invitation, as JSON" });
        const email = str(body["email"]) ? body["email"].trim().toLowerCase() : "";
        const role: Role = body["role"] === "viewer" ? "viewer" : "player";
        if (!EMAIL.test(email) || email.length > MAX_NAME) return json(422, { error: "email: an address to send it to" });
        if ((await store.countInvite(caller.sub, now())) > MAX_INVITES_PER_HOUR) {
          return json(429, { error: "that is a lot of invitations in an hour; try again later" });
        }
        const at = now();
        const profile = await store.touchProfile(caller.sub, at);
        const token = (deps.token ?? (() => randomBytes(24).toString("base64url")))();
        const expiresAt = new Date(Date.parse(at) + INVITE_DAYS * 86400_000).toISOString();
        await store.createInvite({ token, sessionId: id, email, role, invitedBy: caller.sub, ...(shownName(profile) ? { invitedByName: shownName(profile) } : {}), createdAt: at, expiresAt });
        const link = `${(deps.appUrl ?? "/").replace(/\/$/, "")}/?join=${encodeURIComponent(token)}`;
        if (deps.mailer) {
          await deps.mailer.invite(email, {
            inviter: shownName(profile) ?? "Somebody",
            session: found.meta.name ?? `a ${found.meta.packTitle ?? found.meta.packId} run`,
            pack: found.meta.packTitle ?? found.meta.packId,
            link,
            role,
          });
        }
        return json(200, { invite: { token, email, role, createdAt: at, expiresAt, accepted: false }, link });
      }
      return json(410, { error: ROUTE_GONE });
    }
    const revoke = sub.match(/^\/invites\/([^/]+)$/);
    if (revoke) {
      if (method !== "DELETE") return json(410, { error: ROUTE_GONE });
      if (me.role !== "owner") return json(422, { error: "only the owner withdraws an invitation" });
      await store.revokeInvite(id, decodeURIComponent(revoke[1]!));
      return json(200, { revoked: true });
    }
    const member = sub.match(/^\/members\/([^/]+)$/);
    if (member) {
      if (method !== "DELETE") return json(410, { error: ROUTE_GONE });
      const who = decodeURIComponent(member[1]!);
      if (who === caller.sub) return json(422, { error: "leave with DELETE on the session instead" });
      if (me.role !== "owner") return json(422, { error: "only the owner removes a member" });
      const removed = await store.removeMember(id, who, now());
      return json(200, { removed });
    }

    if (sub === "/events") {
      if (method !== "POST") return json(410, { error: ROUTE_GONE });
      if (me.role === "viewer") return json(422, { error: "a viewer watches; only players make moves" });
      const body = parse(event);
      const log = isRecord(body) ? sessionEvents(body["events"]) : null;
      if (!log) return json(422, { error: "events: a list of events with ids, at most a move's worth" });
      const { appended, seq } = await store.appendEvents(id, caller.sub, now(), log);
      await deps.notify?.(id, seq);
      return json(200, { appended, seq });
    }

    if (method === "GET") {
      const after = Number(event.queryStringParameters?.["after"] ?? 0);
      const events = await store.eventsAfter(id, Number.isFinite(after) && after > 0 ? after : 0);
      return json(200, { found: true, session: metaView(found.meta), members: await asShownNow(store, found.members), events });
    }
    if (method === "PATCH") {
      if (me.role === "viewer") return json(422, { error: "a viewer cannot change the session" });
      const body = parse(event);
      if (!isRecord(body)) return json(422, { error: "a patch, as JSON" });
      const { name, ended } = body;
      if ((name !== undefined && !str(name)) || tooLong(name)) return json(422, { error: "name is a short string when given" });
      const patch = { ...(name !== undefined ? { name: name.trim() } : {}), ...(ended === true ? { endedAt: now() } : {}) };
      const meta: SessionMeta | null = await store.updateSession(id, now(), patch);
      if (meta) await deps.notify?.(id, meta.seq);
      return json(200, { session: meta });
    }
    if (method === "DELETE") {
      const result = await store.deleteSession(id, caller.sub, now());
      return json(200, result ?? { found: false });
    }
  }

  const license = path.match(/^\/api\/licenses\/([^/]+)$/);
  if (license) {
    const packId = decodeURIComponent(license[1]!);
    if (method === "GET") {
      const found = await store.getLicense(caller.sub, packId);
      if (!found) return json(200, { found: false });
      if (found.meta.deletedAt) return json(410, { deletedAt: found.meta.deletedAt });
      return json(200, { found: true, license: { ...found.meta, key: found.key } });
    }
    if (method === "PUT") {
      const body = parse(event);
      if (!isRecord(body)) return json(422, { error: "a license, as JSON" });
      const { key, ref, title, updatedAt, hash } = body;
      if (!str(key) || !key.trim() || !str(updatedAt) || !str(hash)) {
        return json(422, { error: "key, updatedAt and hash are all required" });
      }
      if ((ref !== undefined && !str(ref)) || (title !== undefined && !str(title))) {
        return json(422, { error: "ref and title are strings when given" });
      }
      if (key.length > MAX_KEY_CHARS || (ref ?? "").length > MAX_KEY_CHARS || (title ?? "").length > MAX_KEY_CHARS) {
        return json(413, { error: "that is not a license key" });
      }
      const conflict = await mismatch(event, (await store.getLicense(caller.sub, packId))?.meta);
      if (conflict) return conflict;
      const meta: LicenseMeta = { id: packId, updatedAt, hash, ...(ref ? { ref } : {}), ...(title ? { title } : {}) };
      await store.putLicense(caller.sub, meta, key);
      return json(200, { entry: meta });
    }
    if (method === "DELETE") {
      const meta = await store.deleteLicense(caller.sub, packId, now());
      return json(200, { deletedAt: meta.deletedAt });
    }
  }

  return json(410, { error: ROUTE_GONE });
}

/**
 * `If-Match` carries the hash the client last saw. If the server holds
 * something else, another device wrote in between, and the answer is the
 * server's entry so the client can diff again rather than overwrite blind.
 */
async function mismatch(event: APIGatewayProxyEventV2, current: PackMeta | LicenseMeta | undefined): Promise<Result | null> {
  const expected = header(event, "if-match")?.replace(/^"|"$/g, "");
  if (!expected) return null;
  if (!current) return expected === "*" ? null : json(409, { entry: null });
  if (current.hash !== expected) return json(409, { entry: current });
  return null;
}

/* ---- the Lambda ---------------------------------------------------------- */

let deps: Deps | undefined;
let stripeClient: StripeLike | undefined;
let workosClient: WorkOSLike | undefined;
const secrets = secretsReader();

/** The plan keys the app asks for, from the price ids the stack was given. */
export function pricesFromEnv(raw: string | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    const out: Record<string, string> = {};
    const keys: Record<string, string> = { plusMonthly: "plus-monthly", plusYearly: "plus-yearly", hostedMonthly: "hosted-monthly", hostedYearly: "hosted-yearly", serverMonthly: "server-monthly", serverYearly: "server-yearly" };
    for (const [field, key] of Object.entries(keys)) {
      const id = parsed[field];
      if (typeof id === "string" && id) out[key] = id;
    }
    return out;
  } catch {
    return {};
  }
}

export function feesFromEnv(raw: string | undefined): { subscribed: number; unsubscribed: number } {
  try {
    const parsed = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    const n = (v: unknown, d: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000 ? v : d);
    return { subscribed: n(parsed["subscribed"], 0), unsubscribed: n(parsed["unsubscribed"], 500) };
  } catch {
    return { subscribed: 0, unsubscribed: 500 };
  }
}

export function featuresFromEnv(raw: string | undefined): { plus: string; hostedLicensing: string; server: string } {
  try {
    const parsed = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    const s = (key: string, fallback: string) => (typeof parsed[key] === "string" && parsed[key] ? (parsed[key] as string) : fallback);
    return { plus: s("plus", "plus"), hostedLicensing: s("hostedLicensing", "hosted-licensing"), server: s("server", "server") };
  } catch {
    return { plus: "plus", hostedLicensing: "hosted-licensing", server: "server" };
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<Result> {
  if (!deps) {
    const clientId = process.env["WORKOS_CLIENT_ID"] ?? "";
    const cliClientId = process.env["WORKOS_CLI_CLIENT_ID"] ?? "";
    deps = {
      store: dynamoStore({ table: process.env["TABLE_NAME"] ?? "", bucket: process.env["BUCKET_NAME"] ?? "" }),
      races: dynamoRaces({ table: process.env["TABLE_NAME"] ?? "" }),
      billing: dynamoBilling({ table: process.env["TABLE_NAME"] ?? "" }),
      publishers: dynamoPublishers({ table: process.env["TABLE_NAME"] ?? "" }),
      listings: dynamoListings({ table: process.env["TABLE_NAME"] ?? "", bucket: process.env["BUCKET_NAME"] ?? "" }),
      sales: dynamoSales({ table: process.env["TABLE_NAME"] ?? "", bucket: process.env["BUCKET_NAME"] ?? "" }),
      connectWebhookSecret: async () => {
        const value = await secrets(process.env["STRIPE_CONNECT_WEBHOOK_SECRET_SECRET"] ?? "");
        return looksLike("webhook-secret", value) ? value : null;
      },
      fees: feesFromEnv(process.env["STRIPE_FEE_BPS"]),
      workos: async () => {
        const key = await secrets(process.env["WORKOS_API_KEY_SECRET"] ?? "");
        return looksLike("workos-key", key) ? (workosClient ??= realWorkOS(key)) : null;
      },
      gates: process.env["RUNLOG_GATES"] === "on",
      guilds: dynamoGuilds({ table: process.env["TABLE_NAME"] ?? "", bucket: process.env["BUCKET_NAME"] ?? "" }),
      ...(process.env["DISCORD_APPLICATION_ID"] && process.env["DISCORD_PUBLIC_KEY"]
        ? (() => {
            const token = async () => {
              const value = await secrets(process.env["DISCORD_BOT_TOKEN_SECRET"] ?? "");
              return looksLike("discord-token", value) ? value : null;
            };
            return {
              discord: {
                applicationId: process.env["DISCORD_APPLICATION_ID"],
                publicKey: process.env["DISCORD_PUBLIC_KEY"],
                open: process.env["DISCORD_OPEN"] === "on",
                token,
                guildName: async (guildId: string) => {
                  const t = await token();
                  return t ? guildNameFrom(t, guildId) : null;
                },
                rest: async () => {
                  const t = await token();
                  return t ? discordRest(t) : null;
                },
              },
            };
          })()
        : {}),
      prices: pricesFromEnv(process.env["STRIPE_PRICES"]),
      features: featuresFromEnv(process.env["STRIPE_FEATURES"]),
      stripe: async () => {
        const key = await secrets(process.env["STRIPE_SECRET_KEY_SECRET"] ?? "");
        return looksLike("stripe-key", key) ? (stripeClient ??= realStripe(key)) : null;
      },
      webhookSecret: async () => {
        const value = await secrets(process.env["STRIPE_WEBHOOK_SECRET_SECRET"] ?? "");
        return looksLike("webhook-secret", value) ? value : null;
      },
      // Tokens from the browser's client and the command line's are both ours.
      verify: (authorization) => verifyToken(authorization, [clientId, cliClientId]),
      env: process.env["RUNLOG_ENV"] ?? "",
      // A view becomes a CloudWatch metric by way of the embedded metric
      // format: one log line that CloudWatch reads as a count, under the
      // Runlog namespace, by screen, by country and by version. No table,
      // no row, nothing to delete.
      count: (view) =>
        console.log(
          JSON.stringify({
            _aws: {
              Timestamp: Date.now(),
              CloudWatchMetrics: [
                {
                  Namespace: "Runlog",
                  Dimensions: [
                    ["env", "screen"],
                    ["env", "country"],
                    ["env", "version"],
                  ],
                  Metrics: [{ Name: "views", Unit: "Count" }],
                },
              ],
            },
            env: process.env["RUNLOG_ENV"] ?? "",
            screen: view.screen,
            country: view.country,
            version: view.version,
            views: 1,
          }),
        ),
      ...(cliClientId ? { cliClientId } : {}),
      mailer: sesMailer({ from: process.env["EMAIL_FROM"] ?? "", region: process.env["EMAIL_REGION"] ?? "us-west-2" }),
      appUrl: process.env["APP_URL"] ?? "/",
      ...(process.env["WS_ENDPOINT"]
        ? { notify: notifier(dynamoLive({ table: process.env["TABLE_NAME"] ?? "" }), apiGatewayPoster(process.env["WS_ENDPOINT"])) }
        : {}),
    };
  }
  try {
    return await route(event, deps);
  } catch (error) {
    console.error(error);
    return json(500, { error: "something went wrong on this side" });
  }
}
