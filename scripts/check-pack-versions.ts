/**
 * A pack that changed says so in its version.
 *
 * Packs reach a player's library by id and version, and an update is
 * offered only when the version is newer. So a pack edited in place, left
 * at the version it already had, is a pack nobody receives: the app has
 * no way to know the copy in front of somebody is not the copy in the
 * repository, and the run they are in the middle of goes on playing the
 * old flow while the fix sits on main.
 *
 * That happened to `elden-ring-interference`, which was rewritten four
 * times at 0.1.0. This is the check that would have caught it, run
 * against the base of the pull request rather than as a unit test,
 * because the question is not what the file says but whether it says
 * something different from before.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = process.argv[2];
if (!base) {
  console.error("Give the base commit to compare against, such as origin/main.");
  process.exit(2);
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

/** The `version:` a pack declares, read off the text rather than parsed. */
function versionOf(text: string): string | null {
  const line = text.split(/\r?\n/).find((l) => /^version:/.test(l));
  return line ? line.replace(/^version:\s*/, "").trim().replace(/^["']|["']$/g, "") : null;
}

const changed = git("diff", "--name-only", "--diff-filter=M", base, "--", "packs")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.endsWith(".yaml"));

const stale: string[] = [];
for (const file of changed) {
  const was = versionOf(git("show", `${base}:${file}`));
  const now = versionOf(readFileSync(file, "utf8"));
  if (was === null || now === null) continue;
  if (was === now) stale.push(`${file} changed but is still ${now}`);
}

if (stale.length > 0) {
  console.error("A pack that changed has to say so in its version, or nobody who has it is offered the new one:\n");
  for (const line of stale) console.error(`  ${line}`);
  console.error("\nBump the pack's `version:` and try again.");
  process.exit(1);
}

console.log(changed.length === 0 ? "No pack changed." : `${changed.length} pack${changed.length === 1 ? "" : "s"} changed, each with a new version.`);
