// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import App from "./App.tsx";
import { StructurePanel } from "./design/StructurePanel.tsx";
import { RunView, StartScreen } from "./run/RunView.tsx";

/**
 * The Designer's draft, kept where a browser would keep it.
 *
 * jsdom has no IndexedDB, so the real store answers null to everything and
 * a draft could not survive a navigation whatever the nav did. Only the two
 * draft calls are stood in for; the rest of storage is the real module, so
 * the shelf and the runs behave as they do anywhere else.
 */
const drafts = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./storage/db.ts", async (original) => {
  const real = await original<typeof import("./storage/db.ts")>();
  return {
    ...real,
    loadDraft: async (id: string) => drafts.get(id) ?? null,
    saveDraft: async (draft: { id: string }) => {
      drafts.set(draft.id, draft);
    },
  };
});

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

  it("offers no way back to the run when there is no run to go back to", () => {
    // The return is a control of its own, and a first visit with nothing
    // loaded has nothing to return to, so there is no button rather than a
    // dead one. The destinations keep their names either way.
    expect(html).toContain(">Packs<");
    expect(html).not.toContain(">Play<");
    expect(html).not.toContain("Back to the run");
  });

  it("keeps the pack's own paper out of the bar, where there is no run to read it against", () => {
    // Docs sits with the run's controls, beside Undo, so it is absent
    // until there is a run. Rules, which it replaced, is gone from the bar.
    expect(html).not.toContain(">Rules<");
    expect(html).not.toContain(">Docs<");
    expect(html).not.toContain("rulesBtn");
  });

  it("names the header buttons for the addresses they go to", () => {
    // The button and the path say the same word: /create and /guide.
    expect(html).toContain(">Create<");
    expect(html).toContain(">Guide<");
    expect(html).not.toContain(">Designer<");
    expect(html).not.toContain(">Docs<");
  });

  it("does not offer to start a run before storage has answered", () => {
    // Reading storage is asynchronous. Rendering setup in the meantime would
    // invite the player to start a run over the top of one already going.
    expect(html).not.toContain("Begin a");
  });

  it("keeps the app's mark out of the headings, so a page has one h1", () => {
    // The mark is the app's, not the page's, and every page under it has a
    // title of its own. Two h1s on a page is one too many.
    expect(html).toContain('class="brandName"');
    expect(html).not.toContain("<h1>Runlog</h1>");
  });
});

/**
 * The bar, driven.
 *
 * Packs, Create and Guide used to rename themselves to Play once you were
 * standing in them: the current destination lost its name and navigation
 * doubled as a return. These hold the split that fixed it, on the real app
 * rather than on a stand-in for it.
 */
describe("the bar's nav", () => {
  /** The bar's three destinations, in the order they sit in. */
  const DESTINATIONS = ["Packs", "Create", "Guide"];

  beforeEach(() => {
    drafts.clear();
    localStorage.clear();
    history.replaceState(null, "", "/");
  });
  afterEach(cleanup);

  /** The app, rendered and left to settle: the shelf and storage both answer asynchronously. */
  async function openApp() {
    const view = render(<App />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    return view;
  }

  /** A press, with whatever it sets off allowed to finish. */
  async function press(element: Element) {
    await act(async () => {
      fireEvent.click(element);
      await new Promise((r) => setTimeout(r, 250));
    });
  }

  /** The bar itself: the page below it has buttons of its own, and Play is one of them. */
  const bar = () => within(document.querySelector("header.topbar")!);
  const nav = (name: string) => bar().getByRole("button", { name });
  const backToRun = () => bar().queryByRole("button", { name: "Back to the run" });
  /** Which of the bar's controls wears the accent fill, by the name each is read by. */
  const filled = () =>
    Array.from(document.querySelectorAll("header.topbar .topbarEnd > .primary")).map(
      (el) => el.getAttribute("aria-label") ?? el.textContent?.trim(),
    );
  /** Which of the bar's buttons says it is the page you are on. */
  const current = () => Array.from(document.querySelectorAll('header.topbar [aria-current="page"]')).map((el) => el.textContent?.trim());

  /** Opens the first pack on the shelf, which is what gives the app a run to go back to. */
  async function openAPack() {
    const first = document.querySelector("button.libraryTitle");
    expect(first).not.toBeNull();
    await press(first!);
  }

  it("calls each destination by its own name, wherever you are standing", async () => {
    await openApp();
    for (const name of DESTINATIONS) expect(nav(name)).toBeTruthy();
    await press(nav("Create"));
    for (const name of DESTINATIONS) expect(nav(name)).toBeTruthy();
    await press(nav("Guide"));
    for (const name of DESTINATIONS) expect(nav(name)).toBeTruthy();
    expect(bar().queryByRole("button", { name: "Play" })).toBeNull();
  });

  it("marks the page you are on, and only that one", async () => {
    // What says so is `aria-current`. The look follows from it in the
    // sheet, so nothing here reads a class.
    await openApp();
    expect(current()).toEqual(["Packs"]);
    await press(nav("Create"));
    expect(current()).toEqual(["Create"]);
    await press(nav("Guide"));
    expect(current()).toEqual(["Guide"]);
    await press(nav("Packs"));
    expect(current()).toEqual(["Packs"]);
  });

  it("keeps the fill for the one control that acts, and never for the page you are on", async () => {
    // A selected page is a state and the way back is an action; they
    // should not be able to be mistaken for each other. The three doors
    // are quiet whichever one you are standing in, and with a run open
    // exactly one thing in the bar is filled.
    await openApp();
    expect(filled()).toEqual([]);
    await press(nav("Create"));
    expect(filled()).toEqual([]);
    await press(nav("Packs"));
    await openAPack();
    await press(nav("Packs"));
    expect(filled()).toEqual(["Back to the run"]);
    await press(nav("Guide"));
    expect(filled()).toEqual(["Back to the run"]);
  });

  it("offers no way back to the run on a fresh app with no run", async () => {
    await openApp();
    expect(backToRun()).toBeNull();
    await press(nav("Create"));
    expect(backToRun()).toBeNull();
  });

  it("offers the way back only once there is a run, and never on the run itself", async () => {
    await openApp();
    await openAPack();
    // The run is on screen: there is nothing to go back to.
    expect(backToRun()).toBeNull();
    await press(nav("Packs"));
    expect(backToRun()).not.toBeNull();
    await press(nav("Guide"));
    expect(backToRun()).not.toBeNull();
    await press(backToRun()!);
    expect(backToRun()).toBeNull();
    expect(current()).toEqual([]);
  });

  it("sends the mark to the shelf", async () => {
    await openApp();
    await press(nav("Guide"));
    expect(current()).toEqual(["Guide"]);
    const brand = document.querySelector("a.brand");
    expect(brand).not.toBeNull();
    await press(brand!);
    expect(current()).toEqual(["Packs"]);
  });

  it("opens the Designer without discarding the draft or starting a run", async () => {
    await openApp();
    await press(nav("Create"));
    const title = (await screen.findByLabelText(/^Title/)) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(title, { target: { value: "A pack in progress" } });
      await new Promise((r) => setTimeout(r, 250));
    });
    // Away and back again. Navigation sets the view and the address; it
    // does not put the draft down, and it does not begin a run.
    await press(nav("Packs"));
    expect(backToRun()).toBeNull();
    await press(nav("Create"));
    // The Designer asks which pack when it finds one already written, and
    // the one it found is the one that was left open.
    await press(await screen.findByRole("button", { name: "Continue editing A pack in progress" }));
    const again = (await screen.findByLabelText(/^Title/)) as HTMLInputElement;
    expect(again.value).toBe("A pack in progress");
  });

  it("hands Create and Guide to the menu on a phone, and keeps the row to one", async () => {
    // The mark, the way back, the shelf and the menu fill a phone's row on
    // their own; a fifth and a sixth control wrapped it onto a second row.
    // They move into the menu rather than out of the app, and each door is
    // in the page once, so nothing is reachable twice or announced twice.
    const real = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: true,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      await openApp();
      expect(nav("Packs")).toBeTruthy();
      expect(bar().queryByRole("button", { name: "Create" })).toBeNull();
      expect(bar().queryByRole("button", { name: "Guide" })).toBeNull();
      const menu = document.querySelector("details.accountMenu") as HTMLDetailsElement;
      await press(menu.querySelector("summary")!);
      const inMenu = Array.from(menu.querySelectorAll(".menuSections .accountItem")).map((b) => b.querySelector("span")?.textContent);
      expect(inMenu).toEqual(["Create", "Guide"]);
    } finally {
      window.matchMedia = real;
    }
  });
});

describe("the setup screen", () => {
  const noop = () => {};

  it("names the run in the pack's own words", () => {
    const html = renderToStaticMarkup(<StartScreen pack={kiln} onStart={noop} />);
    expect(html).toContain("Begin a Firing");
    expect(html).toContain("Standard Firing");
  });

  it("relabels itself entirely for a different game", () => {
    // The generality claim, held to at the last mile: no hardcoded noun
    // survives a change of pack.
    const html = renderToStaticMarkup(<StartScreen pack={ladder} onStart={noop} />);
    expect(html).toContain("Begin a Session");
    expect(html).not.toContain("Firing");
  });

  it("offers a seed for every mode, and says a shared mode needs one", () => {
    const html = renderToStaticMarkup(<StartScreen pack={kiln} onStart={noop} />);
    // Standard Firing is the default and is not seeded: the seed is optional,
    // and the copy about sharing stays with the modes meant to be shared.
    expect(html).toContain("unseeded, dice are unrepeatable");
    expect(html).not.toContain("meant to be shared");
    expect(html).not.toContain("long-kiln-42");
  });

  it("lists every mode the pack declares", () => {
    const html = renderToStaticMarkup(<StartScreen pack={kiln} onStart={noop} />);
    for (const mode of Object.values(kiln.modes)) expect(html).toContain(mode.label);
  });
});

describe("the inspector", () => {
  const html = renderToStaticMarkup(<StructurePanel pack={kiln} warnings={[]} random={() => Math.random} />);

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
