import { randomBytes } from "node:crypto";

/**
 * An id for an event or a run: a ULID, the same shape the app mints at
 * the edge (apps/web/src/storage/ids.ts). Twenty-six characters, the first
 * ten a timestamp and the rest random, in an alphabet with no confusable
 * letters, so a list of them sorts by when. The bot mints ids because it
 * is the device at the table for a run hosted in Discord; the same shape
 * keeps the log indistinguishable from one the app wrote.
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

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom(randomBytes(10));
}
