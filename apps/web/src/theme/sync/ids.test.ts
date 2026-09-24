import { IDEMPOTENCY_KEY_PATTERN, THEME_ID_PATTERN } from "@runlog/themes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newSyncKey, newThemeId } from "./ids.ts";

const realCrypto = globalThis.crypto;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sync keys", () => {
  it("uses randomUUID when it works", () => {
    expect(newSyncKey()).toMatch(/^[0-9a-f-]{36}$/);
    expect(THEME_ID_PATTERN.test(newThemeId())).toBe(true);
  });

  it("falls back to random bytes when randomUUID throws", () => {
    vi.spyOn(realCrypto, "randomUUID").mockImplementation(() => {
      throw new Error("insecure context");
    });
    const key = newSyncKey();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(IDEMPOTENCY_KEY_PATTERN.test(key)).toBe(true);
  });

  it("falls back to random bytes when randomUUID is missing", () => {
    vi.stubGlobal("crypto", { getRandomValues: <T extends ArrayBufferView>(bytes: T) => realCrypto.getRandomValues(bytes as never) });
    expect(newSyncKey()).toMatch(/^[0-9a-f]{32}$/);
  });
});
