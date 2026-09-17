// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, within } from "@testing-library/react";
import { RunRail, useUnseen, type Pane, type Readings } from "./RunRail.tsx";

/**
 * The way between a run's planes on a phone.
 *
 * Four tabs, one of them named by the pack, one of them the plane you are
 * on, and a mark on any of the others that is holding something you have
 * not seen. The pack's word is the only part of the row that can be too
 * long for it, and it may lose letters on the screen but never in the name
 * it is read out by.
 */

afterEach(cleanup);

function rail(over: Partial<Parameters<typeof RunRail>[0]> = {}) {
  const onPane = vi.fn();
  const { container } = render(
    <RunRail pane="now" onPane={onPane} waiting={false} unit="Round" board="The rounds, what is running, and who is here" {...over} />,
  );
  const nav = container.querySelector("nav.runRail") as HTMLElement;
  return { nav, onPane, tabs: [...nav.querySelectorAll("button.railTab")] as HTMLButtonElement[] };
}

/** The tab whose word is this one, whatever else it is carrying. */
function tabFor(nav: HTMLElement, word: string): HTMLButtonElement {
  const found = [...nav.querySelectorAll("button.railTab")].find((b) => (b.querySelector(".railWord")?.textContent ?? "") === word);
  if (!found) throw new Error(`no tab reading ${word}`);
  return found as HTMLButtonElement;
}

describe("the rail's four planes", () => {
  it("draws Now, the pack's own unit word, Board and Log", () => {
    const { nav, tabs } = rail({ unit: "Stage" });
    expect(tabs.map((b) => b.querySelector(".railWord")?.textContent)).toEqual(["Now", "Stage", "Board", "Log"]);
    expect(nav.getAttribute("aria-label")).toBe("This run");
  });

  it("marks the plane you are on, and only that one", () => {
    const { nav, tabs } = rail({ pane: "board" });
    expect(tabs.filter((b) => b.hasAttribute("aria-current"))).toHaveLength(1);
    expect(tabFor(nav, "Board").getAttribute("aria-current")).toBe("true");
  });

  it("asks for a plane when its tab is pressed", () => {
    const { nav, onPane } = rail();
    fireEvent.click(tabFor(nav, "Log"));
    expect(onPane).toHaveBeenCalledWith<[Pane]>("log");
  });
});

describe("what the marks say", () => {
  it("marks Now while the game is waiting and you are reading something else", () => {
    const { nav } = rail({ pane: "log", waiting: true });
    const now = tabFor(nav, "Now");
    expect(now.querySelector(".railMark")).toBeTruthy();
    expect(now.textContent).toContain(", waiting on you");
  });

  it("leaves Now unmarked while Now is the plane showing", () => {
    const { nav } = rail({ pane: "now", waiting: true });
    expect(tabFor(nav, "Now").querySelector(".railMark")).toBeNull();
  });

  it("marks Board and Log when something has landed behind them", () => {
    const { nav } = rail({ pane: "now", news: { board: true, log: true } });
    for (const word of ["Board", "Log"]) {
      const tab = tabFor(nav, word);
      expect(tab.querySelector(".railMark")).toBeTruthy();
      expect(tab.textContent).toContain(", something new");
    }
    expect(tabFor(nav, "Now").querySelector(".railMark")).toBeNull();
  });

  it("drops a plane's mark while that plane is the one showing", () => {
    const { nav } = rail({ pane: "board", news: { board: true, log: true } });
    expect(tabFor(nav, "Board").querySelector(".railMark")).toBeNull();
    expect(tabFor(nav, "Log").querySelector(".railMark")).toBeTruthy();
  });

  it("says a mark in words as well as in a dot, and hides the dot from the reading", () => {
    const { nav } = rail({ pane: "now", news: { board: true } });
    const board = tabFor(nav, "Board");
    expect(board.querySelector(".railMark")?.getAttribute("aria-hidden")).toBe("true");
    expect(within(board).getByText(", something new").className).toBe("visuallyHidden");
  });
});

describe("what raises a mark", () => {
  const read = (readings: Readings, showing: boolean) =>
    renderHook(({ readings, showing }: { readings: Readings; showing: boolean }) => useUnseen(readings, showing), {
      initialProps: { readings, showing },
    });

  it("says nothing about a reading that has not moved", () => {
    const { result, rerender } = read({ trackers: "calm=0" }, false);
    expect(result.current).toBe(false);
    rerender({ readings: { trackers: "calm=0" }, showing: false });
    expect(result.current).toBe(false);
  });

  it("raises when a reading moves behind a plane that is not showing", () => {
    const { result, rerender } = read({ log: 3 }, false);
    rerender({ readings: { log: 4 }, showing: false });
    expect(result.current).toBe(true);
  });

  it("stays quiet while the plane is the one showing", () => {
    const { result, rerender } = read({ log: 3 }, true);
    rerender({ readings: { log: 4 }, showing: true });
    expect(result.current).toBe(false);
  });

  /**
   * The side column's panels report as they mount, so the first thing a
   * plane says about itself arrives after the run is on the screen. A
   * column turning up is not the game happening behind it.
   */
  it("takes a reading heard for the first time as read", () => {
    const { result, rerender } = read({}, false);
    rerender({ readings: { trackers: "calm=0", scores: "3 pieces" }, showing: false });
    expect(result.current).toBe(false);
    rerender({ readings: { trackers: "calm=1", scores: "3 pieces" }, showing: false });
    expect(result.current).toBe(true);
  });

  it("clears once the plane has been shown, and does not come back for the same reading", () => {
    const { result, rerender } = read({ log: 3 }, false);
    rerender({ readings: { log: 4 }, showing: false });
    expect(result.current).toBe(true);
    rerender({ readings: { log: 4 }, showing: true });
    expect(result.current).toBe(false);
    rerender({ readings: { log: 4 }, showing: false });
    expect(result.current).toBe(false);
  });
});

describe("a pack's long word", () => {
  const long = "Training block A";

  it("keeps the whole word in the name the tab is read out by", () => {
    const { nav } = rail({ unit: long });
    expect(long).toHaveLength(16);
    const tab = tabFor(nav, long);
    expect(tab.textContent).toContain(long);
  });

  it("keeps the whole word in the tab's title, whatever the row shows", () => {
    const { nav } = rail({ unit: long });
    expect(tabFor(nav, long).getAttribute("title")?.startsWith(long)).toBe(true);
  });

  it("gives the word its own box to give up letters in, so the tab keeps its size", () => {
    const { nav } = rail({ unit: long });
    expect(tabFor(nav, long).querySelector(".railWord")?.textContent).toBe(long);
  });

  it("still says it is waiting on you next to a word that long", () => {
    const { nav } = rail({ unit: long, pane: "log", waiting: true });
    expect(tabFor(nav, "Now").textContent).toContain(", waiting on you");
  });
});
