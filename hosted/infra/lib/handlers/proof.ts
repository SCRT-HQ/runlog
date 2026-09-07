import { webcrypto } from "node:crypto";

/**
 * Proof of holding a signing key.
 *
 * The CLI signs a nonce the API issued with the same ECDSA P-256 / SHA-256
 * scheme it signs packs with, and sends the public key, the fingerprint and
 * the signature. This checks all three against each other: the signature
 * verifies under the public key, and the fingerprint is the one the app
 * would derive from that key. Nothing about the pack format is here; only
 * the arithmetic, in the same shape as packages/rules-schema/src/signing.ts.
 */

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64");
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  out.set(binary);
  return out;
}

/** The fingerprint the app shows: ten bytes of SHA-256 over the SPKI, grouped in fours. */
export async function fingerprintOf(publicKey: string): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", fromBase64Url(publicKey));
  const hex = [...new Uint8Array(digest)]
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return (hex.toUpperCase().match(/.{4}/g) ?? []).join("-");
}

export async function verifyProof(publicKey: string, nonce: string, signature: string): Promise<boolean> {
  try {
    const key = await webcrypto.subtle.importKey("spki", fromBase64Url(publicKey), ALGORITHM, false, ["verify"]);
    return await webcrypto.subtle.verify(SIGN, key, fromBase64Url(signature), new TextEncoder().encode(nonce));
  } catch {
    return false;
  }
}
