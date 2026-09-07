import Stripe from "stripe";

/**
 * Stripe, through a keyhole.
 *
 * The API uses five things of Stripe's: a customer for a person, a
 * Checkout session to start a subscription, a Portal session to manage
 * it, the list of what a customer is entitled to, and the check on a
 * webhook's signature. The interface names those and nothing else, so a
 * test hands in a fake and the routes are tested without a network, and
 * so that the SDK's surface is not the API's.
 */

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface StripeLike {
  createCustomer(input: { email?: string; name?: string; metadata: Record<string, string> }): Promise<{ id: string }>;
  /** A subscription Checkout for one price; the address Stripe sends the person back to afterwards. */
  checkout(input: { customer: string; price: string; successUrl: string; cancelUrl: string; clientReferenceId: string }): Promise<{ url: string }>;
  portal(input: { customer: string; returnUrl: string }): Promise<{ url: string }>;
  /** The lookup keys of the features this customer is entitled to now. */
  activeEntitlements(customer: string): Promise<string[]>;
  /** Throws when the signature does not match. */
  constructEvent(rawBody: string, signature: string, secret: string): StripeEvent;
  /** A connected account for a publisher: they take the charges, Stripe hosts their dashboard. */
  createConnectedAccount(input: { email?: string; metadata: Record<string, string> }): Promise<{ id: string }>;
  /** Stripe's hosted onboarding for that account; `returnUrl` when it is done, `refreshUrl` when the link has expired. */
  onboardingLink(input: { account: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string }>;
  connectedAccount(id: string): Promise<{ chargesEnabled: boolean; detailsSubmitted: boolean }>;
  /** A one-time link into the account's Stripe dashboard. */
  dashboardLink(account: string): Promise<{ url: string }>;
  /** A product with one price, on the publisher's connected account, named for the pack. */
  createListing(input: { account: string; name: string; packId: string; amount: number; currency: string; productId?: string }): Promise<{ productId: string; priceId: string }>;
  /** Retire a price on the connected account when a listing changes or goes. */
  retirePrice(input: { account: string; priceId: string }): Promise<void>;
  /** A one-off Checkout on the publisher's account for one pack, the platform's fee taken from it. */
  checkoutSale(input: { account: string; price: string; fee: number; successUrl: string; cancelUrl: string; ref: string; email?: string; metadata: Record<string, string> }): Promise<{ url: string; sessionId: string }>;
}

export function realStripe(secretKey: string): StripeLike {
  const stripe = new Stripe(secretKey);
  return {
    async createCustomer(input) {
      const c = await stripe.customers.create({ ...(input.email ? { email: input.email } : {}), ...(input.name ? { name: input.name } : {}), metadata: input.metadata });
      return { id: c.id };
    },
    async checkout(input) {
      const s = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: input.customer,
        line_items: [{ price: input.price, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.clientReferenceId,
        allow_promotion_codes: true,
      });
      if (!s.url) throw new Error("Stripe made a Checkout session without a URL");
      return { url: s.url };
    },
    async portal(input) {
      const s = await stripe.billingPortal.sessions.create({ customer: input.customer, return_url: input.returnUrl });
      return { url: s.url };
    },
    async activeEntitlements(customer) {
      const out: string[] = [];
      for await (const e of stripe.entitlements.activeEntitlements.list({ customer, limit: 100 })) {
        if (e.lookup_key) out.push(e.lookup_key);
      }
      return out;
    },
    constructEvent(rawBody, signature, secret) {
      const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
      return { id: event.id, type: event.type, data: { object: event.data.object as unknown as Record<string, unknown> } };
    },
    async createConnectedAccount(input) {
      // The publisher is the seller: charges land in their account, they
      // pay Stripe's fees, Stripe carries the losses, and Stripe hosts
      // their dashboard. The platform's share is the application fee.
      const account = await stripe.accounts.create({
        ...(input.email ? { email: input.email } : {}),
        metadata: input.metadata,
        controller: {
          fees: { payer: "account" },
          losses: { payments: "stripe" },
          stripe_dashboard: { type: "full" },
        },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      });
      return { id: account.id };
    },
    async onboardingLink(input) {
      const link = await stripe.accountLinks.create({ account: input.account, type: "account_onboarding", return_url: input.returnUrl, refresh_url: input.refreshUrl });
      return { url: link.url };
    },
    async connectedAccount(id) {
      const account = await stripe.accounts.retrieve(id);
      return { chargesEnabled: account.charges_enabled === true, detailsSubmitted: account.details_submitted === true };
    },
    async dashboardLink(account) {
      // A login link exists only for Express dashboards; a full dashboard
      // is the publisher's own Stripe sign-in.
      try {
        const link = await stripe.accounts.createLoginLink(account);
        return { url: link.url };
      } catch {
        return { url: "https://dashboard.stripe.com/" };
      }
    },
    async createListing(input) {
      const opts = { stripeAccount: input.account };
      const productId = input.productId ?? (await stripe.products.create({ name: input.name, metadata: { pack_id: input.packId } }, opts)).id;
      const price = await stripe.prices.create({ product: productId, unit_amount: input.amount, currency: input.currency, metadata: { pack_id: input.packId } }, opts);
      return { productId, priceId: price.id };
    },
    async retirePrice(input) {
      await stripe.prices.update(input.priceId, { active: false }, { stripeAccount: input.account });
    },
    async checkoutSale(input) {
      const s = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [{ price: input.price, quantity: 1 }],
          ...(input.fee > 0 ? { payment_intent_data: { application_fee_amount: input.fee } } : {}),
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          client_reference_id: input.ref,
          ...(input.email ? { customer_email: input.email } : {}),
          metadata: input.metadata,
        },
        { stripeAccount: input.account },
      );
      if (!s.url) throw new Error("Stripe made a Checkout session without a URL");
      return { url: s.url, sessionId: s.id };
    },
  };
}

/** The features named in an active-entitlement summary, by lookup key. */
export function featuresOfSummary(object: Record<string, unknown>): { customer: string; features: string[] } | null {
  const customer = object["customer"];
  const id = typeof customer === "string" ? customer : typeof customer === "object" && customer !== null ? String((customer as { id?: unknown }).id ?? "") : "";
  if (!id) return null;
  const list = object["entitlements"];
  const data = list && typeof list === "object" && Array.isArray((list as { data?: unknown }).data) ? ((list as { data: unknown[] }).data as Array<Record<string, unknown>>) : [];
  const features = data.map((e) => e["lookup_key"]).filter((k): k is string => typeof k === "string" && k.length > 0);
  return { customer: id, features };
}
