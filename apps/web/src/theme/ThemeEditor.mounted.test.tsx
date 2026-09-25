// @vitest-environment jsdom
import { COLOR_DEFINITIONS, FONT_DEFINITIONS, FONT_ROLE_DEFINITIONS, createThemeRecordFromPreset, isFontAllowed } from "@runlog/themes";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThemeDraftV1 } from "./themeDraft.ts";
import { ThemeEditor, type ThemeEditorCommands, type ThemeEditorLeaveState } from "./ThemeEditor.tsx";
import type { SavedThemeRow, StoredThemeDraft } from "./themeStorage.ts";

function draft(source = true): ThemeDraftV1 {
  const record = createThemeRecordFromPreset({ id: "theme_one", name: "Theme one", presetId: "daylight", contentRevision: 4 });
  if (!record.ok) throw new Error("invalid fixture");
  return {
    schemaVersion: 1,
    id: "draft_one",
    sourceThemeId: source ? "theme_one" : null,
    baseLocalRevision: source ? 3 : null,
    record: record.value,
    rawName: "Theme one",
    rawColors: {},
  };
}

function stored(value = draft(), localRevision = 7): StoredThemeDraft {
  return { id: value.id, localRevision, draft: value };
}

function saved(value: ThemeDraftV1, localRevision = 4): SavedThemeRow {
  return { kind: "saved", id: value.record.id, localRevision, record: value.record };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function commands(): ThemeEditorCommands {
  return {
    saveDraft: vi.fn(async ({ draft: value }) => ({ ok: true as const, value: stored(value, 8) })),
    deleteDraft: vi.fn(async () => ({ ok: true as const, value: null })),
    finalizeDraft: vi.fn(async ({ record }) => ({
      ok: true as const,
      value: { kind: "saved" as const, id: record.id, localRevision: 4, record },
    })),
    applySaved: vi.fn(async () => {}),
    reviewContrast: vi.fn(async () => true),
    analyzeContrast: vi.fn(() => null),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("theme editor", () => {
  it("renders every registered color and font role with public keys, inherited values and curated font choices", () => {
    render(<ThemeEditor scopeKey="anon:themes" initialDraft={draft()} storedDraft={stored()} commands={commands()} onClose={vi.fn()} />);

    expect(document.querySelectorAll("[data-color-role]")).toHaveLength(COLOR_DEFINITIONS.length);
    expect(document.querySelectorAll("[data-font-role]")).toHaveLength(FONT_ROLE_DEFINITIONS.length);
    for (const definition of COLOR_DEFINITIONS) {
      const control = screen.getByLabelText(definition.label);
      expect(control.classList.contains("textInput")).toBe(true);
      expect(control.closest("[data-color-role]")?.textContent).toContain(definition.id);
      expect(screen.getByRole("button", { name: `Reset ${definition.label}` })).toBeTruthy();
    }
    for (const definition of FONT_ROLE_DEFINITIONS) {
      const select = screen.getByLabelText(definition.label);
      expect(select.classList.contains("textInput")).toBe(true);
      const values = Array.from(select.querySelectorAll("option"))
        .map((option) => option.value)
        .filter(Boolean);
      expect(values).toEqual(FONT_DEFINITIONS.filter(({ id }) => isFontAllowed(definition.id, id)).map(({ id }) => id));
      expect(select.closest("[data-font-role]")?.textContent).toContain(definition.id);
    }
    expect((screen.getByLabelText("Success background") as HTMLInputElement).placeholder).toBe("Derived");
    expect(screen.getByLabelText("Theme name").classList.contains("textInput")).toBe(true);
  });

  it("gives every color a swatch that opens the color picker and writes hex back into the field", () => {
    render(<ThemeEditor scopeKey="anon:themes" initialDraft={draft()} storedDraft={stored()} commands={commands()} onClose={vi.fn()} />);
    for (const definition of COLOR_DEFINITIONS) {
      const swatch = screen.getByLabelText(`Pick ${definition.label}`) as HTMLInputElement;
      expect(swatch.type).toBe("color");
      expect(swatch.value).toMatch(/^#[0-9a-f]{6}$/);
    }
    const field = screen.getByLabelText("Primary text") as HTMLInputElement;
    const swatch = screen.getByLabelText("Pick Primary text") as HTMLInputElement;
    expect(swatch.value).toBe(field.value.toLowerCase());
    fireEvent.change(swatch, { target: { value: "#336699" } });
    expect(field.value).toBe("#336699");
    // Typed without its #, a hex color still reads, and the swatch follows it.
    fireEvent.change(field, { target: { value: "a1b2c3" } });
    expect(field.value).toBe("#a1b2c3");
    expect(swatch.value).toBe("#a1b2c3");
    // Half typed, the swatch keeps the last color that read.
    fireEvent.change(field, { target: { value: "#a1" } });
    expect(swatch.value).toBe("#a1b2c3");
  });

  it("shows the base color beside its value, and no chip for a derived one", () => {
    render(<ThemeEditor scopeKey="anon:themes" initialDraft={draft()} storedDraft={stored()} commands={commands()} onClose={vi.fn()} />);
    const primary = document.querySelector('[data-color-role="text.primary"] .themeBaseSwatch') as HTMLElement | null;
    expect(primary).not.toBeNull();
    expect(primary!.style.backgroundColor).not.toBe("");
    expect(primary!.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector('[data-color-role="feedback.successBackground"] .themeBaseSwatch')).toBeNull();
  });

  it("retains invalid raw input, keeps the root unchanged, and flushes the current draft before Save", async () => {
    const on = commands();
    const rootBefore = document.documentElement.style.cssText;
    render(<ThemeEditor scopeKey="anon:themes" initialDraft={draft()} storedDraft={stored()} commands={on} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Primary text"), { target: { value: "#12" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save and apply" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Primary text") as HTMLInputElement).value).toBe("#12");
    expect(screen.getByText(/Invalid opaque color/)).toBeTruthy();
    expect(document.documentElement.style.cssText).toBe(rootBefore);

    fireEvent.click(screen.getByRole("button", { name: "Reset Primary text" }));
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Saved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved on this device");
    expect(on.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ expectedLocalRevision: 7 }));
    expect(on.finalizeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "draft_one", expectedDraftRevision: 8, expectedLocalRevision: 3 }),
    );
    expect(on.applySaved).not.toHaveBeenCalled();
    expect(document.documentElement.style.cssText).toBe(rootBefore);
  });

  it("completes a Save after StrictMode replays the editor lifecycle", async () => {
    const on = commands();
    render(
      <StrictMode>
        <ThemeEditor scopeKey="anon:themes" initialDraft={draft()} storedDraft={stored()} commands={on} onClose={vi.fn()} />
      </StrictMode>,
    );

    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Strictly saved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved on this device");
    expect(on.finalizeDraft).toHaveBeenCalledOnce();
  });

  it("serializes debounced writes and exposes leave save/discard transactions without clearing dirty early", async () => {
    vi.useFakeTimers();
    const on = commands();
    const leaveStates: ThemeEditorLeaveState[] = [];
    const currentLeaveState = (): ThemeEditorLeaveState => {
      const value = leaveStates.at(-1);
      if (value === undefined) throw new Error("Leave state was not registered");
      return value;
    };
    render(
      <ThemeEditor
        scopeKey="anon:themes"
        initialDraft={draft()}
        storedDraft={stored()}
        commands={on}
        onClose={vi.fn()}
        onLeaveState={(value) => {
          leaveStates.push(value);
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "First" } });
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Latest" } });
    await vi.advanceTimersByTimeAsync(499);
    expect(on.saveDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(on.saveDraft).toHaveBeenCalledTimes(1);
    expect(vi.mocked(on.saveDraft).mock.calls[0]?.[0].draft.rawName).toBe("Latest");
    expect(currentLeaveState().dirty).toBe(true);

    await expect(currentLeaveState().saveDraft()).resolves.toBe(true);
    expect(currentLeaveState().dirty).toBe(true);
    await expect(currentLeaveState().discard()).resolves.toBe(true);
    expect(on.deleteDraft).toHaveBeenCalledWith({ id: "draft_one", expectedLocalRevision: 8 });
  });

  it("reports save success separately when applying fails and only enables plain Apply for the exact saved revision", async () => {
    const value = draft();
    const on = commands();
    vi.mocked(on.applySaved).mockRejectedValueOnce(new Error("apply channel unavailable"));
    render(<ThemeEditor scopeKey="anon:themes" initialDraft={value} storedDraft={stored(value)} commands={on} onClose={vi.fn()} />);

    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Changed" } });
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));

    await screen.findByText("Saved on this device, but Apply failed: apply channel unavailable");
    expect(on.reviewContrast).toHaveBeenCalledOnce();
    expect(on.applySaved).toHaveBeenCalledWith(expect.objectContaining({ localRevision: 4 }));
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("preserves a conflicting candidate, labels last-valid export, and can save the candidate as a new copy", async () => {
    const on = commands();
    vi.mocked(on.finalizeDraft)
      .mockResolvedValueOnce({ ok: false, reason: "conflict", current: saved(draft(), 9) })
      .mockImplementationOnce(async ({ record }) => ({
        ok: true,
        value: { kind: "saved", id: record.id, localRevision: 1, record },
      }));
    render(
      <ThemeEditor
        scopeKey="anon:themes"
        initialDraft={{ ...draft(), rawColors: { "text.primary": "#12" } }}
        storedDraft={stored({ ...draft(), rawColors: { "text.primary": "#12" } })}
        commands={on}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/exports the last valid theme/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset Primary text" }));
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Conflict candidate" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/newer saved theme or draft/);
    expect((screen.getByLabelText("Theme name") as HTMLInputElement).value).toBe("Conflict candidate");

    fireEvent.click(screen.getByRole("button", { name: "Save as new copy" }));
    await screen.findByText("Saved on this device");
    const second = vi.mocked(on.finalizeDraft).mock.calls[1]?.[0];
    expect(second?.expectedLocalRevision).toBeNull();
    expect(second?.record.id).not.toBe("theme_one");
  });

  it.each([
    { label: "Save", asCopy: false },
    { label: "Save and apply", asCopy: false },
    { label: "Save as new copy", asCopy: true },
  ])("locks every mutation control while $label is finalizing", async ({ label, asCopy }) => {
    const on = commands();
    const pending = deferred<Awaited<ReturnType<ThemeEditorCommands["finalizeDraft"]>>>();
    if (asCopy) {
      vi.mocked(on.finalizeDraft)
        .mockResolvedValueOnce({ ok: false, reason: "conflict", current: saved(draft(), 9) })
        .mockImplementationOnce(() => pending.promise);
    } else {
      vi.mocked(on.finalizeDraft).mockImplementationOnce(() => pending.promise);
    }
    render(<ThemeEditor scopeKey="anon:themes" initialDraft={draft()} storedDraft={stored()} commands={on} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Name at save" } });
    if (asCopy) {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByRole("button", { name: "Save as new copy" });
    }
    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => expect(on.finalizeDraft).toHaveBeenCalledTimes(asCopy ? 2 : 1));
    expect((screen.getByLabelText("Theme name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Primary text") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reset Primary text" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("UI and controls") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reset UI and controls" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Base theme") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reset all overrides" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => pending.resolve({ ok: true, value: saved(draft(), 10) }));
    await screen.findByText(label === "Save and apply" ? "Saved on this device and applied" : "Saved on this device");
  });

  it("switches base without losing invalid input and Reset all clears overrides without applying", () => {
    const on = commands();
    render(<ThemeEditor scopeKey="anon:themes" initialDraft={draft()} storedDraft={stored()} commands={on} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Keep this name" } });
    fireEvent.change(screen.getByLabelText("Accent"), { target: { value: "#123456" } });
    fireEvent.change(screen.getByLabelText("Primary text"), { target: { value: "#12" } });
    fireEvent.change(screen.getByLabelText("Base theme"), { target: { value: "cyberpunk-neon" } });

    expect((screen.getByLabelText("Base theme") as HTMLSelectElement).value).toBe("cyberpunk-neon");
    expect((screen.getByLabelText("Primary text") as HTMLInputElement).value).toBe("#12");
    expect((screen.getByLabelText("Accent") as HTMLInputElement).value).toBe("#123456");
    expect(screen.getByText(/Invalid opaque color/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Reset all overrides" }));

    expect((screen.getByLabelText("Theme name") as HTMLInputElement).value).toBe("Keep this name");
    expect((screen.getByLabelText("Base theme") as HTMLSelectElement).value).toBe("cyberpunk-neon");
    expect((screen.getByLabelText("Primary text") as HTMLInputElement).value).not.toBe("#12");
    expect((screen.getByLabelText("Accent") as HTMLInputElement).value).not.toBe("#123456");
    expect(screen.queryByText(/Invalid opaque color/)).toBeNull();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    expect(on.applySaved).not.toHaveBeenCalled();
  });
});
