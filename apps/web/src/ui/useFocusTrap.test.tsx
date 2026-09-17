// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { useDismiss } from "./useDismiss.ts";
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

function DialogWithMenu() {
  const [dialog, setDialog] = useState(true);
  const [menu, setMenu] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const popover = useRef<HTMLElement>(null);
  useFocusTrap(panel, dialog, () => setDialog(false));
  useDismiss(popover, menu, () => setMenu(false));
  return (
    <main>
      <button>Behind</button>
      {dialog && (
        <section role="dialog" aria-label="Dialog with menu" tabIndex={-1} ref={panel}>
          <button onClick={() => setMenu(true)}>Open menu</button>
          {menu && (
            <aside ref={popover} aria-label="Choices">
              <button>Choice</button>
            </aside>
          )}
        </section>
      )}
    </main>
  );
}

describe("ordinary layers inside a modal", () => {
  it("lets a menu consume Escape without releasing modal isolation", async () => {
    render(<DialogWithMenu />);
    await act(async () => void screen.getByText("Open menu").click());
    expect(screen.getByText("Behind").closest("[inert]")).not.toBeNull();

    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(screen.queryByLabelText("Choices")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Dialog with menu" })).toBeTruthy();
    expect(screen.getByText("Behind").closest("[inert]")).not.toBeNull();

    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(screen.queryByRole("dialog", { name: "Dialog with menu" })).toBeNull();
  });
});

function PrioritizedSiblings() {
  const [drawer, setDrawer] = useState(false);
  const [required, setRequired] = useState(false);
  const [drawerLastDisabled, setDrawerLastDisabled] = useState(false);
  const drawerPanel = useRef<HTMLElement>(null);
  const drawerFirst = useRef<HTMLButtonElement>(null);
  const requiredPanel = useRef<HTMLElement>(null);
  const requiredFirst = useRef<HTMLButtonElement>(null);
  useFocusTrap(drawerPanel, drawer, () => setDrawer(false), drawerFirst);
  useFocusTrap(requiredPanel, required, () => setRequired(false), requiredFirst, { required: true });
  return (
    <main>
      <button id="page-opener" onClick={() => setDrawer(true)}>
        Open drawer
      </button>
      <button onClick={() => setRequired(true)}>Require account</button>
      {drawer &&
        createPortal(
          <section role="dialog" aria-label="Drawer" tabIndex={-1} ref={drawerPanel}>
            <button ref={drawerFirst}>Drawer first</button>
            <button disabled={drawerLastDisabled}>Drawer last</button>
          </section>,
          document.body,
        )}
      {required &&
        createPortal(
          <section role="dialog" aria-label="Required account" tabIndex={-1} ref={requiredPanel}>
            <button ref={requiredFirst}>Required first</button>
            <button onClick={() => setDrawer(false)}>Remove covered drawer</button>
            <button onClick={() => setDrawerLastDisabled(true)}>Disable covered focus</button>
            <button onClick={() => setRequired(false)}>Finish account</button>
          </section>,
          document.body,
        )}
    </main>
  );
}

describe("one modal owner across sibling and portal branches", () => {
  it("retains the page opener when a late drawer outlives the required prompt", async () => {
    render(
      <StrictMode>
        <PrioritizedSiblings />
      </StrictMode>,
    );
    const opener = screen.getByText("Require account");
    opener.focus();
    await act(async () => void opener.click());
    await act(async () => void screen.getByText("Open drawer").click());
    await act(async () => void screen.getByText("Finish account").click());
    expect(document.activeElement?.textContent).toBe("Drawer first");
    await press("Escape");
    expect(document.activeElement).toBe(opener);
  });

  it.each([
    ["drawer then required", ["Open drawer", "Require account"]],
    ["required then late drawer", ["Require account", "Open drawer"]],
  ] as const)("keeps a required modal active when opened %s", async (_name, order) => {
    render(<PrioritizedSiblings />);
    for (const label of order) await act(async () => void screen.getByText(label).click());

    expect(document.activeElement?.textContent).toBe("Required first");
    expect(screen.getByRole("dialog", { name: "Required account" }).closest("[inert]")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Drawer" }).closest("[inert]")).not.toBeNull();
    expect(focusables(document.body).map((el) => el.textContent)).toEqual([
      "Required first",
      "Remove covered drawer",
      "Disable covered focus",
      "Finish account",
    ]);

    const escaped = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => void window.dispatchEvent(escaped));
    expect(escaped.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Required account" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Drawer" })).toBeTruthy();

    await act(async () => void screen.getByText("Finish account").click());
    const resumed = screen.getByRole("dialog", { name: "Drawer" });
    expect(resumed.closest("[inert]")).toBeNull();
    expect(resumed.contains(document.activeElement)).toBe(true);
    await press("Escape");
    expect(screen.queryByRole("dialog", { name: "Drawer" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("reactivates a covered modal at its last focused control", async () => {
    render(<PrioritizedSiblings />);
    await act(async () => void screen.getByText("Open drawer").click());
    screen.getByText("Drawer last").focus();
    await act(async () => void screen.getByText("Require account").click());
    await act(async () => void screen.getByText("Finish account").click());

    expect(screen.queryByRole("dialog", { name: "Required account" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Drawer" }).closest("[inert]")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Drawer last");
  });

  it("falls back when a covered modal's last focused control is no longer operable", async () => {
    render(<PrioritizedSiblings />);
    await act(async () => void screen.getByText("Open drawer").click());
    screen.getByText("Drawer last").focus();
    await act(async () => void screen.getByText("Require account").click());
    await act(async () => void screen.getByText("Disable covered focus").click());
    await act(async () => void screen.getByText("Finish account").click());

    expect(document.activeElement?.textContent).toBe("Drawer first");
  });

  it("cleans up when a covered modal unmounts out of order", async () => {
    render(<PrioritizedSiblings />);
    const opener = screen.getByText("Open drawer");
    opener.focus();
    await act(async () => void screen.getByText("Open drawer").click());
    await act(async () => void screen.getByText("Require account").click());
    await act(async () => void screen.getByText("Remove covered drawer").click());

    expect(screen.queryByRole("dialog", { name: "Drawer" })).toBeNull();
    expect(document.activeElement?.textContent).toBe("Required first");
    await act(async () => void screen.getByText("Finish account").click());
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByText("Open drawer").closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("preserves preexisting inertness and scroll locking after StrictMode cleanup", async () => {
    document.body.style.overflow = "clip";
    const preexisting = document.createElement("aside");
    preexisting.setAttribute("inert", "");
    document.body.append(preexisting);
    const view = render(
      <StrictMode>
        <PrioritizedSiblings />
      </StrictMode>,
    );
    await act(async () => void screen.getByText("Open drawer").click());
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();

    expect(document.body.style.overflow).toBe("clip");
    expect(preexisting.hasAttribute("inert")).toBe(true);
    preexisting.remove();
    document.body.style.overflow = "";
  });
});
