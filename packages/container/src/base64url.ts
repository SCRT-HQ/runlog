/**
 * Base64url, the unpadded kind, for the salt and IV in a container header.
 *
 * Written out rather than pulled in: it is nine lines each way, and this
 * package's whole point is to have nothing underneath it.
 */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Backed by a plain `ArrayBuffer` on purpose.
 *
 * `Uint8Array.from` produces one typed as `ArrayBufferLike`, which since
 * TypeScript 5.7 includes `SharedArrayBuffer` and so is not accepted where
 * Web Crypto wants bytes. Allocating the buffer explicitly says what is
 * actually true here and avoids a cast at every call site.
 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
