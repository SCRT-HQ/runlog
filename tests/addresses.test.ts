import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Addresses in this repository point at this project.
 *
 * `runlog.dev` was written into the published schema's `$id`, into the
 * skeleton `runlog init` writes, into the generated reference, into the
 * authoring guide and onto the first line of every pack here. It belongs
 * to somebody else and always did. Anybody who followed the instructions
 * was pointed at a stranger's website, which, being a website, answered
 * with a page, which an editor read as a schema that was not one and then
 * quietly checked nothing.
 *
 * A domain we do not own is not a typo that announces itself: it resolves,
 * it answers, and nothing fails. So it is a test rather than a habit.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every file git is tracking, which is exactly the set that ships. */
const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

/** Binary and vendored things nobody writes an address into by hand. */
const readable = (path: string) => !/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|otf|mp3|wav|zip|pdf)$/i.test(path);

describe("the addresses we ship", () => {
  it("finds files to check, so an empty sweep is not a pass", () => {
    expect(tracked.filter(readable).length).toBeGreaterThan(100);
  });

  it("name no domain but ours", () => {
    /*
     * An address, not the word. Naming the domain in a comment is how a
     * file explains why it does not use it, and the first draft of this
     * test failed on the one file that does exactly that.
     *
     * `runlog.dev.scrthq.com` is the dev stage and perfectly real, so the
     * label may not continue: the host after a scheme's double slash, or
     * the bare host with a path after it, and nothing else. Spelled here
     * only as a pattern, so this file passes its own check.
     */
    const wrong = /\/\/runlog\.dev(?![.\w-])|(?<![.\w-])runlog\.dev\//;
    const guilty: string[] = [];
    for (const file of tracked.filter(readable)) {
      const text = readFileSync(join(repoRoot, file), "utf8");
      text.split(/\r?\n/).forEach((line, i) => {
        if (wrong.test(line)) guilty.push(`${file}:${i + 1}`);
      });
    }

    if (guilty.length > 0) {
      throw new Error(
        `That domain is not ours. ${guilty.length} line${guilty.length === 1 ? "" : "s"} send somebody there:\n${guilty.map((g) => `  ${g}`).join("\n")}`,
      );
    }
    expect(guilty).toEqual([]);
  });
});
