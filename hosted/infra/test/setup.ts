import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The tests run against the example stage: the template a self-hoster
 * copies, which is also what keeps them free of any operator's values.
 * Set before any module reads the configuration.
 */
process.env["RUNLOG_ENV_CONFIG"] ??= readFileSync(join(__dirname, "..", "env", "example.json"), "utf8");
process.env["RUNLOG_TARGET_ACCOUNT"] ??= "123456789012";
process.env["RUNLOG_ZONE_ID"] ??= "Z0123456789ABCDEFGHIJ";
