import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CfnOutput } from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { NagSuppressions } from "cdk-nag";
import type { EnvConfig } from "./config";

/**
 * Where the app is served from.
 *
 * A private bucket behind CloudFront. The app is a static bundle that does its
 * own work in the browser, so there is no server in front of anyone who has
 * not asked for one: the only server is the API behind `/api`, and it holds
 * nothing for a player who has not signed in and turned sync on.
 *
 * The bucket is not public. CloudFront reaches it through an Origin Access
 * Control, so the only way to the files is through the distribution, and the
 * distribution is the only thing that has to be got right.
 */
export interface SiteStackProps extends StackProps {
  config: EnvConfig;
  /**
   * The API's hostname. When given, `/api/*` is forwarded there under the
   * site's own domain; absent means a static site and nothing else, which is
   * what the tests build and what a copy without an API still is.
   */
  apiOrigin?: string;
  /** The WebSocket API's hostname, for the `/ws` path. Omit and there is no live push, only polling. */
  wsOrigin?: string;
}

export class SiteStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);
    const { config } = props;

    // CloudFront only accepts a certificate issued in us-east-1. Deployed
    // anywhere else this fails inside ACM with a message that does not say
    // why, so it is refused here instead. Serving from another region is
    // possible, but it needs the certificate in a separate us-east-1 stack
    // and a cross-region reference, which is a deliberate change rather than
    // something to fall into.
    if (config.region !== "us-east-1") {
      throw new Error(
        `The site stack must be in us-east-1, not ${config.region}: CloudFront ` +
          `will not accept a certificate issued anywhere else.`,
      );
    }

    /**
     * Named rather than generated.
     *
     * A predictable name, so a policy or a person can name exactly this
     * bucket in exactly this account. The account id is in the name because
     * bucket names are global.
     */
    this.bucket = new s3.Bucket(this, "Bucket", {
      bucketName: `runlog-${config.name}-site-${config.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: config.retain,
      removalPolicy: config.retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.retain,
    });

    const zone = config.zoneId
      ? route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
          hostedZoneId: config.zoneId,
          zoneName: config.zone,
        })
      : route53.HostedZone.fromLookup(this, "Zone", { domainName: config.zone });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: config.domain,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    /**
     * Two cache policies, because the app has two kinds of file and treating
     * them alike breaks it in one direction or the other.
     *
     * Built assets carry a content hash in the name, so a given URL can never
     * mean anything else and may be cached forever. The shell and the service
     * worker keep the same names across every release, so caching them at the
     * edge means a deploy that nobody receives: the worst kind, because
     * everything looks fine from the deploying end.
     */
    const immutable = new cloudfront.CachePolicy(this, "ImmutableAssets", {
      cachePolicyName: `runlog-${config.name}-immutable`,
      comment: "Content-hashed assets. The name can only ever mean one file.",
      defaultTtl: Duration.days(365),
      maxTtl: Duration.days(365),
      minTtl: Duration.days(365),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    const revalidate = new cloudfront.CachePolicy(this, "AlwaysRevalidate", {
      cachePolicyName: `runlog-${config.name}-revalidate`,
      comment: "The shell and the worker. Cached, but never served without asking.",
      // Zero default, so an object arriving without a Cache-Control header is
      // not cached at all. A non-zero maximum so the *origin's* header decides
      // for objects that carry one, and these carry `no-cache,
      // must-revalidate`, which means the edge may hold a copy but must check
      // it every time. That is what is wanted: fast when nothing changed,
      // never stale when it did.
      //
      // All three at zero would be simpler and is wrong twice over. CloudFront
      // reads it as caching disabled and then rejects the compression settings
      // outright, and it would also throw away a revalidation the origin was
      // willing to answer cheaply.
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.days(365),
      minTtl: Duration.seconds(0),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);
    this.liveAllowed = Boolean(props.wsOrigin);

    // Nothing stands between the edge and the bundle. Who may *use* the app
    // is the app's own question, answered by WorkOS AuthKit with the client
    // id the build was given: see the application repository. An edge
    // function cannot verify that session, and a shared password in front of
    // it would be a second door with a different key.
    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `Runlog (${config.name})`,
      defaultRootObject: "index.html",
      domainNames: [config.domain],
      certificate,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // Cache hit rate and origin latency are additional metrics CloudFront
      // does not publish by default; the observability dashboard wants both.
      publishAdditionalMetrics: true,
      // The app is offline-first; a viewer in Australia should not be paying
      // for a round trip to Virginia on first load either.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: revalidate,
        responseHeadersPolicy: this.headers(config),
        compress: true,
      },
      additionalBehaviors: {
        "/assets/*": {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: immutable,
          compress: true,
        },
        ...(props.apiOrigin ? { "/api/*": this.apiBehavior(props.apiOrigin, config) } : {}),
        // A live link's short form, `/r/<id>?t=…`: the API answers it with a
        // page a chat can preview, which sends a browser on to the app.
        ...(props.apiOrigin ? { "/r/*": this.apiBehavior(props.apiOrigin, config) } : {}),
        // The socket: the same shape as the API's behavior, on the one
        // path. The viewer's `/ws` lands on the stage named `ws`.
        ...(props.wsOrigin ? { "/ws": this.apiBehavior(props.wsOrigin, config) } : {}),
      },
      errorResponses: [
        // S3 answers a missing key with 403 through an access control, which
        // would show a viewer an XML error document. The app has no paths of
        // its own, everything it shares travels in the fragment, so anything
        // unrecognized is a mistyped URL, and the app itself is a better
        // answer than a bucket's complaint.
        //
        // These apply to every behavior, the API's included: there is no
        // per-path setting. That is why the API never answers 403 or 404, a
        // bad token is a 401 and an unknown route a 410, and why the app
        // treats an HTML body from /api as "sign in again" all the same.
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    new route53.ARecord(this, "AliasRecord", {
      zone,
      recordName: config.domain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
    });
    new route53.AaaaRecord(this, "AliasRecordV6", {
      zone,
      recordName: config.domain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
    });

    /**
     * Where the application repository looks to find what it is publishing to.
     *
     * Parameters rather than stack outputs: the app repo would otherwise have
     * to know this stack's name, which couples its workflow to a naming
     * decision made over here. A parameter path is a smaller promise to keep.
     */
    new ssm.StringParameter(this, "BucketParameter", {
      parameterName: "/runlog/site/bucket",
      stringValue: this.bucket.bucketName,
      description: "S3 bucket the Runlog app bundle is published to.",
    });
    new ssm.StringParameter(this, "DistributionParameter", {
      parameterName: "/runlog/site/distribution",
      stringValue: this.distribution.distributionId,
      description: "CloudFront distribution to invalidate after publishing.",
    });
    new ssm.StringParameter(this, "DomainParameter", {
      parameterName: "/runlog/site/domain",
      stringValue: config.domain,
      description: "Hostname the Runlog app is served from.",
    });

    /**
     * The built app, laid over with the hosted pages, published by this
     * stack. `RUNLOG_APP_DIST` names the directory; the deploy workflow
     * builds the app first and points here. Absent, as in the tests and a
     * synth with nothing built, the site is created without contents and
     * what is in the bucket stays.
     *
     * Two deployments, because two cache rules: the hashed assets may be
     * kept for a year, since a name can only ever mean one file; the shell,
     * the worker, the manifest and the hosted pages keep their names across
     * releases and must never be cached, which is how a deploy reaches
     * everyone. The assets go first so an old shell never points at files
     * that are not there, and nothing prunes them: a viewer part-way through
     * the previous release still needs them. Each deployment invalidates
     * the whole edge; the second one is what makes the new shell current.
     *
     * The assets are taken from their own directory and put back under the
     * same prefix, rather than picked out of the build with a glob: a
     * pattern that excludes everything excludes the directory itself, before
     * anything inside it can be let back in, and the deployment ships empty
     * while looking fine. The test checks what each deployment carries.
     */
    const dist = process.env["RUNLOG_APP_DIST"];
    if (dist && existsSync(dist)) {
      const assets = new s3deploy.BucketDeployment(this, "AppAssets", {
        sources: [s3deploy.Source.asset(join(dist, "assets"))],
        destinationBucket: this.bucket,
        destinationKeyPrefix: "assets/",
        prune: false,
        cacheControl: [s3deploy.CacheControl.fromString("public,max-age=31536000,immutable")],
        distribution: this.distribution,
        distributionPaths: ["/*"],
        memoryLimit: 512,
      });
      const shell = new s3deploy.BucketDeployment(this, "AppShell", {
        sources: [s3deploy.Source.asset(dist, { exclude: ["assets/**"] })],
        destinationBucket: this.bucket,
        exclude: ["assets/*"],
        prune: true,
        cacheControl: [s3deploy.CacheControl.fromString("no-cache,must-revalidate")],
        distribution: this.distribution,
        distributionPaths: ["/*"],
        memoryLimit: 512,
      });
      shell.node.addDependency(assets);
    }

    // What the scanner would have said, and why it is fine here.
    NagSuppressions.addResourceSuppressions(this.bucket, [
      {
        id: "AwsSolutions-S1",
        reason: "The bucket holds the built app and is read only by CloudFront through its origin access control; a request record of who read a public page is one the privacy policy promises not to keep.",
      },
    ]);
    NagSuppressions.addResourceSuppressions(this.distribution, [
      { id: "AwsSolutions-CFR1", reason: "The app is for anyone anywhere; no geography is kept out." },
      { id: "AwsSolutions-CFR2", reason: "Static files and an API that checks a token on every call; a WAF would add cost for rules the handler already applies. Revisit if abuse appears." },
      { id: "AwsSolutions-CFR3", reason: "Access logs of who read the app are records the privacy policy promises not to keep; the API logs its own requests, without addresses, for a month." },
    ]);
    // The deployment's Lambda is CDK's, a singleton under the stack: its
    // runtime, its managed policy and its grants (the assets bucket, the
    // site bucket, an invalidation on any distribution) are the construct's
    // own, not choices made here.
    for (const child of this.node.children) {
      if (!child.node.id.startsWith("Custom::CDKBucketDeployment")) continue;
      NagSuppressions.addResourceSuppressions(
        child,
        [
          { id: "AwsSolutions-L1", reason: "The BucketDeployment construct's own function; its runtime follows the construct's release." },
          {
            id: "AwsSolutions-IAM4",
            reason: "AWSLambdaBasicExecutionRole on the construct's own function.",
            appliesTo: ["Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"],
          },
          {
            id: "AwsSolutions-IAM5",
            reason: "The construct's grants: reading the CDK assets bucket, writing and pruning the site bucket, and an invalidation, which CloudFront scopes to no resource.",
            appliesTo: [
              "Action::s3:GetObject*",
              "Action::s3:GetBucket*",
              "Action::s3:List*",
              "Action::s3:Abort*",
              "Action::s3:DeleteObject*",
              "Resource::*",
              { regex: "/^Resource::<Bucket[A-Za-z0-9]+\\.Arn>/\\*$/g" },
              { regex: "/^Resource::arn:(aws|<AWS::Partition>):s3:::cdk-[a-z0-9]+-assets-[^/]+/\\*$/g" },
            ],
          },
        ],
        true,
      );
    }

    new CfnOutput(this, "BucketName", { value: this.bucket.bucketName });
    new CfnOutput(this, "DistributionId", { value: this.distribution.distributionId });
    new CfnOutput(this, "Url", { value: `https://${config.domain}` });
  }

  /**
   * The API, under the site's own domain.
   *
   * Never cached: every answer is one person's, and a cache key that included
   * the Authorization header would be the same as no cache. The one managed
   * origin request policy that forwards Authorization to a custom origin
   * leaves Host out, which is what API Gateway needs, it routes on its own
   * hostname. The same security headers ride along; HSTS on JSON is harmless.
   */
  private apiBehavior(host: string, config: EnvConfig): cloudfront.BehaviorOptions {
    return {
      origin: new origins.HttpOrigin(host, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      }),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Every viewer header but Host: API Gateway routes on its own
      // hostname, and a policy that forwards the viewer's Host makes it
      // answer 404, which the edge then turns into the app page. (A policy
      // that adds the viewer's country adds Host with it, which is how the
      // API went dark once; the country comes another way, or not at all.)
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: this.headers(config),
      compress: false,
    };
  }

  /**
   * Headers the app should be served with.
   *
   * The Content-Security-Policy is the interesting one. The app loads no third
   * party anything, no fonts, no analytics, no CDN, so the policy can say
   * exactly that, and any future dependency has to be added here deliberately
   * rather than arriving unnoticed.
   */
  private headersPolicy: cloudfront.ResponseHeadersPolicy | undefined;
  /** Whether the policy names the site's own socket; set before the first behavior asks. */
  private liveAllowed = false;
  private headers(config: EnvConfig): cloudfront.ResponseHeadersPolicy {
    // One policy, whichever behavior asks first: a second construct with
    // the same id would fail synthesis, and a second policy with the same
    // name would fail deployment.
    this.headersPolicy ??= this.securityHeaders(config, this.liveAllowed);
    return this.headersPolicy;
  }

  private securityHeaders(config: EnvConfig, live: boolean): cloudfront.ResponseHeadersPolicy {
    const csp = [
      "default-src 'self'",
      // Vite inlines a small module preload shim; styles are in a stylesheet
      // but a few are set from script for the dice animation.
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      // The one thing fetched from anywhere: WorkOS, for the sign-in code
      // exchange and the session refresh. Sign-in itself is a full-page
      // redirect, which CSP does not govern. Anything else is a bug worth
      // breaking on, and a new API is named here deliberately.
      // Safari does not count 'self' for a wss: URL, so the socket is
      // named outright, on the site's own host.
      `connect-src 'self' https://api.workos.com${live ? ` wss://${config.domain}` : ""}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    return new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      responseHeadersPolicyName: `runlog-${config.name}-headers`,
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
      },
    });
  }
}
