import { describe, expect, it } from "vitest";
import { loadHosted, parseHosted } from "./config.ts";

const good = {
  operator: "Example Co",
  legalName: "Example Co, LLC",
  support: "help@example.com",
  termsVersion: "2026-09-06",
  version: "0.2.0",
  sha: "abc123",
  links: { terms: "https://runlog.example/legal/terms.html", privacy: "https://runlog.example/legal/privacy.html", pricing: "https://runlog.example/pricing.html" },
  features: { billing: false },
};

describe("the hosted file", () => {
  it("is read when whole", () => {
    const h = parseHosted(good);
    expect(h).toMatchObject({ operator: "Example Co", legalName: "Example Co, LLC", termsVersion: "2026-09-06", version: "0.2.0" });
    expect(h?.links.pricing).toBe("https://runlog.example/pricing.html");
    expect(h?.features.billing).toBe(false);
  });

  it("is nothing at all when a required part is missing or a link is not one", () => {
    expect(parseHosted(null)).toBeNull();
    expect(parseHosted({ ...good, operator: "" })).toBeNull();
    expect(parseHosted({ ...good, links: { terms: "/legal/terms.html", privacy: good.links.privacy } })).toBeNull();
    expect(parseHosted({ ...good, links: { terms: good.links.terms } })).toBeNull();
  });

  it("drops an optional link that is malformed rather than the whole file", () => {
    const h = parseHosted({ ...good, links: { ...good.links, about: "nope" } });
    expect(h).not.toBeNull();
    expect(h?.links.about).toBeUndefined();
  });
});

describe("fetching it", () => {
  const AT = "https://runlog.example/hosted.json";
  const at = (body: string, type: string, ok = true) =>
    (async () => new Response(body, { status: ok ? 200 : 404, headers: { "content-type": type } })) as unknown as typeof fetch;

  it("bypasses every cache and believes only JSON", async () => {
    let init: RequestInit | undefined;
    const spy = (async (_url: RequestInfo | URL, i?: RequestInit) => {
      init = i;
      return new Response(JSON.stringify(good), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const h = await loadHosted(spy, AT);
    expect(h?.operator).toBe("Example Co");
    expect(init?.cache).toBe("no-store");
  });

  it("treats the shell served in place of a missing file as no file", async () => {
    // CloudFront answers a missing key with index.html and a 200.
    expect(await loadHosted(at("<!doctype html><html></html>", "text/html"), AT)).toBeNull();
    expect(await loadHosted(at("{}", "application/json", false), AT)).toBeNull();
    expect(await loadHosted(at("not json", "application/json"), AT)).toBeNull();
  });

  it("is never attempted from disk", async () => {
    let asked = false;
    const spy = (async () => {
      asked = true;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    expect(await loadHosted(spy, undefined)).toBeNull();
    expect(asked).toBe(false);
  });
});
