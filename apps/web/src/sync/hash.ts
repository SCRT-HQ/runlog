/**
 * A fingerprint for "is this the same bytes".
 *
 * SHA-256 over the text as stored, first sixteen hex characters. The canonical
 * form is the stored string itself: a run log is never reordered, and a pack
 * is kept verbatim, so there is nothing to normalize. This is for skipping
 * work and for `If-Match`, not for integrity — the server stores it as given.
 */

export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const hashJson = (value: unknown): Promise<string> => hashText(JSON.stringify(value));
