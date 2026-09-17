// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IconButton } from "./IconButton.tsx";

/**
 * A glyph is not a name, and a small glyph is not a target.
 *
 * Both are the whole reason this component exists, so both are held here:
 * the name cannot be left out, and the class that sizes the hit area is
 * always on.
 */

afterEach(cleanup);

describe("an icon button", () => {
  it("will not compile without a name", () => {
    // @ts-expect-error a glyph says nothing to anyone who is not looking at it
    const missing = <IconButton>x</IconButton>;
    expect(missing).toBeTruthy();
  });

  it("renders the name it was given", () => {
    render(<IconButton label="Deaths up one">+</IconButton>);
    expect(screen.getByRole("button", { name: "Deaths up one" })).toBeTruthy();
  });

  it("keeps the tooltip supplemental, never the name", () => {
    render(
      <IconButton label="Remove them from this run" title="Remove them from this run">
        x
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Remove them from this run" });
    expect(button.getAttribute("title")).toBe("Remove them from this run");
  });

  it("wears the class that sizes the target, whatever the glyph measures", () => {
    render(<IconButton label="Deaths down one">-</IconButton>);
    expect(screen.getByRole("button").className).toBe("ghost tiny iconButton");
  });

  it("keeps the screen's own class beside it", () => {
    render(
      <IconButton label="Close" className="closeDrawer">
        x
      </IconButton>,
    );
    expect(screen.getByRole("button").className).toBe("ghost tiny iconButton closeDrawer");
  });
});
