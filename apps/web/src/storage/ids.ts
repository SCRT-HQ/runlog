/**
 * An id for a run: a ULID.
 *
 * Twenty-six characters, the first ten a timestamp and the rest random, in an
 * alphabet with no confusable letters. Two runs started a second apart sort
 * in that order with no second field, which is what makes a list of them
 * readable in a manifest or an object key. The random half is 80 bits from
 * the platform, so two devices minting at the same millisecond do not meet.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number): string {
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  // 80 bits into 16 characters of 5 bits: read the bytes as one big number
  // five bits at a time, from the top.
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
      acc &= (1 << bits) - 1;
    }
  }
  return out.slice(0, 16);
}

export function ulid(now = Date.now()): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return encodeTime(now) + encodeRandom(bytes);
}

/** Shape only: the right length, the right alphabet. Not a proof of origin. */
export function looksLikeUlid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
