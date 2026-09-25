import { describe, expect, it } from "vitest";
import { WIDGET_KINDS, widgetFromHash, widgetHash, widgetHref, widgetSize } from "./route.ts";

describe("a widget's address", () => {
  it("names the stacked column like any other kind", () => {
    expect(widgetFromHash("#widget/column/01ARZ3NDEKTSV4RRFFQ69G5FAV?bg=clear")?.kind).toBe("column");
  });

  it("names the kind, the run, and the look", () => {
    expect(widgetFromHash("#widget/clock/01ARZ3NDEKTSV4RRFFQ69G5FAV")).toEqual({
      kind: "clock",
      runId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      bg: "solid",
      scale: 1,
    });
    expect(widgetFromHash("#widget/scoreboard/run1?bg=clear&scale=1.5")).toEqual({
      kind: "scoreboard",
      runId: "run1",
      bg: "clear",
      scale: 1.5,
    });
    expect(widgetFromHash("#widget/step/run1")?.kind).toBe("step");
  });
  it("refuses what it does not know and clamps the size", () => {
    expect(widgetFromHash("#widget/dice/run1")).toBeNull();
    expect(widgetFromHash("#guide/start")).toBeNull();
    expect(widgetFromHash("#widget/stats/run1?scale=40")?.scale).toBe(1);
    expect(widgetFromHash("#widget/stats/run1?scale=0.5")?.scale).toBe(0.5);
    expect(widgetFromHash("#widget/stats/run1?scale=4")?.scale).toBe(4);
    expect(widgetFromHash("#widget/stats/run1?scale=0.49")?.scale).toBe(1);
    expect(widgetFromHash("#widget/stats/run1?bg=plaid")?.bg).toBe("solid");
  });
  it("carries a live link's token, for a machine that is not the streamer's", () => {
    expect(widgetFromHash("#widget/stats/run1?t=tok&bg=clear")).toEqual({
      kind: "stats",
      runId: "run1",
      bg: "clear",
      scale: 1,
      token: "tok",
    });
    expect(widgetHash({ kind: "clock", runId: "r", bg: "solid", scale: 1, token: "tok" })).toBe("#widget/clock/r?t=tok");
  });

  it("paints nothing at all when asked, for a scene that frames the numbers itself", () => {
    expect(widgetFromHash("#widget/clock/r?bg=none")?.bg).toBe("none");
    expect(widgetHash({ kind: "clock", runId: "r", bg: "none", scale: 1 })).toBe("#widget/clock/r?bg=none");
  });

  it("pins a theme in the address, so the capture ignores what the streaming machine chose", () => {
    expect(widgetFromHash("#widget/clock/r?theme=ember")?.theme).toBe("ember");
    expect(widgetFromHash("#widget/clock/r?theme=cyberpunk-neon")?.theme).toBe("cyberpunk-neon");
    expect(widgetFromHash("#widget/clock/r?theme=superstar")?.theme).toBe("superstar");
    expect(widgetFromHash("#widget/clock/r?theme=rainbow-road")?.theme).toBe("rainbow-road");
    expect(widgetFromHash("#widget/clock/r?theme=stardust")?.theme).toBe("stardust");
    expect(widgetHash({ kind: "clock", runId: "r", bg: "solid", scale: 1, theme: "stardust" })).toBe("#widget/clock/r?theme=stardust");
    // "system" is the absence of a choice, and a theme nobody has is no theme: neither is carried.
    expect(widgetFromHash("#widget/clock/r?theme=system")).not.toHaveProperty("theme");
    expect(widgetFromHash("#widget/clock/r?theme=neon")).not.toHaveProperty("theme");
    expect(widgetHash({ kind: "clock", runId: "r", bg: "clear", scale: 1, theme: "glaze" })).toBe("#widget/clock/r?bg=clear&theme=glaze");
    expect(widgetHash({ kind: "clock", runId: "r", bg: "solid", scale: 1, theme: "rainbow-road" })).toBe(
      "#widget/clock/r?theme=rainbow-road",
    );
    for (const id of ["red-green-dark", "red-green-light", "blue-yellow-dark", "blue-yellow-light"] as const) {
      expect(widgetFromHash(`#widget/clock/r?theme=${id}`)?.theme).toBe(id);
      expect(widgetHash({ kind: "clock", runId: "r", bg: "clear", scale: 1, theme: id })).toBe(`#widget/clock/r?bg=clear&theme=${id}`);
      expect(widgetHash({ kind: "clock", runId: "r", bg: "none", scale: 1.25, theme: id })).toContain(`theme=${id}`);
    }
  });

  it("carries a pinned theme's text as the last parameter, apart from the token", () => {
    expect(widgetFromHash("#widget/clock/r?bg=clear&t=tok&pin=1.d.abc")).toEqual({
      kind: "clock",
      runId: "r",
      bg: "clear",
      scale: 1,
      token: "tok",
      pin: "1.d.abc",
    });
    expect(widgetHash({ kind: "clock", runId: "r", bg: "clear", scale: 1.25, token: "tok", pin: "1.d.abc" })).toBe(
      "#widget/clock/r?bg=clear&scale=1.25&t=tok&pin=1.d.abc",
    );
    // Present but empty is still a pin: the widget must not fall back to the device for it.
    expect(widgetFromHash("#widget/clock/r?pin=")?.pin).toBe("");
    expect(widgetFromHash("#widget/clock/r")).not.toHaveProperty("pin");
    // A legacy built-in pin is read as it always was, pin or no pin beside it.
    expect(widgetFromHash("#widget/clock/r?theme=ember&pin=junk")).toMatchObject({ theme: "ember", pin: "junk" });
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
    const snapshotPinned = { kind: "clock" as const, runId: "r", bg: "clear" as const, scale: 1.5, token: "tok", pin: "1.l.00ff00" };
    expect(widgetFromHash(widgetHash(snapshotPinned))).toEqual(snapshotPinned);
    expect(widgetHref(route, "https://runlog.example/app/?purchase=x#play")).toBe(
      "https://runlog.example/app/#widget/race/r?bg=clear&scale=2",
    );
  });

  it("carries a theme link's read key under its own name, never as a pin", () => {
    const ch = "r".repeat(32);
    expect(widgetFromHash(`#widget/clock/r?t=tok&ch=${ch}`)).toEqual({
      kind: "clock",
      runId: "r",
      bg: "solid",
      scale: 1,
      token: "tok",
      ch,
    });
    expect(widgetFromHash(`#widget/clock/r?ch=${ch}`)).not.toHaveProperty("pin");
    expect(widgetFromHash("#widget/clock/r?ch=")).toMatchObject({ ch: "" });
    expect(widgetHash({ kind: "clock", runId: "r", bg: "clear", scale: 1, token: "tok", ch })).toBe(
      `#widget/clock/r?bg=clear&t=tok&ch=${ch}`,
    );
  });
});
