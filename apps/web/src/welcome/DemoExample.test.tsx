// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Pack } from "@runlog/rules-schema";
import { loadDemoPack } from "./demoPacks.ts";
import { generateDemoExample, type DemoExample } from "./demoScenario.ts";
import { personaById, type PersonaId } from "./personas.ts";
import { DemoHistory, DemoSpecimen, DemoWidgets } from "./DemoExample.tsx";

/**
 * `DemoExample.tsx` only ever reads a resolved `DemoExample`: no hooks, no
 * pack access, no randomness. These tests build the model the same way the
 * generator's own tests do, real bundled packs played through the engine,
 * so a change to the model's shape breaks here rather than drifting a
 * hand-typed fixture out from under the renderer.
 */

afterEach(cleanup);

const NOW = "2026-09-18T12:00:00.000Z";

const packs = new Map<PersonaId, Pack>();
let streamer: DemoExample;
let learner: DemoExample;
let dj: DemoExample;

beforeAll(async () => {
  for (const id of ["streamer", "learner", "dj"] as const) packs.set(id, await loadDemoPack(id));
  streamer = generateDemoExample(personaById("streamer"), packs.get("streamer")!, { generation: 0, now: NOW });
  learner = generateDemoExample(personaById("learner"), packs.get("learner")!, { generation: 0, now: NOW });
  dj = generateDemoExample(personaById("dj"), packs.get("dj")!, { generation: 0, now: NOW });
});

/** A hand-typed model for the one case a real pack cannot exercise: pack prose that looks like markup. */
function markupExample(): DemoExample {
  return {
    personaId: "learner",
    generation: 0,
    signature: "focus:f-teach|",
    packId: "com.scrthq.runlog.practice-room",
    packTitle: "Practice Room",
    modeId: "hour",
    modeLabel: "The full hour",
    at: "Drill 1",
    lines: [
      {
        id: "outcome:0",
        where: "Drill 1, Focus",
        roll: "d10 → 3",
        text: "<em>not markup</em>",
        heat: true,
        provenance: {
          eventIndex: 0,
          outcomeIndex: 0,
          tableId: "focus",
          entryId: "f-teach",
          roll: { dice: "d10", total: 3, eventIndex: 0 },
        },
      },
    ],
    historyLineIds: ["outcome:0"],
    state: [{ label: "Drills done", value: "0" }],
    widgets: [],
    widgetCaption: "Practice Room · The full hour · Drill 1",
  };
}

describe("DemoWidgets", () => {
  it("shows a scoreboard, with real contestant names, for a moderated competitive example", () => {
    render(<DemoWidgets example={streamer} />);
    expect(screen.getByText(/Scoreboard/)).toBeTruthy();
    const board = streamer.widgets[0];
    if (!board || board.kind !== "scoreboard") throw new Error("expected the streamer's first widget to be a scoreboard");
    expect(screen.getByText(board.rows[0]!.name)).toBeTruthy();
  });

  it("never shows a roster, race, or scoreboard for a solo example", () => {
    render(<DemoWidgets example={learner} />);
    expect(screen.queryByText(/racing|scoreboard/i)).toBeNull();
    expect(screen.getAllByText(/Focus|Curveball/).length).toBeGreaterThan(0);
  });

  it("renders nothing for the finalize step the generator already left out, and still shows the rest", () => {
    // DJ's next step is Soundclash's one-press finalize; demoScenario.ts
    // leaves it out of `widgets` structurally (see its own tests), so there
    // is no "step" widget here to render at all, and the pack's bare
    // finalize word ("Next") never has to be caught by the renderer.
    expect(dj.widgets.some((w) => w.kind === "step")).toBe(false);
    render(<DemoWidgets example={dj} />);
    expect(screen.queryByText("Next")).toBeNull();
    // The rest of the example still shows: the ticker carries the same round's result.
    expect(screen.getByText(/90 seconds/)).toBeTruthy();
  });

  it("captions the widgets visibly as an example, in the example's own words", () => {
    const { container } = render(<DemoWidgets example={streamer} />);
    const caption = container.querySelector(".welcomeWidget > figcaption");
    expect(caption?.textContent).toBe(`Example · ${streamer.widgetCaption}`);
  });

  it("labels the history visibly as an example too", () => {
    const { container } = render(<DemoHistory example={streamer} />);
    expect(container.querySelector(".welcomeExcerpt > figcaption")?.textContent).toBe("Example");
  });

  it("never puts a pack's own text behind aria-hidden or injects it as markup", () => {
    const { container } = render(<DemoWidgets example={streamer} />);
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });
});

describe("DemoSpecimen and DemoHistory", () => {
  it("render the same lines, by id and text, from the same model", () => {
    const { container: specimen } = render(<DemoSpecimen example={streamer} packHref="#marketplace/forfeits" />);
    const { container: history } = render(<DemoHistory example={streamer} />);
    expect(streamer.historyLineIds.length).toBeGreaterThan(0);
    for (const id of streamer.historyLineIds) {
      const line = streamer.lines.find((l) => l.id === id)!;
      const inSpecimen = specimen.querySelector(`[data-line-id="${id}"]`);
      const inHistory = history.querySelector(`[data-line-id="${id}"]`);
      expect(inSpecimen?.textContent).toContain(line.text);
      expect(inHistory?.textContent).toContain(line.text);
    }
  });

  it("labels the figure as an example, not live activity", () => {
    render(<DemoSpecimen example={streamer} packHref="#marketplace/forfeits" />);
    const caption = screen.getByText(/Example/);
    expect(caption.tagName.toLowerCase()).toBe("figcaption");
    expect(caption.textContent).toContain(streamer.packTitle);
  });

  it("renders pack text as literal text, never injected markup or hidden from assistive tech", () => {
    const example = markupExample();
    const { container } = render(<DemoSpecimen example={example} packHref="#" />);
    expect(screen.getByText("<em>not markup</em>")).toBeTruthy();
    expect(container.querySelector("em")).toBeNull();
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });
});
