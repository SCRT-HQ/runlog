import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { decodePack, describeLength, encodePack, encodePackLink, LINK_PREFIX } from "./link.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const kiln = YAML.parse(
  readFileSync(join(repoRoot, "packs", "demo", "pack.yaml"), "utf8"),
) as Record<string, unknown>;

describe("a pack in a link", () => {
  it("round-trips a whole pack unchanged", async () => {
    const result = await decodePack(await encodePack(kiln));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(kiln);
  });

  /**
   * A signature has to survive the trip, or sharing a signed pack quietly
   * strips the one thing that made it checkable. This is why the link carries
   * the raw document rather than a validated pack.
   */
  it("carries a signature with it", async () => {
    const signed = {
      ...kiln,
      signature: {
        algorithm: "ecdsa-p256-sha256",
        publicKey: "k",
        value: "v",
        signedAt: "2026-01-01T00:00:00.000Z",
        signedBy: "Someone",
      },
    };
    const result = await decodePack(await encodePack(signed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(signed);
  });

  it("goes in the fragment, which never reaches a server", async () => {
    const link = await encodePackLink(kiln, "https://example.com/runlog/");
    expect(link.startsWith(`https://example.com/runlog/${LINK_PREFIX}`)).toBe(true);
    // Everything after the # is the pack; nothing about it is in the path or
    // the query, which are the parts a server would see and log.
    expect(new URL(link).pathname).toBe("/runlog/");
    expect(new URL(link).search).toBe("");
  });

  it("replaces a fragment already on the page rather than appending to it", async () => {
    const link = await encodePackLink(kiln, "https://example.com/app/#pack=1g.stale");
    expect(link.split("#").length - 1).toBe(1);
  });

  it("uses only characters that survive a URL and a copy-paste", async () => {
    const fragment = await encodePack(kiln);
    expect(fragment.slice(LINK_PREFIX.length)).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("compresses, which is what makes this usable at all", async () => {
    const raw = JSON.stringify(kiln).length;
    const fragment = await encodePack(kiln);
    expect(fragment.length).toBeLessThan(raw / 2);
  });

  describe("when a link arrives damaged", () => {
    // Chat apps truncate, mail clients wrap, people select by hand. All of it
    // must produce a sentence rather than a stack trace.
    it("reports a truncated link", async () => {
      const fragment = await encodePack(kiln);
      const result = await decodePack(fragment.slice(0, fragment.length - 200));
      expect(result).toMatchObject({ ok: false });
      if (result.ok) return;
      expect(result.error).toContain("damaged or incomplete");
    });

    it("reports an empty link", async () => {
      expect(await decodePack("#pack=")).toMatchObject({ ok: false });
    });

    it("reports a link from a future version instead of guessing", async () => {
      expect(await decodePack("#pack=2g.abcd")).toMatchObject({
        ok: false,
        error: expect.stringContaining("newer version"),
      });
    });

    it("reports an unknown codec", async () => {
      expect(await decodePack("#pack=1z.abcd")).toMatchObject({ ok: false });
    });

    it("reports a link carrying something that is not a pack", async () => {
      const notAPack = await encodePack([1, 2, 3] as unknown);
      expect(await decodePack(notAPack)).toMatchObject({ ok: false });
    });
  });

  it("reads a fragment with or without the app's prefix", async () => {
    const fragment = await encodePack(kiln);
    const bare = fragment.slice(LINK_PREFIX.length);
    expect((await decodePack(`#${bare}`)).ok).toBe(true);
  });
});

/**
 * The length advice is about the medium, not about the app: a fragment never
 * reaches a server, so the limits that matter belong to wherever it is pasted.
 */
describe("what a link's length means", () => {
  it("says a short link goes anywhere", () => {
    expect(describeLength("x".repeat(500))).toMatchObject({ ok: true });
    expect(describeLength("x".repeat(500)).text).toContain("anywhere");
  });

  it("warns that a medium link will not fit a chat message", () => {
    const advice = describeLength("x".repeat(9000));
    expect(advice.ok).toBe(true);
    expect(advice.text).toContain("chat");
  });

  it("says to send the file once a link gets absurd", () => {
    const advice = describeLength("x".repeat(50000));
    expect(advice.ok).toBe(false);
    expect(advice.text).toContain("file");
  });

  it("reports the real pack at a length that matches the advice", async () => {
    const link = await encodePackLink(kiln, "https://example.com/");
    expect(describeLength(link).ok).toBe(true);
  });
});
