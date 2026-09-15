/**
 * SHA-1, written out here rather than imported.
 *
 * The profile ids are a version 5 UUID, and version 5 is SHA-1 by
 * definition: change the digest and every id in every committed profile
 * changes with it. Node has one in `node:crypto` and a browser has one
 * behind `crypto.subtle`, but `subtle.digest` is a promise and this is
 * called once per key on a deck, so the browser path would have to be
 * async all the way up for a hash of forty bytes. Forty lines of it here
 * keeps the whole generator synchronous and identical on both sides.
 *
 * Not for anything that has to be secure. SHA-1 is not, and nothing here
 * is guarding anything: it is a naming scheme that has to give the same
 * answer twice.
 */

const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

/** The digest of one message, as its twenty bytes. */
export function sha1(message: Uint8Array): Uint8Array {
  // The padding the standard asks for: a 1 bit, zeros, and the length in
  // bits as a 64-bit big-endian number in the last eight bytes.
  const blocks = Math.ceil((message.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const bits = message.length * 8;
  const read = new DataView(padded.buffer);
  read.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  read.setUint32(padded.length - 4, bits >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  for (let block = 0; block < blocks; block++) {
    const at = block * 64;
    for (let t = 0; t < 16; t++) w[t] = read.getUint32(at + t * 4);
    for (let t = 16; t < 80; t++) {
      const x = w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!;
      w[t] = (x << 1) | (x >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t++) {
      const round = Math.floor(t / 20);
      const f = round === 0 ? (b & c) | (~b & d) : round === 2 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const next = (((a << 5) | (a >>> 27)) + f + e + K[round]! + w[t]!) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = next;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const write = new DataView(out.buffer);
  write.setUint32(0, h0);
  write.setUint32(4, h1);
  write.setUint32(8, h2);
  write.setUint32(12, h3);
  write.setUint32(16, h4);
  return out;
}

/** Text as its bytes, which is what everything here hashes. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Several runs of bytes as one, for a digest taken over more than one. */
export function joined(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
