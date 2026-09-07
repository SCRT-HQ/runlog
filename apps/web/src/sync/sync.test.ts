import { afterEach, describe, expect, it, vi } from "vitest";
import { hashJson, hashText } from "./hash.ts";
import { apiBase } from "./config.ts";

describe("fingerprints", () => {
  it("are sixteen hex characters and stable", async () => {
    const a = await hashText("hello");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await hashText("hello")).toBe(a);
    expect(await hashText("hello ")).not.toBe(a);
  });

  it("hash the stored string as it is, not a normalized form", async () => {
    // The log is never reordered and a pack is kept verbatim, so the bytes
    // as stored are the canonical form. Key order changes the fingerprint,
    // and that is correct: it would change what is stored.
    expect(await hashJson({ a: 1, b: 2 })).not.toBe(await hashJson({ b: 2, a: 1 }));
  });
});

describe("where the API is", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is nowhere without something to sign into", () => {
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "");
    expect(apiBase()).toBeUndefined();
  });

  it("is nowhere in this test process, which has no location", () => {
    // Node has no window: the same guard that keeps a file on disk from
    // asking keeps the tests from asking.
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
    expect(apiBase()).toBeUndefined();
  });
});
