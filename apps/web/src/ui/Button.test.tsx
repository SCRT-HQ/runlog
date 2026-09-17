// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button, ButtonLink, controlClasses } from "./Button.tsx";

/**
 * What the button promises, rather than what it looks like.
 *
 * The classes matter here for one reason only: the stylesheet draws them,
 * and hundreds of controls the app still writes by hand wear the same
 * ones. If the component stopped rendering them, every screen would take
 * this task's changes at once instead of one slice at a time.
 */

afterEach(cleanup);

describe("what a variant and a size come out as", () => {
  it("renders the classes the sheet already draws", () => {
    expect(controlClasses({ variant: "primary" })).toBe("primary");
    expect(controlClasses({})).toBe("ghost");
    expect(controlClasses({ variant: "quiet", size: "compact" })).toBe("ghost tiny");
    expect(controlClasses({ variant: "primary", size: "big" })).toBe("primary big");
    expect(controlClasses({ variant: "danger" })).toBe("ghost danger");
    expect(controlClasses({ variant: "danger", emphasis: "primary", size: "compact" })).toBe("primary danger tiny");
  });

  it("keeps whatever else the screen's own rules look for", () => {
    expect(controlClasses({ size: "compact" }, "update")).toBe("ghost tiny update");
  });
});

describe("a button that is working", () => {
  const busy = (loading: boolean) => (
    <Button loading={loading} loadingLabel="Saving…">
      Use this name
    </Button>
  );

  it("cannot be pressed a second time", () => {
    let presses = 0;
    render(
      <Button loading loadingLabel="Saving…" onClick={() => (presses += 1)}>
        Use this name
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(presses).toBe(0);
  });

  it("says it is busy", () => {
    const { rerender } = render(busy(false));
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBeNull();
    rerender(busy(true));
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
  });

  it("keeps the room both labels take, so the row does not jump", () => {
    const { rerender } = render(busy(false));
    const resting = screen.getByRole("button");
    // Both labels are in the markup either way; the one not being read is
    // hidden rather than removed, so the width is the wider of the two
    // before the wait and during it.
    expect(resting.textContent).toBe("Use this nameSaving…");
    expect(resting.querySelector(".buttonBusyHidden")?.textContent).toBe("Saving…");
    rerender(busy(true));
    const working = screen.getByRole("button");
    expect(working.textContent).toBe("Use this nameSaving…");
    expect(working.querySelector(".buttonBusyHidden")?.textContent).toBe("Use this name");
    // And the accessible name is only ever one of them.
    expect(working.getAttribute("aria-label")).toBeNull();
    expect(working.querySelector('[aria-hidden="true"]')?.textContent).toBe("Use this name");
  });

  it("leaves a button with nothing else to say exactly as it was", () => {
    render(<Button loading>Test</Button>);
    const button = screen.getByRole("button");
    expect(button.textContent).toBe("Test");
    expect(button.querySelector(".buttonBusy")).toBeNull();
  });
});

describe("a button and a link", () => {
  it("defaults to a button that does not submit whatever form it lands in", () => {
    render(<Button>Test</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("lets a form's own button say so", () => {
    render(<Button type="submit">Join a race</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  it("renders navigation as an anchor with an address on it", () => {
    render(
      <ButtonLink variant="primary" href="./play">
        Play
      </ButtonLink>,
    );
    const link = screen.getByRole("link", { name: "Play" });
    expect(link.tagName).toBe("A");
    // What a button cannot offer: the middle click, the new tab, and the
    // address the browser shows before the press.
    expect(link.getAttribute("href")).toBe("./play");
    expect(link.className).toBe("primary");
  });
});
