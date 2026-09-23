/**
 * Coming back from Stripe's Checkout, Portal or Connect onboarding.
 *
 * Before the app sends someone to Stripe it writes down, in this tab's
 * session storage, which account asked and which profile page asked. The
 * address Stripe sends them back to names the same things as enumerated
 * words, never a URL. A return is acted on only when the stored intent,
 * the signed-in account and the address all agree, and it is used once.
 */

export type ProfileReturnDestination = "account" | "publishing" | "servers";
export type BillingProduct = "plus" | "hosted-licensing" | "server";
export type ProfileReturnIntent =
  | { kind: "checkout"; ownerId: string; product: BillingProduct; destination: ProfileReturnDestination }
  | { kind: "portal"; ownerId: string; destination: ProfileReturnDestination }
  | { kind: "publisher-connect"; ownerId: string; destination: "publishing" };

export type ProfileReturnCallback =
  | { kind: "billing"; outcome: "done" | "canceled" | "managed"; product?: BillingProduct; destination?: ProfileReturnDestination }
  | { kind: "publisher"; outcome: "connected" | "connect-again"; destination?: "publishing" }
  | { kind: "invalid" }
  | null;

/** The query words a callback may carry, removed from the address once read. */
export const PROFILE_RETURN_PARAMS = ["billing", "publisher", "product", "destination"] as const;

const KEY = "runlog:profile-return";
const DESTINATIONS: ReadonlySet<string> = new Set<ProfileReturnDestination>(["account", "publishing", "servers"]);
const PRODUCTS: ReadonlySet<string> = new Set<BillingProduct>(["plus", "hosted-licensing", "server"]);
const BILLING_OUTCOMES: ReadonlySet<string> = new Set(["done", "canceled", "managed"]);
const PUBLISHER_OUTCOMES: ReadonlySet<string> = new Set(["connected", "connect-again"]);

/** Where each product's own section lives: the page a return lands on when its address names none. */
const PRODUCT_HOME: Record<BillingProduct, ProfileReturnDestination> = {
  plus: "account",
  "hosted-licensing": "publishing",
  server: "servers",
};

const isDestination = (value: unknown): value is ProfileReturnDestination => typeof value === "string" && DESTINATIONS.has(value);
const isProduct = (value: unknown): value is BillingProduct => typeof value === "string" && PRODUCTS.has(value);

/** This tab's session storage, or null where the browser will not give it. */
export function profileReturnStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function rememberProfileReturn(storage: Storage, intent: ProfileReturnIntent): void {
  try {
    storage.setItem(KEY, JSON.stringify(intent));
  } catch {
    /* a return with nothing stored is ignored, which is the safe outcome */
  }
}

export function clearProfileReturn(storage: Storage): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Write the intent down, then ask for the Stripe page. Where there is no
 * page to go to (billing off) or the request fails, the intent is removed
 * again, since nobody is leaving. Without an owner nothing is written, and
 * the return, if any, is ignored.
 */
export async function startProfileReturn<T extends { url: string } | { available: false }>(
  intent: ProfileReturnIntent | null,
  start: () => Promise<T>,
): Promise<T> {
  const storage = intent ? profileReturnStorage() : null;
  if (storage && intent) rememberProfileReturn(storage, intent);
  try {
    const out = await start();
    if (storage && !("url" in out)) clearProfileReturn(storage);
    return out;
  } catch (error) {
    if (storage) clearProfileReturn(storage);
    throw error;
  }
}

/** The account a plan snapshot belongs to, where it belongs to one. */
export const planOwnerOf = (state: { kind: string; ownerId?: string }): string | null => state.ownerId ?? null;

/**
 * The callback on an address, if any. `null` is no callback at all;
 * `invalid` is something shaped like one that does not read as one.
 */
export function parseProfileReturn(search: string): ProfileReturnCallback {
  const params = new URLSearchParams(search);
  const has = (name: string) => params.has(name);
  if (!has("billing") && !has("publisher")) return null;
  const invalid = { kind: "invalid" } as const;
  if (PROFILE_RETURN_PARAMS.some((name) => params.getAll(name).length > 1)) return invalid;
  if (has("billing") && has("publisher")) return invalid;

  const destination = params.get("destination");
  if (destination !== null && !isDestination(destination)) return invalid;
  const product = params.get("product");
  if (product !== null && !isProduct(product)) return invalid;

  if (has("billing")) {
    const outcome = params.get("billing") ?? "";
    if (!BILLING_OUTCOMES.has(outcome)) return invalid;
    // The Portal manages every subscription at once: it names no product.
    if (outcome === "managed" && product !== null) return invalid;
    return {
      kind: "billing",
      outcome: outcome as "done" | "canceled" | "managed",
      ...(product !== null ? { product } : {}),
      ...(destination !== null ? { destination } : {}),
    };
  }

  const outcome = params.get("publisher") ?? "";
  if (!PUBLISHER_OUTCOMES.has(outcome) || product !== null) return invalid;
  if (destination !== null && destination !== "publishing") return invalid;
  return {
    kind: "publisher",
    outcome: outcome as "connected" | "connect-again",
    ...(destination !== null ? { destination } : {}),
  };
}

function readIntent(raw: string | null): ProfileReturnIntent | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const ownerId = record["ownerId"];
  if (typeof ownerId !== "string" || ownerId === "") return null;
  const destination = record["destination"];
  switch (record["kind"]) {
    case "checkout": {
      const product = record["product"];
      return isProduct(product) && isDestination(destination) ? { kind: "checkout", ownerId, product, destination } : null;
    }
    case "portal":
      return isDestination(destination) ? { kind: "portal", ownerId, destination } : null;
    case "publisher-connect":
      return destination === "publishing" ? { kind: "publisher-connect", ownerId, destination } : null;
    default:
      return null;
  }
}

/**
 * Consume the stored intent for this callback, once.
 *
 * The stored record is removed whatever the answer, as long as there is a
 * real callback to answer: a match is used up, and a mismatch or a record
 * that does not read is stale. Missing metadata on the address (a copy of
 * the server from before destinations were named) takes the product from
 * the stored, account-bound intent and the destination from that product's
 * own page; metadata that is present must agree with the intent.
 */
export function takeProfileReturn(storage: Storage, ownerId: string, callback: ProfileReturnCallback): ProfileReturnIntent | null {
  if (callback === null || callback.kind === "invalid") return null;
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  clearProfileReturn(storage);
  const intent = readIntent(raw);
  if (!intent || intent.ownerId !== ownerId) return null;

  if (callback.kind === "publisher") {
    if (intent.kind !== "publisher-connect") return null;
    return intent;
  }
  if (callback.outcome === "managed") {
    if (intent.kind !== "portal") return null;
    const destination = callback.destination ?? "account";
    if (callback.destination !== undefined && callback.destination !== intent.destination) return null;
    return { ...intent, destination };
  }
  if (intent.kind !== "checkout") return null;
  if (callback.product !== undefined && callback.product !== intent.product) return null;
  if (callback.destination !== undefined && callback.destination !== intent.destination) return null;
  return { ...intent, destination: callback.destination ?? PRODUCT_HOME[intent.product] };
}
