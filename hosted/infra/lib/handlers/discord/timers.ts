import { createHash } from "node:crypto";
import { ConflictException, CreateScheduleCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import type { TimerJob } from "./play.js";

/**
 * A timer at a Discord table has nobody's browser ticking for it. When one
 * starts, a one-shot schedule is made for its deadline that invokes the
 * job function with the timer's name; the job stops the timer if it has
 * run out, or makes a later schedule if a pause moved the deadline.
 *
 * The schedule is named for the run, the clock and the deadline, so the
 * same deadline asked for twice — a press after a press, a job that came
 * early — is the one schedule, and a conflict is nothing to report. A
 * schedule deletes itself once it has run.
 */
export function scheduledTimers(config: { group: string; roleArn: string; jobArn: string }, client = new SchedulerClient({})): (job: TimerJob) => Promise<void> {
  return async (job) => {
    const name = `rl-${createHash("sha256").update(`${job.sessionId}:${job.clock}:${job.at}`).digest("hex").slice(0, 40)}`;
    try {
      await client.send(
        new CreateScheduleCommand({
          Name: name,
          GroupName: config.group,
          // at(): a moment, to the second, in UTC.
          ScheduleExpression: `at(${job.at.slice(0, 19)})`,
          ScheduleExpressionTimezone: "UTC",
          FlexibleTimeWindow: { Mode: "OFF" },
          ActionAfterCompletion: "DELETE",
          Target: { Arn: config.jobArn, RoleArn: config.roleArn, Input: JSON.stringify({ kind: "timer", ...job }) },
        }),
      );
    } catch (error) {
      if (error instanceof ConflictException) return;
      throw error;
    }
  };
}
