import { createPublicKey, verify as verifySignature } from "node:crypto";

/**
 * Whether a request really came from Discord.
 *
 * Discord signs every interaction it sends to the endpoint: an Ed25519
 * signature over the timestamp header and the raw body, with the key it
 * shows on the application's page. There is no shared secret in it, the
 * key is public, so it sits in the stage's configuration beside the
 * client ids, and nothing here is ever sent back to Discord to check.
 * The body must be the bytes as they arrived: a body parsed and printed
 * again is a different string, and the signature would not match.
 */

/** The DER wrapping Node wants around a raw 32-byte Ed25519 public key: SubjectPublicKeyInfo for OID 1.3.101.112. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyInteraction(publicKeyHex: string, signatureHex: string | undefined, timestamp: string | undefined, rawBody: Buffer): boolean {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
  if (!signatureHex || !/^[0-9a-f]{128}$/i.test(signatureHex) || !timestamp) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return verifySignature(null, Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
