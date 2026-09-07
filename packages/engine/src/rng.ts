/**
 * Seeded, reproducible randomness.
 *
 * Two things depend on this. Shared seeds let several people attempt the
 * identical sequence and compare what they made of it, which is the whole
 * point of a "same dungeon" mode. And deterministic tests let the reducer be
 * checked by replay rather than by inspection.
 *
 * `Math.random` is never used inside the engine: a random source is always
 * passed in, so nothing can accidentally become unreproducible.
 */

/** Hash an arbitrary string seed into four 32-bit values (cyrb128). */
function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** sfc32: small, fast, and good enough for dice. */
export function createRandom(seed: string): () => number {
  let [a, b, c, d] = hashSeed(seed);
  return function next(): number {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * A source that refuses to produce numbers.
 *
 * Used where a roll must have come from the player — physical dice entered by
 * hand — so that a missing value fails loudly instead of silently inventing
 * fate on their behalf.
 */
export const refuseRandom = (): number => {
  throw new Error("this roll requires a value from the player; no random source is available");
};

/**
 * The stream a seeded run draws a particular roll from.
 *
 * Keyed by *where in the game* the roll happens rather than by how far down
 * the log it falls. That is the difference between "the same seed" and "the
 * same dungeon": two people who make different choices still meet the same
 * result in unit three, because the stream is addressed by the unit and the
 * purpose, not by how many events either of them has accumulated.
 *
 * `occurrence` separates repeats of the same roll within one unit, so a table
 * rolled twice does not come up twice the same.
 */
export function streamSeed(
  seed: string,
  unit: number,
  purpose: string,
  occurrence = 0,
): string {
  return `${seed}:u${unit}:${purpose}:${occurrence}`;
}
