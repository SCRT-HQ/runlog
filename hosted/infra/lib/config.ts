/**
 * What a stage is.
 *
 * The shape of one deployed copy of the hosting: its account and region,
 * its domain, its sign-in clients, its mail identity, its plans and the
 * words on its pages. The values are not in this file (see `envConfig`
 * below): they are one operator's, and this repository is anyone's to
 * read and build from.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A stage's name: a short lowercase word, `dev` and `prd` here. */
export type EnvName = string;

export interface EnvConfig {
  name: EnvName;
  /** The AWS account this environment deploys into. */
  account: string;
  /**
   * Everything lives in us-east-1.
   *
   * Not preference: CloudFront can only use an ACM certificate issued in
   * us-east-1, and keeping the whole stack there avoids a cross-region
   * reference for the sake of one certificate. When an API arrives that wants
   * to live nearer someone, it can have its own region and its own stack.
   */
  region: string;
  /** The hostname the app is served from. */
  domain: string;
  /** The Route 53 zone that answers for it, which already exists. */
  zone: string;
  /**
   * Explicit zone id, when you would rather not have CDK look it up.
   *
   * A lookup needs credentials at synth time and caches the answer into
   * `cdk.context.json`, which is a nuisance in a repo deploying to two
   * accounts: the cached dev zone would be used for prd. Setting the id
   * removes the lookup entirely.
   */
  zoneId?: string;
  /** Retain buckets and logs in production; let dev be torn down cleanly. */
  retain: boolean;
  /**
   * The WorkOS AuthKit client the app signs people in with, so the API can
   * check that a token was issued for *this* app and not another one in the
   * same WorkOS account. Public — it appears in every sign-in URL — so it is
   * written here rather than kept as a secret, and it matches the one the app
   * is built with.
   */
  workosClientId: string;
  /**
   * The WorkOS application the command line signs in with, through the
   * device flow: a public client of its own, so its session policy (a month
   * idle rather than two days) and its redirects are not the browser's.
   * `runlog login` asks the API for it, so nothing is baked into the package.
   */
  workosCliClientId: string;
  /**
   * Where invitations are sent from. The verified SES identity lives in a
   * region of its own (core-infra put it in us-west-2), so both are named.
   */
  email: { from: string; region: string; identity: string };
  /**
   * What the hosted pages say about who runs this copy. The app itself is
   * generic and open source; these are the words that make an address of
   * it a service someone operates. They land in `hosted.json` and the legal
   * pages at publish time, so the app reads them rather than carrying them.
   */
  /**
   * Whether plans gate anything. Off, everything on the pricing page is
   * open to everyone and nothing is charged; on, hosting a table needs
   * Plus. Dev runs gated so the gates are exercised; production stays
   * open until Stripe is live there. Config, never a branch.
   */
  gates: boolean;
  /**
   * What is sold, by Stripe id. Prices are public — they appear in every
   * Checkout — so they are written here; the ids come from
   * `hosted/scripts/stripe-setup.ts`, run once per environment. Empty until then,
   * and an empty price is a plan that cannot be bought yet.
   */
  stripe: {
    prices: { plusMonthly: string; plusYearly: string; hostedMonthly: string; hostedYearly: string; serverMonthly: string; serverYearly: string };
    /** The feature lookup keys Stripe entitles; what `entitlements` in `GET /api/me` carries. */
    features: { plus: string; hostedLicensing: string; server: string };
    /** The platform's share of a sale, in basis points, by whether the publisher subscribes to hosted licensing. */
    applicationFeeBps: { subscribed: number; unsubscribed: number };
  };
  /**
   * Monitoring of the handlers, when the operator has somewhere to send it.
   * New Relic's Lambda layer wraps both functions: traces, errors and the
   * function logs, with request bodies, the authorization header and
   * addresses kept out. Absent, the functions run bare, which is what a
   * copy without an account there wants.
   */
  /**
   * The Discord application the bot is, when the operator has made one.
   * Both values are public: the id is in every install link, and the key
   * is what Discord signs interactions with, shown on the application's
   * page for anyone to check against. The bot's token is a secret and
   * lives in Secrets Manager. Absent, the interactions endpoint answers
   * that it is not configured and nothing about Discord is offered.
   */
  discord?: {
    applicationId: string;
    publicKey: string;
    /**
     * Whether Runlog for servers is on sale. Off, everyone sees the tier
     * and may claim a server and fill its vault, but the plan itself is
     * shown as coming, and only a `server` feature flag on a WorkOS
     * session (or a grant Stripe already gave) holds it: the way to let a
     * few people try it. On, Checkout is offered. Absent is off.
     */
    open: boolean;
    /**
     * The SKU of a guild subscription sold through Discord's own store
     * (Monetization in the developer portal), where one is set up: a
     * server whose members bought it holds the server plan the same as
     * one whose owner subscribed here. Absent, the store is not consulted.
     */
    serverSku?: string;
  };
  apm?: {
    newRelic: {
      /** The New Relic account the telemetry goes to; its parent's, as the trusted key, where there is one. */
      accountId: string;
      trustedAccountKey?: string;
      /** The layer's version for this region and runtime; NewRelicNodeJS24XARM64 as published by New Relic. */
      layerVersion: number;
    };
  };
  hosted: {
    /** The full legal name, on the terms, the policies, the publisher agreement and every copyright line. */
    operator: string;
    /** The short name, for a footer, an about page, and anywhere nothing is agreed to. */
    operatorShort: string;
    /** The operator's own site, where the name in a footer goes; absent, the name goes to the about page. */
    operatorUrl?: string;
    /** Where support, privacy requests and security reports go. */
    support: string;
    /**
     * The terms' version, and the day they took effect. Bump the version
     * when the terms or the privacy policy change in a way that matters:
     * the app asks everyone signed in to accept the new one once.
     */
    termsVersion: string;
    termsDate: string;
    /** Whether the app shows plans, checkout and the portal. Off until Stripe is set up for the environment. */
    billing: boolean;
    /**
     * Whether the app's bundled catalog includes the engine-testing pack:
     * dev yes, production no. Absent is treated as `false`, so a stage
     * whose configuration predates this flag stays production-safe rather
     * than shipping a test bench nobody asked for.
     */
    testing: boolean;
  };
}

/**
 * Where a stage's configuration comes from.
 *
 * Not from this file. A stage is one operator's identity: its domain, its
 * sign-in clients, its prices, the words on its pages. None of that is
 * secret, but none of it belongs in a repository anyone can read and
 * build from, so it lives as one JSON document per stage: on the GitHub
 * environment as the `RUNLOG_ENV_CONFIG` variable, and on a machine as
 * `hosted/infra/env/<stage>.json`, which git ignores. `env/example.json`
 * is the template and what the tests run against.
 */
const NAME = /^[a-z][a-z0-9-]{0,15}$/;

/**
 * The account to deploy into.
 *
 * Deliberately *not* `CDK_DEFAULT_ACCOUNT`. The CDK CLI overwrites that with
 * whatever account the resolved credentials belong to, so on a machine with
 * an SSO session open it silently becomes the management account, and this
 * value ends up in the bucket's name. `RUNLOG_TARGET_ACCOUNT` is set
 * explicitly by the `run-cdk` action and cannot be clobbered.
 */
function accountFor(name: EnvName): string {
  const target = process.env.RUNLOG_TARGET_ACCOUNT;
  if (target) return target;
  return required(`RUNLOG_${name.toUpperCase().replace(/-/g, "_")}_ACCOUNT`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. The account is named by environment variable so this repository is not tied to one person's AWS. See docs/self-hosting.md.`);
  }
  return value;
}

function readStage(name: EnvName): Record<string, unknown> {
  const inline = process.env["RUNLOG_ENV_CONFIG"];
  const file = join(__dirname, "..", "env", `${name}.json`);
  const text = inline ?? (existsSync(file) ? readFileSync(file, "utf8") : undefined);
  if (!text) {
    throw new Error(
      `No configuration for the stage "${name}". Set RUNLOG_ENV_CONFIG to its JSON, ` +
        `or write ${file} (env/example.json is the template). See docs/self-hosting.md.`,
    );
  }
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`The configuration for "${name}" is not a JSON object`);
  return parsed as Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, at: string): string => {
  if (typeof v !== "string" || !v) throw new Error(`configuration: ${at} must be a non-empty string`);
  return v;
};
const bool = (v: unknown, at: string): boolean => {
  if (typeof v !== "boolean") throw new Error(`configuration: ${at} must be true or false`);
  return v;
};
const num = (v: unknown, at: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`configuration: ${at} must be a number`);
  return v;
};
const rec = (v: unknown, at: string): Record<string, unknown> => {
  if (!isRecord(v)) throw new Error(`configuration: ${at} must be an object`);
  return v;
};
/** Like `bool`, but a missing key takes the given default rather than erroring. */
const boolOr = (v: unknown, at: string, fallback: boolean): boolean => (v === undefined ? fallback : bool(v, at));

/** The zone id, when the operator would rather CDK did not look it up. */
function zoneIdFor(name: EnvName): string | undefined {
  return process.env["RUNLOG_ZONE_ID"] || process.env[`RUNLOG_${name.toUpperCase().replace(/-/g, "_")}_ZONE_ID`] || undefined;
}

export function envConfig(name: EnvName): EnvConfig {
  const c = readStage(name);
  const email = rec(c["email"], "email");
  const stripe = rec(c["stripe"], "stripe");
  const prices = rec(stripe["prices"], "stripe.prices");
  const features = rec({ plus: "plus", hostedLicensing: "hosted-licensing", server: "server", ...(isRecord(stripe["features"]) ? stripe["features"] : {}) }, "stripe.features");
  const fee = rec(stripe["applicationFeeBps"] ?? { subscribed: 0, unsubscribed: 500 }, "stripe.applicationFeeBps");
  const hosted = rec(c["hosted"], "hosted");
  const price = (key: string): string => {
    const v = prices[key] ?? "";
    if (typeof v !== "string") throw new Error(`configuration: stripe.prices.${key} must be a string`);
    return v;
  };
  const zoneId = zoneIdFor(name) ?? (typeof c["zoneId"] === "string" && c["zoneId"] ? c["zoneId"] : undefined);
  return {
    name,
    // Fixed, not inherited. The CDK CLI overwrites CDK_DEFAULT_REGION with
    // whatever region the resolved credentials point at, so reading it
    // would mean the stack quietly followed a developer's default profile;
    // and CloudFront will not accept a certificate from anywhere but
    // us-east-1.
    region: "us-east-1",
    account: accountFor(name),
    domain: str(c["domain"], "domain"),
    zone: str(c["zone"], "zone"),
    ...(zoneId ? { zoneId } : {}),
    retain: bool(c["retain"], "retain"),
    workosClientId: str(c["workosClientId"], "workosClientId"),
    workosCliClientId: str(c["workosCliClientId"], "workosCliClientId"),
    email: { from: str(email["from"], "email.from"), region: str(email["region"], "email.region"), identity: str(email["identity"], "email.identity") },
    gates: bool(c["gates"], "gates"),
    stripe: {
      prices: { plusMonthly: price("plusMonthly"), plusYearly: price("plusYearly"), hostedMonthly: price("hostedMonthly"), hostedYearly: price("hostedYearly"), serverMonthly: price("serverMonthly"), serverYearly: price("serverYearly") },
      features: { plus: str(features["plus"], "stripe.features.plus"), hostedLicensing: str(features["hostedLicensing"], "stripe.features.hostedLicensing"), server: str(features["server"], "stripe.features.server") },
      applicationFeeBps: { subscribed: num(fee["subscribed"], "stripe.applicationFeeBps.subscribed"), unsubscribed: num(fee["unsubscribed"], "stripe.applicationFeeBps.unsubscribed") },
    },
    ...(isRecord(c["discord"])
      ? {
          discord: {
            applicationId: str(c["discord"]["applicationId"], "discord.applicationId"),
            publicKey: str(c["discord"]["publicKey"], "discord.publicKey"),
            open: boolOr(c["discord"]["open"], "discord.open", false),
            ...(typeof c["discord"]["serverSku"] === "string" && c["discord"]["serverSku"].trim() ? { serverSku: c["discord"]["serverSku"].trim() } : {}),
          },
        }
      : {}),
    ...(isRecord(c["apm"]) && isRecord(c["apm"]["newRelic"])
      ? {
          apm: {
            newRelic: {
              accountId: str(c["apm"]["newRelic"]["accountId"], "apm.newRelic.accountId"),
              ...(typeof c["apm"]["newRelic"]["trustedAccountKey"] === "string" ? { trustedAccountKey: c["apm"]["newRelic"]["trustedAccountKey"] } : {}),
              layerVersion: num(c["apm"]["newRelic"]["layerVersion"] ?? 52, "apm.newRelic.layerVersion"),
            },
          },
        }
      : {}),
    hosted: {
      operator: str(hosted["operator"], "hosted.operator"),
      operatorShort: str(hosted["operatorShort"], "hosted.operatorShort"),
      ...(typeof hosted["operatorUrl"] === "string" && hosted["operatorUrl"] ? { operatorUrl: hosted["operatorUrl"] } : {}),
      support: str(hosted["support"], "hosted.support"),
      termsVersion: str(hosted["termsVersion"], "hosted.termsVersion"),
      termsDate: str(hosted["termsDate"], "hosted.termsDate"),
      billing: bool(hosted["billing"], "hosted.billing"),
      testing: boolOr(hosted["testing"], "hosted.testing", false),
    },
  };
}

/**
 * Which environment this run is for.
 *
 * `AWS_ENVIRONMENT` is the name the shared workflow actions already use across
 * these repositories; `RUNLOG_ENV` is accepted too so a local `cdk diff` reads
 * the way the rest of this project does.
 */
export function currentEnv(): EnvName {
  const raw = process.env.AWS_ENVIRONMENT ?? process.env.RUNLOG_ENV ?? "dev";
  if (!NAME.test(raw)) {
    throw new Error(`AWS_ENVIRONMENT must be a short lowercase name such as "dev" or "prd", not ${JSON.stringify(raw)}`);
  }
  return raw;
}
