import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RaceBoard } from "./RaceBoard.tsx";

const race = {
  name: "Kiln race",
  ended: false,
  racing: 2,
  standings: [
    { name: "Mira", place: 1, owner: true, line: "Stage 2 · 1 done", elapsedMs: 90_000 },
    { name: "Jo", place: 2, owner: false, line: "not started", elapsedMs: 0 },
  ],
};

describe("the shared race board", () => {
  it("marks the run owner's row with a neutral marker and the current state, never 'you'", () => {
    const html = renderToStaticMarkup(<RaceBoard race={race} />);
    expect(html).toContain('<li class="me" aria-current="true">');
    expect(html).toContain('<span class="who"><span class="ownerMark" aria-hidden="true">▸ </span>Mira</span>');
    expect(html).not.toMatch(/\byou\b/i);
    expect(html.match(/ownerMark/g)).toHaveLength(1);
  });
});
