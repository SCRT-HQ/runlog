// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Pack } from "@runlog/rules-schema";
import type { StoredRun } from "../storage/db.ts";
import { HomeStrip } from "./HomeStrip.tsx";

/**
 * The card at the top of the shelf: what it promises.
 *
 * `pickUp` chooses the run, and it chooses the newest whether or not it is
 * over. The card is what has to tell the difference: a run still going is
 * continued, a run that has ended has its results read, and the press is
 * the same press onto the same run either way.
 */

const vocabulary = {
  unit: { one: "Stage", many: "Stages" },
  subject: { one: "Piece", many: "Pieces" },
  run: { one: "Firing", many: "Firings" },
} as Pack["vocabulary"];

const packs = [{ id: "kiln", title: "Kiln Yard" }];
const vocabularies = new Map([["kiln", vocabulary]]);

const run = (ended: boolean): StoredRun =>
  ({
    runId: "r1",
    packId: "kiln",
    packVersion: "1.0.0",
    events: [
      { t: "RunStarted", at: "2026-09-01T10:00:00Z" },
      { t: "UnitEntered", at: "2026-09-01T10:05:00Z" },
      ...(ended ? [{ t: "RunEnded", at: "2026-09-02T10:00:00Z" }] : []),
    ],
    updatedAt: "2026-09-02T10:00:00Z",
  }) as unknown as StoredRun;

const strip = (runs: StoredRun[], onContinue: (pack: { id: string }, r: StoredRun) => void = () => {}) =>
  render(<HomeStrip packs={packs} runs={runs} vocabularies={vocabularies} onContinue={onContinue} onOpen={() => {}} />);

afterEach(cleanup);

describe("the card where you left off", () => {
  it("continues a run that is still going", () => {
    strip([run(false)]);
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View results" })).toBeNull();
    expect(screen.getByLabelText("Where you are").textContent).not.toContain("ended");
  });

  it("reads the results of a run that has ended, and says it has", () => {
    const picked: string[] = [];
    strip([run(true)], (_p, r) => picked.push(r.runId));
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByLabelText("Where you are").textContent).toContain("ended");
    // The same press onto the same run: the run's own page says the rest.
    fireEvent.click(screen.getByRole("button", { name: "View results" }));
    expect(picked).toEqual(["r1"]);
  });

  it("offers a first start where nothing has been played", () => {
    strip([]);
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.getByLabelText("Where you are").textContent).toContain("Kiln Yard");
  });
});
