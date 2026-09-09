import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Pack } from "@runlog/rules-schema";
import type { Clock, RunState } from "@runlog/engine";
import { ClockPanel } from "./ClockPanel.tsx";
import type { useRun } from "./useRun.ts";

/**
 * The clock at first paint, as a column under the unit's number: a label
 * and a state on one small line, the digits, and controls the size of the
 * board's. Static markup; the tick is not exercised here.
 */
const pack = { defaultMode: "solo", modes: { solo: {} }, unit: {}, vocabulary: { unit: { one: "Trial", many: "Trials" } } } as unknown as Pack;
const clock = (over: Partial<Clock>): Clock => ({
  id: "u1:unit",
  kind: "stopwatch",
  label: "Trial 1",
  seconds: null,
  unit: 1,
  status: "running",
  startedAt: "2026-01-01T00:00:00.000Z",
  runningSince: "2026-01-01T00:00:00.000Z",
  accumulatedMs: 0,
  elapsedMs: null,
  ...over,
} as Clock);
const state = (clocks: Clock[]) => ({ unit: 1, mode: "solo", status: "active", clocks } as unknown as RunState);
const run = (readOnly = false) => ({ readOnly, pauseClock() {}, resumeClock() {}, stopClock() {}, startUnitClock() {} }) as unknown as ReturnType<typeof useRun>;

describe("the clock in the margin", () => {
  it("shows a running stopwatch with small pause and stop controls, and no panel of its own", () => {
    const html = renderToStaticMarkup(<ClockPanel pack={pack} run={run()} state={state([clock({})])} />);
    expect(html).toContain('class="clocks"');
    expect(html).not.toContain("panel");
    expect(html).toContain("elapsed");
    // Small and quiet, and carrying both its word and its mark: the word
    // shows on a wide screen, the mark on a phone. See ClockButton.
    expect(html).toContain('class="ghost tiny clockBtn"');
    expect(html).toContain("clockMark");
    expect(html).toContain("Pause");
    expect(html).toContain("Stop");
    expect(html).not.toContain("big");
    // The unit's own clock does not repeat the heading above it.
    expect(html).not.toContain(">Trial 1<");
  });

  it("names a clock that has a name of its own", () => {
    const html = renderToStaticMarkup(<ClockPanel pack={pack} run={run()} state={state([clock({ id: "w", label: "Warm-up" })])} />);
    expect(html).toContain("Warm-up");
  });

  it("offers Resume for a paused clock, and nothing to press for a watcher", () => {
    const paused = clock({ status: "paused", runningSince: null, accumulatedMs: 12_000 });
    expect(renderToStaticMarkup(<ClockPanel pack={pack} run={run()} state={state([paused])} />)).toContain("Resume");
    const watching = renderToStaticMarkup(<ClockPanel pack={pack} run={run(true)} state={state([paused])} />);
    expect(watching).toContain("0:12");
    expect(watching).not.toContain("<button");
  });

  it("keeps a stopped timer on screen, saying whether it ran out", () => {
    const out = clock({ id: "t", kind: "timer", label: "Ten Minutes", seconds: 600, status: "done", runningSince: null, elapsedMs: 600_000, expired: true } as Partial<Clock>);
    const html = renderToStaticMarkup(<ClockPanel pack={pack} run={run()} state={state([out])} />);
    expect(html).toContain("done expired");
    expect(html).toContain(">time<");
    expect(html).toContain("10:00");
  });

  it("renders nothing when the unit has no clock", () => {
    expect(renderToStaticMarkup(<ClockPanel pack={pack} run={run()} state={state([])} />)).toBe("");
  });
});
