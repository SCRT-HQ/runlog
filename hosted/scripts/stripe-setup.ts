import Stripe from "stripe";

/**
 * What Runlog sells, made in Stripe once per environment.
 *
 * Run with the environment's secret key in STRIPE_SECRET_KEY — the sandbox
 * key for dev, the live key for production — from your own terminal:
 *
 *   $env:STRIPE_SECRET_KEY = "sk_test_…"; npx tsx hosted/scripts/stripe-setup.ts
 *
 * Idempotent: every feature, product and price is found by its lookup key
 * or name before it is made, so running it twice changes nothing. It ends
 * by printing the ids to put in lib/config.ts. Prices are public — they
 * appear in every Checkout — so they are committed; the key is not.
 */

const KEY = process.env["STRIPE_SECRET_KEY"];
if (!KEY || !/^(sk|rk)_(test|live)_/.test(KEY)) {
  console.error("STRIPE_SECRET_KEY is not set, or is not a Stripe secret key");
  process.exit(1);
}
const live = KEY.includes("_live_");
const stripe = new Stripe(KEY);

const FEATURES = [
  { lookup_key: "plus", name: "Runlog Plus" },
  { lookup_key: "hosted-licensing", name: "Hosted licensing" },
] as const;

const PRODUCTS = [
  {
    key: "plus",
    name: "Runlog Plus",
    description: "Host a table: invite people into your runs on their own devices, and race across devices.",
    feature: "plus",
    prices: [
      { lookup_key: "plus-monthly", unit_amount: 400, interval: "month" as const },
      { lookup_key: "plus-yearly", unit_amount: 3600, interval: "year" as const },
    ],
  },
  {
    key: "hosted-licensing",
    name: "Hosted licensing",
    description: "For publishers: no fee on sales.",
    feature: "hosted-licensing",
    prices: [
      { lookup_key: "hosted-monthly", unit_amount: 900, interval: "month" as const },
      { lookup_key: "hosted-yearly", unit_amount: 9000, interval: "year" as const },
    ],
  },
];

async function main() {
  console.log(`Stripe ${live ? "LIVE" : "sandbox"}`);
  const featureIds = new Map<string, string>();
  for (const f of FEATURES) {
    const existing = (await stripe.entitlements.features.list({ lookup_key: f.lookup_key, limit: 1 })).data[0];
    const feature = existing ?? (await stripe.entitlements.features.create({ lookup_key: f.lookup_key, name: f.name }));
    featureIds.set(f.lookup_key, feature.id);
    console.log(`feature ${f.lookup_key}: ${feature.id}${existing ? "" : " (made)"}`);
  }

  const priceIds: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const found = (await stripe.products.search({ query: `metadata['runlog']:'${p.key}' AND active:'true'`, limit: 1 })).data[0];
    const product = found ?? (await stripe.products.create({ name: p.name, description: p.description, metadata: { runlog: p.key } }));
    console.log(`product ${p.key}: ${product.id}${found ? "" : " (made)"}`);
    const attached = (await stripe.products.listFeatures(product.id, { limit: 10 })).data;
    if (!attached.some((a) => a.entitlement_feature.id === featureIds.get(p.feature))) {
      await stripe.products.createFeature(product.id, { entitlement_feature: featureIds.get(p.feature)! });
      console.log(`  feature ${p.feature} attached`);
    }
    for (const pr of p.prices) {
      const existing = (await stripe.prices.list({ lookup_keys: [pr.lookup_key], active: true, limit: 1 })).data[0];
      const price =
        existing ??
        (await stripe.prices.create({
          product: product.id,
          currency: "usd",
          unit_amount: pr.unit_amount,
          recurring: { interval: pr.interval },
          lookup_key: pr.lookup_key,
          transfer_lookup_key: true,
        }));
      priceIds[pr.lookup_key] = price.id;
      console.log(`  price ${pr.lookup_key}: ${price.id}${existing ? "" : " (made)"}`);
    }
  }

  // The Customer Portal: what a person can do about their subscription.
  const portals = (await stripe.billingPortal.configurations.list({ limit: 10 })).data;
  let portal = portals.find((c) => c.metadata?.["runlog"] === "default");
  if (!portal) {
    portal = await stripe.billingPortal.configurations.create({
      business_profile: { headline: "Runlog" },
      features: {
        customer_update: { enabled: true, allowed_updates: ["email", "name"] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
      },
      metadata: { runlog: "default" },
    });
    console.log(`portal configuration: ${portal.id} (made)`);
  } else {
    console.log(`portal configuration: ${portal.id}`);
  }

  console.log("\nPut these in lib/config.ts under stripe.prices for this environment:\n");
  console.log(JSON.stringify({ plusMonthly: priceIds["plus-monthly"], plusYearly: priceIds["plus-yearly"], hostedMonthly: priceIds["hosted-monthly"], hostedYearly: priceIds["hosted-yearly"] }, null, 2));
  console.log("\nThen register the webhook endpoint https://<domain>/api/stripe/webhook for the event entitlements.active_entitlement_summary.updated, and fill stripe/webhook-secret with its signing secret.");
}

void main();
