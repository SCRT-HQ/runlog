import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  canonicalize,
  fingerprint,
  fromBase64Url,
  generateKeyPair,
  signPack,
  toBase64Url,
  verifyPack,
} from "./signing.ts";
import { parsePack } from "./parse.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const kilnSource = readFileSync(join(repoRoot, "packs", "demo", "pack.yaml"), "utf8");
const kiln = YAML.parse(kilnSource) as Record<string, unknown>;

/**
 * The signature covers the *game*, not the file.
 *
 * That is the whole reason for a canonical form. An author who re-indents
 * their YAML, reorders two keys, adds a comment or converts the file to JSON
 * has not changed their game, and a signature that broke on any of those is
 * one people stop bothering to attach.
 */
describe("canonical form", () => {
  it("ignores key order", () => {
    const a = { title: "x", id: "y", version: "1" };
    const b = { version: "1", id: "y", title: "x" };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("ignores whitespace and the file format it arrived in", () => {
    const asJson = JSON.parse(JSON.stringify(kiln)) as unknown;
    const reindented = YAML.parse(YAML.stringify(kiln, { indent: 4 })) as unknown;
    expect(canonicalize(reindented)).toBe(canonicalize(asJson));
  });

  it("does not ignore the order of a list, which is meaningful", () => {
    // Phases run in order and table entries are read in order; reordering
    // them is a different game, not a different file.
    expect(canonicalize({ phases: [1, 2] })).not.toBe(canonicalize({ phases: [2, 1] }));
  });

  it("excludes the signature block, which cannot cover itself", () => {
    const unsigned = { title: "x" };
    const signed = { title: "x", signature: { value: "anything" } };
    expect(canonicalize(signed)).toBe(canonicalize(unsigned));
  });

  it("notices a change anywhere in the document", () => {
    const changed = structuredClone(kiln);
    const tables = changed.tables as Record<string, { entries: Array<{ text: string }> }>;
    tables.check!.entries[0]!.text = "Something else entirely.";
    expect(canonicalize(changed)).not.toBe(canonicalize(kiln));
  });

  it("distinguishes values that stringify alike", () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: "1" }));
    expect(canonicalize({ a: null })).not.toBe(canonicalize({ a: "null" }));
  });
});

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
  });

  it("produces nothing that needs escaping in a URL or a YAML scalar", () => {
    const bytes = new Uint8Array(300).map((_, i) => (i * 7) % 256);
    expect(toBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]*$/);
  });
});

describe("signing a pack", () => {
  it("verifies against the pack it was made from", async () => {
    const { privateKey } = await generateKeyPair();
    const signature = await signPack(kiln, privateKey, "A Designer");
    const result = await verifyPack({ ...kiln, signature });

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.signedBy).toBe("A Designer");
    expect(result.fingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
  });

  it("survives the pack being reformatted", async () => {
    // Author signs the YAML they wrote; a distributor bundles it to JSON.
    const { privateKey } = await generateKeyPair();
    const signature = await signPack(kiln, privateKey);
    const bundled = JSON.parse(JSON.stringify({ ...kiln, signature })) as unknown;
    expect((await verifyPack(bundled)).status).toBe("valid");
  });

  /**
   * The point of the whole exercise: an edited pack cannot go on claiming to
   * be the author's. It still plays, nothing here restricts that, but it
   * stops being *theirs*.
   */
  it("fails once a single word of the rules changes", async () => {
    const { privateKey } = await generateKeyPair();
    const signature = await signPack(kiln, privateKey);
    const tampered = structuredClone({ ...kiln, signature }) as Record<string, unknown>;
    const tables = tampered.tables as Record<string, { entries: Array<{ text: string }> }>;
    tables.check!.entries[0]!.text = "The Kiln is generous. Take a free Piece.";

    const result = await verifyPack(tampered);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.reason).toContain("changed since it was signed");
  });

  it("fails when someone else's key is claimed", async () => {
    const mine = await generateKeyPair();
    const theirs = await generateKeyPair();
    const signature = await signPack(kiln, mine.privateKey);
    // Swapping in another key does not make the signature theirs.
    const forged = { ...kiln, signature: { ...signature, publicKey: theirs.publicKey } };
    expect((await verifyPack(forged)).status).toBe("invalid");
  });

  it("treats an unsigned pack as unsigned, not as suspect", async () => {
    // Most packs will never be signed. Flagging them would make the feature a
    // nuisance and teach everyone to ignore it.
    expect(await verifyPack(kiln)).toEqual({ status: "unsigned" });
  });

  it("refuses an algorithm it does not know rather than assuming", async () => {
    const result = await verifyPack({
      ...kiln,
      signature: { algorithm: "magic", publicKey: "x", value: "y", signedAt: "z" },
    });
    expect(result).toMatchObject({ status: "invalid" });
  });

  it("reports a malformed signature instead of throwing", async () => {
    const result = await verifyPack({
      ...kiln,
      signature: {
        algorithm: "ecdsa-p256-sha256",
        publicKey: "not-a-key",
        value: "not-a-signature",
        signedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(result.status).toBe("invalid");
  });

  it("gives the same fingerprint for the same key, and a different one otherwise", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    expect(await fingerprint(a.publicKey)).toBe(await fingerprint(a.publicKey));
    expect(await fingerprint(a.publicKey)).not.toBe(await fingerprint(b.publicKey));
  });

  it("produces a pack the schema still accepts", async () => {
    // A signature must not be the thing that stops a pack loading.
    const { privateKey } = await generateKeyPair();
    const signature = await signPack(kiln, privateKey, "A Designer");
    const result = parsePack({ ...kiln, signature });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a signature block the schema does not recognize", async () => {
    const result = parsePack({ ...kiln, signature: { algorithm: "ecdsa-p256-sha256" } });
    expect(result.ok).toBe(false);
  });
});
