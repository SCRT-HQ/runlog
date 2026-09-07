import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Nothing in this repository may be the game it was built for.
 *
 * The rulebook that started this project forbids reproducing, adapting or
 * converting it into software. The architecture answers that structurally: the
 * repo holds a general engine, the transcription lives in a gitignored private
 * pack, and the two only meet in one person's browser. That answer is only as
 * good as its weakest comment, though — a doc comment quoting a rule, or an
 * example naming the game, puts the thing back in the repo no matter how the
 * packages are arranged.
 *
 * Drift here is quiet and easy: it arrives as a helpful illustration written by
 * someone with the book open beside them. So this checks what is actually
 * *tracked* by git, which is exactly the set of files that would be published.
 *
 * This is not a substitute for reading a diff. It catches the specific mistake
 * that has already been made more than once.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const selfPath = "tests/license-boundary.test.ts";

/**
 * Names and compound terms belonging to the private game, read from the
 * gitignored `packs/private/reserved.txt` beside the pack itself: one term
 * per line, lowercase. The list is not in this file because the list is
 * the thing the rule forbids naming. Where the file is absent (a clone
 * without the private pack) this check is skipped and the attribution
 * check below still runs.
 */
const RESERVED: string[] = (() => {
  try {
    return readFileSync(join(repoRoot, "packs", "private", "reserved.txt"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
})();

/**
 * Phrasing that attributes a rule to one particular book.
 *
 * Describing packs generically ("transcribing a rulebook") is the whole point
 * of the format and stays. Pointing at *the* book is a citation, and a citation
 * means the source is being reproduced from.
 */
const ATTRIBUTIONS = [
  "the book says",
  "the book's",
  "the book does",
  "the rulebook says",
  "the rulebook's",
  "in the book,",
  "per the book",
  "from the rules,",
];

/** Every file git would publish, minus the binary-ish ones and this test. */
function trackedTextFiles(): string[] {
  const listed = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  return listed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => file !== selfPath)
    .filter((file) => !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip)$/i.test(file))
    .filter((file) => !file.startsWith("package-lock"));
}

interface Hit {
  file: string;
  line: number;
  term: string;
  text: string;
}

function scan(files: string[], terms: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(repoRoot, file), "utf8");
    } catch {
      continue; // Deleted but still indexed; not our problem to report.
    }
    content.split(/\r?\n/).forEach((text, i) => {
      const lower = text.toLowerCase();
      for (const term of terms) {
        if (lower.includes(term)) hits.push({ file, line: i + 1, term, text: text.trim() });
      }
    });
  }
  return hits;
}

const show = (hits: Hit[]) =>
  hits.map((h) => `  ${h.file}:${h.line}  [${h.term}]\n    ${h.text.slice(0, 110)}`).join("\n");

describe("the license boundary", () => {
  const files = trackedTextFiles();

  it("has files to check at all", () => {
    // Guards the guard: an empty list would pass everything below silently.
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain("packages/rules-schema/src/pack.ts");
  });

  it("keeps the private pack out of version control", () => {
    // The transcription is the one artifact that must never be published, and
    // it is easy to add by reflex while staging everything else.
    expect(files.filter((f) => f.startsWith("packs/private/"))).toEqual([]);
    expect(files.filter((f) => f.startsWith("reference/"))).toEqual([]);
  });

  it("names no part of the private game", () => {
    const hits = scan(files, RESERVED);
    if (hits.length > 0) {
      throw new Error(
        `${hits.length} tracked line(s) name the private game.\n\n` +
          `These belong in packs/private/, which is gitignored. Rewrite the ` +
          `example with a craft this repo does not depend on — a drawing game, ` +
          `a training log, a writing game:\n\n${show(hits)}\n`,
      );
    }
    expect(hits).toEqual([]);
  });

  it("quotes no rulebook as a source", () => {
    const hits = scan(files, ATTRIBUTIONS);
    if (hits.length > 0) {
      throw new Error(
        `${hits.length} tracked line(s) cite a particular rulebook.\n\n` +
          `A comment that explains a rule by pointing at the book it came from ` +
          `is reproducing that book, in the one repository that must not. ` +
          `State the mechanic on its own terms instead:\n\n${show(hits)}\n`,
      );
    }
    expect(hits).toEqual([]);
  });

  it("ships no pack that claims to be non-redistributable", () => {
    // A pack in the repo is published by definition, so one marked private has
    // either been committed by mistake or is lying about its license.
    const packs = files.filter((f) => f.startsWith("packs/") && /\.ya?ml$|\.json$/.test(f));
    expect(packs.length).toBeGreaterThan(0);
    const wrong = packs.filter((f) =>
      /redistributable:\s*false/.test(readFileSync(join(repoRoot, f), "utf8")),
    );
    expect(wrong).toEqual([]);
  });

  it("uses posix paths in its own reporting, so failures are readable on any OS", () => {
    // git ls-files always reports forward slashes; this asserts the assumption
    // rather than leaving it implicit for the next person on Windows.
    expect(files.every((f) => !f.includes("\\"))).toBe(true);
    expect(posix.basename(files[0]!)).toBeTruthy();
  });
});
