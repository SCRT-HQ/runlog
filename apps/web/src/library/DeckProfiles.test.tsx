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
 * is the other half: that the row asks for the pack only when somebody
 * opens it, that a pack with nothing of its own to lay out draws no row at
 * all, and that pressing a deck gets as far as handing the browser a file.
 * jsdom has no `URL.createObjectURL`, so it is stood in for; without it the
 * press would throw and the test would be about jsdom rather than this.
 */

afterEach(cleanup);

/** The demo pack with its moves, counters and resources taken out. */
const bare = YAML.stringify({ ...(YAML.parse(demo) as object), counters: undefined, resources: undefined, moves: undefined });

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

  it("builds the file and hands it to the browser", async () => {
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
      await waitFor(() => expect(clicks).toEqual(["com.scrthq.runlog.long-kiln-mini.streamDeckProfile"]));
      expect(made).toEqual(["application/zip"]);
    } finally {
      press.mockRestore();
    }
  });

  it("draws nothing for a pack with nothing of its own to lay out", async () => {
    const { container } = render(<DeckProfiles load={async () => bare} />);
    open();
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
