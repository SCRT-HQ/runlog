import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiStack } from "../lib/api-stack";
import type { EnvConfig } from "../lib/config";

/**
 * The API's stack, held to the properties that would hurt.
 *
 * The one that matters most is not here, because it cannot be: that every
 * request is checked. That lives in the handler, and test/handlers.test.ts
 * holds it. What the template can say is that every route reaches that one
 * handler, that nothing else can call it, and that the data outlives a
 * mistaken deploy in production and does not in dev.
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
  stripe: { prices: { plusMonthly: "price_pm", plusYearly: "price_py", hostedMonthly: "price_hm", hostedYearly: "price_hy" }, features: { plus: "plus", hostedLicensing: "hosted-licensing" }, applicationFeeBps: { subscribed: 0, unsubscribed: 500 } },
  hosted: { operator: "Example Co, LLC", operatorShort: "Example Co", support: "help@example.com", termsVersion: "2026-01-01", termsDate: "2026-01-01", billing: false, testing: false },
  ...over,
});

function templateFor(over: Partial<EnvConfig> = {}) {
  // No bundling: the handler is esbuild's business, and running it here
  // would make every test a build. `cdk synth` does bundle, which is the
  // check that the handler compiles.
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const c = config(over);
  const stack = new ApiStack(app, "Api", { env: { account: c.account, region: c.region }, config: c });
  return Template.fromStack(stack);
}

describe("the API", () => {
  let template: Template;
  beforeAll(() => {
    template = templateFor();
  });

  it("sends every HTTP route to the one handler", () => {
    const apis = template.findResources("AWS::ApiGatewayV2::Api", { Properties: { ProtocolType: "HTTP" } });
    const [httpApiId] = Object.keys(apis);
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).filter((r) => JSON.stringify(r.Properties.ApiId).includes(httpApiId!));
    const keys = routes.map((r) => r.Properties.RouteKey).sort();
    expect(keys).toEqual(["$default", "ANY /api/{proxy+}"]);
    // One integration behind both: a second one would be a second place to
    // forget the token check.
    const integrations = Object.values(template.findResources("AWS::ApiGatewayV2::Integration")).filter((i) => JSON.stringify(i.Properties.ApiId).includes(httpApiId!));
    expect(integrations).toHaveLength(1);
  });

  it("has a socket beside it, on a stage named ws so the site's /ws path lands on it", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 2);
    const sockets = Object.values(template.findResources("AWS::ApiGatewayV2::Api", { Properties: { ProtocolType: "WEBSOCKET" } }));
    expect(sockets).toHaveLength(1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", { StageName: "ws", AutoDeploy: true });
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).map((r) => r.Properties.RouteKey).sort();
    expect(routes).toEqual(["$connect", "$default", "$default", "$disconnect", "ANY /api/{proxy+}"]);
    // Two functions: the HTTP handler and the socket's. The HTTP one may
    // post to connections; it knows where through its environment.
    template.resourceCountIs("AWS::Lambda::Function", 2);
    const policies = JSON.stringify(Object.values(template.findResources("AWS::IAM::Policy")));
    expect(policies).toContain("execute-api:ManageConnections");
    const env = JSON.stringify(Object.values(template.findResources("AWS::Lambda::Function")).map((f) => f.Properties.Environment));
    expect(env).toContain("WS_ENDPOINT");
  });

  it("tells the handler whether plans gate, and what is for sale, and rings an alarm when it fails", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ RUNLOG_GATES: "off", STRIPE_PRICES: Match.stringLikeRegexp("plusMonthly") }) },
    });
    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", { MetricName: "Errors", Namespace: "AWS/Lambda", Threshold: 5 });
  });

  it("offers no CORS, because nothing but the app's own origin calls it", () => {
    const api = JSON.stringify(Object.values(template.findResources("AWS::ApiGatewayV2::Api")));
    expect(api).not.toContain("CorsConfiguration");
  });

  it("has a ceiling on how often it can be called", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: Match.objectLike({ ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 }),
    });
  });

  it("knows which WorkOS client it is checking tokens for", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Environment: { Variables: Match.objectLike({ WORKOS_CLIENT_ID: "client_test", WORKOS_CLI_CLIENT_ID: "client_cli_test" }) },
    });
  });

  it("defines the secrets it will need, and lets only the handler read them", () => {
    template.resourceCountIs("AWS::SecretsManager::Secret", 4);
    // Bare, without an account to report to: no layer and no wrapper.
    template.hasResourceProperties("AWS::Lambda::Function", Match.objectLike({ Handler: "index.handler", Layers: Match.absent() }));
    for (const name of ["stripe/secret-key", "stripe/webhook-secret", "stripe/connect-webhook-secret", "workos/api-key"]) {
      template.hasResourceProperties("AWS::SecretsManager::Secret", { Name: `runlog/${name}` });
    }
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          STRIPE_SECRET_KEY_SECRET: "runlog/stripe/secret-key",
          STRIPE_WEBHOOK_SECRET_SECRET: "runlog/stripe/webhook-secret",
          WORKOS_API_KEY_SECRET: "runlog/workos/api-key",
        }),
      },
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"] }),
        ]),
      },
    });
  });

  it("wraps both functions in New Relic's layer where the stage names an account, and reads the key from a fifth secret", () => {
    const monitored = templateFor({ apm: { newRelic: { accountId: "1234567", layerVersion: 52 } } });
    monitored.resourceCountIs("AWS::SecretsManager::Secret", 5);
    monitored.hasResourceProperties("AWS::SecretsManager::Secret", { Name: "runlog/newrelic/license-key" });
    const wrapped = Object.values(monitored.findResources("AWS::Lambda::Function", { Properties: { Handler: "newrelic-lambda-wrapper.handler" } }));
    expect(wrapped).toHaveLength(2);
    for (const fn of wrapped) {
      const props = fn["Properties"] as { Layers: unknown; Environment: { Variables: Record<string, string> } };
      expect(JSON.stringify(props.Layers)).toContain("layer:NewRelicNodeJS24XARM64:52");
      expect(props.Environment.Variables).toMatchObject({
        NEW_RELIC_LAMBDA_HANDLER: "index.handler",
        NEW_RELIC_USE_ESM: "true",
        NEW_RELIC_ACCOUNT_ID: "1234567",
        NEW_RELIC_TRUSTED_ACCOUNT_KEY: "1234567",
        NEW_RELIC_LICENSE_KEY_SECRET: "runlog/newrelic/license-key",
        NEW_RELIC_EXTENSION_SEND_FUNCTION_LOGS: "true",
      });
      expect(props.Environment.Variables["NEW_RELIC_ATTRIBUTES_EXCLUDE"]).toContain("request.headers.authorization");
    }
  });

  it("may send mail only as the verified identity", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "ses:SendEmail",
            Resource: ["arn:aws:ses:us-west-2:111122223333:identity/example.com", "arn:aws:ses:us-west-2:111122223333:identity/noreply@example.com"],
          }),
        ]),
      },
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ EMAIL_FROM: "Runlog <noreply@example.com>", APP_URL: "https://runlog.scrthq.com/" }) },
    });
  });

  it("lets tombstones expire on their own", () => {
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "runlog-prd",
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    });
  });

  it("keeps the bucket entirely private", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "runlog-prd-sync-111122223333",
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("tells the app where to find it, on the site's own domain", () => {
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/runlog/api/url",
      Value: "https://runlog.scrthq.com/api",
    });
  });

  describe("between environments", () => {
    it("keeps production data when the stack goes away", () => {
      const tables = template.findResources("AWS::DynamoDB::GlobalTable");
      expect(Object.values(tables)[0]!.DeletionPolicy).toBe("Retain");
      const buckets = template.findResources("AWS::S3::Bucket");
      expect(Object.values(buckets)[0]!.DeletionPolicy).toBe("Retain");
    });

    it("lets dev be torn down cleanly", () => {
      const dev = templateFor({ name: "dev", domain: "runlog.dev.scrthq.com", zone: "dev.scrthq.com", retain: false });
      expect(Object.values(dev.findResources("AWS::DynamoDB::GlobalTable"))[0]!.DeletionPolicy).toBe("Delete");
      expect(Object.values(dev.findResources("AWS::S3::Bucket"))[0]!.DeletionPolicy).toBe("Delete");
      dev.hasResourceProperties("AWS::DynamoDB::GlobalTable", { TableName: "runlog-dev" });
    });
  });
});
