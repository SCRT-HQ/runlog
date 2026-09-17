// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act, useRef, useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { focusables, useFocusTrap } from "./useFocusTrap.ts";

/**
 * What `aria-modal` promises and does not do.
 *
 * The attribute announces a dialog as modal and leaves the page behind it
 * in the tab order, which is how Shift+Tab out of the run's Settings
 * reached a button under the veil. These are the four things the trap
 * owes: focus starts inside, stays inside, the page behind is out of
 * reach, and it goes back where it came from.
 */
function Sheet({ vanishing = false }: { vanishing?: boolean }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useFocusTrap(panel, open, () => setOpen(false), first);
  return (
    <main>
      {!(vanishing && open) && (
        <button id="opener" onClick={() => setOpen(true)}>
          Open
        </button>
      )}
      <button id="behind">Behind</button>
      {open && (
        <section role="dialog" aria-label="A sheet" tabIndex={-1} ref={panel}>
          <button>First</button>
          <button ref={first}>Second</button>
        </section>
      )}
    </main>
  );
}

/**
 * The dialog as a component of its own, which is how the run's Settings
 * is written: the trap mounts with it rather than being switched on in a
 * component that was already there.
 */
function Dialog({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useFocusTrap(panel, true, onClose);
  return (
    <section role="dialog" aria-label="A sheet" tabIndex={-1} ref={panel}>
      <button>Only</button>
    </section>
  );
}

function Mounting() {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <button id="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && <Dialog onClose={() => setOpen(false)} />}
    </main>
  );
}

const press = (key: string, shiftKey = false) =>
  act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));

const open = async (vanishing = false) => {
  render(<Sheet vanishing={vanishing} />);
  const opener = screen.getByText("Open");
  opener.focus();
  await act(async () => void opener.click());
};

const focused = () => document.activeElement?.textContent;

afterEach(cleanup);

describe("holding focus in a dialog", () => {
  it("starts on the control the dialog names", async () => {
    await open();
    expect(focused()).toBe("Second");
  });

  it("wraps from the last control to the first rather than leaving", async () => {
    await open();
    await press("Tab");
    expect(focused()).toBe("First");
  });

  it("wraps backwards from the first control to the last, not to the page behind", async () => {
    await open();
    screen.getByText("First").focus();
    await press("Tab", true);
    expect(focused()).toBe("Second");
  });

  it("leaves nothing outside the dialog to tab to", async () => {
    await open();
    expect(focusables(document.body).map((el) => el.textContent)).toEqual(["First", "Second"]);
    expect(document.getElementById("behind")?.closest("[inert]")).not.toBeNull();
  });

  it("holds the page behind it still", async () => {
    await open();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes on Escape and gives the page back", async () => {
    await open();
    await press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.getElementById("behind")?.closest("[inert]")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("gives focus back to whatever opened it", async () => {
    await open();
    await press("Escape");
    expect(document.activeElement?.id).toBe("opener");
  });

  it("lands on the page when the opener went away under it", async () => {
    await open(true);
    await press("Escape");
    expect(document.activeElement?.tagName).toBe("MAIN");
  });

  it("still knows the opener where every effect is mounted twice", async () => {
    // A development build mounts each effect twice, and the app runs in
    // one. An opener forgotten between the two mounts sent focus to the
    // page instead of back to the button that had been pressed.
    render(
      <StrictMode>
        <Mounting />
      </StrictMode>,
    );
    const opener = screen.getByText("Open");
    opener.focus();
    await act(async () => void opener.click());
    expect(focused()).toBe("Only");
    await press("Escape");
    expect(document.activeElement?.id).toBe("opener");
  });
});

/** A confirm over a sheet: one press of Escape closes one of them. */
function Stacked() {
  const [sheet, setSheet] = useState(true);
  const [over, setOver] = useState(true);
  const outer = useRef<HTMLElement>(null);
  const inner = useRef<HTMLElement>(null);
  useFocusTrap(outer, sheet, () => setSheet(false));
  useFocusTrap(inner, over, () => setOver(false));
  return (
    <main>
      {sheet && (
        <section role="dialog" aria-label="A sheet" tabIndex={-1} ref={outer}>
          <button>Sheet</button>
          {over && (
            <section role="alertdialog" aria-label="Sure?" tabIndex={-1} ref={inner}>
              <button>Over</button>
            </section>
          )}
        </section>
      )}
    </main>
  );
}

describe("two layers at once", () => {
  it("closes the top one first, and the one under it on the next press", async () => {
    render(<Stacked />);
    await press("Escape");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeNull();
    await press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not answer a key it was not given", async () => {
    const onClose = vi.fn();
    function Quiet() {
      const panel = useRef<HTMLElement>(null);
      useFocusTrap(panel, true, onClose);
      return (
        <main>
          <section role="dialog" aria-label="Quiet" tabIndex={-1} ref={panel}>
            <button>Only</button>
          </section>
        </main>
      );
    }
    render(<Quiet />);
    await press("a");
    expect(onClose).not.toHaveBeenCalled();
  });
});
