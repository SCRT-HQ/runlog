import { describe, expect, it } from "vitest";
import { deviceFlow, renew, type FlowDeps } from "./account.ts";

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp, sub: "user_1" })).toString("base64url")}.s`;

/** A WorkOS that answers the device-flow endpoints from a script of token answers. */
function fakeWorkos(answers: Array<Record<string, unknown>>) {
  const calls: Array<{ url: string; form: Record<string, string> }> = [];
  const said: string[] = [];
  const opened: string[] = [];
  let clock = 1_000_000;
  const deps: FlowDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
      calls.push({ url, form });
      if (url.endsWith("/authorize/device")) {
        return new Response(
          JSON.stringify({
            device_code: "dev_secret",
            user_code: "RRGQ-BJVS",
            verification_uri: "https://auth.example/device",
            verification_uri_complete: "https://auth.example/device?user_code=RRGQ-BJVS",
            expires_in: 300,
            interval: 5,
          }),
          { status: 200 },
        );
      }
      const next = answers.shift() ?? { error: "expired_token" };
      return new Response(JSON.stringify(next), { status: "error" in next ? 400 : 200 });
    },
    sleep: async (ms) => {
      clock += ms;
    },
    say: (line) => said.push(line),
    open: (url) => opened.push(url),
    now: () => clock,
  };
  return { deps, calls, said, opened };
}

describe("signing in from a terminal", () => {
  it("shows the code, opens the browser, polls until confirmed, and keeps what came back", async () => {
    const w = fakeWorkos([{ error: "authorization_pending" }, { error: "authorization_pending" }, { access_token: jwt(2_000), refresh_token: "r1" }]);
    const session = await deviceFlow("client_cli", "https://api.workos.test", w.deps);
    expect(session).toEqual({ clientId: "client_cli", issuer: "https://api.workos.test", accessToken: jwt(2_000), refreshToken: "r1", expiresAt: "1970-01-01T00:33:20.000Z" });
    expect(w.said.join("\n")).toContain("RRGQ-BJVS");
    expect(w.said.join("\n")).toContain("https://auth.example/device");
    expect(w.opened).toEqual(["https://auth.example/device?user_code=RRGQ-BJVS"]);
    expect(w.calls[0]).toEqual({ url: "https://api.workos.test/user_management/authorize/device", form: { client_id: "client_cli" } });
    expect(w.calls[1]?.form).toEqual({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: "dev_secret", client_id: "client_cli" });
    expect(w.calls).toHaveLength(4);
  });

  it("backs off when told to slow down", async () => {
    const w = fakeWorkos([{ error: "slow_down" }, { error: "authorization_pending" }, { access_token: jwt(9), refresh_token: "r" }]);
    const before = w.deps.now();
    await deviceFlow("c", "https://api.workos.test", w.deps);
    // 5 s, then 6 s twice after the slow_down.
    expect(w.deps.now() - before).toBe((5 + 6 + 6) * 1000);
  });

  it("gives up when the person refuses or the code dies", async () => {
    await expect(deviceFlow("c", "https://api.workos.test", fakeWorkos([{ error: "access_denied" }]).deps)).rejects.toThrow("refused");
    await expect(deviceFlow("c", "https://api.workos.test", fakeWorkos([{ error: "expired_token" }]).deps)).rejects.toThrow("expired");
    await expect(deviceFlow("c", "https://api.workos.test", fakeWorkos([{ error: "invalid_client", error_description: "no such client" }]).deps)).rejects.toThrow("no such client");
  });

  it("stops polling at the deadline even if WorkOS keeps saying pending", async () => {
    const pending = Array.from({ length: 100 }, () => ({ error: "authorization_pending" }));
    const w = fakeWorkos(pending);
    await expect(deviceFlow("c", "https://api.workos.test", w.deps)).rejects.toThrow("expired");
    expect(w.calls.length).toBeLessThan(70);
  });
});

describe("renewing a session", () => {
  it("swaps the refresh token for a new pair and reads the new expiry", async () => {
    const w = fakeWorkos([{ access_token: jwt(3_600), refresh_token: "r2" }]);
    const session = await renew({ clientId: "c", issuer: "https://api.workos.test", accessToken: "old", refreshToken: "r1", expiresAt: "" }, w.deps);
    expect(session.refreshToken).toBe("r2");
    expect(session.expiresAt).toBe("1970-01-01T01:00:00.000Z");
    expect(w.calls[0]?.form).toEqual({ grant_type: "refresh_token", refresh_token: "r1", client_id: "c" });
  });

  it("says the sign-in has lapsed when WorkOS will not renew it", async () => {
    const w = fakeWorkos([{ error: "invalid_grant" }]);
    await expect(renew({ clientId: "c", issuer: "https://api.workos.test", accessToken: "old", refreshToken: "r1", expiresAt: "" }, w.deps)).rejects.toThrow("lapsed");
  });
});
