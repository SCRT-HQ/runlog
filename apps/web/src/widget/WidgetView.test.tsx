import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatsWidget, StepWidget, TickerWidget } from "./WidgetView.tsx";
import type { LiveSnapshot } from "../live/snapshot.ts";
import type { TickerLine } from "./ticker.ts";

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
  where: "Throw the Piece · Throw it.",
  step: "Throw it.",
  stepKind: "manual",
  phases: [
    { id: "enter", label: "Enter the Stage", state: "done" },
    { id: "work", label: "Throw the Piece", state: "current" },
    { id: "close", label: "Fire", state: "todo" },
  ],
  constraints: ["The wall must be thin enough to admit light."],
  quoted: true,
  standings: [],
  contestants: 0,
  subjects: [
    { id: 1, name: "Piece 1", type: "A cup", states: [], finalized: true },
    { id: 2, name: "Piece 2", type: "A bowl", states: [], finalized: false },
  ],
  counters: [],
  resources: [],
  clocks: [],
  progress: { unitsDone: 1, elapsedMs: 90_000, timed: true },
  score: { label: "Stages closed", text: "1 stage", value: 1, better: "higher" },
  forcedUnits: 0,
  log: [{ n: 3, unit: 2, where: "Stage 2, Form", hit: null, text: "A wide bowl" }],
  unitResults: [{ table: "Form", text: "A wide bowl", hit: null }],
  latest: { where: "Stage 2, Form", text: "A wide bowl" },
};

describe("the Step widget", () => {
  it("carries the current step, the constraints in play, and the latest result: enough to follow along by", () => {
    const html = renderToStaticMarkup(<StepWidget s={base} />);
    expect(html).toContain("Throw it.");
    expect(html).toContain("The game has already had its say");
    expect(html).toContain("The wall must be thin enough to admit light.");
    expect(html).toContain("A wide bowl");
    expect(html).toContain("Stage 2");
  });

  it("says what it is waiting on rather than showing nothing, off a step or a result", () => {
    const html = renderToStaticMarkup(<StepWidget s={{ ...base, step: null, constraints: [], latest: null }} />);
    expect(html).toContain("Waiting");
    expect(html).not.toContain("The game has already had its say");
  });

  it("names the ending once the run has one", () => {
    const html = renderToStaticMarkup(<StepWidget s={{ ...base, status: "ended", ending: "The Shelf", step: null }} />);
    expect(html).toContain("Ended");
    expect(html).toContain("The Shelf");
  });
});

describe("the Stats widget", () => {
  it("carries more of the run: the step, the constraints, the latest line, the score, and subjects declared", () => {
    const html = renderToStaticMarkup(<StatsWidget s={base} />);
    expect(html).toContain("Throw it.");
    expect(html).toContain("The wall must be thin enough to admit light.");
    expect(html).toContain("A wide bowl");
    expect(html).toContain("Stages closed");
    expect(html).toContain("1 stage");
    // Both subjects, declared or not, count.
    expect(html).toContain("Subjects declared");
    expect(html).toContain(">2<");
  });

  it("names the leader in a moderated run, and the ending once it has one", () => {
    const html = renderToStaticMarkup(
      <StatsWidget
        s={{
          ...base,
          status: "ended",
          ending: "The Shelf",
          contestants: 2,
          standings: [{ name: "Mira", points: 4, place: 1, states: [] }],
        }}
      />,
    );
    expect(html).toContain("Leading");
    expect(html).toContain("Mira");
    expect(html).toContain("Ended");
    expect(html).toContain("The Shelf");
  });

  it("leaves out the constraint and latest lines, and the leader, when there is nothing to show", () => {
    const html = renderToStaticMarkup(<StatsWidget s={{ ...base, constraints: [], latest: null, standings: [] }} />);
    expect(html).not.toContain("The game has already had its say");
    expect(html).not.toContain("Latest");
    expect(html).not.toContain("Leading");
  });

  it("reads a snapshot written before these fields existed without throwing", () => {
    const { constraints: _c, latest: _l, stepKind: _k, ...legacy } = base;
    expect(() => renderToStaticMarkup(<StatsWidget s={legacy as LiveSnapshot} />)).not.toThrow();
    expect(() => renderToStaticMarkup(<StepWidget s={legacy as LiveSnapshot} />)).not.toThrow();
  });
});

describe("the Ticker widget", () => {
  const lines: TickerLine[] = [
    { id: "o5", kind: "outcome", mark: "Result", text: "Celadon" },
    { id: "gT", kind: "rolled", mark: "Rolled", text: "Mira rolled 14 on Kiln Check" },
  ];

  it("lists the lines it is given in the order given, each with its kind said in front", () => {
    const html = renderToStaticMarkup(<TickerWidget lines={lines} />);
    expect(html).toContain("Just now");
    expect(html.indexOf("Celadon")).toBeLessThan(html.indexOf("Mira rolled 14"));
    expect(html).toContain("Result");
    expect(html).toContain("Rolled");
    expect(html).not.toContain("Nothing yet");
  });

  it("says so rather than showing an empty box before anything has happened", () => {
    const html = renderToStaticMarkup(<TickerWidget lines={[]} />);
    expect(html).toContain("Nothing yet");
  });

});
