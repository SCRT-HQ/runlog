import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SiteStack } from "../lib/site-stack";
import type { EnvConfig } from "../lib/config";

/**
 * Infrastructure tests earn their keep differently from the rest.
 *
 * A mistake here is expensive and quiet: a public bucket looks exactly like a
 * private one until someone finds it, and a cache header that is wrong in the
 * wrong direction means a release nobody receives while everything looks fine
 * from the deploying end. None of that shows up in a browser.
 *
 * So these assert the handful of properties that would actually hurt, not the
 * shape of the generated template.
 */

const config = (over: Partial<EnvConfig> = {}): EnvConfig => ({
  name: "prd",
  account: "111122223333",
  region: "us-east-1",
  domain: "runlog.scrthq.com",
  zone: "scrthq.com",
  zoneId: "Z0123456789ABCDEFGHIJ",
  retain: true,
  workosClientId: "client_test",
  workosCliClientId: "client_cli_test",
  email: { from: "Runlog <noreply@example.com>", region: "us-west-2", identity: "example.com" },
  gates: false,
  stripe: { prices: { plusMonthly: "", plusYearly: "", hostedMonthly: "", hostedYearly: "" }, features: { plus: "plus", hostedLicensing: "hosted-licensing" }, applicationFeeBps: { subscribed: 0, unsubscribed: 500 } },
  hosted: { operator: "Example Co, LLC", operatorShort: "Example Co", support: "help@example.com", termsVersion: "2026-01-01", termsDate: "2026-01-01", billing: false },
  ...over,
});

function templateFor(over: Partial<EnvConfig> = {}, apiOrigin?: string, wsOrigin?: string) {
  const app = new App();
  const c = config(over);
  const stack = new SiteStack(app, "Site", {
    env: { account: c.account, region: c.region },
    config: c,
    ...(apiOrigin ? { apiOrigin } : {}),
    ...(wsOrigin ? { wsOrigin } : {}),
  });
  return Template.fromStack(stack);
}

describe("the site", () => {
  let template: Template;
  beforeAll(() => {
    template = templateFor();
  });

  it("keeps the bucket entirely private", () => {
    // The app is static, so the temptation is a public bucket and no
    // distribution. That would also serve the files from a URL nobody
    // controls the headers on.
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("reaches the bucket through an origin access control, not a public read", () => {
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    const policies = template.findResources("AWS::S3::BucketPolicy");
    const documents = JSON.stringify(Object.values(policies));
    expect(documents).toContain("cloudfront.amazonaws.com");
    expect(documents).not.toContain('"Principal":"*"');
  });

  it("refuses plaintext requests to the bucket", () => {
    const policies = JSON.stringify(Object.values(template.findResources("AWS::S3::BucketPolicy")));
    expect(policies).toContain("aws:SecureTransport");
  });

  /**
   * The cache split is the one that breaks releases. Hashed assets may be kept
   * forever; the shell and the service worker must never be, or a deploy
   * reaches nobody and looks perfect from the outside.
   */
  describe("caching", () => {
    it("caches content-hashed assets for a year", () => {
      template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
        CachePolicyConfig: Match.objectLike({
          Name: "runlog-prd-immutable",
          DefaultTTL: 31536000,
          MinTTL: 31536000,
        }),
      });
    });

    it("never serves the shell or the worker without revalidating", () => {
      // A zero default means an object with no Cache-Control is not cached;
      // the non-zero maximum lets the origin's own `no-cache, must-revalidate`
      // decide for the ones that carry it.
      template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
        CachePolicyConfig: Match.objectLike({
          Name: "runlog-prd-revalidate",
          DefaultTTL: 0,
          MinTTL: 0,
        }),
      });
    });

    /**
     * CloudFront treats all three TTLs at zero as caching disabled, and then
     * refuses the compression settings outright — which failed the very first
     * deploy, after the bucket and certificate had already been created.
     */
    it("does not ask for compression on a policy CloudFront would call disabled", () => {
      const policies = Object.values(
        template.findResources("AWS::CloudFront::CachePolicy"),
      ).map((r) => r.Properties.CachePolicyConfig);

      for (const policy of policies) {
        const disabled =
          policy.DefaultTTL === 0 && policy.MaxTTL === 0 && policy.MinTTL === 0;
        const compresses =
          policy.ParametersInCacheKeyAndForwardedToOrigin?.EnableAcceptEncodingGzip ||
          policy.ParametersInCacheKeyAndForwardedToOrigin?.EnableAcceptEncodingBrotli;
        expect(disabled && compresses, `${policy.Name} asks for both`).toBeFalsy();
      }
    });

    it("routes assets to the immutable policy and everything else to the other", () => {
      const distributions = template.findResources("AWS::CloudFront::Distribution");
      const config = Object.values(distributions)[0]!.Properties.DistributionConfig;
      expect(config.CacheBehaviors).toHaveLength(1);
      expect(config.CacheBehaviors[0].PathPattern).toBe("/assets/*");
      expect(config.CacheBehaviors[0].CachePolicyId).not.toEqual(
        config.DefaultCacheBehavior.CachePolicyId,
      );
    });
  });

  it("serves only over https", () => {
    const config = Object.values(template.findResources("AWS::CloudFront::Distribution"))[0]!
      .Properties.DistributionConfig;
    expect(config.DefaultCacheBehavior.ViewerProtocolPolicy).toBe("redirect-to-https");
    expect(config.ViewerCertificate.MinimumProtocolVersion).toBe("TLSv1.2_2021");
  });

  it("answers an unknown path with the app rather than a bucket error", () => {
    // The app has no paths of its own; everything it shares is in the
    // fragment. So anything unrecognized is a typo, and S3's XML complaint is
    // a worse answer than the app.
    const config = Object.values(template.findResources("AWS::CloudFront::Distribution"))[0]!
      .Properties.DistributionConfig;
    expect(config.CustomErrorResponses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: "/index.html" }),
        expect.objectContaining({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: "/index.html" }),
      ]),
    );
  });

  /**
   * The app fetches nothing from anywhere. Saying so in a policy means a
   * dependency that arrives later has to be added here on purpose, rather
   * than working quietly the first time someone tries it.
   */
  it("declares a content security policy that allows no third parties but WorkOS", () => {
    const policies = template.findResources("AWS::CloudFront::ResponseHeadersPolicy");
    const csp = JSON.stringify(Object.values(policies));
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    // The app signs people in with AuthKit, and the code exchange and the
    // session refresh are fetches. Nothing else is: a new origin here should
    // be a decision, not a side effect of a dependency.
    expect(csp).toContain("connect-src 'self' https://api.workos.com;");
  });

  it("puts nothing between the edge and the bundle", () => {
    // Who may use the app is the app's question, answered by AuthKit. A
    // function at the edge cannot verify that session, so there is none —
    // the shared-password door this replaced lived exactly here.
    template.resourceCountIs("AWS::CloudFront::Function", 0);
  });

  describe("with an API", () => {
    let withApi: Template;
    beforeAll(() => {
      withApi = templateFor({}, "abc123.execute-api.us-east-1.amazonaws.com");
    });

    it("forwards /api/* to it, uncached, with the token and without the Host", () => {
      const distributions = withApi.findResources("AWS::CloudFront::Distribution");
      const config = Object.values(distributions)[0]!.Properties.DistributionConfig;
      const api = config.CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === "/api/*");
      expect(api).toBeDefined();
      // The managed CachingDisabled policy: every answer is one person's.
      expect(api.CachePolicyId).toBe("4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
      // The managed AllViewerExceptHostHeader policy: Authorization reaches
      // the API, and API Gateway keeps routing on its own hostname.
      // The managed AllViewerExceptHostHeader policy: Authorization reaches
      // the API, and API Gateway keeps routing on its own hostname. Never a
      // policy that forwards Host, however it is spelled: that is a 404 from
      // the gateway and the app page from the edge, for every API call.
      expect(api.OriginRequestPolicyId).toBe("b689b0a8-53d0-40ab-baf2-68738e2966ac");
      expect(api.AllowedMethods).toEqual(expect.arrayContaining(["PUT", "DELETE"]));
    });

    it("forwards /r/* to the API too, for a live link's preview page", () => {
      const config = Object.values(withApi.findResources("AWS::CloudFront::Distribution"))[0]!.Properties.DistributionConfig;
      const short = config.CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === "/r/*");
      expect(short).toBeDefined();
      expect(short.CachePolicyId).toBe("4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
    });

    it("forwards /ws to the socket the same way, and lets the app open it", () => {
      const live = templateFor({}, "abc123.execute-api.us-east-1.amazonaws.com", "def456.execute-api.us-east-1.amazonaws.com");
      const config = Object.values(live.findResources("AWS::CloudFront::Distribution"))[0]!.Properties.DistributionConfig;
      const ws = config.CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === "/ws");
      expect(ws).toBeDefined();
      expect(ws.CachePolicyId).toBe("4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
      expect(ws.OriginRequestPolicyId).toBe("b689b0a8-53d0-40ab-baf2-68738e2966ac");
      // Safari does not count 'self' for wss:, so the policy names it.
      const policies = live.findResources("AWS::CloudFront::ResponseHeadersPolicy");
      expect(JSON.stringify(Object.values(policies))).toContain("connect-src 'self' https://api.workos.com wss://runlog.scrthq.com;");
      live.resourceCountIs("AWS::CloudFront::ResponseHeadersPolicy", 1);
    });

    it("changes nothing about what the app may talk to", () => {
      // Same origin is the whole point: the policy that pins the app to
      // itself and WorkOS is exactly as it was.
      const policies = withApi.findResources("AWS::CloudFront::ResponseHeadersPolicy");
      expect(JSON.stringify(Object.values(policies))).toContain("connect-src 'self' https://api.workos.com;");
      withApi.resourceCountIs("AWS::CloudFront::ResponseHeadersPolicy", 1);
      withApi.resourceCountIs("AWS::CloudFront::Function", 0);
    });
  });

  it("sends HSTS, and no referrer to anyone", () => {
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({ Preload: true, IncludeSubdomains: true }),
          ReferrerPolicy: Match.objectLike({ ReferrerPolicy: "no-referrer" }),
        }),
      }),
    });
  });

  it("answers on both IPv4 and IPv6", () => {
    template.resourceCountIs("AWS::Route53::RecordSet", 2);
    template.hasResourceProperties("AWS::Route53::RecordSet", { Type: "A" });
    template.hasResourceProperties("AWS::Route53::RecordSet", { Type: "AAAA" });
  });

  it("validates its certificate through DNS, so nothing needs an inbox", () => {
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "runlog.scrthq.com",
      ValidationMethod: "DNS",
    });
  });

  /**
   * The publish is two deployments with two cache rules, and the failure
   * that matters is quiet: a deployment that ships nothing still deploys
   * green, and the shell then points at files that are not there. So this
   * builds a small dist, synthesizes with it, and reads what each
   * deployment actually carries out of the assembly.
   */
  describe("publishing a build", () => {
    let dist: string;
    let out: string;
    let template: Template;
    let carried: Map<string, { prefix: string | undefined; files: string[]; cache: string; prune: boolean }>;

    const filesUnder = (dir: string, root = dir): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? filesUnder(join(dir, entry.name), root) : [relative(root, join(dir, entry.name)).replace(/\\/g, "/")],
      );

    beforeAll(() => {
      dist = mkdtempSync(join(tmpdir(), "runlog-dist-"));
      out = mkdtempSync(join(tmpdir(), "runlog-out-"));
      mkdirSync(join(dist, "assets", "fonts"), { recursive: true });
      mkdirSync(join(dist, "legal"), { recursive: true });
      writeFileSync(join(dist, "index.html"), "<!doctype html>");
      writeFileSync(join(dist, "sw.js"), "// worker");
      writeFileSync(join(dist, "hosted.json"), "{}");
      writeFileSync(join(dist, "legal", "terms.html"), "<p>terms</p>");
      writeFileSync(join(dist, "assets", "index-abc123.js"), "// app");
      writeFileSync(join(dist, "assets", "fonts", "literata.woff2"), "font");

      process.env["RUNLOG_APP_DIST"] = dist;
      try {
        const app = new App({ outdir: out });
        const c = config();
        const stack = new SiteStack(app, "Site", { env: { account: c.account, region: c.region }, config: c });
        template = Template.fromStack(stack);
        const assembly = app.synth();
        carried = new Map();
        for (const [id, resource] of Object.entries(template.findResources("Custom::CDKBucketDeployment"))) {
          const props = resource["Properties"] as Record<string, unknown>;
          const keys = props["SourceObjectKeys"] as string[];
          const hash = keys[0]!.replace(/\.zip$/, "");
          carried.set(id.replace(/CustomResource.*$/, ""), {
            prefix: props["DestinationBucketKeyPrefix"] as string | undefined,
            files: filesUnder(join(assembly.directory, `asset.${hash}`)).sort(),
            cache: (props["SystemMetadata"] as Record<string, string>)["cache-control"]!,
            prune: props["Prune"] as boolean,
          });
        }
      } finally {
        delete process.env["RUNLOG_APP_DIST"];
      }
    });

    afterAll(() => {
      rmSync(dist, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    });

    it("makes two deployments, assets first", () => {
      expect([...carried.keys()].sort()).toEqual(["AppAssets", "AppShell"]);
      const shell = template.findResources("Custom::CDKBucketDeployment", { Properties: { Prune: true } });
      const [shellId, shellResource] = Object.entries(shell)[0]!;
      const dependsOn = (shellResource["DependsOn"] as string[] | undefined) ?? [];
      expect(shellId).toMatch(/^AppShell/);
      expect(dependsOn.some((d) => d.startsWith("AppAssets"))).toBe(true);
    });

    it("carries every asset, nested ones included, under the assets prefix, cached for a year and never pruned", () => {
      const assets = carried.get("AppAssets")!;
      expect(assets.files).toEqual(["fonts/literata.woff2", "index-abc123.js"]);
      expect(assets.prefix).toBe("assets/");
      expect(assets.cache).toBe("public,max-age=31536000,immutable");
      expect(assets.prune).toBe(false);
    });

    it("carries the shell, the worker and the pages without any asset, never cached, pruning around the assets", () => {
      const shell = carried.get("AppShell")!;
      expect(shell.files).toEqual(["hosted.json", "index.html", "legal/terms.html", "sw.js"]);
      expect(shell.prefix).toBeUndefined();
      expect(shell.cache).toBe("no-cache,must-revalidate");
      expect(shell.prune).toBe(true);
      template.hasResourceProperties("Custom::CDKBucketDeployment", { Prune: true, Exclude: ["assets/*"] });
    });

    it("invalidates the whole edge from both", () => {
      for (const resource of Object.values(template.findResources("Custom::CDKBucketDeployment"))) {
        expect((resource["Properties"] as Record<string, unknown>)["DistributionPaths"]).toEqual(["/*"]);
      }
    });
  });

  describe("between environments", () => {
    it("keeps production data when the stack goes away", () => {
      const buckets = templateFor({ name: "prd", retain: true }).findResources("AWS::S3::Bucket");
      expect(Object.values(buckets)[0]!.DeletionPolicy).toBe("Retain");
    });

    it("lets dev be torn down cleanly", () => {
      const dev = templateFor({ name: "dev", domain: "runlog.dev.scrthq.com", zone: "dev.scrthq.com", retain: false });
      const buckets = dev.findResources("AWS::S3::Bucket");
      expect(Object.values(buckets)[0]!.DeletionPolicy).toBe("Delete");
    });

    it("names its policies per environment, so two accounts never collide", () => {
      const dev = templateFor({ name: "dev", domain: "runlog.dev.scrthq.com", zone: "dev.scrthq.com", retain: false });
      dev.hasResourceProperties("AWS::CloudFront::CachePolicy", {
        CachePolicyConfig: Match.objectLike({ Name: "runlog-dev-immutable" }),
      });
    });
  });
});
