import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * No em dashes, anywhere that is read: docs, copy, comments, names in
 * generated files. A colon, a comma, parentheses or a new sentence say the
 * same thing without the tic. Binary files and the lockfile are not prose.
 *
 * The dash is built from its code point rather than typed, or this file
 * would be the first thing it reported.
 */
const DASH = String.fromCharCode(0x2014);
const SKIP = /\.(png|jpg|jpeg|gif|ico|woff2?|ttf|otf|streamDeckProfile|pdf|zip)$|^package-lock\.json$/;

describe("em dashes", () => {
  it("appear in no tracked file", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter((f) => f && !SKIP.test(f));
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (!text.includes(DASH)) continue;
      text.split("\n").forEach((line, i) => {
        if (line.includes(DASH)) hits.push(`${file}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
