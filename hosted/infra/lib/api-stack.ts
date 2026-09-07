import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as iam from "aws-cdk-lib/aws-iam";
import { HttpLambdaIntegration, WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import * as path from "node:path";
import type { EnvConfig } from "./config";

/**
 * The API behind /api.
 *
 * It exists for one thing: a signed-in player's runs, and the packs they
 * choose, on every device they use. Nothing is stored for anyone who has not
 * turned sync on, and what is stored is only ever read back by the same
 * person. The app still works without any of this — from disk, from a public
 * page, or here with nobody signed in.
 *
 * Served under the app's own domain by a CloudFront behavior, not on a
 * hostname of its own: the app then fetches `/api/...` relative, the CSP
 * stays `connect-src 'self'`, there is no CORS, no second certificate and no
 * second record. The raw execute-api hostname stays reachable, as HTTP APIs
 * do without a custom domain; it is behind the same token check.
 *
 * One function answers every route. Verifying the token in the handler rather
 * than in a gateway authorizer is deliberate: the gateway's refusal is a 403,
 * and the site's distribution rewrites every 403 into the app's index page.
 */
export interface ApiStackProps extends StackProps {
  config: EnvConfig;
}

export class ApiStack extends Stack {
  readonly api: apigwv2.HttpApi;
  readonly table: dynamodb.TableV2;
  readonly bucket: s3.Bucket;
  /** The hostname CloudFront forwards /api/* to. */
  readonly origin: string;
  /** The hostname CloudFront forwards /ws to: the WebSocket API, whose stage is named `ws` so the path maps to it. */
  readonly wsOrigin: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config } = props;

    /**
     * What is known *about* each item: one row per pack or run, keyed by the
     * player. Bodies live in the bucket, so no row approaches the item size
     * limit however long a run gets, and the manifest is a single query.
     * A tombstone stays thirty days by TTL so other devices hear of it.
     */
    this.table = new dynamodb.TableV2(this, "Table", {
      tableName: `runlog-${config.name}`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: config.retain },
      deletionProtection: config.retain,
      removalPolicy: config.retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    /**
     * The items themselves: a run's whole event log, a pack's whole source,
     * each written as one object under the player's own prefix. Versioned in
     * production, so a sync that went wrong can be undone from here.
     */
    this.bucket = new s3.Bucket(this, "Bucket", {
      bucketName: `runlog-${config.name}-sync-${config.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: config.retain,
      removalPolicy: config.retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.retain,
      lifecycleRules: config.retain ? [{ noncurrentVersionExpiration: Duration.days(90) }] : [],
    });

    // An explicit group, so retention is a property of this stack and not a
    // custom resource that quietly runs on the first invocation.
    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    /**
     * What the API holds for the services it talks to, defined here and
     * filled out of band. A secret is created with a random placeholder so
     * the stack deploys before anyone has a key; the handler treats a value
     * that does not look like the real thing as "not configured" and keeps
     * the feature off. Filling one is a `put-secret-value`, never a deploy,
     * and the value never passes through this repository.
     */
    // The literal name goes into the handler's environment: the construct's
    // own `secretName` is a token parsed back out of the ARN at deploy time.
    // No environment in the name: each environment is its own account, so
    // the account someone is signed in to is the environment they fill.
    const secretName = (name: string) => `runlog/${name}`;
    const secret = (id: string, name: string, description: string) =>
      new secretsmanager.Secret(this, id, {
        secretName: secretName(name),
        description,
        removalPolicy: config.retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      });
    const stripeSecretKey = secret("StripeSecretKey", "stripe/secret-key", "Stripe secret key: sandbox in dev, live in prd");
    const stripeWebhookSecret = secret("StripeWebhookSecret", "stripe/webhook-secret", "Signing secret of the Stripe webhook endpoint that points at /api/stripe/webhook");
    const stripeConnectWebhookSecret = secret("StripeConnectWebhookSecret", "stripe/connect-webhook-secret", "Signing secret of the Stripe Connect webhook endpoint that points at /api/stripe/connect-webhook");
    const workosApiKey = secret("WorkosApiKey", "workos/api-key", "WorkOS API key for the environment, used to create publisher organisations");

    const handler = new lambdaNodejs.NodejsFunction(this, "Handler", {
      entry: path.join(__dirname, "handlers", "api.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(15),
      logGroup,
      environment: {
        TABLE_NAME: this.table.tableName,
        BUCKET_NAME: this.bucket.bucketName,
        RUNLOG_ENV: config.name,
        WORKOS_CLIENT_ID: config.workosClientId,
        WORKOS_CLI_CLIENT_ID: config.workosCliClientId,
        STRIPE_SECRET_KEY_SECRET: secretName("stripe/secret-key"),
        STRIPE_WEBHOOK_SECRET_SECRET: secretName("stripe/webhook-secret"),
        STRIPE_CONNECT_WEBHOOK_SECRET_SECRET: secretName("stripe/connect-webhook-secret"),
        STRIPE_FEE_BPS: JSON.stringify(config.stripe.applicationFeeBps),
        WORKOS_API_KEY_SECRET: secretName("workos/api-key"),
        EMAIL_FROM: config.email.from,
        EMAIL_REGION: config.email.region,
        APP_URL: `https://${config.domain}/`,
        RUNLOG_GATES: config.gates ? "on" : "off",
        STRIPE_PRICES: JSON.stringify(config.stripe.prices),
        STRIPE_FEATURES: JSON.stringify(config.stripe.features),
      },
      bundling: {
        minify: true,
        sourceMap: true,
        format: lambdaNodejs.OutputFormat.ESM,
        target: "node22",
        // The AWS SDK is in the runtime already; bundling a copy would only
        // make the function slower to start.
        externalModules: ["@aws-sdk/*"],
        // A CommonJS dependency inside an ES module bundle needs `require`
        // to exist; esbuild does not create it on its own.
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
    this.table.grantReadWriteData(handler);
    this.bucket.grantReadWrite(handler);
    for (const s of [stripeSecretKey, stripeWebhookSecret, stripeConnectWebhookSecret, workosApiKey]) s.grantRead(handler);
    // Invitations go out through the domain identity core-infra verified,
    // and through nothing else: the grant names the identity, not the
    // account's SES.
    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: [
          `arn:aws:ses:${config.email.region}:${config.account}:identity/${config.email.identity}`,
          `arn:aws:ses:${config.email.region}:${config.account}:identity/${config.email.from.replace(/^.*<|>$/g, "")}`,
        ],
      }),
    );

    /**
     * No CORS, on purpose. The API is reached from the app's own origin
     * through CloudFront, and a CORS policy is a list of *other* origins that
     * may call it — there are none.
     */
    this.api = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: `runlog-${config.name}-api`,
      createDefaultStage: true,
    });
    const integration = new HttpLambdaIntegration("Api", handler);
    // The full viewer path arrives here, /api and all, so the routes carry
    // the prefix and nothing has to rewrite anything on the way.
    this.api.addRoutes({ path: "/api/{proxy+}", methods: [apigwv2.HttpMethod.ANY], integration });
    new apigwv2.HttpRoute(this, "Default", {
      httpApi: this.api,
      routeKey: apigwv2.HttpRouteKey.DEFAULT,
      integration,
    });

    // A ceiling, not a target: on-demand everything means a loop somewhere
    // would otherwise run up a bill before anyone noticed.
    const stage = this.api.defaultStage!.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 50, throttlingBurstLimit: 100 };

    this.origin = `${this.api.apiId}.execute-api.${this.region}.amazonaws.com`;

    /**
     * When the handler fails, somebody should hear. One topic; subscribe an
     * address to it by hand, since the address is not this repository's to
     * commit. A webhook Stripe could not deliver is the case that matters:
     * an entitlement that never lands is a person who paid for nothing.
     */
    const alarms = new sns.Topic(this, "Alarms", { topicName: `runlog-${config.name}-alarms` });
    handler
      .metricErrors({ period: Duration.minutes(5), statistic: "sum" })
      .createAlarm(this, "HandlerErrors", {
        alarmName: `runlog-${config.name}-api-errors`,
        threshold: 5,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: "The API handler failed five times in five minutes.",
      })
      .addAlarmAction(new cloudwatchActions.SnsAction(alarms));
    new CfnOutput(this, "AlarmTopic", { value: alarms.topicArn });

    /**
     * Live push: a doorbell, not a channel.
     *
     * A device with a run open holds a socket and names the session it is
     * watching; when another device appends to it, the HTTP handler posts
     * "changed" down every socket on it and the device syncs at once. The
     * moves themselves still travel over HTTP with a bearer token, so the
     * socket carries nothing anyone could want. Its own handler is a
     * second function with the same token check, and the stage is named
     * `ws` so that CloudFront can forward the site's `/ws` path to it
     * unchanged: the stage name is the first path segment of a WebSocket
     * API's address, and CloudFront cannot rewrite paths without an edge
     * function.
     */
    const wsHandler = new lambdaNodejs.NodejsFunction(this, "LiveHandler", {
      entry: path.join(__dirname, "handlers", "ws.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup,
      environment: {
        TABLE_NAME: this.table.tableName,
        BUCKET_NAME: this.bucket.bucketName,
        WORKOS_CLIENT_ID: config.workosClientId,
        WORKOS_CLI_CLIENT_ID: config.workosCliClientId,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        format: lambdaNodejs.OutputFormat.ESM,
        target: "node22",
        externalModules: ["@aws-sdk/*"],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
    this.table.grantReadWriteData(wsHandler);
    this.bucket.grantRead(wsHandler);
    const liveIntegration = (id: string) => new WebSocketLambdaIntegration(id, wsHandler);
    const wsApi = new apigwv2.WebSocketApi(this, "WebSocketApi", {
      apiName: `runlog-${config.name}-live`,
      connectRouteOptions: { integration: liveIntegration("LiveConnect") },
      disconnectRouteOptions: { integration: liveIntegration("LiveDisconnect") },
      defaultRouteOptions: { integration: liveIntegration("LiveDefault") },
    });
    const wsStage = new apigwv2.WebSocketStage(this, "WebSocketStage", {
      webSocketApi: wsApi,
      stageName: "ws",
      autoDeploy: true,
      throttle: { rateLimit: 50, burstLimit: 100 },
    });
    // The HTTP handler rings the doorbell: it needs the management
    // endpoint of this stage and permission to post to its connections.
    handler.addEnvironment("WS_ENDPOINT", wsStage.callbackUrl);
    wsStage.grantManagementApiAccess(handler);
    // And the socket handler passes gestures from one connection to the
    // rest, so it needs the same.
    wsHandler.addEnvironment("WS_ENDPOINT", wsStage.callbackUrl);
    wsStage.grantManagementApiAccess(wsHandler);
    this.wsOrigin = `${wsApi.apiId}.execute-api.${this.region}.amazonaws.com`;

    new ssm.StringParameter(this, "ApiUrlParameter", {
      parameterName: "/runlog/api/url",
      stringValue: `https://${config.domain}/api`,
      description: "Where the Runlog app reaches its API: the site's own domain, under /api.",
    });
    new ssm.StringParameter(this, "ApiEndpointParameter", {
      parameterName: "/runlog/api/endpoint",
      stringValue: this.api.apiEndpoint,
      description: "The API Gateway endpoint CloudFront forwards /api/* to.",
    });

    new ssm.StringParameter(this, "LiveEndpointParameter", {
      parameterName: "/runlog/api/live",
      stringValue: wsStage.url,
      description: "The WebSocket API CloudFront forwards /ws to.",
    });

    new CfnOutput(this, "ApiEndpoint", { value: this.api.apiEndpoint });
    new CfnOutput(this, "LiveEndpoint", { value: wsStage.url });
    new CfnOutput(this, "TableName", { value: this.table.tableName });
    new CfnOutput(this, "SyncBucketName", { value: this.bucket.bucketName });
  }
}
