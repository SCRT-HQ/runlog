import { describe, expect, it } from "vitest";
import { widgetFromHash, widgetHash, widgetHref } from "./route.ts";

describe("a widget's address", () => {
  it("names the stacked column like any other kind", () => {
    expect(widgetFromHash("#widget/column/01ARZ3NDEKTSV4RRFFQ69G5FAV?bg=clear")?.kind).toBe("column");
  });

  it("names the kind, the run, and the look", () => {
    expect(widgetFromHash("#widget/clock/01ARZ3NDEKTSV4RRFFQ69G5FAV")).toEqual({ kind: "clock", runId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", bg: "solid", scale: 1 });
    expect(widgetFromHash("#widget/scoreboard/run1?bg=clear&scale=1.5")).toEqual({ kind: "scoreboard", runId: "run1", bg: "clear", scale: 1.5 });
    expect(widgetFromHash("#widget/step/run1")?.kind).toBe("step");
  });
  it("refuses what it does not know and clamps the size", () => {
    expect(widgetFromHash("#widget/dice/run1")).toBeNull();
    expect(widgetFromHash("#guide/start")).toBeNull();
    expect(widgetFromHash("#widget/stats/run1?scale=40")?.scale).toBe(1);
  });
  it("carries a live link's token, for a machine that is not the streamer's", () => {
    expect(widgetFromHash("#widget/stats/run1?t=tok&bg=clear")).toEqual({ kind: "stats", runId: "run1", bg: "clear", scale: 1, token: "tok" });
    expect(widgetHash({ kind: "clock", runId: "r", bg: "solid", scale: 1, token: "tok" })).toBe("#widget/clock/r?t=tok");
  });

  it("round-trips", () => {
    const route = { kind: "race" as const, runId: "r", bg: "clear" as const, scale: 2 };
    expect(widgetFromHash(widgetHash(route))).toEqual(route);
    expect(widgetHref(route, "https://runlog.example/app/?purchase=x#play")).toBe("https://runlog.example/app/#widget/race/r?bg=clear&scale=2");
  });
});
