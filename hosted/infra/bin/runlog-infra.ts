#!/usr/bin/env node
import "source-map-support/register";
import { App, Aspects, Tags } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { currentEnv, envConfig } from "../lib/config";
import { ApiStack } from "../lib/api-stack";
import { SiteStack } from "../lib/site-stack";
import { ObservabilityStack } from "../lib/observability-stack";

/**
 * The Runlog infrastructure app.
 *
 * One environment at a time, chosen by `RUNLOG_ENV`, because the two live in
 * different AWS accounts. Synthesising both together would need credentials
 * for both, and a pipeline holding both is a pipeline where a mistake in the
 * dev job can reach production.
 */
const name = currentEnv();
const config = envConfig(name);
const app = new App();

// The API first: the site forwards /api/* to it, so the site stack depends
// on this one and `cdk deploy --all` orders them accordingly.
const api = new ApiStack(app, `Runlog-${name}-Api`, {
  env: { account: config.account, region: config.region },
  config,
});

const site = new SiteStack(app, `Runlog-${name}-Site`, {
  env: { account: config.account, region: config.region },
  config,
  apiOrigin: api.origin,
  wsOrigin: api.wsOrigin,
});

// Last, because it reads from both: the API's table, functions and alarm
// topic, and the site's own distribution.
new ObservabilityStack(app, `Runlog-${name}-Observability`, {
  env: { account: config.account, region: config.region },
  config,
  api,
  site,
});

// The AWS Solutions rules, on every synth, diff and deploy: an error fails
// the synth, so a finding is either fixed or suppressed where it stands with
// the reason written next to it. The test suite runs the same checks.
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

Tags.of(app).add("runlog:env", name);
Tags.of(app).add("project", "runlog");

app.synth();
