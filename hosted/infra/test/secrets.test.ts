import { describe, expect, it } from "vitest";
import { looksLike } from "../lib/handlers/secrets";

/**
 * A secret that does not look like the real thing keeps its feature off,
 * so the shapes have to admit every real key and no placeholder.
 */
describe("what a real key looks like", () => {
  it("knows WorkOS keys, sandbox and production alike", () => {
    expect(looksLike("workos-key", "sk_test_" + "a".repeat(60))).toBe(true);
    // Production keys carry no environment word: sk_ and the body.
    expect(looksLike("workos-key", "sk_" + "a2V5X".repeat(15) + "_")).toBe(true);
    expect(looksLike("workos-key", "placeholder-9f2c")).toBe(false);
    expect(looksLike("workos-key", "sk_short")).toBe(false);
    expect(looksLike("workos-key", "")).toBe(false);
  });
  it("knows Stripe keys and webhook secrets", () => {
    expect(looksLike("stripe-key", "sk_live_" + "A".repeat(40))).toBe(true);
    expect(looksLike("stripe-key", "rk_test_" + "A".repeat(40))).toBe(true);
    expect(looksLike("stripe-key", "whsec_" + "A".repeat(40))).toBe(false);
    expect(looksLike("webhook-secret", "whsec_" + "A".repeat(40))).toBe(true);
    expect(looksLike("webhook-secret", "sk_live_" + "A".repeat(40))).toBe(false);
  });
});
