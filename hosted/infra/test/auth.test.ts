import { describe, expect, it } from "vitest";
import { clientIdOf, issuersFor, verify } from "../lib/handlers/auth.js";

const token = (payload: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("which client a token is for", () => {
  it("reads the client id claim without trusting it", () => {
    expect(clientIdOf(token({ client_id: "client_a", sub: "u" }))).toBe("client_a");
    expect(clientIdOf(token({ sub: "u" }))).toBeUndefined();
    expect(clientIdOf("not.a.jwt")).toBeUndefined();
    expect(clientIdOf("")).toBeUndefined();
  });

  it("refuses a token for a client that is not ours before fetching any key set", async () => {
    await expect(verify(`Bearer ${token({ client_id: "client_x" })}`, ["client_a", "client_b"])).rejects.toThrow("another client");
    await expect(verify(`Bearer ${token({ client_id: "" })}`, "client_a")).rejects.toThrow("another client");
    await expect(verify(undefined, "client_a")).rejects.toThrow("no bearer token");
  });
});

describe("which issuers a token may name", () => {
  it("accepts the bare host and the issuer form of every client we accept, since WorkOS names the environment's primary client", () => {
    expect(issuersFor("client_cli", ["client_browser", "client_cli"])).toEqual([
      "https://api.workos.com",
      "https://api.workos.com/user_management/client_cli",
      "https://api.workos.com/user_management/client_browser",
    ]);
    expect(issuersFor("client_a", ["client_a", ""])).toEqual(["https://api.workos.com", "https://api.workos.com/user_management/client_a"]);
  });
});
