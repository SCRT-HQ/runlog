// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearProfileReturn, parseProfileReturn, rememberProfileReturn, takeProfileReturn, type ProfileReturnIntent } from "./returns.ts";

const KEY = "runlog:profile-return";

describe("parsing a Billing or Connect callback", () => {
  it("is null where the address carries no callback", () => {
    expect(parseProfileReturn("")).toBeNull();
    expect(parseProfileReturn("?join=abc")).toBeNull();
  });

  it("reads each outcome with its enumerated metadata", () => {
    expect(parseProfileReturn("?billing=done&product=server&destination=servers")).toEqual({
      kind: "billing",
      outcome: "done",
      product: "server",
      destination: "servers",
    });
    expect(parseProfileReturn("?billing=canceled&product=plus&destination=account")).toEqual({
      kind: "billing",
      outcome: "canceled",
      product: "plus",
      destination: "account",
    });
    expect(parseProfileReturn("?billing=managed&destination=publishing")).toEqual({
      kind: "billing",
      outcome: "managed",
      destination: "publishing",
    });
    expect(parseProfileReturn("?publisher=connect-again&destination=publishing")).toEqual({
      kind: "publisher",
      outcome: "connect-again",
      destination: "publishing",
    });
  });

  it("reads legacy callbacks that carry no metadata", () => {
    expect(parseProfileReturn("?billing=done")).toEqual({ kind: "billing", outcome: "done" });
    expect(parseProfileReturn("?publisher=connected")).toEqual({ kind: "publisher", outcome: "connected" });
  });

  it("calls unknown, external or mismatched values invalid rather than guessing", () => {
    for (const search of [
      "?billing=done&product=server&destination=https://evil.example",
      "?billing=done&product=server&destination=//evil.example",
      "?billing=done&product=server&destination=profile",
      "?billing=done&product=gold",
      "?billing=refunded",
      "?billing=",
      "?publisher=connected&destination=servers",
      "?publisher=hijacked",
      "?publisher=connected&product=plus",
      "?billing=managed&product=plus",
      "?billing=done&publisher=connected",
      "?billing=done&destination=account&destination=servers",
    ]) {
      expect(parseProfileReturn(search), search).toEqual({ kind: "invalid" });
    }
  });
});

describe("taking the stored return intent", () => {
  const intent: ProfileReturnIntent = {
    kind: "checkout",
    ownerId: "A",
    product: "server",
    destination: "servers",
  };

  beforeEach(() => sessionStorage.clear());

  it("round-trips an intent for its own account, once", () => {
    rememberProfileReturn(sessionStorage, intent);
    const callback = parseProfileReturn("?billing=done&product=server&destination=servers");
    expect(takeProfileReturn(sessionStorage, "A", callback)).toMatchObject({ product: "server", destination: "servers" });
    expect(sessionStorage.getItem(KEY)).toBeNull();

    // `takeProfileReturn` consumed the first record; seed it again so this
    // assertion exercises owner mismatch rather than merely empty storage.
    rememberProfileReturn(sessionStorage, intent);
    expect(takeProfileReturn(sessionStorage, "B", callback)).toBeNull();
    expect(takeProfileReturn(sessionStorage, "A", callback)).toBeNull();
    expect(parseProfileReturn("?billing=done&product=server&destination=https://evil.example")).toEqual({ kind: "invalid" });
  });

  it("removes the intent when the callback's product does not match it", () => {
    rememberProfileReturn(sessionStorage, intent);
    expect(takeProfileReturn(sessionStorage, "A", parseProfileReturn("?billing=done&product=plus&destination=servers"))).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("removes the intent when the callback's destination does not match it", () => {
    rememberProfileReturn(sessionStorage, intent);
    expect(takeProfileReturn(sessionStorage, "A", parseProfileReturn("?billing=done&product=server&destination=account"))).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("removes the intent when the callback is for another kind of return", () => {
    rememberProfileReturn(sessionStorage, intent);
    expect(takeProfileReturn(sessionStorage, "A", parseProfileReturn("?publisher=connected"))).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();

    rememberProfileReturn(sessionStorage, { kind: "portal", ownerId: "A", destination: "servers" });
    expect(takeProfileReturn(sessionStorage, "A", parseProfileReturn("?billing=done&product=server"))).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("removes corrupt or unknown stored records", () => {
    const callback = parseProfileReturn("?billing=done");
    for (const raw of [
      "{",
      "null",
      JSON.stringify({ ...intent, destination: "https://evil.example" }),
      JSON.stringify({ ...intent, product: "gold" }),
      JSON.stringify({ ...intent, ownerId: "" }),
      JSON.stringify({ ...intent, kind: "refund" }),
      JSON.stringify({ kind: "publisher-connect", ownerId: "A", destination: "servers" }),
    ]) {
      sessionStorage.setItem(KEY, raw);
      expect(takeProfileReturn(sessionStorage, "A", callback), raw).toBeNull();
      expect(sessionStorage.getItem(KEY), raw).toBeNull();
    }
  });

  it("does not touch storage for a missing or invalid callback", () => {
    rememberProfileReturn(sessionStorage, intent);
    expect(takeProfileReturn(sessionStorage, "A", null)).toBeNull();
    expect(takeProfileReturn(sessionStorage, "A", { kind: "invalid" })).toBeNull();
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    clearProfileReturn(sessionStorage);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("fills a legacy callback's product and destination from the account-bound intent", () => {
    rememberProfileReturn(sessionStorage, intent);
    expect(takeProfileReturn(sessionStorage, "A", parseProfileReturn("?billing=done"))).toEqual(intent);

    rememberProfileReturn(sessionStorage, { kind: "checkout", ownerId: "A", product: "hosted-licensing", destination: "publishing" });
    expect(takeProfileReturn(sessionStorage, "A", parseProfileReturn("?billing=canceled"))).toMatchObject({
      product: "hosted-licensing",
      destination: "publishing",
    });

    // A portal opened from Servers whose callback came back without a
    // destination still returns to Servers, the page that started it.
    rememberProfileReturn(sessionStorage, { kind: "portal", ownerId: "A", destination: "servers" });
    expect(takeProfileReturn(sessionStorage, "A", parseProfileReturn("?billing=managed"))).toEqual({
      kind: "portal",
      ownerId: "A",
      destination: "servers",
    });

    // A Checkout started from a page other than its product's own keeps
    // that page when the address names none.
    rememberProfileReturn(sessionStorage, { kind: "checkout", ownerId: "A", product: "server", destination: "account" });
    expect(takeProfileReturn(sessionStorage, "A", parseProfileReturn("?billing=done"))).toMatchObject({
      product: "server",
      destination: "account",
    });

    rememberProfileReturn(sessionStorage, { kind: "publisher-connect", ownerId: "A", destination: "publishing" });
    expect(takeProfileReturn(sessionStorage, "A", parseProfileReturn("?publisher=connected"))).toEqual({
      kind: "publisher-connect",
      ownerId: "A",
      destination: "publishing",
    });
  });

  it("finds nothing where no intent was stored, even for a well-formed callback", () => {
    expect(takeProfileReturn(sessionStorage, "A", parseProfileReturn("?billing=done&product=plus&destination=account"))).toBeNull();
  });
});
