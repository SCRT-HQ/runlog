/**
 * What the pre-commit hook runs, and in batches it can actually run.
 *
 * lint-staged puts every staged path on one command line. Windows caps a
 * command line at about 32,000 characters, so a commit large enough --
 * eighty new pack files, a regenerated table -- failed before prettier was
 * reached, with "The command line is too long" and nothing committed. The
 * files were fine; the commit was simply too big to describe in one go.
 *
 * So the paths are cut into batches. The work is identical either way, and
 * a commit of one file still runs one command.
 */

/** How many paths go on one command line. Well under the cap, even for long paths. */
const BATCH = 30;

/** One command per batch of paths, each path quoted, since a repository may hold spaces. */
function batched(tool, files) {
  const out = [];
  for (let i = 0; i < files.length; i += BATCH) {
    out.push(
      `${tool} ${files
        .slice(i, i + BATCH)
        .map((f) => JSON.stringify(f))
        .join(" ")}`,
    );
  }
  return out;
}

export default {
  "*.{ts,tsx,mjs,cjs,js,jsx,json,css,html,yml,yaml}": (files) => batched("prettier --write", files),
  "*.md": (files) => batched("markdownlint-cli2 --fix", files),
};
