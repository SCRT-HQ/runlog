import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import App, { PackView } from "./App.tsx";
import { RunView, Setup } from "./run/RunView.tsx";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}
const kiln = loadPack("packs/demo/pack.yaml");
const ladder = loadPack("packs/sketches/ladder-work.yaml");

/**
 * Render smoke tests.
 *
 * Rendering to static markup walks the whole component tree against real pack
 * data, and throws on the runtime mistakes a type-checker cannot see. Not a
 * substitute for looking at the thing, but it means "it compiles" is not the
 * only evidence it works.
 */
describe("the app shell", () => {
  const html = renderToStaticMarkup(<App />);

  it("renders without throwing", () => {
    expect(html.length).toBeGreaterThan(500);
  });

  it("ships no pack in the bundle: the first paint is the library, and the bar says so", () => {
    expect(html).toContain("packNow");
    expect(html).toContain(">Packs<");
    expect(html).toContain("Your packs");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Get more packs");
    for (const label of ["The Long Kiln", "Salt &amp; Signal", "Ladder Work"]) expect(html).not.toContain(label);
  });

  it("keeps the bar to the pack, the rules, and one menu", () => {
    expect(html).not.toContain("Inspect");
    expect(html).not.toContain(">Design<");
    expect(html).toContain("Menu");
  });

  it("offers the shelf, not the way back, when there is no run to go back to", () => {
    // The shelf button is the way back from the library the way the
    // Designer's and the Guide's are, but only where a run is loaded. On a
    // first visit it is still the way there.
    expect(html).toContain(">Packs<");
    expect(html).not.toContain(">Play<");
  });

  it("keeps the pack's own paper out of the bar, where there is no run to read it against", () => {
    // Docs sits with the run's controls, beside Undo, so it is absent
    // until there is a run. Rules, which it replaced, is gone from the bar.
    expect(html).not.toContain(">Rules<");
    expect(html).not.toContain(">Docs<");
    expect(html).not.toContain("rulesBtn");
  });

  it("names the header buttons for what the pages call themselves", () => {
    // "Create" and "Docs" read as verbs for pages that call themselves
    // Designer and Guide; the header says the same names those pages do.
    expect(html).toContain(">Designer<");
    expect(html).toContain(">Guide<");
    expect(html).not.toContain(">Create<");
    expect(html).not.toContain(">Docs<");
  });

  it("does not offer to start a run before storage has answered", () => {
    // Reading storage is asynchronous. Rendering setup in the meantime would
    // invite the player to start a run over the top of one already going.
    expect(html).not.toContain("Begin a");
  });
});

describe("the setup screen", () => {
  const noop = () => {};

  it("names the run in the pack's own words", () => {
    const html = renderToStaticMarkup(<Setup pack={kiln} onStart={noop} />);
    expect(html).toContain("Begin a Firing");
    expect(html).toContain("Standard Firing");
  });

  it("relabels itself entirely for a different game", () => {
    // The generality claim, held to at the last mile: no hardcoded noun
    // survives a change of pack.
    const html = renderToStaticMarkup(<Setup pack={ladder} onStart={noop} />);
    expect(html).toContain("Begin a Session");
    expect(html).not.toContain("Firing");
  });

  it("offers a seed for every mode, and says a shared mode needs one", () => {
    const html = renderToStaticMarkup(<Setup pack={kiln} onStart={noop} />);
    // Standard Firing is the default and is not seeded: the seed is optional,
    // and the copy about sharing stays with the modes meant to be shared.
    expect(html).toContain("unseeded, dice are unrepeatable");
    expect(html).not.toContain("meant to be shared");
    expect(html).not.toContain("long-kiln-42");
  });

  it("lists every mode the pack declares", () => {
    const html = renderToStaticMarkup(<Setup pack={kiln} onStart={noop} />);
    for (const mode of Object.values(kiln.modes)) expect(html).toContain(mode.label);
  });
});

describe("the inspector", () => {
  const html = renderToStaticMarkup(
    <PackView pack={kiln} warnings={[]} random={() => Math.random} initial="structure" />,
  );

  it("shows the pack's own vocabulary rather than generic nouns", () => {
    for (const word of ["Firing", "Stage", "Piece"]) expect(html).toContain(word);
  });

  it("lists the tables with their resolution kinds", () => {
    expect(html).toContain("Kiln Check");
    expect(html).toContain("lookup");
    expect(html).toContain("bands");
    expect(html).toContain("d100");
  });

  it("surfaces declared capabilities and the license", () => {
    expect(html).toContain("backwardTargeting");
    expect(html).toContain("MIT");
  });

  it("renders the per-unit flow from the pack's phases", () => {
    expect(html).toContain("Fire the Stage");
  });
});
