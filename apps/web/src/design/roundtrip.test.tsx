// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import fixture from "./__fixtures__/round-trip.yaml?raw";
import { parsePack } from "@runlog/rules-schema";
import { loadDraft, saveDraft } from "../storage/db.ts";
import type { Draft } from "./draft.ts";
import { DesignView } from "./DesignView.tsx";

vi.mock("../storage/db.ts", () => ({
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The fixture's own text, with line endings as the YAML writer produces them: a Windows checkout is not a difference in the pack. */
const SOURCE = fixture.replace(/\r\n/g, "\n");

/**
 * What the editor does not edit, it must not lose.
 *
 * Most of the schema has no control in the Designer: a deck, a state, the
 * per-unit overrides in a mode, the notice on a license. The draft is a
 * raw object precisely so those survive, but nothing proved it, and the
 * change most likely to break it is the one that moves panels between
 * files and then only draws the section you are looking at. So: open a
 * pack carrying every such field, change one thing through the same path
 * the fields use, walk every section, and demand the YAML back byte for
 * byte apart from that one change.
 */
describe("a pack the editor does not fully understand, opened and handed back", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    history.replaceState(null, "", "/");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(saveDraft).mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(loadDraft).mockReset();
    vi.mocked(saveDraft).mockReset();
  });

  it("is a pack that loads, so nothing here is proved by an error", () => {
    expect(parsePack(YAML.parse(SOURCE)).diagnostics).toEqual([]);
  });

  it("keeps every field the editor has no control for", async () => {
    vi.mocked(loadDraft).mockResolvedValue({
      id: "current",
      pack: YAML.parse(SOURCE) as Draft,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await act(async () => {
      root.render(<DesignView />);
    });
    // Past the door, which any pack that is not the blank one meets.
    const door = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Continue editing"));
    await act(async () => {
      door!.click();
    });

    // One edit, through the field the UI writes through.
    const title = Array.from(container.querySelectorAll<HTMLElement>(".field"))
      .find((f) => f.querySelector(".fieldLabel")?.textContent === "Title")!
      .querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Round Trip, Edited");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Every section, in order, then back to the first.
    for (const label of ["Tables", "Flow", "Modes", "Test", "Publish", "Overview"]) {
      const item = Array.from(container.querySelectorAll<HTMLButtonElement>(".designNavItem")).find((b) =>
        (b.textContent ?? "").startsWith(label),
      )!;
      await act(async () => {
        item.click();
      });
    }

    const saves = vi.mocked(saveDraft).mock.calls;
    expect(saves).toHaveLength(1);
    const kept = saves[0]![0]!.pack;

    // The same bytes the file carried, with the one edit in the place the
    // title was, which is what a download of this draft would write.
    const expected = YAML.stringify({ ...YAML.parse(SOURCE), title: "Round Trip, Edited" }, { lineWidth: 90 });
    expect(YAML.stringify(kept, { lineWidth: 90 })).toBe(expected);
    // And the fixture itself is written the way the editor writes YAML, so
    // that comparison is against the file on disk and not a reformatting.
    expect(YAML.stringify(YAML.parse(SOURCE), { lineWidth: 90 })).toBe(SOURCE);
  });
});
