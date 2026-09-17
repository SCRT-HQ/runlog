// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidePanel } from "./SidePanel.tsx";

/**
 * A panel in the run's side column: it folds, the fold lasts, and a fold
 * does not swallow what arrives behind it.
 *
 * The folding is the browser's and is tested where the component that
 * does it lives. What is tested here is whose fold it is: one run's
 * arrangement is not another's, a run with no id yet keeps nothing, and a
 * device that refuses storage still gets a panel that works.
 */

/** The key a fold is kept under, spelled out so a change of shape has to be deliberate. */
const keyFor = (runId: string, panel: string) => `runlog:disclosure.v1:panel:${runId}:${panel}`;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** jsdom does not fire `toggle` off a click, so the press is spelled out. */
function press() {
  const details = document.querySelector("details") as HTMLDetailsElement;
  details.open = !details.open;
  fireEvent(details, new Event("toggle", { bubbles: false }));
  return details;
}

const panel = () => document.querySelector("details") as HTMLDetailsElement;

describe("a side panel", () => {
  it("opens to begin with, and keeps the class its section was styled by", () => {
    render(
      <SidePanel runId="run1" panel="trackers" title="Trackers" className="scores">
        <p>a dial</p>
      </SidePanel>,
    );
    expect(panel().open).toBe(true);
    expect(panel().className).toBe("panel scores");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Trackers");
  });

  it("keeps the fold under this run and this panel, and reads it back", () => {
    const { unmount } = render(
      <SidePanel runId="run1" panel="trackers" title="Trackers">
        <p>a dial</p>
      </SidePanel>,
    );
    press();
    expect(localStorage.getItem(keyFor("run1", "trackers"))).toBe("shut");
    unmount();
    render(
      <SidePanel runId="run1" panel="trackers" title="Trackers">
        <p>a dial</p>
      </SidePanel>,
    );
    expect(panel().open).toBe(false);
  });

  it("starts another run, and another panel of the same run, from the default", () => {
    localStorage.setItem(keyFor("run1", "trackers"), "shut");
    const { unmount } = render(
      <SidePanel runId="run2" panel="trackers" title="Trackers">
        <p>a dial</p>
      </SidePanel>,
    );
    expect(panel().open).toBe(true);
    unmount();
    render(
      <SidePanel runId="run1" panel="board" title="The board">
        <p>a subject</p>
      </SidePanel>,
    );
    expect(panel().open).toBe(true);
  });

  it("keeps nothing for a run that has not been saved yet", () => {
    render(
      <SidePanel runId={null} panel="trackers" title="Trackers">
        <p>a dial</p>
      </SidePanel>,
    );
    press();
    expect(localStorage.length).toBe(0);
  });

  it("leaves the panel at its default on a device that refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    render(
      <SidePanel runId="run1" panel="trackers" title="Trackers">
        <p>a dial</p>
      </SidePanel>,
    );
    expect(panel().open).toBe(true);
    expect(() => press()).not.toThrow();
    expect(panel().open).toBe(false);
  });

  it("marks a folded panel that something landed behind, and says so in words", () => {
    const { rerender } = render(
      <SidePanel runId="run1" panel="trackers" title="Trackers" news="calm=0">
        <p>a dial</p>
      </SidePanel>,
    );
    press();
    expect(screen.queryByRole("img", { name: "new" })).toBeNull();
    rerender(
      <SidePanel runId="run1" panel="trackers" title="Trackers" news="calm=1">
        <p>a dial</p>
      </SidePanel>,
    );
    expect(screen.getByRole("img", { name: "new" })).toBeTruthy();
  });

  it("says nothing while it is open, and drops the marker when it is opened", () => {
    const { rerender } = render(
      <SidePanel runId="run1" panel="trackers" title="Trackers" news="calm=0">
        <p>a dial</p>
      </SidePanel>,
    );
    rerender(
      <SidePanel runId="run1" panel="trackers" title="Trackers" news="calm=1">
        <p>a dial</p>
      </SidePanel>,
    );
    expect(screen.queryByRole("img", { name: "new" })).toBeNull();
    press();
    rerender(
      <SidePanel runId="run1" panel="trackers" title="Trackers" news="calm=2">
        <p>a dial</p>
      </SidePanel>,
    );
    expect(screen.getByRole("img", { name: "new" })).toBeTruthy();
    press();
    expect(screen.queryByRole("img", { name: "new" })).toBeNull();
  });
});
