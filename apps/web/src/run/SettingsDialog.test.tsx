// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_ALERTS } from "../alerts/settings.ts";
import { SettingsDialog } from "./SettingsDialog.tsx";

/**
 * The sheet at first paint: what this device's choices are, and which
 * other tabs there are to go to. Static markup, so nothing is read from
 * storage that a test process does not have.
 */
const sheet = (runId: string | null, rolling?: { auto: boolean; seeded: boolean; onAuto: () => void }) =>
  renderToStaticMarkup(
    <SettingsDialog
      runId={runId}
      race={false}
      alerts={DEFAULT_ALERTS}
      onAlerts={() => {}}
      onClose={() => {}}
      {...(rolling ? { rolling } : {})}
    />,
  );

describe("the settings sheet", () => {
  it("holds every choice about this device on one tab, the theme excepted", () => {
    const html = sheet("run-1", { auto: false, seeded: false, onAuto: () => {} });
    expect(html).toContain("This device");
    expect(html).toContain("Widgets");
    expect(html).toContain("Alerts");
    expect(html).toContain("Roll for me, without asking");
    expect(html).toContain("carry on by itself");
    expect(html).toContain("Esc");
    // The theme moved to the account menu, where trying one does not mean
    // opening and shutting a dialog to see what it did.
    expect(html).not.toContain("Theme");
  });

  it("has no widgets tab outside a run, since the widgets follow one", () => {
    const html = sheet(null);
    expect(html).not.toContain("Widgets");
    expect(html).toContain("Roll for me, without asking");
  });

  it("offers chat and control only where there is a pack to write them against", () => {
    // No pack and no record here, so those two tabs have nothing to show
    // and are not offered; the widgets follow the run and are.
    const html = sheet("run-1");
    expect(html).toContain("Widgets");
    expect(html).not.toContain(">Chat<");
    expect(html).not.toContain(">Control<");
  });

  it("offers no choice of dice in a seeded run", () => {
    const html = sheet("run-1", { auto: false, seeded: true, onAuto: () => {} });
    expect(html).toContain("rolls from its seed");
    expect(html).not.toContain("Roll for me, without asking");
  });
});

/**
 * The sheet open over a run, in a page with controls behind it.
 *
 * Five presses of Shift+Tab from Close used to reach a button under the
 * veil: the dialog said it was modal and the keyboard did not agree. What
 * is asserted here is the agreement.
 */
function Page() {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <button id="opener" onClick={() => setOpen(true)}>
        Settings
      </button>
      <button id="behind">Behind</button>
      {open && (
        <SettingsDialog
          runId="run-1"
          race={false}
          alerts={DEFAULT_ALERTS}
          onAlerts={() => {}}
          rolling={{ auto: false, seeded: false, onAuto: () => {} }}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  );
}

const openSheet = async () => {
  render(<Page />);
  const opener = screen.getByText("Settings");
  opener.focus();
  await act(async () => void opener.click());
};

const press = (key: string, shiftKey = false) =>
  act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));

const inside = () => screen.getByRole("dialog").contains(document.activeElement);

afterEach(cleanup);

describe("the settings sheet as a keyboard sees it", () => {
  it("opens with Close under the fingers", async () => {
    await openSheet();
    expect(document.activeElement?.textContent).toBe("Close");
  });

  it("goes backwards from Close into the sheet, never to the page behind", async () => {
    await openSheet();
    for (let i = 0; i < 5; i++) {
      await press("Tab", true);
      expect(inside()).toBe(true);
      expect(document.activeElement?.id).not.toBe("behind");
    }
  });

  it("comes round from the last control to the first", async () => {
    await openSheet();
    const dialog = screen.getByRole("dialog");
    const start = document.activeElement;
    let steps = 0;
    do {
      await press("Tab");
      expect(dialog.contains(document.activeElement)).toBe(true);
      steps++;
    } while (document.activeElement !== start && steps < 40);
    // It came back round rather than running off the end of the sheet.
    expect(document.activeElement).toBe(start);
    expect(steps).toBeGreaterThan(1);
  });

  it("leaves the page behind it out of reach while it is open", async () => {
    await openSheet();
    expect(document.getElementById("behind")?.closest("[inert]")).not.toBeNull();
    expect(document.getElementById("opener")?.closest("[inert]")).not.toBeNull();
  });

  it("closes on Escape and hands focus back to whatever opened it", async () => {
    await openSheet();
    await press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement?.id).toBe("opener");
    expect(document.getElementById("behind")?.closest("[inert]")).toBeNull();
  });

  it("closes on a click on the veil, and not on a click in the sheet", async () => {
    await openSheet();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("walks its tabs with the arrow keys, one of them in the Tab order", async () => {
    await openSheet();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    await act(async () => void fireEvent.keyDown(tabs[0] as HTMLElement, { key: "ArrowRight" }));
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(document.activeElement?.textContent).toBe("Widgets");
    // And the panel it names is the one on show.
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[1]?.id);
    await act(async () => void fireEvent.keyDown(screen.getAllByRole("tab")[1] as HTMLElement, { key: "Home" }));
    expect(document.activeElement?.textContent).toBe("This device");
  });
});

/**
 * The run's own tab, and the one thing on it that destroys something.
 *
 * Discard used to ride in the run's toolbar between Settings and the run's
 * name, a press away from Undo. It is last on the tab about this run now,
 * and the question it asks, and the call it makes only on a yes, are the
 * ones it always asked and made.
 */
const overARun = (onDiscard: () => void, name: string | null = "Tuesday") => {
  render(
    <SettingsDialog
      runId="run-1"
      race={false}
      alerts={DEFAULT_ALERTS}
      onAlerts={() => {}}
      rolling={{ auto: false, seeded: false, onAuto: () => {} }}
      session={{ name, noun: "firing", onDiscard }}
      onClose={() => {}}
    />,
  );
};

describe("discarding a run, from the run's own tab", () => {
  it("offers a tab about the run, and nothing about the run on the device's tab", () => {
    overARun(() => {});
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["This device", "This run", "Widgets"]);
    expect(screen.queryByText("Discard")).toBeNull();
  });

  it("has no such tab where there is no run", () => {
    const html = sheet("run-1");
    expect(html).not.toContain("This run");
    expect(html).not.toContain("Discard");
  });

  it("puts Discard last on it, and asks before it does anything", async () => {
    const onDiscard = vi.fn();
    overARun(onDiscard);
    await act(async () => void screen.getByText("This run").click());

    const section = screen.getByRole("tabpanel");
    const row = section.querySelector(".dangerRow")!;
    expect(section.lastElementChild!.lastElementChild).toBe(row);
    const discard = row.querySelector("button.danger") as HTMLButtonElement;
    expect(discard.textContent).toBe("Discard");

    await act(async () => void discard.click());
    expect(screen.getByText("Discard Tuesday?")).toBeTruthy();
    // The row said it and the question says it again, which is the point of
    // asking: the same sentence, not a second one.
    expect(screen.getAllByText("Its log is deleted, and there is no undoing it.").length).toBe(2);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("discards only on a yes, and does nothing on a no", async () => {
    const onDiscard = vi.fn();
    overARun(onDiscard);
    await act(async () => void screen.getByText("This run").click());
    const ask = () => act(async () => void (screen.getByRole("tabpanel").querySelector("button.danger") as HTMLButtonElement).click());

    await ask();
    const cancel = [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!;
    await act(async () => void cancel.click());
    expect(onDiscard).not.toHaveBeenCalled();

    await ask();
    const yes = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Discard")!;
    await act(async () => void (yes as HTMLButtonElement).click());
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("names the run itself where it has no name of its own", async () => {
    overARun(() => {}, null);
    await act(async () => void screen.getByText("This run").click());
    await act(async () => void (screen.getByRole("tabpanel").querySelector("button.danger") as HTMLButtonElement).click());
    expect(screen.getByText("Discard this firing?")).toBeTruthy();
  });
});
