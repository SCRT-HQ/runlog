import { webcrypto } from "node:crypto";

/**
 * The sealed pack container, as the app opens it.
 *
 * A port of `packages/container/src/container.ts` in SCRT-HQ/runlog, byte
 * for byte: the same magic, header, key derivation and cipher, so a file
 * sealed here opens in the app with the key this issued. That package is
 * not published; this is the one copy outside it, and the round-trip test
 * beside it is what keeps the two honest. Change one, change both.
 */

const crypto = webcrypto;
const MAGIC = "RLPACK";
const KDF_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ContainerHeader {
  v: 1;
  alg: "aes-256-gcm";
  kdf: "pbkdf2-sha256";
  iterations: number;
  salt: string;
  iv: string;
  ref?: string;
  title?: string;
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(text, "base64url");
  const out = new Uint8Array(new ArrayBuffer(buf.length));
  out.set(buf);
  return out;
}
function bytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(out);
  return out;
}

/** A license key a person can be given and can type: five groups of five, no lookalikes. */
export function generateLicenseKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = bytes(20);
  const chars = [...raw].map((b) => alphabet[b % alphabet.length]).join("");
  return (chars.match(/.{5}/g) ?? []).join("-");
}

const normalizeKey = (key: string) => key.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

async function deriveKey(licenseKey: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(normalizeKey(licenseKey)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Seal a document: the whole thing, signature included, under a key. */
export async function seal(document: unknown, licenseKey: string, extra: { ref?: string; title?: string } = {}): Promise<Uint8Array> {
  const salt = bytes(16);
  const iv = bytes(12);
  const key = await deriveKey(licenseKey, salt, KDF_ITERATIONS);
  const plaintext = encoder.encode(JSON.stringify(document));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
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
  const magic = encoder.encode(MAGIC);
  const out = new Uint8Array(magic.length + 4 + headerBytes.length + body.length);
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

/** Read the clear header without a key; null for anything that is not a sealed pack. */
export function readHeader(data: Uint8Array): ContainerHeader | null {
  const magic = encoder.encode(MAGIC);
  if (data.length < magic.length || !magic.every((b, i) => data[i] === b)) return null;
  try {
    const start = magic.length;
    const length = new DataView(data.buffer, data.byteOffset).getUint32(start, false);
    const header = JSON.parse(decoder.decode(data.subarray(start + 4, start + 4 + length))) as ContainerHeader;
    return header.v === 1 ? header : null;
  } catch {
    return null;
  }
}

/** Open a sealed pack with its key; null for the wrong key or a damaged file. For the test. */
export async function open(data: Uint8Array, licenseKey: string): Promise<unknown | null> {
  const header = readHeader(data);
  if (!header) return null;
  try {
    const start = encoder.encode(MAGIC).length;
    const length = new DataView(data.buffer, data.byteOffset).getUint32(start, false);
    const view = data.subarray(start + 4 + length);
    const body = new Uint8Array(new ArrayBuffer(view.length));
    body.set(view);
    const key = await deriveKey(licenseKey, fromBase64Url(header.salt), header.iterations);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(header.iv) }, key, body);
    return JSON.parse(decoder.decode(plain)) as unknown;
  } catch {
    return null;
  }
}
