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
  progress: { unitsDone: 1, elapsedMs: 0, timed: true },
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
    // The phase carries the weight, the step reads under it.
    expect(html).toContain("<strong>Shape</strong>");
    expect(html).toContain("· Throw the piece");
    expect(html).not.toContain("Shape · Throw the piece");
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

  it("lights a result that holds over the step in hand where it sits under its phase, and says nothing twice", () => {
    const html = renderToStaticMarkup(
      <LiveView
        snapshot={{
          ...base,
          constraints: ["The wall must be thin enough to admit light."],
          unitResults: [{ table: "Constraint", text: "The wall must be thin enough to admit light.", hit: null }],
          phases: [
            { id: "constrain", label: "Constraint", state: "done", results: ["The wall must be thin enough to admit light."] },
            { id: "work", label: "Throw", state: "current" },
          ],
        }}
      />,
    );
    expect(html).toContain('class="result constrains"');
    expect(html.match(/The wall must be thin enough to admit light\./g)?.length).toBe(1);
    // No block of its own, above or below the phases.
    expect(html).not.toContain('class="notice constraints"');
    expect(html).not.toContain("This stage so far");
    // A snapshot written before these fields existed carries neither key at all.
    const { constraints: _c, unitResults: _u, ...withoutFields } = base;
    const legacy = renderToStaticMarkup(<LiveView snapshot={withoutFields as LiveSnapshot} />);
    expect(legacy).not.toContain("constrains");
  });

  it("shows time only for a run that keeps it, and puts what it is handed above the board", () => {
    const timed = renderToStaticMarkup(<LiveView snapshot={base} side={<section className="panel react">React</section>} />);
    expect(timed).toContain(">Time<");
    expect(timed.indexOf('class="panel react"')).toBeLessThan(timed.indexOf("So far"));
    // A run without unit clocks has only wall time since it started, which says nothing for one played across days.
    const untimed = renderToStaticMarkup(<LiveView snapshot={{ ...base, progress: { unitsDone: 1, elapsedMs: 9_000_000, timed: false } }} />);
    expect(untimed).not.toContain(">Time<");
    expect(untimed).toContain("Stages done");
  });

  it("tells the run room by room when asked, in place of the log, newest first", () => {
    // The current room reads from the flow, as ever; the rooms before it from what they produced.
    const snapshot = {
      ...base,
      phases: base.phases.map((p) => (p.id === "shape" ? { ...p, results: ["A wide bowl", "Setback - hit #1: A crack"] } : p)),
      units: [
        { unit: 1, phases: [{ id: "form", label: "Shape", results: ["A cup"] }] },
        { unit: 2, phases: [{ id: "form", label: "Shape", results: ["A wide bowl"] }, { id: "constrain", label: "Constraint", results: ["Thin walls", "Setback - hit #1: A crack"] }] },
      ],
    };
    const all = renderToStaticMarkup(<LiveView snapshot={snapshot} rooms="all" />);
    expect(all).toContain('class="pastRoom"');
    expect(all).toContain("A cup");
    expect(all).toContain("Setback - hit #1: A crack");
    expect(all).not.toContain('class="log"');
    // The current room stays the flow; the rooms before it follow, newest first, and only what they produced.
    const flow = all.slice(all.indexOf('class="stageFlow'));
    expect(flow.indexOf("Stage</span> 1")).toBeGreaterThan(flow.indexOf('aria-current="step"'));
    const one = renderToStaticMarkup(<LiveView snapshot={snapshot} />);
    expect(one).toContain('class="log"');
    expect(one).not.toContain('class="pastRoom"');
    expect(one).toContain("All stages");
  });

  it("shows what each phase produced this unit under the phase, in order", () => {
    const html = renderToStaticMarkup(
      <LiveView
        snapshot={{
          ...base,
          phases: [
            { id: "check", label: "Kiln Check", state: "done", results: ["Roll on the Form table"] },
            { id: "form", label: "Shape", state: "done", results: ["A wide bowl"] },
            { id: "work", label: "Throw", state: "current" },
          ],
        }}
      />,
    );
    const flow = html.slice(html.indexOf('class="flow"'));
    const check = flow.indexOf("Kiln Check");
    const rolled = flow.indexOf('<span class="result">Roll on the Form table</span>');
    const shape = flow.indexOf("Shape");
    const bowl = flow.indexOf('<span class="result">A wide bowl</span>');
    expect(check).toBeGreaterThan(-1);
    expect(rolled).toBeGreaterThan(check);
    expect(shape).toBeGreaterThan(rolled);
    expect(bowl).toBeGreaterThan(shape);
  });
});
