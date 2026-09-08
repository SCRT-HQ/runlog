import { describe, expect, it } from "vitest";
import { dockFromHash, dockHash, dockHref } from "./route.ts";

describe("a dock's address", () => {
  it("names the run whose controls it shows, and nothing else", () => {
    expect(dockFromHash("#dock/controls/01ARZ3NDEKTSV4RRFFQ69G5FAV")).toEqual({ kind: "controls", runId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(dockFromHash("#dock/controls/run1?t=tok")).toBeNull();
    expect(dockFromHash("#dock/board/run1")).toBeNull();
    expect(dockFromHash("#widget/clock/run1")).toBeNull();
  });

  it("round-trips, dropping the app's own query", () => {
    const route = { kind: "controls" as const, runId: "r" };
    expect(dockFromHash(dockHash(route))).toEqual(route);
    expect(dockHref(route, "https://runlog.example/app/?purchase=x#play")).toBe("https://runlog.example/app/#dock/controls/r");
  });
});
