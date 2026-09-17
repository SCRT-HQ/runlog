// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredPack, StoredRun } from "../storage/db.ts";
import { LibraryView, type LibraryPack } from "./LibraryView.tsx";

/**
 * The shelf: what it puts first, and what each pack offers.
 *
 * The order is checked because it is the point of the screen: where you
 * left off, then your own packs, then what you might add. The card is
 * checked because a control that is missing is invisible in the markup
 * and a wrong one is a press away from losing something. In particular: a
 * pack has one thing to press and its errands are in the menu, a pack of
 * your own offers to take a newer file, a sealed copy does not, and the
 * card's picker will not take a sealed file at all.
 *
 * The runs come from storage, so storage is stood in for: the view reads
 * `listRuns` once and again whenever the sync bus says a run changed.
 */

/** What `listRuns` answers with in the test that is running. */
let stored: StoredRun[] = [];

vi.mock("../storage/db.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../storage/db.ts")>();
  return { ...real, listRuns: async () => stored };
});

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const source = readFileSync(join(repoRoot, "packs", "demo", "pack.yaml"), "utf8");

const record = (over: Partial<StoredPack>): StoredPack => ({
  id: "com.example.kiln",
  title: "Kiln Yard",
  version: "1.0.0",
  source,
  format: "yaml",
  filename: "kiln.yaml",
  importedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const shelf = (records: StoredPack[]): LibraryPack[] =>
  records.map((r) => ({ id: r.id, title: r.title, sub: `from your file, v${r.version}`, source: r.source, record: r }));

/** A run of the demo pack: going, or over where `ended` is given. */
const run = (runId: string, at: string, ended = false): StoredRun =>
  ({
    runId,
    packId: "com.example.kiln",
    packVersion: "1.0.0",
    events: [{ t: "RunStarted", at, packId: "com.example.kiln", packVersion: "1.0.0" }, ...(ended ? [{ t: "RunEnded", at }] : [])],
    updatedAt: at,
  }) as unknown as StoredRun;

const noop = () => {};

/** jsdom has no `URL.createObjectURL`; stand it in and say what was asked of it. */
function objectUrls(): string[] {
  const made: string[] = [];
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      made.push(blob.type);
      return "blob:deck";
    },
    revokeObjectURL: () => {},
  });
  return made;
}

const paint = (packs: LibraryPack[], withReplace = true) =>
  renderToStaticMarkup(
    <LibraryView
      packs={packs}
      activeId=""
      onOpen={noop}
      onContinue={noop}
      onStartAnother={noop}
      onForgetRun={noop}
      onForgetPack={noop}
      onFile={noop}
      onSyncToggle={noop}
      onMarketplace={noop}
      {...(withReplace ? { onReplace: noop } : {})}
    />,
  );

/** The shelf with everything it needs, and the props a case is about said over it. */
const renderLibrary = (over: Partial<Parameters<typeof LibraryView>[0]>) =>
  render(
    <LibraryView
      packs={[]}
      activeId=""
      onOpen={noop}
      onContinue={noop}
      onStartAnother={noop}
      onForgetRun={noop}
      onForgetPack={noop}
      onFile={noop}
      onSyncToggle={noop}
      onMarketplace={noop}
      {...over}
    />,
  );

/** The card's menu, opened the way somebody opens it. */
const openMore = () => fireEvent.click(screen.getByRole("button", { name: /More/ }));
const lines = () => screen.getAllByRole("menuitem").map((el) => el.textContent);

beforeEach(() => {
  stored = [];
});
afterEach(cleanup);

describe("the order of the page", () => {
  it("puts where you left off first, then the packs, then adding and discovering", () => {
    const html = paint(shelf([record({})]));
    const where = html.indexOf('aria-label="Where you are"');
    const pack = html.indexOf("libraryPack");
    const add = html.indexOf("Add and discover");
    expect(where).toBeGreaterThan(-1);
    expect(pack).toBeGreaterThan(where);
    expect(add).toBeGreaterThan(pack);
    // The one lead sentence stays, above everything.
    expect(html.indexOf("Newest played first.")).toBeLessThan(where);
  });

  it("keeps adding a pack and joining a race in that group, not in the header", () => {
    const html = paint(shelf([record({})]));
    expect(html.indexOf("Add and discover")).toBeLessThan(html.indexOf("Get more packs"));
    expect(html).toContain("Load a pack from a file");
  });

  it("offers a Start on the most recently opened pack when nothing has been played", () => {
    renderLibrary({ packs: shelf([record({})]) });
    const card = screen.getByLabelText("Where you are");
    expect(card.textContent).toContain("Kiln Yard");
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("says nothing above the packs when there are none, and the empty state carries it", () => {
    renderLibrary({ packs: [] });
    expect(screen.queryByLabelText("Where you are")).toBeNull();
    expect(screen.getByText(/No packs here yet/)).toBeTruthy();
  });
});

describe("a pack's card", () => {
  it("has one thing to press: a start, where nothing is going, and the menu beside it", () => {
    const { container } = renderLibrary({ packs: shelf([record({})]) });
    const card = container.querySelector(".libraryPack")!;
    const head = within(card.querySelector(".libraryPackActions") as HTMLElement);
    expect(head.getAllByRole("button").length).toBe(2);
    expect(head.getByRole("button", { name: "Start a firing" })).toBeTruthy();
    expect(head.getByRole("button", { name: /More/ })).toBeTruthy();
    // Quiet: the page's one filled action is the card at the top of it.
    expect(card.querySelectorAll(".primary").length).toBe(0);
  });

  it("continues the run that is going, rather than offering a second one", async () => {
    stored = [run("r1", "2026-09-01T10:00:00Z")];
    const picked: string[] = [];
    const { container } = renderLibrary({ packs: shelf([record({})]), onContinue: (_p, r) => picked.push(r.runId) });
    // The row of the run offers Continue too; this is about the one action
    // at the head of the card.
    const head = () => within(container.querySelector(".libraryPackActions") as HTMLElement);
    await waitFor(() => head().getByRole("button", { name: "Continue" }));
    expect(head().queryByRole("button", { name: /^Start/ })).toBeNull();
    fireEvent.click(head().getByRole("button", { name: "Continue" }));
    expect(picked).toEqual(["r1"]);
  });

  it("starts a new one where every run is over, and those rows offer their results", async () => {
    stored = [run("r1", "2026-09-01T10:00:00Z", true)];
    const { container } = renderLibrary({ packs: shelf([record({})]) });
    const card = () => within(container.querySelector(".libraryPack") as HTMLElement);
    await waitFor(() => card().getByRole("button", { name: "View results" }));
    expect(card().getByRole("button", { name: "Start a firing" })).toBeTruthy();
    expect(card().queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("shows three runs, and the rest where they are asked for", async () => {
    stored = ["05", "04", "03", "02", "01"].map((d, i) => run(`r${i}`, `2026-09-${d}T10:00:00Z`));
    const { container } = renderLibrary({ packs: shelf([record({})]) });
    await waitFor(() => expect(container.querySelectorAll(".runRow").length).toBe(3));
    fireEvent.click(screen.getByRole("button", { name: "All firings" }));
    expect(container.querySelectorAll(".runRow").length).toBe(5);
    expect(screen.queryByRole("button", { name: "All firings" })).toBeNull();
  });

  it("keeps a waiting update in sight, out of the menu", () => {
    const r = record({});
    renderLibrary({ packs: [{ id: r.id, title: r.title, sub: "v1.0.0", source: r.source, record: r, update: "2.0.0" }], onUpdate: noop });
    expect(screen.getByRole("button", { name: "Update to v2.0.0" })).toBeTruthy();
    openMore();
    expect(lines()).not.toContain("Update to v2.0.0");
  });
});

describe("the errands, in the menu", () => {
  it("holds the documents, the deck, the test and the file, with Forget last", () => {
    renderLibrary({ packs: shelf([record({})]), onTest: noop, onReplace: noop });
    openMore();
    const named = lines();
    expect(named).toContain("Summary");
    expect(named).toContain("Rulebook");
    expect(named).toContain("Stream Deck profile");
    expect(named).toContain("Test");
    expect(named).toContain("Replace from a file");
    expect(named.at(-1)).toBe("Forget pack");
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("offers to take a newer file of a pack that is yours, and says the runs stay", () => {
    const { container } = renderLibrary({ packs: shelf([record({})]), onReplace: noop });
    openMore();
    const replace = screen.getByRole("menuitem", { name: "Replace from a file" });
    expect(replace.getAttribute("title")).toMatch(/Load a newer file of Kiln Yard; its [a-z]+ are kept/);
    expect(container.querySelector("input[type=file][hidden]")).toBeTruthy();
  });

  it("will not take a sealed file in a pack's place", () => {
    const { container } = renderLibrary({ packs: shelf([record({})]), onReplace: noop });
    const picker = container.querySelector("input[type=file][hidden]")!;
    expect(picker.getAttribute("accept")).toBe(".yaml,.yml,.json");
  });

  it("does not offer it for a sealed copy, whose update is the publisher's", () => {
    renderLibrary({ packs: shelf([record({ id: "com.example.sealed", title: "Sealed Copy", sealed: true })]), onReplace: noop });
    openMore();
    expect(lines()).not.toContain("Replace from a file");
    expect(lines()).toContain("Forget pack");
  });

  it("does not offer it where nothing would take the file", () => {
    renderLibrary({ packs: shelf([record({})]) });
    openMore();
    expect(lines()).not.toContain("Replace from a file");
  });

  it("keeps the shelf-wide picker, which still takes a sealed copy", () => {
    const html = paint(shelf([record({})]));
    expect(html).toContain("Load a pack from a file");
    expect(html).toContain('accept=".yaml,.yml,.json,.rlpack"');
  });

  it("forgets the pack from the menu's last line", () => {
    const forgotten: string[] = [];
    renderLibrary({ packs: shelf([record({})]), onForgetPack: (r) => forgotten.push(r.id) });
    openMore();
    fireEvent.click(screen.getByRole("menuitem", { name: "Forget pack" }));
    expect(forgotten).toEqual(["com.example.kiln"]);
  });
});

describe("a Stream Deck profile from a library pack", () => {
  it("offers the decks in the menu and builds the download with the demo pack", async () => {
    const made = objectUrls();
    const clicks: string[] = [];
    const press = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    try {
      renderLibrary({ packs: shelf([record({})]), onReplace: noop });
      openMore();
      fireEvent.click(screen.getByRole("menuitem", { name: "Stream Deck profile" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Mini" }));
      await waitFor(() => expect(clicks).toEqual(["com.scrthq.runlog.long-kiln-mini.streamDeckProfile"]));
      expect(made).toEqual(["application/zip"]);
    } finally {
      press.mockRestore();
    }
  });
});

describe("a seat on the shelf", () => {
  it("lists a run this account plays but has no pack for, as a seat", () => {
    const taken: string[] = [];
    const seat: StoredRun = {
      runId: "r1",
      packId: "com.example.kiln",
      packVersion: "1",
      packTitle: "The Long Kiln",
      events: [],
      updatedAt: "",
      role: "player",
    };
    renderLibrary({ packs: [], seats: [seat], onTakeSeat: (r) => taken.push(r.runId) });

    expect(screen.getByText("The Long Kiln")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take your seat" }));
    expect(taken).toEqual(["r1"]);
  });
});
