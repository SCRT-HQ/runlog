import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredClientId } from "./config.ts";

/**
 * The sign-in client is a build-time setting first, and a tag in the shell
 * second: the second is how a published build, which was built with none,
 * signs in at an address that lays one over it.
 */
describe("the sign-in client", () => {
  const before = (globalThis as { document?: unknown }).document;
  const shell = (content?: string) => {
    (globalThis as { document?: unknown }).document = {
      querySelector: (selector: string) =>
        selector === 'meta[name="runlog:sign-in"]' && content !== undefined ? { getAttribute: () => content } : null,
    };
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    (globalThis as { document?: unknown }).document = before;
  });

  it("is the build's, when the build has one", () => {
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_built");
    shell("client_01LAIDOVER");
    expect(configuredClientId()).toBe("client_built");
  });

  it("is the shell's tag, when the build has none", () => {
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "");
    shell("client_01LAIDOVER");
    expect(configuredClientId()).toBe("client_01LAIDOVER");
  });

  it("is nothing without either, and nothing for a tag that is not a client id", () => {
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "");
    shell();
    expect(configuredClientId()).toBeUndefined();
    shell("<script>alert(1)</script>");
    expect(configuredClientId()).toBeUndefined();
  });
});
