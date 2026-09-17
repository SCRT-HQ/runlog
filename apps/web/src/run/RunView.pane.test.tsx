// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import { syncBus } from "../sync/bus.ts";
import type { StoredRun } from "../storage/db.ts";
import { memoryRunStore, type RunStore } from "./store.ts";
import { RunView } from "./RunView.tsx";

/**
 * A run on a phone, where the columns are planes and the rail is the way
 * between them.
 *
 * Switching used to throw away where you were: the window scrolls, not a box
 * inside the page, so the plane you opened started wherever the one you left
 * happened to be standing, and the keyboard was left on a button that had
 * just been hidden. Each plane keeps its own place and hands the keyboard to
 * its own first heading.
 */

vi.mock("../sync/useApi.ts", () => ({ useApi: () => null }));
vi.mock("./useReachable.ts", () => ({
  useReachable: () => ({ link: null, key: "watchkey", working: false, mint: async () => "watchkey" }),
}));
vi.mock("../control/setups.ts", async (original) => ({
  ...(await original<typeof import("../control/setups.ts")>()),
  setupsHere: async () => [],
}));
vi.mock("../control/builtin.ts", async (original) => ({
  ...(await original<typeof import("../control/builtin.ts")>()),
  builtins: async () => [],
}));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;
const mode = Object.keys(kiln.modes)[0]!;

const sync: Sync = {
  available: true,
  enabled: false,
  setEnabled: () => {},
  status: "idle",
  last: null,
  syncNow: () => {},
  setPackSync: async () => {},
  gesture: () => false,
  drove: () => {},
};

async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) await act(async () => await Promise.resolve());
}

/** Where the window is, which is what a phone scrolls. */
let at = 0;
const scrollTo = vi.fn();

beforeEach(() => {
  at = 0;
  scrollTo.mockClear();
  // The plane switch only happens where the columns are not columns.
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("max-width: 760px"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => at });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
});

afterEach(cleanup);

/** Put the window here, the way scrolling would, and let the page hear it. */
function scrolledTo(y: number) {
  at = y;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

const at0 = "2026-09-14T00:00:00.000Z";

/** A saved run of this pack, optionally in its first unit with a clock. */
function saved(runId: string, withClock = false): StoredRun {
  const started: RunEvent = { id: `e-${runId}`, t: "RunStarted", at: at0, packId: kiln.id, packVersion: kiln.version, runId, mode };
  const events: RunEvent[] = withClock
    ? [
        started,
        { id: `u-${runId}`, t: "UnitEntered", at: at0 },
        { id: `c-${runId}`, t: "ClockStarted", at: at0, clock: "u1:unit", kind: "stopwatch", label: `${kiln.vocabulary.unit.one} 1` },
      ]
    : [started];
  return {
    runId,
    packId: kiln.id,
    packVersion: kiln.version,
    packTitle: kiln.title,
    events,
    updatedAt: at0,
    role: "owner",
  };
}

/**
 * A store that hears a run arriving from elsewhere. The memory store says it
 * keeps nothing, and the run hook takes that as leave to ignore a pull, which
 * is the one way a run changes under a page that stays put.
 */
function keeping(): RunStore {
  return { ...memoryRunStore(), keeps: true };
}

async function screen(opts: { store?: RunStore; withClock?: boolean } = {}): Promise<HTMLElement> {
  const store = opts.store ?? memoryRunStore();
  await store.saveRun(saved("run1", opts.withClock));
  store.setActiveRunFor(kiln.id, "run1");
  const { container } = render(
    <SyncContext.Provider value={sync}>
      <RunView pack={kiln} store={store} />
    </SyncContext.Provider>,
  );
  await flush();
  return container;
}

describe("the run header", () => {
  it("groups its data ahead of Flow and keeps the working clock ahead of the menu", async () => {
    const root = await screen({ withClock: true });
    const margin = root.querySelector(".columns.run > .margin")!;
    const head = margin.querySelector(":scope > .runHead")!;
    const flow = margin.querySelector(":scope > .stageFlow")!;

    expect([...head.children].map((child) => child.className)).toEqual(["stageNo", "stagePack", "clocks", "runMenuBtn"]);
    expect(head.nextElementSibling).toBe(flow);

    const menu = head.querySelector<HTMLButtonElement>(".runMenuBtn")!;
    const pause = head.querySelector<HTMLButtonElement>('button[aria-label="Pause"]')!;
    expect(pause.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(pause);
    await flush();
    const resume = head.querySelector<HTMLButtonElement>('button[aria-label="Resume"]')!;
    expect(resume).toBeTruthy();
    expect(resume.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(resume);
    await flush();
    expect(head.querySelector('button[aria-label="Pause"]')).toBeTruthy();
  });
});

/** The rail's tab whose word is this one. */
function tab(root: HTMLElement, word: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("nav.runRail button.railTab")].find(
    (b) => (b.querySelector(".railWord")?.textContent ?? "") === word,
  );
  if (!found) throw new Error(`no tab reading ${word}`);
  return found as HTMLButtonElement;
}

function showing(root: HTMLElement): string | null {
  return root.querySelector(".columns.run")?.getAttribute("data-pane") ?? null;
}

describe("the rail switches planes", () => {
  it("writes which plane is showing where the sheet's own rules read it", async () => {
    const root = await screen();
    expect(showing(root)).toBe("now");
    fireEvent.click(tab(root, "Log"));
    expect(showing(root)).toBe("log");
    fireEvent.click(tab(root, "Board"));
    expect(showing(root)).toBe("board");
  });

  it("keeps the one thing to press on the Now plane", async () => {
    const root = await screen();
    const control = root.querySelector(".primary.big");
    expect(control).toBeTruthy();
    expect(root.querySelector(".columns.run > .col.wide")?.contains(control!)).toBe(true);
    // The rail is not inside a plane; it is the way between them.
    expect(root.querySelector(".columns.run")?.contains(root.querySelector("nav.runRail"))).toBe(false);
  });
});

describe("a plane keeps its place", () => {
  it("puts back where the plane you are opening was left", async () => {
    const root = await screen();
    scrolledTo(240);
    fireEvent.click(tab(root, "Log"));
    // The log has not been read yet, so it opens at its top.
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    scrolledTo(80);
    fireEvent.click(tab(root, "Now"));
    // Now is where it was left, not where the log was.
    expect(scrollTo).toHaveBeenLastCalledWith(0, 240);
    scrolledTo(240);
    fireEvent.click(tab(root, "Log"));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 80);
  });

  it("keeps each plane's place apart from the others", async () => {
    const root = await screen();
    scrolledTo(300);
    fireEvent.click(tab(root, "Board"));
    scrolledTo(50);
    fireEvent.click(tab(root, "Log"));
    scrolledTo(10);
    fireEvent.click(tab(root, "Board"));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 50);
  });

  /**
   * The page is kept mounted across a run ending and another starting in the
   * same pack, so a place kept has to belong to the run rather than to the
   * pack. It used to belong to the pack: a board left three hundred pixels
   * down opened three hundred pixels down in a run nobody had scrolled.
   */
  it("forgets where the planes were when another run of the pack takes over", async () => {
    const store = keeping();
    const root = await screen({ store });
    fireEvent.click(tab(root, "Board"));
    scrolledTo(300);
    fireEvent.click(tab(root, "Now"));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    await act(async () => {
      await store.saveRun({ ...saved("run2"), updatedAt: "2026-09-15T00:00:00.000Z" });
      store.setActiveRunFor(kiln.id, "run2");
      syncBus.pulled("run", ["run1"]);
    });
    await flush();
    expect(showing(root)).toBe("now");

    scrollTo.mockClear();
    fireEvent.click(tab(root, "Board"));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it("leaves the window alone where the columns are still columns", async () => {
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    const root = await screen();
    fireEvent.click(tab(root, "Board"));
    expect(showing(root)).toBe("board");
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("the keyboard lands on the plane that opened", () => {
  it("hands focus to the side column's first heading", async () => {
    const root = await screen();
    fireEvent.click(tab(root, "Board"));
    const side = root.querySelector(".columns.run > .col.side")!;
    expect(side.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toMatch(/^H[234]$/);
  });

  it("hands focus to the log rather than to the rest of its column", async () => {
    const root = await screen();
    fireEvent.click(tab(root, "Log"));
    const log = root.querySelector(".columns.run > .col.wide > .log")!;
    expect(log.contains(document.activeElement)).toBe(true);
  });

  it("never leaves focus on the page itself", async () => {
    const root = await screen();
    for (const word of ["Log", "Board", "Now"]) {
      fireEvent.click(tab(root, word));
      expect(document.activeElement).not.toBe(document.body);
    }
    expect(root.querySelector(".columns.run > .col.wide")?.contains(document.activeElement)).toBe(true);
  });

  /**
   * The sheet takes the ring off a heading the keyboard was put down on and
   * leaves it on one somebody tabbed to, which it tells apart with
   * `:focus-visible`. jsdom answers that pseudo-class the same way whoever
   * is asking, so the two cannot be told apart here; what is asserted is
   * the hook the rule keys on, and the ring itself is checked in a browser.
   */
  it("marks the heading it put the keyboard on, for the sheet to find", async () => {
    const root = await screen();
    fireEvent.click(tab(root, "Board"));
    const landed = document.activeElement as HTMLElement;
    expect(landed.hasAttribute("data-plane-head")).toBe(true);
    expect(landed.getAttribute("tabindex")).toBe("-1");
  });
});

describe("the rail says when another plane needs you", () => {
  /** A dial in the side column, turned up one. */
  function nudge(root: HTMLElement) {
    const up = [...root.querySelectorAll(".col.side button")].find((b) => b.textContent === "+");
    if (!up) throw new Error("no dial to turn in the side column");
    act(() => {
      fireEvent.click(up);
    });
  }

  it("marks the board when a tracker moved while another plane was showing", async () => {
    const root = await screen();
    fireEvent.click(tab(root, "Log"));
    expect(tab(root, "Board").querySelector(".railMark")).toBeNull();
    nudge(root);
    await flush(2);
    const board = tab(root, "Board");
    expect(board.querySelector(".railMark")).toBeTruthy();
    expect(board.textContent).toContain(", something new");
  });

  it("clears the mark once the board has been opened", async () => {
    const root = await screen();
    fireEvent.click(tab(root, "Log"));
    nudge(root);
    await flush(2);
    expect(tab(root, "Board").querySelector(".railMark")).toBeTruthy();
    fireEvent.click(tab(root, "Board"));
    await flush(2);
    expect(tab(root, "Board").querySelector(".railMark")).toBeNull();
    fireEvent.click(tab(root, "Log"));
    await flush(2);
    expect(tab(root, "Board").querySelector(".railMark")).toBeNull();
  });

  it("says nothing about the board while the board is the plane showing", async () => {
    const root = await screen();
    fireEvent.click(tab(root, "Board"));
    nudge(root);
    await flush(2);
    expect(tab(root, "Board").querySelector(".railMark")).toBeNull();
  });
});
