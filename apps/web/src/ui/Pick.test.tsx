// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { computeAccessibleName } from "dom-accessibility-api";
import { Pick } from "./Pick.tsx";

afterEach(cleanup);

describe("a pick", () => {
  it("states a single choice with aria-pressed and the ring class, and draws no check", () => {
    render(
      <>
        <Pick kind="one" on className="chip pick">
          Two
        </Pick>
        <Pick kind="one" on={false} className="chip pick">
          Three
        </Pick>
      </>,
    );
    const on = screen.getByRole("button", { name: "Two", pressed: true });
    const off = screen.getByRole("button", { name: "Three", pressed: false });
    expect(on.className).toBe("chip pick pickOne");
    expect(on.querySelector(".pickMark")).toBeNull();
    expect(off.getAttribute("type")).toBe("button");
  });

  it("draws a check inside one of several when it is on, and keeps it out of the name", () => {
    const { rerender } = render(
      <Pick kind="many" on={false}>
        dice
      </Pick>,
    );
    expect(screen.getByRole("button", { name: "dice", pressed: false }).querySelector(".pickMark")).toBeNull();
    rerender(
      <Pick kind="many" on>
        dice
      </Pick>,
    );
    const button = screen.getByRole("button", { name: "dice", pressed: true });
    const mark = button.querySelector(".pickMark")!;
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.querySelector("svg path")?.getAttribute("stroke")).toBe("currentColor");
    expect(computeAccessibleName(button)).toBe("dice");
    expect(button.classList.contains("pickMany")).toBe(true);
  });

  it("passes its handler and other attributes through", () => {
    const onClick = vi.fn();
    render(
      <Pick kind="one" on={false} onClick={onClick} title="Two players">
        2
      </Pick>,
    );
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("Two players")).toBeTruthy();
  });
});
