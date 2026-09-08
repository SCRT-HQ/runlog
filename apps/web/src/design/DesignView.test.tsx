// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDraft, saveDraft } from "../storage/db.ts";
import { blankPack, type Draft } from "./draft.ts";
import { DesignView } from "./DesignView.tsx";

vi.mock("../storage/db.ts", () => ({
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
}));

// react-dom looks for this flag before it will run effects inside act();
// without it, the load effect fires but React warns as though it did not.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The Designer used to load whatever draft was last open and jump straight
 * into it, so pressing the header's Designer button after finishing one
 * pack landed you back inside it — not the blank start a second pack needs.
 * These render the real load effect (mocking only the storage it reads
 * from) and drive the door's buttons, because the bug lived in the
 * combination of what loaded and what got shown, not in either alone.
 */
describe("which pack the Designer opens on", () => {
  const spyOnConfirm = () => vi.spyOn(window, "confirm").mockReturnValue(true);

  let root: Root;
  let container: HTMLDivElement;
  let confirmSpy: ReturnType<typeof spyOnConfirm>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    confirmSpy = spyOnConfirm();
    vi.mocked(saveDraft).mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    confirmSpy.mockRestore();
    vi.mocked(loadDraft).mockReset();
    vi.mocked(saveDraft).mockReset();
  });

  async function mount(stored: Draft | null) {
    vi.mocked(loadDraft).mockResolvedValue(
      stored ? { id: "current", pack: stored, updatedAt: "2026-01-01T00:00:00Z" } : null,
    );
    await act(async () => {
      root.render(<DesignView />);
    });
  }

  const buttonLabeled = (text: string) =>
    Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);

  it("asks which pack when a real draft is waiting", async () => {
    await mount({ ...blankPack(), title: "Two-Line Days" });
    expect(container.textContent).toContain("Which pack?");
    expect(container.textContent).toContain("Continue editing Two-Line Days");
    expect(buttonLabeled("New pack")).toBeDefined();
    expect(container.textContent).not.toContain("Download");
  });

  it("goes straight to the editor for a blank draft", async () => {
    await mount(blankPack());
    expect(container.textContent).not.toContain("Which pack?");
    expect(container.textContent).toContain("Download");
  });

  it("goes straight to the editor when nothing was ever saved", async () => {
    await mount(null);
    expect(container.textContent).not.toContain("Which pack?");
    expect(container.textContent).toContain("Download");
  });

  it("replaces the draft and opens the editor once New pack is confirmed", async () => {
    await mount({ ...blankPack(), title: "Two-Line Days" });
    expect(container.textContent).toContain("Which pack?");

    await act(async () => {
      buttonLabeled("New pack")!.click();
    });

    expect(confirmSpy).toHaveBeenCalledWith("Start a new pack? The current draft is replaced.");
    expect(container.textContent).not.toContain("Which pack?");
    expect(container.textContent).toContain("Download");
    // Replaced, not merely dismissed: the title is the blank pack's own.
    expect(container.textContent).toContain("My Game");
    expect(saveDraft).toHaveBeenCalled();
  });

  it("leaves the draft alone and opens the editor when Continue is chosen", async () => {
    await mount({ ...blankPack(), title: "Two-Line Days" });

    await act(async () => {
      buttonLabeled("Continue editing Two-Line Days")!.click();
    });

    expect(container.textContent).not.toContain("Which pack?");
    expect(container.textContent).toContain("Two-Line Days");
    expect(container.textContent).toContain("Download");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("declining New pack's confirm leaves the door open", async () => {
    confirmSpy.mockReturnValue(false);
    await mount({ ...blankPack(), title: "Two-Line Days" });

    await act(async () => {
      buttonLabeled("New pack")!.click();
    });

    expect(container.textContent).toContain("Which pack?");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("puts New pack first in the editor's header row, ahead of the file and sharing actions", async () => {
    await mount(blankPack());
    const labels = Array.from(container.querySelectorAll(".headerActions button")).map((b) => b.textContent);
    expect(labels[0]).toBe("New pack");
    expect(labels[1]).toBe("Open a file…");
    expect(labels[2]).toBe("Start from a pack…");
    expect(labels[3]).toMatch(/^Download/);
    expect(labels[4]).toBe("Copy a link");
  });
});
