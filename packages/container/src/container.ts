import { fromBase64Url, toBase64Url } from "./base64url.ts";

/**
 * A sealed copy of a pack.
 *
 * The threat this addresses is narrow and worth stating exactly, because
 * anything wider would be a promise it cannot keep. It stops a buyer from
 * opening the file they downloaded, deleting the two lines that name them, and
 * re-uploading it. That is the leak that actually happens: not an attack, just
 * a text editor and thirty seconds.
 *
 * It does not stop someone who is determined. The app must show the rules to
 * play them, so a person willing to read their own browser's memory, or to
 * build the open-source app with one line changed, gets the plaintext. Nor
 * does it stop anyone retyping the game from a book. Those are out of scope by
 * design, not by oversight.
 *
 * What it does buy:
 *
 *  - The distributed file is not YAML. Opening it in an editor shows binary.
 *  - Without the license key it is inert, so the file alone is worthless —
 *    passing it on means passing on a key that was issued to one person.
 *  - The buyer's name is inside the sealed, signed payload, so a copy that has
 *    been opened and re-sealed is either still named or no longer verifies.
 *
 * The author's own working file stays plain YAML and every tool keeps working
 * on it. This is a distribution format, not the pack format.
 */

const MAGIC = "RLPACK";
/**
 * The first releases wrote a stray control byte after the magic. The
 * documented format, the server's sealer and every other reader use the
 * six letters alone; files from those releases still open here.
 */
const LEGACY_MAGIC = "RLPACK\u0001";

/** How many bytes of magic open the file: six, seven for a legacy copy, none if it is not sealed. */
function magicLength(data: Uint8Array): number {
  for (const candidate of [LEGACY_MAGIC, MAGIC]) {
    const magic = encoder.encode(candidate);
    if (data.length >= magic.length && magic.every((b, i) => data[i] === b)) return magic.length;
  }
  return 0;
}
const KDF_ITERATIONS = 600_000;

/** What travels in the clear, so a seller can act on a leak without the key. */
export interface ContainerHeader {
  v: 1;
  alg: "aes-256-gcm";
  kdf: "pbkdf2-sha256";
  iterations: number;
  salt: string;
  iv: string;
  /**
   * The seller's own reference for the sale, if they set one.
   *
   * Deliberately not the buyer's name. A leaked file should let the seller
   * trace the sale through their own records; it should not publish somebody's
   * name to everyone who downloads it.
   */
  ref?: string;
  /** Shown before asking for a key, so the prompt can say what it is for. */
  title?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(out);
  return out;
}

/**
 * A license key a person can be given and can type.
 *
 * Grouped and from an alphabet without the characters people confuse, because
 * this gets pasted out of a receipt email by someone who wants to play.
 */
export function generateLicenseKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = bytes(20);
  const chars = [...raw].map((b) => alphabet[b % alphabet.length]).join("");
  return (chars.match(/.{5}/g) ?? []).join("-");
}

/** Normalized so spacing and case in a typed key do not matter. */
const normalizeKey = (key: string) => key.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

async function deriveKey(licenseKey: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizeKey(licenseKey)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Seal a document.
 *
 * The whole document goes in, including its signature: verification happens
 * after opening, against the same bytes the author signed.
 */
export async function seal(
  document: unknown,
  licenseKey: string,
  extra: { ref?: string; title?: string } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = bytes(16);
  const iv = bytes(12);
  const key = await deriveKey(licenseKey, salt, KDF_ITERATIONS);

  const plaintext = encoder.encode(JSON.stringify(document));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    plaintext,
  );

  const header: ContainerHeader = {
    v: 1,
    alg: "aes-256-gcm",
    kdf: "pbkdf2-sha256",
    iterations: KDF_ITERATIONS,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ...(extra.ref ? { ref: extra.ref } : {}),
    ...(extra.title ? { title: extra.title } : {}),
  };
  const headerBytes = encoder.encode(JSON.stringify(header));
  const body = new Uint8Array(sealed);

  // magic | header length (4 bytes, big endian) | header | ciphertext
  const magic = encoder.encode(MAGIC);
  const out = new Uint8Array(new ArrayBuffer(magic.length + 4 + headerBytes.length + body.length));
  let at = 0;
  out.set(magic, at);
  at += magic.length;
  new DataView(out.buffer).setUint32(at, headerBytes.length, false);
  at += 4;
  out.set(headerBytes, at);
  at += headerBytes.length;
  out.set(body, at);
  return out;
}

export function isSealed(data: Uint8Array): boolean {
  return magicLength(data) > 0;
}

/** Read the clear header without needing a key. */
export function readHeader(data: Uint8Array): ContainerHeader | null {
  const start = magicLength(data);
  if (!start) return null;
  try {
    const length = new DataView(data.buffer, data.byteOffset).getUint32(start, false);
    const header = JSON.parse(
      decoder.decode(data.subarray(start + 4, start + 4 + length)),
    ) as ContainerHeader;
    return header.v === 1 ? header : null;
  } catch {
    return null;
  }
}

export type OpenResult =
  | { ok: true; document: unknown }
  | { ok: false; reason: "not-sealed" | "unsupported" | "wrong-key" | "damaged"; message: string };

export async function open(data: Uint8Array, licenseKey: string): Promise<OpenResult> {
  const header = readHeader(data);
  if (!header) {
    return { ok: false, reason: "not-sealed", message: "this file is not a sealed pack" };
  }
  if (header.alg !== "aes-256-gcm" || header.kdf !== "pbkdf2-sha256") {
    return {
      ok: false,
      reason: "unsupported",
      message: "this copy was sealed by a newer version of the app",
    };
  }

  try {
    const start = magicLength(data);
    const length = new DataView(data.buffer, data.byteOffset).getUint32(start, false);
    // Copied into a buffer of its own rather than passed as a view: a
    // `Uint8Array` read from a file may be backed by a shared buffer, which
    // Web Crypto will not accept.
    const view = data.subarray(start + 4 + length);
    const body = new Uint8Array(new ArrayBuffer(view.length));
    body.set(view);
    const key = await deriveKey(licenseKey, fromBase64Url(header.salt), header.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(header.iv) },
      key,
      body,
    );
    return { ok: true, document: JSON.parse(decoder.decode(plain)) as unknown };
  } catch {
    // AES-GCM fails the same way for a wrong key and for a corrupted file, and
    // there is no honest way to tell them apart. The wrong key is what almost
    // always happened, so that is what the message says.
    return {
      ok: false,
      reason: "wrong-key",
      message: "that license key does not open this copy",
    };
  }
}
