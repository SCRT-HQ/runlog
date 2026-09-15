// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import YAML from "yaml";
import demo from "../../../../packs/demo/pack.yaml?raw";
import { DeckProfiles } from "./DeckProfiles.tsx";

/**
 * The download a pack's own page offers.
 *
 * What comes out of the builder is held against the profiles the plugin
 * ships in `packages/deck-profiles`, byte for byte, so what is checked here
 * is the other half: that the row asks for the pack once and only when
 * somebody opens it, that pressing a deck gets as far as handing the
 * browser a file, and that the two ways there is no download tell a reader
 * apart. A pack with nothing of its own to lay out draws no row; a pack
 * that could not be read says so and stays.
 *
 * jsdom has no `URL.createObjectURL`, so it is stood in for; without it the
 * press would throw and the test would be about jsdom rather than this.
 */

afterEach(cleanup);

/**
 * A pack that reads perfectly well and has nothing to put on a deck.
 *
 * Not the demo pack with its moves cut out: its tables and modes name the
 * counters those moves move, so what came back was a pack that does not
 * parse, which is the other answer entirely.
 */
const bare = YAML.stringify({
  schemaVersion: 1,
  id: "dev.runlog.bare",
  version: "1.0.0",
  title: "Bare",
  license: { id: "CC0-1.0", redistributable: true },
  capabilities: [],
  vocabulary: {
    run: { one: "Run", many: "Runs" },
    unit: { one: "Unit", many: "Units" },
    subject: { one: "Subject", many: "Subjects" },
  },
  tables: {
    simple: {
      resolution: "lookup",
      title: "Simple",
      roll: "d6",
      entries: [
        { id: "a", range: [1, 3], text: "low" },
        { id: "b", range: [4, 6], text: "high" },
      ],
    },
  },
  phases: [{ id: "only", label: "Only", steps: [{ kind: "finalizeUnit" }] }],
  modes: { standard: { label: "Standard" } },
  defaultMode: "standard",
});

/** Stand in for the object URLs jsdom does not make, and say what was asked of them. */
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

/** Open the row, the way a reader does. */
const open = () => fireEvent.click(screen.getByText("Stream Deck profile"));

describe("a Stream Deck profile from a pack's page", () => {
  it("does not read the pack until somebody opens the row", async () => {
    const load = vi.fn(async () => demo);
    render(<DeckProfiles load={load} />);
    expect(load).not.toHaveBeenCalled();
    open();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  });

  it("offers one download per deck", async () => {
    render(<DeckProfiles load={async () => demo} />);
    open();
    await waitFor(() => screen.getByRole("button", { name: "XL" }));
    for (const label of ["XL", "Stream Deck", "Mini", "+"]) expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });

  it("reads the pack once, however often the row is opened", async () => {
    const load = vi.fn(async () => demo);
    render(<DeckProfiles load={load} />);
    // Three toggles before the first read has a chance to answer, and two
    // more once it has: neither should send for the text again.
    open();
    open();
    open();
    await waitFor(() => screen.getByRole("button", { name: "XL" }));
    open();
    open();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("builds the file and hands it to the browser, saying so while it does", async () => {
    const made = objectUrls();
    const clicks: string[] = [];
    const press = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    try {
      render(<DeckProfiles load={async () => demo} />);
      open();
      await waitFor(() => screen.getByRole("button", { name: "Mini" }));
      fireEvent.click(screen.getByRole("button", { name: "Mini" }));
      // The pressed key says what it is doing; the others are only disabled.
      expect(screen.getByRole("button", { name: "Building…" })).toBeTruthy();
      expect((screen.getByRole("button", { name: "XL" }) as HTMLButtonElement).disabled).toBe(true);
      await waitFor(() => expect(clicks).toEqual(["com.scrthq.runlog.long-kiln-mini.streamDeckProfile"]));
      expect(made).toEqual(["application/zip"]);
      await waitFor(() => screen.getByRole("button", { name: "Mini" }));
    } finally {
      press.mockRestore();
    }
  });

  it("says so where the pack could not be read, and stays open about it", async () => {
    // A fetch that did not answer is not the same as a pack with nothing to
    // lay out. Hiding the row here would tell somebody this pack has no
    // keys when nobody knows whether it does.
    render(<DeckProfiles load={async () => Promise.reject(new Error("offline"))} />);
    open();
    await waitFor(() => screen.getByText("Could not read the pack."));
    expect(screen.getByText("Stream Deck profile")).toBeTruthy();
  });

  it("says the same where the pack's text does not parse", async () => {
    render(<DeckProfiles load={async () => "id: not-a-pack"} />);
    open();
    await waitFor(() => screen.getByText("Could not read the pack."));
  });

  it("draws nothing for a pack with nothing of its own to lay out", async () => {
    const { container } = render(<DeckProfiles load={async () => bare} />);
    open();
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
