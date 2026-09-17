// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredPack, StoredRun } from "../storage/db.ts";
import { LibraryView, type LibraryPack } from "./LibraryView.tsx";

/**
 * The shelf at first paint, rendered static: no storage read, no server.
 *
 * What is checked is which controls each row offers, since a control that
 * is missing is invisible in the markup and a wrong one is a press away
 * from losing something. In particular: a pack of your own offers to take
 * a newer file, a sealed copy does not, and the row's picker will not take
 * a sealed file at all.
 */

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

describe("a pack's row", () => {
  it("offers to take a newer file of a pack that is yours, and says the runs stay", () => {
    const html = paint(shelf([record({})]));
    expect(html).toContain("Replace from a file");
    expect(html).toMatch(/Load a newer file of Kiln Yard; its [a-z]+ are kept/);
    expect(html).toContain("Forget pack");
  });

  it("will not take a sealed file in a pack's place", () => {
    const html = paint(shelf([record({})]));
    const picker = html.match(/<label class="ghost tiny fileButton"[^>]*>Replace from a file<input[^>]*>/)?.[0] ?? "";
    expect(picker).toContain('accept=".yaml,.yml,.json"');
    expect(picker).not.toContain(".rlpack");
  });

  it("does not offer it for a sealed copy, whose update is the publisher's", () => {
    const html = paint(shelf([record({ id: "com.example.sealed", title: "Sealed Copy", sealed: true })]));
    expect(html).not.toContain("Replace from a file");
    expect(html).toContain("Forget pack");
  });

  it("does not offer it where nothing would take the file", () => {
    expect(paint(shelf([record({})]), false)).not.toContain("Replace from a file");
  });

  it("keeps the shelf-wide picker, which still takes a sealed copy", () => {
    const html = paint(shelf([record({})]));
    expect(html).toContain("Load a pack from a file");
    expect(html).toContain('accept=".yaml,.yml,.json,.rlpack"');
  });
});

describe("a Stream Deck profile from a library pack", () => {
  it("shows the row and builds the download with the demo pack", async () => {
    const made = objectUrls();
    const clicks: string[] = [];
    const press = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    try {
      render(
        <LibraryView
          packs={shelf([record({})])}
          activeId=""
          onOpen={noop}
          onContinue={noop}
          onStartAnother={noop}
          onForgetRun={noop}
          onForgetPack={noop}
          onFile={noop}
          onSyncToggle={noop}
          onMarketplace={noop}
          onReplace={noop}
        />,
      );
      fireEvent.click(screen.getByText("Stream Deck profile"));
      await waitFor(() => screen.getByRole("button", { name: "Mini" }));
      fireEvent.click(screen.getByRole("button", { name: "Mini" }));
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
