// @vitest-environment jsdom
import { createThemeRecordFromPreset, presentationSnapshotKey, resolveThemeRecord } from "@runlog/themes";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_ONLY_SYNC } from "./sync/view.ts";
import type { ThemeContextValue } from "./ThemeProvider.tsx";
import type { SavedThemeRow, StoredThemeDraft } from "./themeStorage.ts";

const mocks = vi.hoisted(() => ({
  context: null as unknown as ThemeContextValue,
  review: vi.fn(async () => true),
  analyze: vi.fn(() => null),
}));

vi.mock("./ThemeProvider.tsx", () => ({ useThemes: () => mocks.context }));
vi.mock("./ThemeContrastReview.tsx", async (original) => {
  const React = await import("react");
  const real = await original<typeof import("./ThemeContrastReview.tsx")>();
  return {
    ...real,
    useThemeContrastReview: () => {
      const [, setRevision] = React.useState(0);
      const analyze = React.useCallback((...args: Parameters<typeof mocks.analyze>) => {
        const result = mocks.analyze(...args);
        setRevision((before) => before + 1);
        return result;
      }, []);
      const review = React.useCallback((...args: Parameters<typeof mocks.review>) => mocks.review(...args), []);
      return {
        report: null,
        acknowledgementKey: null,
        problem: null,
        dialog: null,
        review,
        analyze,
      };
    },
  };
});

import { ThemeStudio } from "./ThemeStudio.tsx";

function row(id = "mine", name = "My local theme", localRevision = 3): SavedThemeRow {
  const record = createThemeRecordFromPreset({ id, name, presetId: "daylight" });
  if (!record.ok) throw new Error("invalid fixture");
  return { kind: "saved", id, localRevision, record: record.value };
}

function stored(saved: SavedThemeRow): StoredThemeDraft {
  return {
    id: "draft_recovery",
    localRevision: 2,
    draft: {
      schemaVersion: 1,
      id: "draft_recovery",
      sourceThemeId: saved.id,
      baseLocalRevision: saved.localRevision,
      record: saved.record,
      rawName: "Recovered raw name",
      rawColors: { "text.primary": "#12" },
    },
  };
}

function context(library: readonly SavedThemeRow[] = [row()]): ThemeContextValue {
  return {
    scopeKey: "anon:themes",
    status: "ready",
    library,
    drafts: [],
    problem: null,
    applied: { schemaVersion: 1, mode: "system" },
    appliedSource: null,
    sourceRemoved: false,
    reload: vi.fn(async () => {}),
    saveTheme: vi.fn(async ({ record, expectedLocalRevision }) => ({
      ok: true as const,
      value: { kind: "saved" as const, id: record.id, localRevision: (expectedLocalRevision ?? 0) + 1, record },
    })),
    deleteTheme: vi.fn(async () => ({ ok: true as const, value: { kind: "deleted" as const, id: "mine", localRevision: 4 } })),
    saveDraft: vi.fn(async ({ draft }) => ({ ok: true as const, value: { id: draft.id, localRevision: 1, draft } })),
    deleteDraft: vi.fn(async () => ({ ok: true as const, value: null })),
    finalizeDraft: vi.fn(async ({ record }) => ({
      ok: true as const,
      value: { kind: "saved" as const, id: record.id, localRevision: 1, record },
    })),
    applySystem: vi.fn(async () => {}),
    applyBuiltin: vi.fn(async () => {}),
    applySaved: vi.fn(async () => {}),
    sync: DEVICE_ONLY_SYNC,
  };
}

beforeEach(() => {
  mocks.context = context();
  mocks.review.mockClear();
  mocks.analyze.mockClear();
});

afterEach(cleanup);

describe("theme studio integration", () => {
  it("inherits the applied chrome by default and opens a registry-complete editor without changing the root", () => {
    const rootBefore = document.documentElement.style.cssText;
    render(<ThemeStudio onBack={vi.fn()} registerLeaveGuard={vi.fn()} />);

    const studio = screen.getByRole("main");
    expect(studio.classList.contains("themeStudioControl")).toBe(false);
    expect(studio.style.length).toBe(0);
    expect(screen.getByRole("heading", { name: "My local theme" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create theme" }));
    expect(screen.getByRole("heading", { name: "Edit theme" })).toBeTruthy();
    expect(document.querySelectorAll("[data-color-role]")).toHaveLength(28);
    expect(document.querySelectorAll("[data-font-role]")).toHaveLength(10);
    expect(document.documentElement.style.cssText).toBe(rootBefore);
  });

  it("offers one way back from the editor, to the list, and leaves the studio only from the list", async () => {
    const onBack = vi.fn();
    render(<ThemeStudio onBack={onBack} registerLeaveGuard={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create theme" }));
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to themes" }));
    // A new theme is unsaved work, so leaving asks first.
    fireEvent.click(await screen.findByRole("button", { name: "Discard and leave" }));
    expect(await screen.findByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Edit theme" })).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("toggles safe colors locally without losing the draft or changing the applied appearance", () => {
    const rootBefore = document.documentElement.style.cssText;
    render(<ThemeStudio onBack={vi.fn()} registerLeaveGuard={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create theme" }));
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Draft survives" } });
    const studio = screen.getByRole("main");
    const toggle = screen.getByRole("button", { name: "Use safe editor colors" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.querySelector(".pickMark")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.querySelector(".pickMark svg")).not.toBeNull();
    expect(studio.classList.contains("themeStudioControl")).toBe(true);
    expect(studio.style.length).toBeGreaterThan(0);
    expect((screen.getByLabelText("Theme name") as HTMLInputElement).value).toBe("Draft survives");
    expect(document.documentElement.style.cssText).toBe(rootBefore);

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.querySelector(".pickMark")).toBeNull();
    expect(studio.classList.contains("themeStudioControl")).toBe(false);
    expect(studio.style.length).toBe(0);
    expect((screen.getByLabelText("Theme name") as HTMLInputElement).value).toBe("Draft survives");
    expect(document.documentElement.style.cssText).toBe(rootBefore);
    expect(mocks.context.applySystem).not.toHaveBeenCalled();
    expect(mocks.context.applyBuiltin).not.toHaveBeenCalled();
    expect(mocks.context.applySaved).not.toHaveBeenCalled();
  });

  it("analyzes an unchanged editor snapshot once even when the contrast hook rerenders its owner", async () => {
    render(<ThemeStudio onBack={vi.fn()} registerLeaveGuard={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit a copy of Stardust" }));

    await waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));
  });

  it("hides the old account editor synchronously when the provider scope changes", () => {
    const view = render(<ThemeStudio onBack={vi.fn()} registerLeaveGuard={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit My local theme" }));
    expect(screen.getByDisplayValue("My local theme")).toBeTruthy();

    mocks.context = { ...context([]), scopeKey: "account:new:themes" };
    view.rerender(<ThemeStudio onBack={vi.fn()} registerLeaveGuard={vi.fn()} />);
    expect(screen.queryByDisplayValue("My local theme")).toBeNull();
    expect(screen.queryByRole("heading", { name: "My local theme" })).toBeNull();
  });

  it("labels an applied custom snapshot as retained when its saved source advances without Apply", () => {
    const applied = row("mine", "Applied revision", 3);
    const newer = row("mine", "Newer saved revision", 4);
    const resolved = resolveThemeRecord(applied.record);
    if (!resolved.ok) throw new Error("invalid applied fixture");
    mocks.context = {
      ...context([newer]),
      applied: { schemaVersion: 1, mode: "snapshot", snapshot: resolved.value },
      appliedSource: {
        schemaVersion: 1,
        id: applied.id,
        localRevision: applied.localRevision,
        snapshotKey: presentationSnapshotKey(resolved.value),
      },
      sourceRemoved: false,
    };

    render(<ThemeStudio onBack={vi.fn()} registerLeaveGuard={vi.fn()} />);

    expect(screen.getByText('Using an earlier version of "Newer saved revision". Apply it to use your latest changes.')).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Newer saved revision" }).closest("article")?.textContent).not.toContain("Applied");
  });

  it("keeps the real guard registered until Save draft finishes, then closes the editor for same-view navigation", async () => {
    let guard: (() => Promise<boolean>) | null = null;
    render(
      <ThemeStudio
        onBack={vi.fn()}
        registerLeaveGuard={(next) => {
          guard = next;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create theme" }));
    await waitFor(() => expect(guard).not.toBeNull());

    const result = guard!();
    fireEvent.click(await screen.findByRole("button", { name: "Save draft and leave" }));
    await expect(result).resolves.toBe(true);
    expect(mocks.context.saveDraft).toHaveBeenCalled();
    await screen.findByRole("heading", { name: "Your themes" });
    await waitFor(() => expect(guard).toBeNull());
  });

  it("restores invalid raw drafts and gates saved custom application through shared contrast review", async () => {
    const saved = row();
    mocks.context = { ...context([saved]), drafts: [stored(saved)] };
    render(<ThemeStudio onBack={vi.fn()} registerLeaveGuard={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Restore draft Recovered raw name" }));
    expect((screen.getByLabelText("Primary text") as HTMLInputElement).value).toBe("#12");
    expect(screen.getByText(/exports the last valid theme/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to themes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to themes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard and leave" }));
    await screen.findByRole("heading", { name: "Your themes" });
    fireEvent.click(screen.getByRole("button", { name: "Apply My local theme" }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalled());
    expect(mocks.context.applySaved).toHaveBeenCalledWith("mine", 3);
  });

  it("keeps a single library watch across sync reports that swap the sync object's identity without changing its mode", () => {
    const watchLibrary = vi.fn();
    const unsubscribe = vi.fn();
    watchLibrary.mockReturnValue(unsubscribe);
    const freshSync = () => ({ ...DEVICE_ONLY_SYNC, mode: "device" as const, watchLibrary });

    mocks.context = { ...context(), sync: freshSync() };
    const view = render(<ThemeStudio onBack={vi.fn()} registerLeaveGuard={vi.fn()} />);
    expect(watchLibrary).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    mocks.context = { ...mocks.context, sync: freshSync() };
    view.rerender(<ThemeStudio onBack={vi.fn()} registerLeaveGuard={vi.fn()} />);
    mocks.context = { ...mocks.context, sync: freshSync() };
    view.rerender(<ThemeStudio onBack={vi.fn()} registerLeaveGuard={vi.fn()} />);

    expect(watchLibrary).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Create theme" }));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
