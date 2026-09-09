import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { generateLicenseKey, isSealed, open, readHeader, seal } from "./container.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const kiln = YAML.parse(
  readFileSync(join(repoRoot, "packs", "demo", "pack.yaml"), "utf8"),
) as Record<string, unknown>;

const KEY = "ABCDE-FGHJK-LMNPQ-RSTUV";
const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

/**
 * The threat is narrow and worth restating: a buyer opening the file they
 * downloaded, deleting the two lines that name them, and re-uploading it. Not
 * an attack: a text editor and thirty seconds.
 */
describe("a sealed copy", () => {
  it("round-trips the whole document", async () => {
    const sealed = await seal(kiln, KEY);
    const result = await open(sealed, KEY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(kiln);
  });

  it("carries no rules text that a text editor could reach", async () => {
    const sealed = await seal(kiln, KEY, { title: "The Long Kiln", ref: "order-1" });
    const readable = text(sealed);
    expect(readable).not.toContain("The Kiln is quiet");
    expect(readable).not.toContain("Wedge clay");
    expect(readable).not.toContain("anchoredOffset");
  });

  it("names the buyer nowhere in the clear", async () => {
    // The seller's own reference is in the header so a leak is traceable
    // through their records. The person's name is not, because a leaked file
    // should not publish it to everyone who downloads it.
    const stamped = { ...kiln, issue: { to: "Nate Ferrell", issuedAt: "2026-01-01T00:00:00Z" } };
    const sealed = await seal(stamped, KEY, { ref: "order-8f3a" });
    expect(text(sealed)).not.toContain("Nate Ferrell");
    expect(readHeader(sealed)?.ref).toBe("order-8f3a");
  });

  it("says what it is before asking for a key", async () => {
    // A prompt that cannot name the file it wants a key for is a bad prompt.
    const sealed = await seal(kiln, KEY, { title: "The Long Kiln" });
    expect(readHeader(sealed)).toMatchObject({ title: "The Long Kiln", v: 1 });
  });

  it("refuses the wrong key", async () => {
    const sealed = await seal(kiln, KEY);
    const result = await open(sealed, "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ");
    expect(result).toMatchObject({ ok: false, reason: "wrong-key" });
  });

  it("does not care how the key was typed", async () => {
    // It arrives pasted out of a receipt, with whatever spacing and case came
    // with it. Refusing a correct key over a space would be its own problem.
    const sealed = await seal(kiln, KEY);
    expect((await open(sealed, " abcde-fghjk-lmnpq-rstuv ")).ok).toBe(true);
    expect((await open(sealed, "ABCDEFGHJKLMNPQRSTUV")).ok).toBe(true);
  });

  it("refuses a file that has been tampered with", async () => {
    // AES-GCM authenticates, so a flipped byte fails rather than decrypting
    // into rubbish the app would then try to play.
    const sealed = await seal(kiln, KEY);
    const at = sealed.length - 5;
    sealed[at] = (sealed[at] ?? 0) ^ 0xff;
    expect((await open(sealed, KEY)).ok).toBe(false);
  });

  it("recognizes what is and is not a sealed file", async () => {
    expect(isSealed(await seal(kiln, KEY))).toBe(true);
    expect(isSealed(new TextEncoder().encode("schemaVersion: 1\ntitle: x"))).toBe(false);
    expect(isSealed(new Uint8Array(2))).toBe(false);
    expect(readHeader(new TextEncoder().encode("not a pack"))).toBeNull();
  });

  it("reports a plain file as not sealed rather than as a bad key", async () => {
    const plain = new TextEncoder().encode("schemaVersion: 1");
    expect(await open(plain, KEY)).toMatchObject({ ok: false, reason: "not-sealed" });
  });

  it("seals differently every time, so two copies never look alike", async () => {
    // A fresh salt and IV per copy. Identical ciphertext for two buyers would
    // let anyone tell that two files held the same pack.
    const a = await seal(kiln, KEY);
    const b = await seal(kiln, KEY);
    expect(text(a)).not.toBe(text(b));
  });
});

describe("license keys", () => {
  it("are readable, groupable and hard to mistype", () => {
    const key = generateLicenseKey();
    expect(key).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    // No O/0, I/1 confusion for someone copying from a receipt.
    expect(key).not.toMatch(/[OI01]/);
  });

  it("are not the same twice", () => {
    const keys = new Set(Array.from({ length: 50 }, generateLicenseKey));
    expect(keys.size).toBe(50);
  });
});

describe("the magic", () => {
  it("is the six documented letters, and a copy from the first releases still opens", async () => {
    const key = "AAAAA-BBBBB-CCCCC-DDDDD";
    const sealed = await seal({ id: "x", title: "T" }, key, { title: "T" });
    expect(new TextDecoder().decode(sealed.subarray(0, 6))).toBe("RLPACK");
    expect(sealed[6]).not.toBe(1);
    expect(isSealed(sealed)).toBe(true);
    // The first releases wrote a stray 0x01 after the letters.
    const legacy = new Uint8Array(sealed.length + 1);
    legacy.set(sealed.subarray(0, 6), 0);
    legacy[6] = 1;
    legacy.set(sealed.subarray(6), 7);
    expect(isSealed(legacy)).toBe(true);
    expect(readHeader(legacy)?.title).toBe("T");
    const opened = await open(legacy, key);
    expect(opened.ok).toBe(true);
  });
});
