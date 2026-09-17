// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Badge } from "./Badge.tsx";

/**
 * A badge reports; it does not act.
 *
 * The app draws a status and a filter with the same `chip`, and people
 * have pressed the status. This holds the half that cannot be pressed to
 * being exactly that: a span, with no handler to give it and nothing for
 * a keyboard to land on.
 */

afterEach(cleanup);

describe("a badge", () => {
  it("is never a button", () => {
    render(<Badge tone="cap">In your packs</Badge>);
    expect(screen.queryByRole("button")).toBeNull();
    const badge = screen.getByText("In your packs");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.getAttribute("tabindex")).toBeNull();
  });

  it("will not take a press even if one is offered", () => {
    // @ts-expect-error a badge is not a control, so there is nothing to handle
    const pressable = <Badge onClick={() => {}}>test bench</Badge>;
    expect(pressable).toBeTruthy();
  });

  it("wears the tone the sheet already draws, and the class that keeps a control's cursor off it", () => {
    render(<Badge tone="ok">on</Badge>);
    expect(screen.getByText("on").className).toBe("chip badge ok");
  });

  it("says nothing extra for the plain one", () => {
    render(<Badge>v2</Badge>);
    expect(screen.getByText("v2").className).toBe("chip badge");
  });
});
