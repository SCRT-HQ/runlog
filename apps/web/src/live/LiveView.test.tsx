import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveView } from "./LiveView.tsx";
import type { LiveSnapshot } from "./snapshot.ts";

const base: LiveSnapshot = {
  v: 1,
  at: "2026-01-01T00:00:00Z",
  packId: "kiln",
  packTitle: "The Long Kiln",
  runName: null,
  mode: "Standard",
  words: { run: "Firing", unit: "Stage", units: "Stages" },
  status: "active",
  ending: null,
  unit: 2,
  where: "Shape · Throw the piece",
  step: "Throw the piece",
  phases: [
    { id: "enter", label: "Enter the stage", state: "done" },
    { id: "shape", label: "Shape", state: "current" },
    { id: "fire", label: "Fire", state: "todo" },
  ],
  quoted: true,
  standings: [],
  contestants: 0,
  subjects: [],
  counters: [],
  resources: [],
  clocks: [],
  progress: { unitsDone: 1, elapsedMs: 0 },
  score: { label: "Stages closed", text: "1 stages", value: 1, better: "higher" },
  forcedUnits: 0,
  log: [
    { n: 2, unit: 2, where: "Stage 2, Form", hit: null, text: "A wide bowl" },
    { n: 1, unit: 1, where: "Stage 1, Form", hit: null, text: "A cup" },
  ],
};

describe("the live page", () => {
  it("lists the unit's phases with the step in hand, and the log by unit", () => {
    const html = renderToStaticMarkup(<LiveView snapshot={base} />);
    expect(html).toContain("Shape · Throw the piece");
    expect(html).toContain('class="current"');
    expect(html).toContain("Enter the stage");
    expect(html).toContain("A wide bowl");
    // Each unit's first line carries the unit's name.
    expect(html.match(/mono">Stage 2<\/span>/g)?.length).toBe(1);
    expect(html.match(/mono">Stage 1<\/span>/g)?.length).toBe(1);
  });

  it("reads the log from either end and can keep to the last few, the way the run screen does", () => {
    const html = renderToStaticMarkup(<LiveView snapshot={base} />);
    expect(html).toContain("Newest first");
    expect(html).toContain('aria-label="How much of the log to show"');
    // Newest first by default: in the timeline, the higher-numbered line comes before the lower.
    const timeline = html.slice(html.indexOf('class="timeline"'));
    const first = timeline.indexOf('class="idx">2<');
    const second = timeline.indexOf('class="idx">1<');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
  });

  it("says why a phase is out of play this unit, not just that it is", () => {
    const html = renderToStaticMarkup(
      <LiveView snapshot={{ ...base, phases: [...base.phases, { id: "wedge", label: "Wedging", state: "skipped", why: "after the first stage" }] }} />,
    );
    expect(html).toContain('class="skipped"');
    expect(html).toContain('<span class="why">after the first stage</span>');
  });

  it("says where a run is before its first unit, and after a unit closes", () => {
    const fresh = renderToStaticMarkup(<LiveView snapshot={{ ...base, unit: 0, where: null, step: null, phases: [], log: [] }} />);
    expect(fresh).toContain("Waiting to enter the first stage");
    expect(fresh).toContain("the log fills in with the first roll");
    const between = renderToStaticMarkup(<LiveView snapshot={{ ...base, where: null, step: null, phases: [] }} />);
    expect(between).toContain("Stage 2 is closed; the next has not begun");
  });

  it("shows a step's constraints the way the run screen does, and this stage's results so far", () => {
    const html = renderToStaticMarkup(
      <LiveView
        snapshot={{
          ...base,
          constraints: ["The wall must be thin enough to admit light."],
          unitResults: [{ table: "Constraint", text: "The wall must be thin enough to admit light.", hit: null }],
        }}
      />,
    );
    expect(html).toContain("The game has already had its say");
    expect(html).toContain("The wall must be thin enough to admit light.");
    expect(html).toContain("This stage so far");
    // Nothing to honor and nothing rolled yet: neither block appears.
    const empty = renderToStaticMarkup(<LiveView snapshot={{ ...base, constraints: [], unitResults: [] }} />);
    expect(empty).not.toContain("The game has already had its say");
    expect(empty).not.toContain("This stage so far");
    // A snapshot written before these fields existed carries neither key at all.
    const { constraints: _c, unitResults: _u, ...withoutFields } = base;
    const legacy = renderToStaticMarkup(<LiveView snapshot={withoutFields as LiveSnapshot} />);
    expect(legacy).not.toContain("The game has already had its say");
    expect(legacy).not.toContain("This stage so far");
  });
});
