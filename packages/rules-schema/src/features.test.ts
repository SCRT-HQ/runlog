import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { FEATURES, featuresOf } from "./features.ts";

/**
 * `packs/testing/engine-testing.yaml` exists to exercise every corner of the
 * format at least once. That claim is only as good as this check: a feature
 * `featuresOf` knows how to find but the bench never triggers would mean the
 * bench is not actually testing everything it says it is.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("the engine-testing bench reports every feature featuresOf knows", () => {
  it("declares a mode or capability for each entry in FEATURES", () => {
    const source = readFileSync(join(repoRoot, "packs/testing/engine-testing.yaml"), "utf8");
    const head = YAML.parse(source) as Record<string, unknown>;
    const { features } = featuresOf(head);

    const missing = FEATURES.map((f) => f.id).filter((id) => !features.includes(id));
    if (missing.length > 0) {
      throw new Error(
        `the bench does not report: ${missing.join(", ")}. Every Feature id should be ` +
          `reachable from its modes and capabilities.`,
      );
    }
    expect(missing).toEqual([]);
    expect(features.sort()).toEqual([...FEATURES.map((f) => f.id)].sort());
  });
});
