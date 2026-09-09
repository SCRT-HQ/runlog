import { createHash } from "node:crypto";
import { JwtVerifier } from "aws-jwt-verify";

/**
 * Who is asking.
 *
 * The app signs people in with WorkOS AuthKit in the browser and sends the
 * access token it was given; the command line signs in with the device flow
 * against a WorkOS application of its own and sends what that gave it. Both
 * are JWTs signed with a key WorkOS publishes per client, so nothing here
 * needs a secret: fetch the key set, check the signature, the expiry, the
 * issuer, and that the token was minted for one of *our* clients and not
 * another one in the same WorkOS account.
 *
 * Verified here, in the handler, rather than in an API Gateway authorizer.
 * An authorizer's refusal comes out of the gateway as a 403, and CloudFront
 * rewrites every 403 on this distribution into the app's index page, so a
 * bad token would have been answered with HTML and a 200. A handler can say
 * 401, in JSON, and mean it.
 */
import type { KeyScope } from "./store.js";

export interface Caller {
  sub: string;
  sid: string;
  /**
   * WorkOS feature flags on the session, from the token's `feature_flags`
   * claim: a way to give one person a plan's features without a
   * subscription: a friend testing, a comped account. A command-line key
   * carries none. The API reads a flag named like a feature as that
   * feature.
   */
  flags?: string[];
  /** A command-line key's scope; a session, and a full key, have none. */
  scope?: KeyScope;
}

const ISSUER = "https://api.workos.com";

/**
 * One verifier per client, kept for the life of the container so the key set
 * is fetched once and then only when a key id it has not seen turns up.
 */
const verifiers = new Map<string, ReturnType<typeof build>>();

/**
 * The issuers a token for `clientId` may name.
 *
 * WorkOS documents the issuer as the bare API host, and publishes a
 * discovery document under a client-specific path that names the longer
 * form. The longer form names the *environment's* primary client, not the
 * client the token was minted for: a token from the command line's own
 * application says `client_id: <cli>` and `iss: …/user_management/<browser>`.
 * So every client we accept contributes its issuer form, and the client
 * check on the signed `client_id` claim is what actually decides.
 */
export function issuersFor(clientId: string, allowed: readonly string[]): string[] {
  const ids = [clientId, ...allowed.filter((c) => c && c !== clientId)];
  return [ISSUER, ...ids.map((c) => `${ISSUER}/user_management/${c}`)];
}

function build(clientId: string, allowed: readonly string[]) {
  const issuers = issuersFor(clientId, allowed);
  return JwtVerifier.create(
    issuers.map((issuer) => ({
      issuer,
      // Access tokens carry `client_id`, not `aud`; the check below covers it.
      audience: null,
      jwksUri: `${ISSUER}/sso/jwks/${clientId}`,
      customJwtCheck: ({ payload }: { payload: Record<string, unknown> }) => {
        if (payload["client_id"] !== clientId) throw new Error("token is for another client");
      },
    })),
  );
}

/**
 * Which client a token says it was minted for, read without checking
 * anything. It only chooses which key set to verify against; the verifier
 * then insists the signed claim agrees, so a lie here buys nothing.
 */
export function clientIdOf(token: string): string | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof payload["client_id"] === "string" ? payload["client_id"] : undefined;
  } catch {
    return undefined;
  }
}

export async function verify(authorization: string | undefined, clientIds: string | readonly string[]): Promise<Caller> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new Error("no bearer token");
  const allowed = (typeof clientIds === "string" ? [clientIds] : clientIds).filter(Boolean);
  const clientId = clientIdOf(token);
  if (!clientId || !allowed.includes(clientId)) throw new Error("token is for another client");
  const key = `${clientId}|${allowed.join(",")}`;
  let verifier = verifiers.get(key);
  if (!verifier) {
    verifier = build(clientId, allowed);
    verifiers.set(key, verifier);
  }
  const payload = await verifier.verify(token);
  const flags = Array.isArray(payload["feature_flags"]) ? payload["feature_flags"].filter((f): f is string => typeof f === "string") : [];
  return {
    sub: String(payload.sub),
    sid: typeof payload["sid"] === "string" ? payload["sid"] : "",
    ...(flags.length > 0 ? { flags } : {}),
  };
}

/** A token's fingerprint: what is stored, so a table read never yields a token anyone could use. */
export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
