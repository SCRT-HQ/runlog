import { describe, expect, it } from "vitest";
import { remixable, remixOf } from "./remix.ts";

describe("what may be remixed", () => {
  it("allows the permissive licenses, with attribution where they ask for it", () => {
    expect(remixable({ id: "CC0-1.0", redistributable: true })).toEqual({ ok: true, attribution: false, shareAlike: false });
    expect(remixable({ id: "CC-BY-4.0", redistributable: true })).toEqual({ ok: true, attribution: true, shareAlike: false });
    expect(remixable({ id: "CC-BY-SA-4.0", redistributable: true })).toEqual({ ok: true, attribution: true, shareAlike: true });
    expect(remixable({ id: "MIT", redistributable: true }).ok).toBe(true);
  });

  it("refuses no-derivatives, non-redistributable, unknown, and missing licenses, each with its reason", () => {
    expect(remixable({ id: "CC-BY-ND-4.0", redistributable: true })).toMatchObject({ ok: false, reason: expect.stringContaining("not changed ones") as unknown as string });
    expect(remixable({ id: "CC0-1.0", redistributable: false })).toMatchObject({ ok: false, reason: expect.stringContaining("shared") as unknown as string });
    expect(remixable({ id: "proprietary", redistributable: true })).toMatchObject({ ok: false, reason: expect.stringContaining("ask the author") as unknown as string });
    expect(remixable({ id: "All rights reserved", redistributable: true })).toMatchObject({ ok: false, reason: expect.stringContaining("ask the author") as unknown as string });
    expect(remixable(undefined)).toMatchObject({ ok: false });
  });
});

describe("a remix", () => {
  it("is a new pack that names the old one and carries no signature or stamp", () => {
    const original = {
      id: "com.scrthq.runlog.long-kiln",
      version: "1.0.0",
      title: "The Long Kiln",
      author: "Runlog",
      license: { id: "CC-BY-SA-4.0", redistributable: true, holder: "Runlog" },
      signature: { algorithm: "ecdsa-p256-sha256", publicKey: "x", value: "y", signedAt: "2026-01-01" },
      issue: { to: "A Buyer", issuedAt: "2026-01-01" },
      tables: {},
    };
    const remix = remixOf(original);
    expect(remix["id"]).toBe("com.scrthq.runlog.long-kiln.remix");
    expect(remix["title"]).toBe("The Long Kiln (remix)");
    expect(remix["version"]).toBe("0.1.0");
    expect(remix).not.toHaveProperty("signature");
    expect(remix).not.toHaveProperty("issue");
    expect(remix).not.toHaveProperty("author");
    expect((remix["license"] as { id: string; notice: string }).id).toBe("CC-BY-SA-4.0");
    expect((remix["license"] as { notice: string }).notice).toContain("Based on “The Long Kiln” by Runlog (com.scrthq.runlog.long-kiln v1.0.0)");
    expect(remix["tables"]).toEqual({});
  });
});
