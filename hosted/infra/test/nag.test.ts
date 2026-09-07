import { App, Aspects } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { envConfig, type EnvName } from "../lib/config";
import { ApiStack } from "../lib/api-stack";
import { SiteStack } from "../lib/site-stack";

/**
 * The AWS Solutions rules, as the pipeline will run them.
 *
 * `bin/runlog-infra.ts` puts the same aspect on every synth, where an error
 * fails the deploy. This runs it here first, on both environments and with
 * a build attached so the publish is checked too, and prints every finding
 * with its path: a rule is answered by fixing the construct or by a
 * suppression beside it with the reason written down, never by a rerun.
 */

describe.each(["dev", "prd"] as EnvName[])("the AWS Solutions rules against %s", (name) => {
  let dist: string;
  let stacks: { api: ApiStack; site: SiteStack };

  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), "runlog-nag-"));
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "index.html"), "<!doctype html>");
    writeFileSync(join(dist, "assets", "index-abc.js"), "// app");
    process.env["RUNLOG_APP_DIST"] = dist;
    try {
      const app = new App();
      const config = envConfig(name);
      const api = new ApiStack(app, `Runlog-${name}-Api`, { env: { account: config.account, region: config.region }, config });
      const site = new SiteStack(app, `Runlog-${name}-Site`, {
        env: { account: config.account, region: config.region },
        config,
        apiOrigin: api.origin,
        wsOrigin: api.wsOrigin,
      });
      Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
      stacks = { api, site };
    } finally {
      delete process.env["RUNLOG_APP_DIST"];
    }
  });

  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  const findings = (stack: ApiStack | SiteStack, level: "error" | "warning") => {
    const annotations = Annotations.fromStack(stack);
    const found = level === "error" ? annotations.findError("*", Match.stringLikeRegexp("AwsSolutions-.*")) : annotations.findWarning("*", Match.stringLikeRegexp("AwsSolutions-.*"));
    return found.map((f) => `${f.id}: ${String(f.entry.data).split("\n")[0]}`);
  };

  it("raise no error on the API", () => {
    expect(findings(stacks.api, "error")).toEqual([]);
  });

  it("raise no error on the site", () => {
    expect(findings(stacks.site, "error")).toEqual([]);
  });

  it("raise no warning either", () => {
    expect([...findings(stacks.api, "warning"), ...findings(stacks.site, "warning")]).toEqual([]);
  });
});
