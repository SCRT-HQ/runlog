import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { envConfig, type EnvName } from "../lib/config";
import { ApiStack } from "../lib/api-stack";
import { SiteStack } from "../lib/site-stack";
import { ObservabilityStack } from "../lib/observability-stack";

/**
 * The observability stack, held to what would make it silently useless: a
 * dashboard that never picks up a new country because it named metrics
 * instead of searching for them, or an alarm that never reaches anyone
 * because it was never wired to the topic the API stack already owns.
 */

describe.each(["dev", "prd"] as EnvName[])("observability for %s", (name) => {
  let template: Template;
  let config: ReturnType<typeof envConfig>;

  beforeAll(() => {
    // No bundling: `cdk synth` is what checks the handler compiles; this
    // just checks the templates these three stacks produce together.
    const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
    config = envConfig(name);
    const api = new ApiStack(app, `Runlog-${name}-Api`, { env: { account: config.account, region: config.region }, config });
    const site = new SiteStack(app, `Runlog-${name}-Site`, {
      env: { account: config.account, region: config.region },
      config,
      apiOrigin: api.origin,
      wsOrigin: api.wsOrigin,
    });
    const observability = new ObservabilityStack(app, `Runlog-${name}-Observability`, {
      env: { account: config.account, region: config.region },
      config,
      api,
      site,
    });
    template = Template.fromStack(observability);
  });

  it("names the dashboard after the stage", () => {
    template.hasResourceProperties("AWS::CloudWatch::Dashboard", { DashboardName: `runlog-${name}` });
  });

  // The dashboard body is built at synth time as an Fn::Join of literal
  // chunks and cross-stack tokens (the HTTP API's id, the table name, and so
  // on); joining only the literal chunks back together is enough to search
  // the widget JSON for a plain string, without needing every token to
  // resolve to a real value.
  const dashboardBody = () => {
    const dashboards = template.findResources("AWS::CloudWatch::Dashboard");
    const parts = (Object.values(dashboards)[0]!.Properties.DashboardBody as { "Fn::Join": [string, unknown[]] })["Fn::Join"][1];
    return parts.map((part) => (typeof part === "string" ? part : "<token>")).join("");
  };

  it("searches for views rather than naming them, so a new country or screen needs no redeploy", () => {
    const body = dashboardBody();
    // The search expression names the Runlog namespace and this stage, once
    // per dimension the beacon writes.
    for (const dimension of ["country", "screen", "version"]) {
      expect(body).toContain(`SEARCH('{Runlog,${dimension},env} MetricName=\\"views\\" env=\\"${name}\\"', 'Sum', 86400)`);
    }
  });

  it("adds five alarms, all pointed at the API stack's own topic", () => {
    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    expect(Object.keys(alarms)).toHaveLength(5);
    for (const alarm of Object.values(alarms)) {
      expect(alarm.Properties.TreatMissingData).toBe("notBreaching");
      expect(typeof alarm.Properties.AlarmDescription).toBe("string");
      expect((alarm.Properties.AlarmDescription as string).length).toBeGreaterThan(20);
      // The topic is the API stack's, imported across the stack boundary,
      // so its ARN arrives as an Fn::ImportValue rather than a literal.
      expect(JSON.stringify(alarm.Properties.AlarmActions)).toContain("Fn::ImportValue");
    }
  });

  it("lists every alarm — its own five, and the API stack's existing one — on the alarm status widget", () => {
    const body = dashboardBody();
    // The widget's "alarms" array holds one ARN token per alarm; each
    // becomes its own opaque "<token>" chunk in the joined body, so instead
    // of parsing the surrounding widget JSON (broken up by those tokens),
    // count the ARN-shaped placeholders between the widget's markers.
    const widgetStart = body.indexOf('"type":"alarm"');
    expect(widgetStart).toBeGreaterThan(-1);
    const alarmsStart = body.indexOf('"alarms":[', widgetStart);
    const alarmsEnd = body.indexOf("]", alarmsStart);
    const alarmsSection = body.slice(alarmsStart, alarmsEnd);
    // Five new alarms plus the API stack's HandlerErrors alarm.
    expect(alarmsSection.split("<token>")).toHaveLength(6 + 1); // 6 tokens, 7 fragments around them
  });

  it("names each alarm for the stage", () => {
    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    const alarmNames = Object.values(alarms).map((a) => a.Properties.AlarmName as string);
    expect(alarmNames.sort()).toEqual(
      [`runlog-${name}-api-5xx`, `runlog-${name}-edge-5xx-rate`, `runlog-${name}-handler-p95-duration`, `runlog-${name}-handler-throttles`, `runlog-${name}-table-throttles`].sort(),
    );
  });

  it("picks the handler's duration threshold from its own timeout, not a hardcoded one", () => {
    const alarms = template.findResources("AWS::CloudWatch::Alarm", { Properties: { AlarmName: `runlog-${name}-handler-p95-duration` } });
    const [durationAlarm] = Object.values(alarms);
    // The handler's timeout is 15s; 60% of that in milliseconds is 9000.
    expect(durationAlarm!.Properties.Threshold).toBe(9000);
  });
});
