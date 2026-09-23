// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { computeAccessibleDescription } from "dom-accessibility-api";
import { Severity, SeverityGlyph } from "./Severity.tsx";

afterEach(cleanup);

describe("a severity", () => {
  it.each([
    ["error", "✕", "Error:"],
    ["warning", "!", "Warning:"],
  ] as const)("says %s with a glyph and a visible word in a list", (level, glyph, word) => {
    const { container } = render(
      <p>
        <Severity level={level} show="word" />
        Something
      </p>,
    );
    const shown = container.querySelector(".severityGlyph")!;
    expect(shown.textContent).toBe(glyph);
    expect(shown.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".severityWord")!.textContent).toBe(word);
    expect(container.querySelector(".visuallyHidden")).toBeNull();
  });

  it("keeps the word for a screen reader only where the field is dense", () => {
    const { container } = render(
      <>
        <input aria-describedby="n" />
        <span id="n">
          <Severity level="warning" show="glyph" />
          This roll is unusual.
        </span>
      </>,
    );
    expect(container.querySelector(".severityWord")).toBeNull();
    expect(container.querySelector(".visuallyHidden")!.textContent).toBe("Warning:");
    expect(computeAccessibleDescription(container.querySelector("input")!)).toBe("Warning: This roll is unusual.");
  });

  it("draws the glyph alone, hidden, for a count that says its kind in words", () => {
    const { container } = render(<SeverityGlyph level="error" />);
    expect(container.innerHTML).toBe('<span class="severityGlyph error" aria-hidden="true">✕</span>');
  });
});
