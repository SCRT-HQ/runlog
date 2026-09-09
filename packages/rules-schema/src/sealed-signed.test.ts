import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { open, seal } from "@runlog/container";
import { generateKeyPair, signPack, verifyPack } from "./signing.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const kiln = YAML.parse(
  readFileSync(join(repoRoot, "packs", "demo", "pack.yaml"), "utf8"),
) as Record<string, unknown>;

const KEY = "ABCDE-FGHJK-LMNPQ-RSTUV";

/**
 * The property the whole selling scheme rests on: the buyer's name is inside
 * the signed payload, and the seal wraps the signature. Removing the name
 * leaves a copy that no longer verifies, so the choice is between a copy that
 * names you and a copy that is visibly not the author's release.
 *
 * Here rather than with the container, because the container knows nothing
 * about signatures, that is the point of it being its own package.
 */
describe("a sealed, signed copy", () => {
  it("binds the watermark to the signature", async () => {
    const { privateKey } = await generateKeyPair();
    const stamped = { ...kiln, issue: { to: "A Buyer", issuedAt: "2026-01-01T00:00:00Z" } };
    const signed = { ...stamped, signature: await signPack(stamped, privateKey, "The Author") };

    const opened = await open(await seal(signed, KEY), KEY);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(await verifyPack(opened.document)).toMatchObject({ status: "valid" });

    const { issue: _removed, ...stripped } = opened.document as Record<string, unknown>;
    expect(await verifyPack(stripped)).toMatchObject({ status: "invalid" });
  });
});
