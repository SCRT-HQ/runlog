/**
 * Signing a pack.
 *
 * What this is for, and what it is not for.
 *
 * It does **not** stop anyone copying a pack. It cannot: the engine has to
 * read every word of the rules to play them, so anything the app can read the
 * buyer can read. Any scheme that claims otherwise is either broken or has
 * quietly given up on working offline.
 *
 * What it does is prove *authorship*. A signed pack carries evidence that
 * whoever holds a particular key produced exactly this content. A copy passed
 * around still plays, but a copy someone has edited cannot go on claiming to
 * be the author's, and a pack that turns up claiming to be an official release
 * either verifies or it does not. For a designer selling their own game, the
 * thing worth protecting is usually their name on it.
 *
 * One honest limitation, stated here because it is easy to oversell: the
 * public key travels *inside* the pack, so a valid signature by itself only
 * says "this content was signed by the holder of this key". It does not say
 * whose key it is. That link has to come from somewhere else: the author
 * publishing their fingerprint, or the app remembering a key it has seen
 * before. `fingerprint()` exists for exactly that, and the app shows it.
 */

/** The signature block a signed pack carries. */
export interface PackSignature {
  algorithm: "ecdsa-p256-sha256";
  /** Base64url SPKI public key. */
  publicKey: string;
  /** Base64url signature over the canonical bytes. */
  value: string;
  signedAt: string;
  /** What the signer claims to be called. A claim, not proof: see above. */
  signedBy?: string;
}

/* ------------------------------------------------------------------ *
 * Canonical form
 * ------------------------------------------------------------------ */

/**
 * The exact bytes a signature covers.
 *
 * Two decisions matter here.
 *
 * **Keys are sorted and whitespace is dropped**, so the signature covers the
 * game rather than the file. An author can reformat their YAML, re-indent it,
 * add comments or convert it to JSON, and the signature still verifies: 
 * which is the difference between a signature people keep and one they stop
 * bothering with.
 *
 * **The signature block is excluded**, since it cannot cover itself.
 *
 * This runs over the *raw parsed document*, before the schema fills in any
 * defaults. Signing after defaults were applied would mean the bytes depended
 * on the engine version, and a pack signed by one release would fail to
 * verify against the next.
 */
export function canonicalize(document: unknown): string {
  const stripped = strip(document);
  return stableStringify(stripped);
}

function strip(document: unknown): unknown {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return document;
  }
  const { signature: _signature, ...rest } = document as Record<string, unknown>;
  return rest;
}

/** JSON with object keys in sorted order and no insignificant whitespace. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` is not representable in JSON and YAML never produces it, but
    // an object built in JS on the way here might.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

// Shared with the container, which is where they now live.
import { fromBase64Url, toBase64Url } from "@runlog/container";
export { fromBase64Url, toBase64Url };

/* ------------------------------------------------------------------ *
 * Keys and signatures
 * ------------------------------------------------------------------ */

/**
 * Web Crypto's JWK type is declared by the DOM library and this package builds
 * without it, it has to run in Node for the CLI as much as in a browser. The
 * API itself is a platform API present in both, so the shape is spelled out
 * here rather than pulling the whole DOM in.
 */
interface Jwk {
  d?: string;
  key_ops?: string[];
  ext?: boolean;
  [key: string]: unknown;
}

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

/**
 * ECDSA P-256 rather than Ed25519.
 *
 * Ed25519 is the nicer primitive and reached Web Crypto only recently; P-256
 * has been in every browser and in Node for years. A signature scheme that
 * fails to verify on someone's browser is worse than a slightly older curve.
 */
export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.exportKey("spki", pair.publicKey),
    crypto.subtle.exportKey("pkcs8", pair.privateKey),
  ]);
  return {
    publicKey: toBase64Url(new Uint8Array(publicKey)),
    privateKey: toBase64Url(new Uint8Array(privateKey)),
  };
}

/**
 * A short, readable form of a public key.
 *
 * This is the thing an author publishes and a reader compares, on a website,
 * in a video, on the back of a printed book. Grouped into fours because a
 * fingerprint that cannot be read aloud does not get checked.
 */
export async function fingerprint(publicKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", fromBase64Url(publicKey));
  const hex = [...new Uint8Array(digest)]
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return (hex.toUpperCase().match(/.{4}/g) ?? []).join("-");
}

export async function signPack(
  document: unknown,
  privateKey: string,
  signedBy?: string,
): Promise<PackSignature> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64Url(privateKey),
    ALGORITHM,
    false,
    ["sign"],
  );
  const publicKey = await derivePublicKey(privateKey);
  const bytes = new TextEncoder().encode(canonicalize(document));
  const value = await crypto.subtle.sign(SIGN, key, bytes);

  return {
    algorithm: "ecdsa-p256-sha256",
    publicKey,
    value: toBase64Url(new Uint8Array(value)),
    signedAt: new Date().toISOString(),
    ...(signedBy ? { signedBy } : {}),
  };
}

/**
 * Recover the public half from a stored private key.
 *
 * PKCS#8 for P-256 carries the public point, but Web Crypto will not export
 * `spki` from a key imported as private. Going through JWK and dropping the
 * private scalar is the portable way, and it saves an author having to keep
 * two files in step.
 */
/**
 * Sign bytes that are not a pack: the nonce the API hands out when a key is
 * claimed. Same key, same algorithm, same encoding, so the API can check it
 * with the arithmetic it already has for packs.
 */
export async function signBytes(bytes: Uint8Array<ArrayBuffer>, privateKey: string): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", fromBase64Url(privateKey), ALGORITHM, false, ["sign"]);
  const value = await crypto.subtle.sign(SIGN, key, bytes);
  return toBase64Url(new Uint8Array(value));
}

async function derivePublicKey(privateKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64Url(privateKey),
    ALGORITHM,
    true,
    ["sign"],
  );
  const jwk = (await crypto.subtle.exportKey("jwk", key)) as Jwk;
  const { d: _d, key_ops: _ops, ext: _ext, ...pub } = jwk;
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { ...pub, key_ops: ["verify"] },
    ALGORITHM,
    true,
    ["verify"],
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey("spki", publicKey)));
}

export type VerifyResult =
  | { status: "unsigned" }
  /** Signed, but this environment cannot check it. Not the same as failing. */
  | { status: "unverifiable"; reason: string }
  | { status: "valid"; publicKey: string; fingerprint: string; signedBy?: string; signedAt: string }
  | { status: "invalid"; reason: string };

/**
 * Check a pack's signature.
 *
 * Deliberately three-valued. "Unsigned" is not a failure: most packs will
 * never be signed, and treating an unsigned pack as suspect would make the
 * whole feature a nuisance. "Invalid" means the pack carries a signature that
 * does not match its contents, which is worth saying loudly, because the
 * common cause is an edit after signing rather than an attack.
 */
export async function verifyPack(document: unknown): Promise<VerifyResult> {
  const signature = (document as { signature?: PackSignature } | null)?.signature;
  if (!signature) return { status: "unsigned" };

  // Web Crypto is absent outside a secure context, and opening the built app
  // straight from disk is a supported way to run it. "Cannot check" is a
  // different thing from "does not match", and saying the latter would accuse
  // an honest pack of being tampered with.
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return {
      status: "unverifiable",
      reason: "signatures can only be checked over https or on localhost",
    };
  }

  if (signature.algorithm !== "ecdsa-p256-sha256") {
    return { status: "invalid", reason: `unknown algorithm ${String(signature.algorithm)}` };
  }

  try {
    const key = await crypto.subtle.importKey(
      "spki",
      fromBase64Url(signature.publicKey),
      ALGORITHM,
      false,
      ["verify"],
    );
    const bytes = new TextEncoder().encode(canonicalize(document));
    const ok = await crypto.subtle.verify(
      SIGN,
      key,
      fromBase64Url(signature.value),
      bytes,
    );
    if (!ok) {
      return {
        status: "invalid",
        reason: "the signature does not match this pack's contents, it has been changed since it was signed",
      };
    }
    return {
      status: "valid",
      publicKey: signature.publicKey,
      fingerprint: await fingerprint(signature.publicKey),
      signedAt: signature.signedAt,
      ...(signature.signedBy ? { signedBy: signature.signedBy } : {}),
    };
  } catch (e) {
    return {
      status: "invalid",
      reason: e instanceof Error ? e.message : "the signature could not be read",
    };
  }
}
