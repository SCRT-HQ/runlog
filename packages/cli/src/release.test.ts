import { describe, expect, it } from "vitest";
import { priceFlag } from "./account.ts";
import { loadKey } from "./sign.ts";

describe("the release command's price", () => {
  it("reads dollars and cents into whole cents", () => {
    expect(priceFlag(["--price", "3.00"])).toEqual({ amount: 300, currency: "usd" });
    expect(priceFlag(["--price", "$12.5"])).toEqual({ amount: 1250, currency: "usd" });
    expect(priceFlag(["--price", "7"])).toEqual({ amount: 700, currency: "usd" });
  });
  it("knows free from keep", () => {
    expect(priceFlag(["--free"])).toBe("free");
    expect(priceFlag(["pack.yaml"])).toBe("keep");
  });
  it("refuses what the marketplace would", () => {
    expect(priceFlag(["--price", "0.50"])).toHaveProperty("error");
    expect(priceFlag(["--price", "three"])).toHaveProperty("error");
    expect(priceFlag(["--price", "2000"])).toHaveProperty("error");
  });
});

describe("the signing key in the environment", () => {
  const key = JSON.stringify({ algorithm: "ecdsa-p256-sha256", publicKey: "pk", privateKey: "sk", fingerprint: "ab:cd", createdAt: "2026-09-07T00:00:00Z" });
  it("is read from RUNLOG_SIGNING_KEY when no --key is passed", () => {
    const held = loadKey(["pack.yaml"], { RUNLOG_SIGNING_KEY: key });
    expect("key" in held && held.key.privateKey).toBe("sk");
    expect("from" in held && held.from).toBe("RUNLOG_SIGNING_KEY");
  });
  it("says what is wrong with it", () => {
    expect(loadKey(["pack.yaml"], {})).toHaveProperty("error");
    expect(loadKey(["pack.yaml"], { RUNLOG_SIGNING_KEY: "not json" })).toHaveProperty("error");
    expect(loadKey(["pack.yaml"], { RUNLOG_SIGNING_KEY: JSON.stringify({ publicKey: "pk" }) })).toHaveProperty("error");
  });
});
