import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { annotate, traced, tracedCalls } from "../lib/handlers/xray";

/**
 * A test run and the CLI have no X-Ray daemon behind them, and never
 * should need one: `AWS_XRAY_DAEMON_ADDRESS` and `_X_AMZN_TRACE_ID` are
 * both things the Lambda runtime sets, never a local shell. Everything
 * here confirms that outside that runtime, wrapping is a plain no-op —
 * the same client, the same calls, nothing extra to fail without a
 * daemon.
 */
describe("outside Lambda", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["AWS_XRAY_DAEMON_ADDRESS", "_X_AMZN_TRACE_ID"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("traced() hands back the exact client it was given", () => {
    const client = { middlewareStack: { remove: () => {}, use: () => {} }, config: {}, marker: "the fake client" };
    expect(traced(client)).toBe(client);
  });

  it("tracedCalls() hands back the exact implementation it was given", () => {
    const impl = { async ping() { return "pong"; } };
    expect(tracedCalls("stripe", impl)).toBe(impl);
  });

  it("tracedCalls()'s wrapping changes nothing about what a call returns or throws", async () => {
    const impl = {
      async ok(n: number) {
        return n * 2;
      },
      async fails() {
        throw new Error("this is the error a real call would throw");
      },
      sync(n: number) {
        return n + 1;
      },
    };
    const wrapped = tracedCalls("workos", impl);
    await expect(wrapped.ok(21)).resolves.toBe(42);
    await expect(wrapped.fails()).rejects.toThrow("this is the error a real call would throw");
    expect(wrapped.sync(1)).toBe(2);
  });

  it("annotate() does nothing and never throws with no segment to annotate", () => {
    expect(() => annotate({ method: "GET", route: "/api/me" })).not.toThrow();
  });
});
