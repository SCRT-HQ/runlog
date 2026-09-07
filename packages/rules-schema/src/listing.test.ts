import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { listingPayload } from "./listing.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("a listing's payload", () => {
  it("carries the source, a head the card is drawn from, and the summary", () => {
    const source = readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8");
    const r = listingPayload(source, "yaml", YAML.parse(source) as Record<string, unknown>);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.source).toBe(source);
    expect(r.payload.head.title).toBe(r.pack.title);
    expect(r.payload.head.version).toBe(r.pack.version);
    expect(r.payload.head.license.id).toBe("MIT");
    expect(r.payload.head.players).toBeGreaterThanOrEqual(1);
    expect(r.payload.summary.kind).toBe("summary");
  });

  it("says why when the pack does not load", () => {
    const r = listingPayload("id: x\n", "yaml", { id: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.length).toBeGreaterThan(0);
  });
});
