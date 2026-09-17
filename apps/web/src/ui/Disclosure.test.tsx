// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Disclosure } from "./Disclosure.tsx";

/**
 * A section that folds, and remembers that it was folded.
 *
 * The folding itself is the browser's, so what is tested here is the two
 * things around it: the key is written and read back, and a device that
 * refuses storage still gets a panel that works.
 */

const KEY = "runlog:disclosure.v1:setupShelf";

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

describe("a disclosure", () => {
  it("wraps the native details, with the summary as its heading", () => {
    render(
      <Disclosure summary="Your setups">
        <p>a setup</p>
      </Disclosure>,
    );
    const details = document.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(details.className).toBe("panel");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Your setups");
  });

  it("keeps the class the section it replaced was styled by", () => {
    render(<Disclosure summary="Your setups" className="setupShelf" children={<p>a setup</p>} />);
    expect((document.querySelector("details") as HTMLDetailsElement).className).toBe("panel setupShelf");
  });

  it("writes the key when it is folded, and reads it back next time", () => {
    const { unmount } = render(
      <Disclosure summary="Your setups" remember="setupShelf">
        <p>a setup</p>
      </Disclosure>,
    );
    expect(localStorage.getItem(KEY)).toBeNull();
    press();
    expect(localStorage.getItem(KEY)).toBe("shut");
    unmount();
    render(
      <Disclosure summary="Your setups" remember="setupShelf">
        <p>a setup</p>
      </Disclosure>,
    );
    expect((document.querySelector("details") as HTMLDetailsElement).open).toBe(false);
  });

  it("remembers nothing at all without a key", () => {
    render(
      <Disclosure summary="Your setups">
        <p>a setup</p>
      </Disclosure>,
    );
    press();
    expect(localStorage.length).toBe(0);
  });

  it("works on a device that refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    render(
      <Disclosure summary="Your setups" remember="setupShelf" defaultOpen={false}>
        <p>a setup</p>
      </Disclosure>,
    );
    const details = document.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(() => press()).not.toThrow();
    expect(details.open).toBe(true);
  });

  it("marks a folded panel that has something new, and drops the marker once it is open", () => {
    render(
      <Disclosure summary="Your setups" defaultOpen={false} signal signalLabel="Something new">
        <p>a setup</p>
      </Disclosure>,
    );
    expect(screen.getByRole("img", { name: "Something new" })).toBeTruthy();
    press();
    expect(screen.queryByRole("img", { name: "Something new" })).toBeNull();
  });
});
