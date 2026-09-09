import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import { Operation } from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";
import type { ApiStack } from "./api-stack";
import type { EnvConfig } from "./config";
import type { SiteStack } from "./site-stack";

/**
 * What is actually running, per stage.
 *
 * A third stack, not folded into either of the others: the dashboard wants
 * the API's table, functions and topic *and* the site's distribution, and
 * the site stack is built after the API stack (it needs the API's origin to
 * forward to). Reaching backwards from the API stack for a distribution that
 * does not exist yet would be the awkward order; a stack of its own that
 * takes both, built last, is not.
 *
 * One dashboard, named `runlog-<stage>`, and a handful of alarms that join
 * the API stack's own `Alarms` topic — the operator subscribes an address to
 * that topic by hand, same as the alarm the API stack already owns.
 */
/** How long Discord waits for an interaction's answer before it tells the member the application did not respond. */
const DISCORD_BUDGET_MS = 3000;

export interface ObservabilityStackProps extends StackProps {
  config: EnvConfig;
  api: ApiStack;
  site: SiteStack;
}

export class ObservabilityStack extends Stack {
  readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { config, api, site } = props;
    const env = config.name;

    // The EMF beacon (see handlers/api.ts) writes three dimension sets under
    // the Runlog namespace: env+screen, env+country, env+version. A search
    // expression, not a named metric, is what lets a country or a screen
    // that has never been seen before show up without a redeploy.
    const viewsSearch = (dimension: "screen" | "country" | "version", period: Duration, label: string) =>
      new cloudwatch.MathExpression({
        expression: `SEARCH('{Runlog,${dimension},env} MetricName="views" env="${env}"', 'Sum', ${period.toSeconds()})`,
        label,
        period,
      });

    const peopleHeading = new cloudwatch.TextWidget({ markdown: "## People\nWho is playing, and from where.", width: 24, height: 1 });
    const viewsByCountry = new cloudwatch.GraphWidget({
      title: "Views per day by country",
      left: [viewsSearch("country", Duration.days(1), "")],
      width: 12,
      height: 6,
    });
    const viewsByScreen = new cloudwatch.GraphWidget({
      title: "Views by screen",
      left: [viewsSearch("screen", Duration.days(1), "")],
      width: 6,
      height: 6,
    });
    const viewsByVersion = new cloudwatch.GraphWidget({
      title: "Views by version",
      left: [viewsSearch("version", Duration.days(1), "")],
      width: 6,
      height: 6,
    });
    const weeklyViews = new cloudwatch.SingleValueWidget({
      title: "Views, last 7 days",
      // Counting by country rather than screen or version is an arbitrary
      // choice among the three dimension sets; each beacon lands in exactly
      // one country bucket, so summing across countries double-counts
      // nothing.
      metrics: [
        new cloudwatch.MathExpression({
          expression: `SUM(SEARCH('{Runlog,country,env} MetricName="views" env="${env}"', 'Sum', ${Duration.days(7).toSeconds()}))`,
          label: "views",
          period: Duration.days(7),
        }),
      ],
      width: 24,
      height: 3,
    });

    // ---- the API ----
    const httpHeading = new cloudwatch.TextWidget({ markdown: "## The API\nRequests, errors and latency at the edge of `/api`.", width: 24, height: 1 });
    const httpRequests = new cloudwatch.GraphWidget({ title: "HTTP requests", left: [api.api.metricCount({ period: Duration.minutes(5) })], width: 8, height: 6 });
    const httpErrors = new cloudwatch.GraphWidget({
      title: "HTTP 4xx / 5xx",
      left: [
        api.api.metricClientError({ period: Duration.minutes(5), label: "4xx" }),
        api.api.metricServerError({ period: Duration.minutes(5), label: "5xx" }),
      ],
      width: 8,
      height: 6,
    });
    const httpLatency = new cloudwatch.GraphWidget({
      title: "Integration latency (p50 / p95 / p99)",
      left: [
        api.api.metricIntegrationLatency({ period: Duration.minutes(5), statistic: "p50", label: "p50" }),
        api.api.metricIntegrationLatency({ period: Duration.minutes(5), statistic: "p95", label: "p95" }),
        api.api.metricIntegrationLatency({ period: Duration.minutes(5), statistic: "p99", label: "p99" }),
      ],
      width: 8,
      height: 6,
    });
    const wsConnections = new cloudwatch.GraphWidget({
      title: "WebSocket connect / message count",
      left: [
        api.wsApi.metric("ConnectCount", { period: Duration.minutes(5), statistic: "sum", label: "connect" }),
        api.wsApi.metric("MessageCount", { period: Duration.minutes(5), statistic: "sum", label: "message" }),
      ],
      width: 12,
      height: 6,
    });
    const wsErrors = new cloudwatch.GraphWidget({
      title: "WebSocket 4xx / 5xx / integration errors",
      left: [
        api.wsApi.metric("ClientError", { period: Duration.minutes(5), statistic: "sum", label: "4xx" }),
        api.wsApi.metric("ExecutionError", { period: Duration.minutes(5), statistic: "sum", label: "5xx" }),
        api.wsApi.metric("IntegrationError", { period: Duration.minutes(5), statistic: "sum", label: "integration" }),
      ],
      width: 12,
      height: 6,
    });

    // ---- the handler ----
    const handlerHeading = new cloudwatch.TextWidget({ markdown: "## The handler\nThe function behind every `/api` route.", width: 24, height: 1 });
    const handlerThroughput = new cloudwatch.GraphWidget({
      title: "Invocations, errors, throttles",
      left: [
        api.handler.metricInvocations({ period: Duration.minutes(5), label: "invocations" }),
        api.handler.metricErrors({ period: Duration.minutes(5), label: "errors" }),
        api.handler.metricThrottles({ period: Duration.minutes(5), label: "throttles" }),
      ],
      width: 6,
      height: 6,
    });
    const handlerDuration = new cloudwatch.GraphWidget({
      title: "Duration (p50 / p95 / p99)",
      left: [
        api.handler.metricDuration({ period: Duration.minutes(5), statistic: "p50", label: "p50" }),
        api.handler.metricDuration({ period: Duration.minutes(5), statistic: "p95", label: "p95" }),
        api.handler.metricDuration({ period: Duration.minutes(5), statistic: "p99", label: "p99" }),
      ],
      width: 6,
      height: 6,
    });
    const handlerConcurrency = new cloudwatch.GraphWidget({
      title: "Concurrent executions",
      left: [api.handler.metric("ConcurrentExecutions", { period: Duration.minutes(5), statistic: "max" })],
      width: 6,
      height: 6,
    });
    // The Insights layer (see the tracing on both functions, above) reports
    // these itself, under its own namespace, keyed by function name rather
    // than the ApiId/FunctionName dimensions the rest of this stack reads.
    const handlerInsights = new cloudwatch.GraphWidget({
      title: "Lambda Insights: memory / cold start",
      left: [
        new cloudwatch.Metric({ namespace: "LambdaInsights", metricName: "memory_utilization", dimensionsMap: { function_name: api.handler.functionName }, statistic: "Average", period: Duration.minutes(5), label: "memory utilization (%)" }),
      ],
      right: [
        new cloudwatch.Metric({ namespace: "LambdaInsights", metricName: "init_duration", dimensionsMap: { function_name: api.handler.functionName }, statistic: "Average", period: Duration.minutes(5), label: "init duration (ms)" }),
      ],
      width: 6,
      height: 6,
    });
    // A rough filter: console.error logs an Error, which stringifies with
    // "Error" in it; this is a starting point for a look at what broke, not
    // a promise every failure matches it.
    const handlerRecentErrors = new cloudwatch.LogQueryWidget({
      title: "Recent handler errors",
      logGroupNames: [api.handlerLogGroup.logGroupName],
      queryLines: ["fields @timestamp, @message", "filter @message like /error/i", "sort @timestamp desc", "limit 20"],
      width: 24,
      height: 6,
    });

    // ---- the bot ----
    // The route measures every interaction it answers (handlers/api.ts,
    // `measure`): a count and an answer time by kind, under the Runlog
    // namespace, plus a rollup by stage alone that the failure alarm reads.
    // Discord waits three seconds; the answer time is the handler's part
    // of that, and the job function's cold start beside it is the rest.
    const interactionsSearch = (metric: "interactions" | "answerMs", statistic: string, label: string) =>
      new cloudwatch.MathExpression({
        expression: `SEARCH('{Runlog,env,kind} MetricName="${metric}" env="${env}"', '${statistic}', 300)`,
        label,
        period: Duration.minutes(5),
      });
    const interactionFailures = new cloudwatch.Metric({ namespace: "Runlog", metricName: "failures", dimensionsMap: { env }, statistic: "sum", period: Duration.minutes(5), label: "failures" });
    const botHeading = new cloudwatch.TextWidget({ markdown: "## The bot\nDiscord interactions, and the function with time that finishes a deferred one.", width: 24, height: 1 });
    const interactionsByKind = new cloudwatch.GraphWidget({
      title: "Interactions by kind",
      left: [interactionsSearch("interactions", "Sum", "")],
      width: 6,
      height: 6,
    });
    const answerTime = new cloudwatch.GraphWidget({
      title: "Answer time p95 by kind (ms)",
      left: [interactionsSearch("answerMs", "p95", "")],
      leftAnnotations: [{ value: DISCORD_BUDGET_MS, label: "Discord's three seconds", color: "#d62728" }],
      width: 6,
      height: 6,
    });
    const jobThroughput = new cloudwatch.GraphWidget({
      title: "Job: invocations, errors, failures to reply",
      left: [
        api.discordJob.metricInvocations({ period: Duration.minutes(5), label: "invocations" }),
        api.discordJob.metricErrors({ period: Duration.minutes(5), label: "errors" }),
        interactionFailures,
      ],
      width: 6,
      height: 6,
    });
    const jobDuration = new cloudwatch.GraphWidget({
      title: "Job: duration p95 / cold start (ms)",
      left: [api.discordJob.metricDuration({ period: Duration.minutes(5), statistic: "p95", label: "p95" })],
      right: [
        new cloudwatch.Metric({ namespace: "LambdaInsights", metricName: "init_duration", dimensionsMap: { function_name: api.discordJob.functionName }, statistic: "Average", period: Duration.minutes(5), label: "init duration (ms)" }),
      ],
      width: 6,
      height: 6,
    });

    // ---- the store ----
    // Named explicitly, rather than the default of every operation DynamoDB
    // has: these are the ones handlers/store.ts actually issues, and an
    // alarm on a math expression is capped at ten individual metrics — the
    // full operation list (fourteen) trips that cap.
    const tableOperations = [Operation.GET_ITEM, Operation.PUT_ITEM, Operation.UPDATE_ITEM, Operation.DELETE_ITEM, Operation.QUERY, Operation.BATCH_WRITE_ITEM, Operation.TRANSACT_WRITE_ITEMS];
    const storeHeading = new cloudwatch.TextWidget({ markdown: "## The store\nDynamoDB, and the sync bucket (S3's own metrics are daily).", width: 24, height: 1 });
    const tableCapacity = new cloudwatch.GraphWidget({
      title: "DynamoDB consumed capacity",
      left: [
        api.table.metricConsumedReadCapacityUnits({ period: Duration.minutes(5), label: "read" }),
        api.table.metricConsumedWriteCapacityUnits({ period: Duration.minutes(5), label: "write" }),
      ],
      width: 6,
      height: 6,
    });
    // Kept as two graphs, not one: metricThrottledRequestsForOperations and
    // metricSystemErrorsForOperations each build a math expression out of
    // one sub-metric per operation, auto-named after the operation
    // ("getitem", "putitem", ...). Two such expressions in the same widget
    // collide on those names even though the underlying metrics differ.
    const tableThrottledMetric = api.table.metricThrottledRequestsForOperations({ period: Duration.minutes(5), operations: tableOperations });
    const tableSystemErrorsMetric = api.table.metricSystemErrorsForOperations({ period: Duration.minutes(5), operations: tableOperations });
    const tableThrottles = new cloudwatch.GraphWidget({
      title: "DynamoDB throttled requests",
      left: [tableThrottledMetric],
      width: 6,
      height: 6,
    });
    const tableErrors = new cloudwatch.GraphWidget({
      title: "DynamoDB system / user errors",
      left: [tableSystemErrorsMetric, api.table.metricUserErrors({ period: Duration.minutes(5) })],
      width: 6,
      height: 6,
    });
    const bucketSize = new cloudwatch.GraphWidget({
      title: "Sync bucket size and object count (daily)",
      left: [new cloudwatch.Metric({ namespace: "AWS/S3", metricName: "BucketSizeBytes", dimensionsMap: { BucketName: api.bucket.bucketName, StorageType: "StandardStorage" }, statistic: "Average", period: Duration.days(1) })],
      right: [new cloudwatch.Metric({ namespace: "AWS/S3", metricName: "NumberOfObjects", dimensionsMap: { BucketName: api.bucket.bucketName, StorageType: "AllStorageTypes" }, statistic: "Average", period: Duration.days(1) })],
      width: 6,
      height: 6,
    });

    // ---- the edge ----
    // CloudFront's metrics live in us-east-1 regardless of where the
    // distribution's origins are; that is also where this stack (and every
    // Runlog stack) deploys, so the distribution's own metric methods need
    // no region override here. A copy deployed elsewhere would need one.
    const edgeHeading = new cloudwatch.TextWidget({ markdown: "## The edge\nCloudFront, in front of the site and the API.", width: 24, height: 1 });
    const edgeRequests = new cloudwatch.GraphWidget({ title: "Requests", left: [site.distribution.metricRequests({ period: Duration.minutes(5) })], width: 6, height: 6 });
    const edgeBytes = new cloudwatch.GraphWidget({ title: "Bytes downloaded", left: [site.distribution.metricBytesDownloaded({ period: Duration.minutes(5) })], width: 6, height: 6 });
    const edgeErrors = new cloudwatch.GraphWidget({
      title: "4xx / 5xx error rate",
      left: [
        site.distribution.metric4xxErrorRate({ period: Duration.minutes(5), label: "4xx" }),
        site.distribution.metric5xxErrorRate({ period: Duration.minutes(5), label: "5xx" }),
      ],
      width: 6,
      height: 6,
      leftYAxis: { label: "%", min: 0 },
    });
    const edgeCacheHitRate = new cloudwatch.GraphWidget({
      title: "Cache hit rate",
      left: [site.distribution.metricCacheHitRate({ period: Duration.minutes(5) })],
      width: 6,
      height: 6,
      leftYAxis: { label: "%", min: 0, max: 100 },
    });

    // ---- alarms, new and existing, all owned by the API stack's topic ----
    const alarmsHeading = new cloudwatch.TextWidget({ markdown: "## Alarms", width: 24, height: 1 });

    const alarm = (id: string, options: cloudwatch.AlarmProps, description: string) => {
      const made = new cloudwatch.Alarm(this, id, { treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING, alarmDescription: description, ...options });
      made.addAlarmAction(new cloudwatchActions.SnsAction(api.alarmTopic));
      return made;
    };

    const apiServerErrors = alarm(
      "ApiServerErrors",
      {
        alarmName: `runlog-${env}-api-5xx`,
        metric: api.api.metricServerError({ period: Duration.minutes(5), statistic: "sum" }),
        threshold: 5,
        evaluationPeriods: 2,
      },
      "The HTTP API answered with 5xx more than five times in five minutes, twice in a row. Check the handler's own error alarm and its recent logs for what is failing.",
    );

    // 60% of the function's own timeout: a request still has a chance to
    // finish inside the limit, but something is clearly slower than usual.
    const handlerTimeoutMs = (api.handler.timeout ?? Duration.seconds(15)).toMilliseconds();
    const handlerSlow = alarm(
      "HandlerSlow",
      {
        alarmName: `runlog-${env}-handler-p95-duration`,
        metric: api.handler.metricDuration({ period: Duration.minutes(5), statistic: "p95" }),
        threshold: Math.round(handlerTimeoutMs * 0.6),
        evaluationPeriods: 3,
      },
      `The handler's p95 duration has stayed above ${Math.round(handlerTimeoutMs * 0.6)}ms (60% of its ${handlerTimeoutMs}ms timeout) for fifteen minutes. Something downstream — DynamoDB, S3, Stripe, WorkOS — is slow, or is about to start timing requests out.`,
    );

    const handlerThrottled = alarm(
      "HandlerThrottled",
      {
        alarmName: `runlog-${env}-handler-throttles`,
        metric: api.handler.metricThrottles({ period: Duration.minutes(5), statistic: "sum" }),
        threshold: 1,
        evaluationPeriods: 1,
      },
      "The API handler was throttled: concurrent invocations hit a limit and a request was rejected before it ran. Check the account's concurrency limit and any reserved concurrency on the function.",
    );

    const tableThrottled = alarm(
      "TableThrottled",
      {
        alarmName: `runlog-${env}-table-throttles`,
        metric: tableThrottledMetric,
        threshold: 1,
        evaluationPeriods: 1,
      },
      "DynamoDB throttled a request against the table. On-demand billing should absorb ordinary traffic; sustained throttling usually means one partition key is unusually hot.",
    );

    const edgeServerErrors = alarm(
      "EdgeServerErrors",
      {
        alarmName: `runlog-${env}-edge-5xx-rate`,
        metric: site.distribution.metric5xxErrorRate({ period: Duration.minutes(5), statistic: "avg" }),
        threshold: 5,
        evaluationPeriods: 2,
      },
      "More than 5% of CloudFront responses were 5xx for two five-minute periods in a row. The site bucket or the API origin behind it is failing at the edge, not just for one viewer.",
    );

    // One failure is one member looking at a reply that never came, so the
    // threshold is one. The job catches what it can and reports it as a
    // failure to reply; what it cannot catch — a timeout, a start that
    // never got going — is a Lambda error on the job itself.
    const interactionFailed = alarm(
      "InteractionFailed",
      {
        alarmName: `runlog-${env}-discord-failures`,
        metric: interactionFailures,
        threshold: 1,
        evaluationPeriods: 1,
      },
      "A Discord interaction was not answered: the handler threw, or the job function could not fill the deferred reply in. The member saw an error or a reply that never came. Check the recent handler errors for the cause.",
    );

    const jobErrors = alarm(
      "DiscordJobErrors",
      {
        alarmName: `runlog-${env}-discord-job-errors`,
        metric: api.discordJob.metricErrors({ period: Duration.minutes(5), statistic: "sum" }),
        threshold: 1,
        evaluationPeriods: 1,
      },
      "The bot's job function failed outright — most likely it timed out before the deferred reply was filled in, and a member is still looking at \"thinking\". It is invoked once per press, with no retry, so the press is lost; check its duration and the recent handler errors.",
    );

    const alarmStatus = new cloudwatch.AlarmStatusWidget({
      title: "Every alarm this stage owns",
      alarms: [api.handlerErrorsAlarm, apiServerErrors, handlerSlow, handlerThrottled, tableThrottled, edgeServerErrors, interactionFailed, jobErrors],
      width: 24,
      height: 4,
    });

    this.dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: `runlog-${env}`,
      periodOverride: cloudwatch.PeriodOverride.AUTO,
    });
    this.dashboard.addWidgets(peopleHeading);
    this.dashboard.addWidgets(viewsByCountry, viewsByScreen, viewsByVersion);
    this.dashboard.addWidgets(weeklyViews);
    this.dashboard.addWidgets(httpHeading);
    this.dashboard.addWidgets(httpRequests, httpErrors, httpLatency);
    this.dashboard.addWidgets(wsConnections, wsErrors);
    this.dashboard.addWidgets(handlerHeading);
    this.dashboard.addWidgets(handlerThroughput, handlerDuration, handlerConcurrency, handlerInsights);
    this.dashboard.addWidgets(handlerRecentErrors);
    this.dashboard.addWidgets(botHeading);
    this.dashboard.addWidgets(interactionsByKind, answerTime, jobThroughput, jobDuration);
    this.dashboard.addWidgets(storeHeading);
    this.dashboard.addWidgets(tableCapacity, tableThrottles, tableErrors, bucketSize);
    this.dashboard.addWidgets(edgeHeading);
    this.dashboard.addWidgets(edgeRequests, edgeBytes, edgeErrors, edgeCacheHitRate);
    this.dashboard.addWidgets(alarmsHeading);
    this.dashboard.addWidgets(alarmStatus);
  }
}
