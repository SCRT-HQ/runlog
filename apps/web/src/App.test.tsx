// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StrictMode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import App from "./App.tsx";
import { DocDrawerProvider } from "./docs/DocDrawer.tsx";
import { StructurePanel } from "./design/StructurePanel.tsx";
import type { MarketplaceEntry } from "./library/marketplace.ts";
import { RunView } from "./run/RunView.tsx";
import { StartScreen } from "./run/StartScreen.tsx";
import { listPacks } from "./storage/db.ts";
import { whoIsHere } from "./storage/who.ts";
import { AccountContext, type Account } from "./auth/Account.tsx";

/** The API App asks directly; null, as with no client configured, unless a test supplies one. */
const apiBoundary = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("./sync/useApi.ts", () => ({ useApi: () => apiBoundary.api }));
/** A catalog supplied only when an App integration test needs to control the public marketplace boundary. */
const marketplaceBoundary = vi.hoisted(() => ({ entries: null as Array<{ id: string }> | null, missing: new Set<string>() }));
const themeStudioBoundary = vi.hoisted(() => ({ pending: [] as Array<(accepted: boolean) => void> }));
vi.mock("./theme/ThemeStudio.tsx", () => ({
  ThemeStudio: ({
    onBack,
    registerLeaveGuard,
  }: {
    onBack: () => void;
    registerLeaveGuard: (guard: (() => Promise<boolean>) | null) => void;
  }) => (
    <main className="themeStudio">
      <h1>Theme studio</h1>
      <button type="button" onClick={() => registerLeaveGuard(() => new Promise((resolve) => themeStudioBoundary.pending.push(resolve)))}>
        Make draft dirty
      </button>
      <button type="button" onClick={() => registerLeaveGuard(null)}>
        Make draft clean
      </button>
      <button type="button" onClick={onBack}>
        Back
      </button>
      <a
        href="#packs"
        onClick={(event) => {
          event.preventDefault();
          onBack();
        }}
      >
        Back link
      </a>
    </main>
  ),
}));
vi.mock("./library/marketplace.ts", async (original) => {
  const real = await original<typeof import("./library/marketplace.ts")>();
  return {
    ...real,
    loadMarketplace: (options?: { testing?: boolean }) =>
      marketplaceBoundary.entries ? Promise.resolve(marketplaceBoundary.entries as MarketplaceEntry[]) : real.loadMarketplace(options),
    marketplaceEntry: (id: string) =>
      marketplaceBoundary.entries
        ? Promise.resolve(
            marketplaceBoundary.missing.has(id)
              ? null
              : ((marketplaceBoundary.entries.find((entry) => entry.id === id) as MarketplaceEntry | undefined) ?? null),
          )
        : real.marketplaceEntry(id),
  };
});

/**
 * The Designer's draft, kept where a browser would keep it.
 *
 * jsdom has no IndexedDB, so the real store answers null to everything and
 * a draft could not survive a navigation whatever the nav did. Only the two
 * draft calls are stood in for. Marketplace-add tests can also opt into an
 * in-memory pack shelf so they can inspect persisted state; every other test
 * falls through to the real storage module.
 */
const drafts = vi.hoisted(() => new Map<string, unknown>());
const packStorage = vi.hoisted(() => ({ records: null as Map<string, unknown> | null }));
vi.mock("./storage/db.ts", async (original) => {
  const real = await original<typeof import("./storage/db.ts")>();
  return {
    ...real,
    listPacks: async () => (packStorage.records ? [...packStorage.records.values()] : real.listPacks()),
    savePack: async (pack: { id: string }) => {
      if (!packStorage.records) return real.savePack(pack as Parameters<typeof real.savePack>[0]);
      packStorage.records.set(pack.id, pack);
    },
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
 * jsdom logs the browser behavior it does not implement as a console
 * error, and this file drives enough of the real app to hit two of them
 * on every run: a scroll on every pane change, and the WebGL probe the
 * dice setting reads once to decide whether it can draw in three
 * dimensions. Both are stubbed at the API rather than filtered after
 * the fact: jsdom's own console forwarding calls a console reference
 * this file cannot reach with `vi.spyOn`, so the message never reaches
 * a spy here, only stubbing what jsdom cannot do keeps it from being
 * logged at all. This runs once at load, since the dice probe's answer
 * is itself cached at load the first time anything reads it.
 *
 * A real cross-document departure, deliberately driven by two tests in
 * "the theme studio navigation guard" below, is not stubbed here: jsdom's
 * `Location.assign` is a non-configurable, non-writable own property, so
 * neither `defineProperty` nor a `Proxy` can stand in for just that one
 * method without violating the invariant checks the platform requires of
 * both. Those two tests swap the whole of `window.location` for a plain
 * object instead; see `stubDocumentDeparture` near them.
 */
vi.stubGlobal("scrollTo", vi.fn());
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

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

  it("sends the mark to the welcome page, as a plain link", async () => {
    await openApp();
    await press(nav("Guide"));
    const brand = document.querySelector("a.brand") as HTMLAnchorElement | null;
    expect(brand).not.toBeNull();
    // The page that says what Runlog is, asked for by name so it opens
    // even where this device chose to skip it; a real navigation, not a
    // view change, so the current view is untouched by the render.
    expect(brand!.getAttribute("href")).toBe(`${import.meta.env.BASE_URL}?welcome`);
    expect(brand!.onclick).toBeNull();
    expect(current()).toEqual(["Guide"]);
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

/**
 * Stand in for `window.location` for the two tests below that carry a
 * guarded departure all the way to a real `location.assign`: jsdom
 * cannot fetch the destination and logs that it cannot as a console
 * error, expected here since the departure is the point of the test.
 * `assign` is a locked-down property of the real `Location`, so the
 * whole object is replaced with a plain one instead; every other
 * property a test or the app reads or writes (`hash`, `href`, and so
 * on) passes straight through to the real one underneath, so hash
 * routing elsewhere in these tests keeps working unchanged.
 */
function stubDocumentDeparture() {
  const real = window.location;
  const passthrough = ["href", "hash", "pathname", "search", "origin", "protocol", "host", "hostname", "port"] as const;
  const facade: Record<string, unknown> = { assign: vi.fn(), replace: vi.fn(), reload: vi.fn() };
  for (const key of passthrough) {
    Object.defineProperty(facade, key, {
      configurable: true,
      enumerable: true,
      get: () => (real as unknown as Record<string, unknown>)[key],
      set: (value: unknown) => {
        (real as unknown as Record<string, unknown>)[key] = value;
      },
    });
  }
  Object.defineProperty(window, "location", { configurable: true, get: () => facade });
  return () => Object.defineProperty(window, "location", { configurable: true, value: real });
}

describe("the theme studio navigation guard", () => {
  let restoreLocation: () => void;

  beforeEach(() => {
    themeStudioBoundary.pending.length = 0;
    drafts.clear();
    localStorage.clear();
    history.replaceState(null, "", "/#themes");
    restoreLocation = stubDocumentDeparture();
  });
  afterEach(() => {
    restoreLocation();
    cleanup();
  });

  async function openDirtyStudio() {
    render(<App />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    fireEvent.click(screen.getByRole("button", { name: "Make draft dirty" }));
  }

  async function answer(accepted: boolean) {
    const resolve = themeStudioBoundary.pending.shift();
    expect(resolve).toBeTypeOf("function");
    await act(async () => {
      resolve!(accepted);
      await Promise.resolve();
    });
  }

  it("keeps a rejected shell transition in the studio and requests a native unload warning only while dirty", async () => {
    await openDirtyStudio();

    fireEvent.click(within(document.querySelector("header.topbar")!).getByRole("button", { name: "Packs" }));
    expect(themeStudioBoundary.pending).toHaveLength(1);
    expect(location.hash).toBe("#themes");
    await answer(false);
    expect(document.querySelector(".themeStudio")).not.toBeNull();

    const dirtyUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Make draft clean" }));
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
  });

  it("lets only the newest pending confirmation navigate", async () => {
    await openDirtyStudio();
    const topbar = within(document.querySelector("header.topbar")!);
    fireEvent.click(topbar.getByRole("button", { name: "Packs" }));
    fireEvent.click(topbar.getByRole("button", { name: "Create" }));
    expect(themeStudioBoundary.pending).toHaveLength(2);

    await answer(true);
    expect(location.hash).toBe("#themes");
    await answer(true);
    expect(location.hash).toBe("#create");
  });

  it("finishes an accepted transition when saving or discarding unregisters its guard", async () => {
    await openDirtyStudio();
    fireEvent.click(within(document.querySelector("header.topbar")!).getByRole("button", { name: "Packs" }));
    expect(themeStudioBoundary.pending).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Make draft clean" }));
    await answer(true);

    expect(location.hash).toBe("#packs");
    expect(document.querySelector(".themeStudio")).toBeNull();
  });

  it.each(["hashchange", "popstate"])("restores the themes address during %s review, then uses the captured destination", async (kind) => {
    await openDirtyStudio();
    history.pushState(null, "", "/#guide/start");
    window.dispatchEvent(kind === "hashchange" ? new HashChangeEvent(kind) : new PopStateEvent(kind));

    expect(location.hash).toBe("#themes");
    expect(themeStudioBoundary.pending).toHaveLength(1);
    await answer(true);
    expect(location.hash).toBe("#guide/start");
    expect(document.querySelector(".guideSide")).not.toBeNull();
  });

  it("guards a themes-to-recovery address change instead of replacing the dirty editor address", async () => {
    await openDirtyStudio();
    history.pushState(null, "", "/#themes/recovery");
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(location.hash).toBe("#themes");
    expect(themeStudioBoundary.pending).toHaveLength(1);
    await answer(false);
    expect(location.hash).toBe("#themes");

    history.pushState(null, "", "/#themes/recovery");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await answer(true);
    expect(location.hash).toBe("#themes/recovery");
  });

  it("guards same-tab shell anchors and ignores modifier, download and new-tab links", async () => {
    await openDirtyStudio();
    const shell = document.querySelector(".app")!;
    const link = document.createElement("a");
    link.href = "#guide/start";
    link.textContent = "Theme help";
    shell.append(link);

    fireEvent.click(link);
    expect(themeStudioBoundary.pending).toHaveLength(1);
    expect(location.hash).toBe("#themes");
    await answer(true);
    expect(location.hash).toBe("#guide/start");

    history.replaceState(null, "", "/#themes");
    link.addEventListener("click", (event) => event.preventDefault());
    link.setAttribute("download", "guide.html");
    fireEvent.click(link);
    link.removeAttribute("download");
    link.target = "_blank";
    fireEvent.click(link);
    link.target = "";
    fireEvent.click(link, { ctrlKey: true });
    expect(themeStudioBoundary.pending).toHaveLength(0);
  });

  it("runs a guarded anchor's navigation callback only once", async () => {
    await openDirtyStudio();

    fireEvent.click(screen.getByRole("link", { name: "Back link" }));

    expect(themeStudioBoundary.pending).toHaveLength(1);
  });

  it("does not show a second native prompt after accepting a same-origin document departure", async () => {
    await openDirtyStudio();
    const shell = document.querySelector(".app")!;
    const link = document.createElement("a");
    link.href = "/outside.html";
    link.textContent = "Outside document";
    shell.append(link);

    fireEvent.click(link);
    expect(themeStudioBoundary.pending).toHaveLength(1);
    await answer(true);

    const acceptedUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(acceptedUnload);
    expect(acceptedUnload.defaultPrevented).toBe(false);
  });

  it("guards a cross-origin same-tab anchor and keeps it a document departure after acceptance", async () => {
    await openDirtyStudio();
    const shell = document.querySelector(".app")!;
    const link = document.createElement("a");
    link.href = "https://example.test/elsewhere";
    link.textContent = "External destination";
    shell.append(link);

    fireEvent.click(link);
    expect(themeStudioBoundary.pending).toHaveLength(1);
    expect(location.hash).toBe("#themes");
    await answer(false);
    expect(location.hash).toBe("#themes");

    fireEvent.click(link);
    expect(themeStudioBoundary.pending).toHaveLength(1);
    await answer(true);
    const acceptedUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(acceptedUnload);
    expect(acceptedUnload.defaultPrevented).toBe(false);
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

/**
 * The marketplace's two addresses, read on the way in.
 *
 * `#marketplace/<packId>` is one pack's page and `#marketplace/<packId>/docs`
 * is a document over it. Both have to survive a reload, which is what
 * rendering the app at the address and finding the same thing is.
 */
describe("a pack's address in the marketplace", () => {
  const LADDER = "com.scrthq.runlog.ladder-work";

  beforeEach(() => {
    drafts.clear();
    localStorage.clear();
    history.replaceState(null, "", "/");
  });
  afterEach(cleanup);

  /** The app at one address, left long enough for the catalog to be read off disk. */
  async function openAt(hash: string) {
    history.replaceState(null, "", hash);
    // The drawer's provider lives above the app in main.tsx; a document
    // opened by address needs it here for the same reason.
    const view = render(
      <DocDrawerProvider>
        <App />
      </DocDrawerProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    return view;
  }

  it("opens the marketplace on that pack, and on a reload opens it again", async () => {
    for (const _pass of [1, 2]) {
      await openAt(`#marketplace/${LADDER}`);
      const page = document.querySelector("article.packPage");
      expect(page).not.toBeNull();
      expect(within(page as HTMLElement).getByRole("heading", { name: "Ladder Work" })).toBeTruthy();
      // The page is where the grid was, not beside it.
      expect(document.querySelector(".marketGrid")).toBeNull();
      cleanup();
    }
  });

  it("opens a document over the page, and on a reload opens it again", async () => {
    for (const _pass of [1, 2]) {
      await openAt(`#marketplace/${LADDER}/docs`);
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(document.querySelector("article.packPage")).not.toBeNull();
      cleanup();
    }
  });

  it("goes back to the catalog with nothing after the address", async () => {
    await openAt("#marketplace");
    expect(document.querySelector(".marketGrid")).not.toBeNull();
    expect(document.querySelector("article.packPage")).toBeNull();
  });
});

/**
 * A free listing can fail without throwing when its file is not a valid pack.
 *
 * The catalog and file are the public data boundary; the App, marketplace UI,
 * parser and library state below are real. Missing and malformed responses are
 * each retried with a valid pack so both sides of the caller contract are held.
 */
describe("adding a free marketplace pack", () => {
  const id = "com.example.marketplace-retry";
  const validPack = `
schemaVersion: 1
id: ${id}
version: "1.0.0"
title: Retry Pack
license: { id: CC0-1.0, redistributable: true }
vocabulary:
  run: { one: Session, many: Sessions }
  unit: { one: Round, many: Rounds }
  subject: { one: Try, many: Tries }
  finalize: Finish
unit: { createsSubject: true, min: 1, max: 1 }
tables: {}
phases:
  - id: play
    label: Play
    steps:
      - kind: finalizeUnit
endings:
  - { id: done, label: Done }
modes:
  standard: { label: Standard }
defaultMode: standard
`;

  beforeEach(() => {
    drafts.clear();
    packStorage.records = new Map();
    localStorage.clear();
    // This scenario starts with an intentionally empty shelf; do not let the
    // unrelated first-run seeding path resolve another marketplace entry.
    localStorage.setItem("runlog:seeded", "yes");
    history.replaceState(null, "", "#marketplace");
  });
  afterEach(() => {
    marketplaceBoundary.entries = null;
    marketplaceBoundary.missing.clear();
    packStorage.records = null;
    cleanup();
  });

  const listing = (load: () => Promise<string>): MarketplaceEntry => ({
    id,
    version: "1.0.0",
    title: "Retry Pack",
    description: "A synthetic public listing for the retry boundary.",
    category: "games",
    tags: [],
    features: [],
    requires: [],
    players: 1,
    tablePlays: true,
    blurb: "games · solo",
    kind: "pack",
    price: "free",
    source: "listing",
    load,
  });

  async function failThenRetry(makeRetryPossible: () => void) {
    render(
      <DocDrawerProvider>
        <App />
      </DocDrawerProvider>,
    );
    const card = (await screen.findByText("Retry Pack")).closest("article");
    expect(card).not.toBeNull();

    fireEvent.click(within(card!).getByRole("button", { name: "Add" }));

    expect((await within(card!).findByRole("status")).textContent).toBe("The pack could not be added.");
    expect(location.hash).toBe("#marketplace");
    expect((within(card!).getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(card!).queryByText("Owned")).toBeNull();
    expect(within(card!).queryByRole("button", { name: "Open" })).toBeNull();
    expect(await listPacks()).toEqual([]);

    makeRetryPossible();
    fireEvent.click(within(card!).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(within(card!).getByRole("button", { name: "Open" })).toBeTruthy());
    expect(within(card!).getByText("Owned")).toBeTruthy();
    expect(within(card!).queryByRole("status")).toBeNull();
    expect(location.hash).toBe("#marketplace");
    expect(await listPacks()).toMatchObject([{ id, title: "Retry Pack", source: validPack }]);
  }

  it("reports a listing that no longer resolves without changing the shelf, then adds it on retry", async () => {
    marketplaceBoundary.entries = [listing(async () => validPack)];
    marketplaceBoundary.missing.add(id);

    await failThenRetry(() => marketplaceBoundary.missing.delete(id));
  });

  it("reports invalid loaded text without changing the shelf, then adds the valid retry", async () => {
    let loads = 0;
    marketplaceBoundary.entries = [listing(async () => (++loads === 1 ? "not: a valid Runlog pack" : validPack))];

    await failThenRetry(() => {});
  });
});

describe("profile access through application navigation", () => {
  const signedIn: Extract<Account, { status: "signed-in" }> = {
    status: "signed-in",
    user: {
      object: "user",
      id: "user_APP",
      email: "app@example.com",
      emailVerified: true,
      firstName: "App",
      lastName: null,
      profilePictureUrl: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      lastSignInAt: null,
      externalId: undefined,
    },
    signOut: () => {},
    getAccessToken: async () => "token",
  };

  beforeEach(() => {
    drafts.clear();
    marketplaceBoundary.entries = [];
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, "", "/");
  });
  afterEach(() => {
    marketplaceBoundary.entries = null;
    apiBoundary.api = null;
    cleanup();
  });

  /** An API that answers what a test names and leaves every other request waiting. */
  const quietApi = (named: Record<string, unknown>) =>
    new Proxy(named, {
      get: (target, key) => (typeof key === "string" && key in target ? target[key] : () => new Promise(() => {})),
    });

  function renderApp(account: Account) {
    return render(
      <AccountContext.Provider value={account}>
        <DocDrawerProvider>
          <App />
        </DocDrawerProvider>
      </AccountContext.Provider>,
    );
  }

  it("replaces a local direct Account boot with Settings instead of adding a private history entry", async () => {
    history.replaceState(null, "", "#profile/account");
    const replace = vi.spyOn(history, "replaceState");
    const push = vi.spyOn(history, "pushState");

    renderApp({ status: "local" });

    await waitFor(() => expect(location.hash).toBe("#profile/settings"));
    expect(replace.mock.calls.some((call) => String(call[2]).endsWith("#profile/settings"))).toBe(true);
    expect(push.mock.calls.some((call) => String(call[2]).endsWith("#profile/settings"))).toBe(false);
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
  });

  it("uses the profile anchor to push signed-in Account content", async () => {
    history.replaceState(null, "", "#profile");
    whoIsHere({ kind: "account", id: signedIn.user.id });
    renderApp(signedIn);

    fireEvent.click(await screen.findByRole("link", { name: "Account" }));

    await waitFor(() => expect(location.hash).toBe("#profile/account"));
    expect(screen.getByRole("heading", { name: "Account" })).toBeTruthy();
  });

  it("keeps an anonymous Publishing hashchange and renders both sign-in doors", async () => {
    renderApp({ status: "anonymous", signIn: () => {}, signUp: () => {} });
    history.replaceState(null, "", "#profile/publishing");
    act(() => window.dispatchEvent(new HashChangeEvent("hashchange")));

    const profile = document.querySelector(".profileBody");
    expect(profile).not.toBeNull();
    await waitFor(() => expect(within(profile as HTMLElement).getByRole("button", { name: "Sign in" })).toBeTruthy());
    expect(within(profile as HTMLElement).getByRole("button", { name: "Create an account" })).toBeTruthy();
    expect(location.hash).toBe("#profile/publishing");
  });

  it("keeps an anonymous Developer keys hashchange and renders both sign-in doors", async () => {
    renderApp({ status: "anonymous", signIn: () => {}, signUp: () => {} });
    history.replaceState(null, "", "#profile/developer");
    act(() => window.dispatchEvent(new HashChangeEvent("hashchange")));

    const profile = document.querySelector(".profileBody");
    expect(profile).not.toBeNull();
    await waitFor(() => expect(within(profile as HTMLElement).getByRole("button", { name: "Sign in" })).toBeTruthy());
    expect(within(profile as HTMLElement).getByRole("button", { name: "Create an account" })).toBeTruthy();
    expect(location.hash).toBe("#profile/developer");
  });

  it("boots a signed-in account directly into Developer keys", async () => {
    history.replaceState(null, "", "#profile/developer");
    whoIsHere({ kind: "account", id: signedIn.user.id });

    renderApp(signedIn);

    expect(await screen.findByRole("heading", { name: "Developer keys" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Developer keys" }).getAttribute("aria-current")).toBe("page");
    expect(location.hash).toBe("#profile/developer");
  });

  it("restores a server Checkout return to Servers for the account that started it", async () => {
    sessionStorage.setItem(
      "runlog:profile-return",
      JSON.stringify({ kind: "checkout", ownerId: signedIn.user.id, product: "server", destination: "servers" }),
    );
    history.replaceState(null, "", "/?billing=done&product=server&destination=servers");
    const refreshEntitlements = vi.fn(async () => {});
    apiBoundary.api = quietApi({ refreshEntitlements });
    whoIsHere({ kind: "account", id: signedIn.user.id });

    renderApp(signedIn);

    await waitFor(() => expect(location.hash).toBe("#profile/servers"));
    expect(location.search).toBe("");
    expect(refreshEntitlements).toHaveBeenCalledOnce();
    expect(await screen.findByText("The payment for Runlog for servers went through. It can take a moment to show here.")).toBeTruthy();
    expect(sessionStorage.getItem("runlog:profile-return")).toBeNull();
  });

  it("cleans up another account's return without reading, moving or saying anything", async () => {
    sessionStorage.setItem(
      "runlog:profile-return",
      JSON.stringify({ kind: "checkout", ownerId: "user_OTHER", product: "plus", destination: "account" }),
    );
    history.replaceState(null, "", "/?billing=done&product=plus&destination=account#packs");
    const refreshEntitlements = vi.fn(async () => {});
    apiBoundary.api = quietApi({ refreshEntitlements });
    whoIsHere({ kind: "account", id: signedIn.user.id });

    renderApp(signedIn);

    await waitFor(() => expect(location.search).toBe(""));
    await act(async () => void (await Promise.resolve()));
    expect(location.hash).toBe("#packs");
    expect(refreshEntitlements).not.toHaveBeenCalled();
    expect(screen.queryByText(/went through/)).toBeNull();
    expect(sessionStorage.getItem("runlog:profile-return")).toBeNull();
  });

  it("keeps a checking Account popstate at its requested address without mounting Account", async () => {
    renderApp({ status: "checking", signIn: () => {} });
    history.replaceState(null, "", "#profile/account");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));

    await waitFor(() => expect(screen.getByText("Checking your account…")).toBeTruthy());
    expect(location.hash).toBe("#profile/account");
    expect(screen.queryByRole("heading", { name: "Account" })).toBeNull();
  });
});

/**
 * A cold load keeps its address.
 *
 * Every section is reached by an address a person can type, and each one
 * used to draw the right thing and then write `#packs` over it: the view
 * was decided in an effect, and in the commit before that effect the run
 * view still believed it was the run and wrote its own address. What was
 * on screen was right and the bar was wrong, so the next reload was wrong
 * too. These mount at each address and read the bar back once everything
 * has settled. Under StrictMode, because that is what dev runs and the
 * rewrite happened on its second pass of the effects.
 */
describe("a cold load keeps its address", () => {
  const LADDER = "com.scrthq.runlog.ladder-work";

  beforeEach(() => {
    drafts.clear();
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, "", "/");
  });
  afterEach(cleanup);

  /** The app mounted at one address, left for every effect, and the whole address read back. */
  async function landAt(address: string): Promise<string> {
    history.replaceState(null, "", address);
    render(
      <StrictMode>
        <DocDrawerProvider>
          <App />
        </DocDrawerProvider>
      </StrictMode>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    return `${location.pathname}${location.search}${location.hash}`;
  }

  /** What each address should have drawn, so the address is not kept by drawing nothing. */
  const entries: { address: string; shows: string; there: () => boolean; after?: string }[] = [
    { address: "#packs", shows: "the shelf", there: () => document.body.textContent!.includes("Your packs") },
    { address: "#marketplace", shows: "the catalog", there: () => document.querySelector(".marketGrid") !== null },
    { address: `#marketplace/${LADDER}`, shows: "a pack's page", there: () => document.querySelector("article.packPage") !== null },
    {
      address: `#marketplace/${LADDER}/docs`,
      shows: "a document over a pack's page",
      there: () => document.querySelector('[role="dialog"]') !== null && document.querySelector("article.packPage") !== null,
    },
    { address: "#guide/start", shows: "the guide", there: () => document.querySelector(".guideSide") !== null },
    { address: "#guide/streaming", shows: "the guide", there: () => document.querySelector(".guideSide") !== null },
    { address: "#create", shows: "the Designer", there: () => document.querySelector(".designNav") !== null },
    { address: "#create/tables", shows: "the Designer", there: () => document.querySelector(".designNav") !== null },
    // This test process is a local copy with no account door. Private
    // profile addresses become its one available page without leaving the
    // inaccessible address in history.
    {
      address: "#profile",
      after: "#profile/settings",
      shows: "profile Settings",
      there: () => document.querySelector("a[href='#profile/settings'][aria-current='page']") !== null,
    },
    {
      address: "#profile/publishing",
      after: "#profile/settings",
      shows: "profile Settings",
      there: () => document.querySelector("a[href='#profile/settings'][aria-current='page']") !== null,
    },
    { address: "#themes", shows: "the theme studio", there: () => document.querySelector(".themeStudio") !== null },
    { address: "#themes/recovery", shows: "theme recovery", there: () => document.querySelector(".themeStudio") !== null },
    // A run and a seat name something this device does not have, so what
    // they draw is the shelf and a seat's own page; the address is theirs
    // either way, and losing it is what sent a reload to the shelf.
    { address: "#run/notarun", shows: "the app", there: () => document.querySelector(".topbar") !== null },
    { address: "#seat/notarun", shows: "a seat", there: () => document.querySelector(".liveBar") !== null },
  ];

  for (const entry of entries) {
    it(`draws ${entry.shows} at ${entry.address} and leaves the address alone`, async () => {
      const after = await landAt(entry.address);
      expect(entry.there()).toBe(true);
      expect(after).toBe(`/${entry.after ?? entry.address}`);
    });
  }

  it("leaves the bare address bare", async () => {
    expect(await landAt("/")).toBe("/");
  });

  it("holds the address through a second load of the same one, which is what a reload is", async () => {
    expect(await landAt(`#marketplace/${LADDER}`)).toBe(`/#marketplace/${LADDER}`);
    cleanup();
    expect(await landAt(`#marketplace/${LADDER}`)).toBe(`/#marketplace/${LADDER}`);
  });
});
