import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Constraints } from "./Constraints.tsx";

/**
 * How a step's drawn constraints are shown — what to say lives in the
 * engine's `constraintsFor` (see packages/engine/src/flow.test.ts); this is
 * only the page's and the remote's shared rendering of it.
 */
describe("Constraints", () => {
  it("renders nothing when there is nothing to say", () => {
    expect(renderToStaticMarkup(<Constraints lines={[]} />)).toBe("");
  });

  it("lists every line, under the game's own voice", () => {
    const html = renderToStaticMarkup(<Constraints lines={["A bowl.", "A vase."]} />);
    expect(html).toContain("The game has already had its say");
    expect(html).toContain("A bowl.");
    expect(html).toContain("A vase.");
  });
});
