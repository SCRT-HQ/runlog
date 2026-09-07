import { describe, expect, it } from "vitest";
import { looksLikeUlid, ulid } from "./ids.ts";
import { migrateRuns } from "./migrate.ts";

describe("run ids", () => {
  it("are twenty-six characters of the confusable-free alphabet", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(looksLikeUlid(id)).toBe(true);
    expect(looksLikeUlid("not-an-id")).toBe(false);
  });

  it("sort by the moment they were made", () => {
    // Two ids a second apart must order without any second field: that is
    // what lets a list of runs read top to bottom in a manifest.
    const earlier = ulid(1_700_000_000_000);
    const later = ulid(1_700_000_001_000);
    expect(earlier < later).toBe(true);
  });

  it("do not collide", () => {
    const seen = new Set(Array.from({ length: 500 }, () => ulid(0)));
    expect(seen.size).toBe(500);
  });
});

describe("runs written before they had ids", () => {
  const started = { t: "RunStarted", at: "2026-01-01T00:00:00Z", packId: "p", packVersion: "1" };

  it("get one each, and the first event learns it", () => {
    let n = 0;
    const out = migrateRuns(
      [{ packId: "p", packVersion: "1", events: [started, { t: "UnitEntered" }], updatedAt: "x" }],
      () => `id-${++n}`,
    );
    expect(out[0]!.runId).toBe("id-1");
    expect(out[0]!.events[0]).toEqual({ ...started, runId: "id-1" });
    expect(out[0]!.events[1]).toEqual({ t: "UnitEntered" });
  });

  it("leave a log that does not start with RunStarted alone, apart from the key", () => {
    const out = migrateRuns([{ packId: "p", packVersion: "1", events: [{ t: "odd" }], updatedAt: "x" }], () => "id");
    expect(out[0]!.runId).toBe("id");
    expect(out[0]!.events).toEqual([{ t: "odd" }]);
  });
});
