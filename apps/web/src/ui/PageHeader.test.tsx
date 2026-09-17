// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader.tsx";

/** What page this is, said once, where a screen reader's list of headings finds it. */

afterEach(cleanup);

describe("a page header", () => {
  it("draws the title as the page's own heading", () => {
    render(<PageHeader title="Your packs" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your packs");
  });

  it("draws the line under it only when there is one", () => {
    const { rerender } = render(<PageHeader title="Your packs" />);
    expect(document.querySelector(".pageLead")).toBeNull();
    rerender(<PageHeader title="Your packs" lead="Newest played first." />);
    expect(document.querySelector(".pageLead")?.textContent).toBe("Newest played first.");
  });

  it("puts the actions in one row, and draws none where there are none", () => {
    const { rerender } = render(<PageHeader title="Your packs" />);
    expect(document.querySelector(".pageHeaderActions")).toBeNull();
    rerender(<PageHeader title="Your packs" primary={<button>Get more packs</button>} secondary={<button>Load a file</button>} />);
    const actions = document.querySelector(".pageHeaderActions");
    expect(actions?.textContent).toBe("Load a fileGet more packs");
  });

  it("keeps the class the screen it replaced was styled by", () => {
    render(<PageHeader className="libraryHead" title="Your packs" />);
    expect(document.querySelector("header")?.className).toBe("pageHeader libraryHead");
  });
});
