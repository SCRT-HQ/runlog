import { describe, expect, it } from "vitest";
import { WIDGET_KINDS, widgetFromHash, widgetHash, widgetHref, widgetSize } from "./route.ts";

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
    expect(widgetFromHash("#widget/stats/run1?bg=plaid")?.bg).toBe("solid");
  });
  it("carries a live link's token, for a machine that is not the streamer's", () => {
    expect(widgetFromHash("#widget/stats/run1?t=tok&bg=clear")).toEqual({ kind: "stats", runId: "run1", bg: "clear", scale: 1, token: "tok" });
    expect(widgetHash({ kind: "clock", runId: "r", bg: "solid", scale: 1, token: "tok" })).toBe("#widget/clock/r?t=tok");
  });

  it("paints nothing at all when asked, for a scene that frames the numbers itself", () => {
    expect(widgetFromHash("#widget/clock/r?bg=none")?.bg).toBe("none");
    expect(widgetHash({ kind: "clock", runId: "r", bg: "none", scale: 1 })).toBe("#widget/clock/r?bg=none");
  });

  it("pins a theme in the address, so the capture ignores what the streaming machine chose", () => {
    expect(widgetFromHash("#widget/clock/r?theme=ember")?.theme).toBe("ember");
    // "system" is the absence of a choice, and a theme nobody has is no theme: neither is carried.
    expect(widgetFromHash("#widget/clock/r?theme=system")).not.toHaveProperty("theme");
    expect(widgetFromHash("#widget/clock/r?theme=neon")).not.toHaveProperty("theme");
    expect(widgetHash({ kind: "clock", runId: "r", bg: "clear", scale: 1, theme: "glaze" })).toBe("#widget/clock/r?bg=clear&theme=glaze");
  });

  it("suggests a size for every kind, scaled from the documented 1.25× numbers", () => {
    for (const k of WIDGET_KINDS) expect(widgetSize(k.kind, 1.25)).toEqual(k.size);
    expect(widgetSize("clock", 2.5)).toEqual({ w: 960, h: 400 });
    expect(widgetFromHash("#widget/ticker/r")?.kind).toBe("ticker");
  });

  it("round-trips", () => {
    const route = { kind: "race" as const, runId: "r", bg: "clear" as const, scale: 2 };
    expect(widgetFromHash(widgetHash(route))).toEqual(route);
    const pinned = { kind: "stats" as const, runId: "r", bg: "none" as const, scale: 1.25, token: "tok", theme: "daylight" as const };
    expect(widgetFromHash(widgetHash(pinned))).toEqual(pinned);
    expect(widgetHref(route, "https://runlog.example/app/?purchase=x#play")).toBe("https://runlog.example/app/#widget/race/r?bg=clear&scale=2");
  });
});
