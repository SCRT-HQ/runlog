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
 * That happened to `elden-ring-tarnishedtool`, which was rewritten four
 * times at 0.1.0. This is the check that would have caught it, run
 * against the base of the pull request rather than as a unit test,
 * because the question is not what the file says but whether it says
 * something different from before.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const base = process.argv[2];
if (!base) {
  console.error("Give the base commit to compare against, such as origin/main.");
  process.exit(2);
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

/** The `version:` a pack declares, read off the text rather than parsed. */
function versionOf(text: string): string | null {
  const line = text.split(/\r?\n/).find((l) => /^version:/.test(l));
  return line
    ? line
        .replace(/^version:\s*/, "")
        .trim()
        .replace(/^["']|["']$/g, "")
    : null;
}

/**
 * What the document says, with nothing of how it was written.
 *
 * The question this guard asks is whether a holder of the old copy is
 * holding something different from what is on main, and a comment is not
 * something different: an editor hint added to the top of eighteen files
 * is eighteen version bumps that offer everybody a pack identical to the
 * one they have. So the comparison is of the parsed document, and a file
 * that will not parse is treated as changed, since a pack that stopped
 * loading is the one case where saying nothing would be worst.
 */
function meaningOf(text: string): string {
  try {
    return JSON.stringify(parseYaml(text) ?? null);
  } catch {
    return text;
  }
}

const changed = git("diff", "--name-only", "--diff-filter=M", base, "--", "packs")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.endsWith(".yaml"));

const stale: string[] = [];
/** The ones that say something different, as opposed to the ones that were merely edited. */
const different: string[] = [];
for (const file of changed) {
  const before = git("show", `${base}:${file}`);
  const after = readFileSync(file, "utf8");
  if (meaningOf(before) === meaningOf(after)) continue;
  different.push(file);
  const was = versionOf(before);
  const now = versionOf(after);
  if (was === null || now === null) continue;
  if (was === now) stale.push(`${file} changed but is still ${now}`);
}

if (stale.length > 0) {
  console.error("A pack that changed has to say so in its version, or nobody who has it is offered the new one:\n");
  for (const line of stale) console.error(`  ${line}`);
  console.error("\nBump the pack's `version:` and try again.");
  process.exit(1);
}

const touched = changed.length - different.length;
const aside = touched > 0 ? ` (${touched} edited without saying anything different.)` : "";
console.log(
  different.length === 0
    ? `No pack changed.${aside}`
    : `${different.length} pack${different.length === 1 ? "" : "s"} changed, each with a new version.${aside}`,
);
