/**
 * What differs between the two accounts.
 *
 * Account ids are read from the environment rather than committed. They are
 * not secret — an account id is in every ARN — but hardcoding them makes the
 * repository specific to one person's AWS, and this one is meant to be
 * readable by anyone.
 *
 * Everything else is here in plain sight, because "which domain does dev use"
 * is the kind of question that should be answerable by reading one file.
 */

export type EnvName = "dev" | "prd";

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
    prices: { plusMonthly: string; plusYearly: string; hostedMonthly: string; hostedYearly: string };
    /** The feature lookup keys Stripe entitles; what `entitlements` in `GET /api/me` carries. */
    features: { plus: string; hostedLicensing: string };
    /** The platform's share of a sale, in basis points, by whether the publisher subscribes to hosted licensing. */
    applicationFeeBps: { subscribed: number; unsubscribed: number };
  };
  hosted: {
    /** The full legal name, on the terms, the policies, the publisher agreement and every copyright line. */
    operator: string;
    /** The short name, for a footer, an about page, and anywhere nothing is agreed to. */
    operatorShort: string;
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
  };
}

/** What Stripe calls the features, and the fee rule; the same in both environments. */
const STRIPE = {
  features: { plus: "plus", hostedLicensing: "hosted-licensing" },
  applicationFeeBps: { subscribed: 0, unsubscribed: 500 },
};

/** The hosted words shared by both environments. What differs is said below. */
const HOSTED = {
  operator: "Secret Headquarters, LLC",
  operatorShort: "Secret Headquarters",
  support: "runlog@scrthq.com",
  termsVersion: "2026-09-07",
  termsDate: "2026-09-07",
};

/**
 * The account to deploy into.
 *
 * Deliberately *not* `CDK_DEFAULT_ACCOUNT`. The CDK CLI overwrites that with
 * whatever account the resolved credentials belong to, so on a machine with an
 * SSO session open it silently becomes the management account — and this value
 * ends up in the bucket's name, so the mistake ships as a real resource rather
 * than an error. `RUNLOG_TARGET_ACCOUNT` is set explicitly by the `run-cdk`
 * action and cannot be clobbered.
 */
function accountFor(name: EnvName): string {
  const target = process.env.RUNLOG_TARGET_ACCOUNT;
  if (target) return target;
  return required(name === "prd" ? "RUNLOG_PRD_ACCOUNT" : "RUNLOG_DEV_ACCOUNT");
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Both accounts are named by environment variable so ` +
        `this repository is not tied to one person's AWS. See docs/hosting.md.`,
    );
  }
  return value;
}

export function envConfig(name: EnvName): EnvConfig {
  // Fixed, not inherited. The CDK CLI overwrites CDK_DEFAULT_REGION with
  // whatever region the resolved credentials point at, so reading it would
  // mean the stack quietly followed a developer's default profile — and
  // CloudFront will not accept a certificate from anywhere but us-east-1.
  const shared = { name, region: "us-east-1" };

  if (name === "prd") {
    return {
      ...shared,
      account: accountFor("prd"),
      domain: "runlog.scrthq.com",
      zone: "scrthq.com",
      ...(process.env.RUNLOG_PRD_ZONE_ID ? { zoneId: process.env.RUNLOG_PRD_ZONE_ID } : {}),
      retain: true,
      workosClientId: process.env.RUNLOG_WORKOS_CLIENT_ID ?? "client_01M1THR4WFCQZVPZDJ4SPY1FMY",
      workosCliClientId: process.env.RUNLOG_WORKOS_CLI_CLIENT_ID ?? "client_01M1W76VPGCRZ33HZAF7EBZ7NS",
      email: { from: "Runlog <noreply@scrthq.com>", region: "us-west-2", identity: "scrthq.com" },
      // Plans are on: Stripe is live, both webhooks are registered and their
      // secrets filled (2026-09-07). Selling still waits on each publisher's
      // own Connect onboarding, which is per account, not a switch here.
      gates: true,
      stripe: {
        ...STRIPE,
        prices: { plusMonthly: "price_1UCrhjCjnERWhjs4vdlHJPlZ", plusYearly: "price_1UCrhjCjnERWhjs47CzgfLYj", hostedMonthly: "price_1UCrhkCjnERWhjs4Q5gw9KbC", hostedYearly: "price_1UCrhlCjnERWhjs4eMCv5qrL" },
      },
      hosted: { ...HOSTED, billing: true },
    };
  }

  return {
    ...shared,
    account: accountFor("dev"),
    domain: "runlog.dev.scrthq.com",
    // The dev account holds its own delegated zone, so nothing here needs to
    // reach across accounts to write a record or validate a certificate.
    zone: "dev.scrthq.com",
    ...(process.env.RUNLOG_DEV_ZONE_ID ? { zoneId: process.env.RUNLOG_DEV_ZONE_ID } : {}),
    retain: false,
    // The staging environment in WorkOS; a fork points this at its own.
    workosClientId: process.env.RUNLOG_WORKOS_CLIENT_ID ?? "client_01M1THR4J61XTAPTK0H0GQNFXG",
    workosCliClientId: process.env.RUNLOG_WORKOS_CLI_CLIENT_ID ?? "client_01M1W76Q2VZRFPJGH073WW7MCE",
    // The dev account's SES is sandboxed: mail only reaches addresses
    // verified there, which is fine for a test with one's own.
    email: { from: "Runlog <noreply@dev.scrthq.com>", region: "us-west-2", identity: "dev.scrthq.com" },
    gates: true,
    stripe: {
      ...STRIPE,
      prices: { plusMonthly: "price_1UCrgCCjnERWhjs4GIhJ9kxZ", plusYearly: "price_1UCrgCCjnERWhjs4LKstAimJ", hostedMonthly: "price_1UCrgDCjnERWhjs4MuHYWuLS", hostedYearly: "price_1UCrgECjnERWhjs4RR77WQe3" },
    },
    // Billing shows in dev now that the sandbox prices exist; production waits for the live webhooks.
    hosted: { ...HOSTED, billing: true },
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
  if (raw !== "dev" && raw !== "prd") {
    throw new Error(`AWS_ENVIRONMENT must be "dev" or "prd", not ${JSON.stringify(raw)}`);
  }
  return raw;
}
