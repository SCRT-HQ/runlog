// @vitest-environment jsdom
import { createThemeRecordFromPreset } from "@runlog/themes";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeLibrary, type ThemeLibraryActions } from "./ThemeLibrary.tsx";
import type { SavedThemeRow, StoredThemeDraft } from "./themeStorage.ts";

function saved(id = "mine", name = "My theme", localRevision = 3): SavedThemeRow {
  const record = createThemeRecordFromPreset({ id, name, presetId: "daylight" });
  if (!record.ok) throw new Error("invalid fixture");
  return { kind: "saved", id, localRevision, record: record.value };
}

function draft(row: SavedThemeRow): StoredThemeDraft {
  return {
    id: "draft_one",
    localRevision: 2,
    draft: {
      schemaVersion: 1,
      id: "draft_one",
      sourceThemeId: row.id,
      baseLocalRevision: row.localRevision,
      record: row.record,
      rawName: row.record.name,
      rawColors: {},
    },
  };
}

function actions(): ThemeLibraryActions {
  return {
    create: vi.fn(),
    editBuiltin: vi.fn(),
    applyBuiltin: vi.fn(async () => {}),
    editSaved: vi.fn(),
    duplicate: vi.fn(),
    rename: vi.fn(async () => true),
    delete: vi.fn(async () => true),
    applySaved: vi.fn(async () => {}),
    importText: vi.fn(async () => true),
    exportSaved: vi.fn(),
    recover: vi.fn(),
  };
}

afterEach(cleanup);

describe("theme library", () => {
  it("lists built-in bases and saved themes with scheme, applied and local durability labels", () => {
    const row = saved();
    render(
      <ThemeLibrary
        library={[row]}
        drafts={[]}
        appliedSource={{ schemaVersion: 1, id: row.id, localRevision: 3, snapshotKey: "key" }}
        actions={actions()}
      />,
    );

    expect(screen.getAllByTestId("builtin-theme")).toHaveLength(12);
    expect(screen.getByRole("heading", { name: "Daylight" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My theme" })).toBeTruthy();
    expect(screen.getAllByText("Light").length).toBeGreaterThan(0);
    expect(screen.getByText((text) => text.includes("Applied") && text.includes("Saved on this device"))).toBeTruthy();
  });

  it("offers create, built-in copy, saved edit/duplicate/rename/export and recovery actions from the keyboard", async () => {
    const row = saved();
    const recovering = draft(row);
    const on = actions();
    render(<ThemeLibrary library={[row]} drafts={[recovering]} appliedSource={null} actions={on} />);

    fireEvent.click(screen.getByRole("button", { name: "Create theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit a copy of Daylight" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit My theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate My theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename My theme" }));
    const field = screen.getByRole("textbox", { name: "New name for My theme" });
    expect(field.classList.contains("textInput")).toBe(true);
    fireEvent.change(field, { target: { value: "Renamed theme" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(on.rename).toHaveBeenCalledWith(row, "Renamed theme"));
    fireEvent.click(screen.getByRole("button", { name: "Download My theme JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore draft My theme" }));

    expect(on.create).toHaveBeenCalledWith("daylight");
    expect(on.editBuiltin).toHaveBeenCalledWith("daylight");
    expect(on.editSaved).toHaveBeenCalledWith(row);
    expect(on.duplicate).toHaveBeenCalledWith(row);
    expect(on.exportSaved).toHaveBeenCalledWith(row);
    expect(on.recover).toHaveBeenCalledWith(recovering);
  });

  it("confirms deletion and keeps the item visible when the transaction fails", async () => {
    const row = saved();
    const on = actions();
    vi.mocked(on.delete).mockResolvedValue(false);
    render(<ThemeLibrary library={[row]} drafts={[]} appliedSource={null} actions={on} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete My theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(on.delete).toHaveBeenCalledWith(row));
    expect(screen.getByRole("heading", { name: "My theme" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("could not be deleted");
  });

  it("keeps the theme and reports a rejected delete transaction without an unhandled promise", async () => {
    const row = saved();
    const on = actions();
    vi.mocked(on.delete).mockRejectedValue(new Error("theme scope changed"));
    render(<ThemeLibrary library={[row]} drafts={[]} appliedSource={null} actions={on} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete My theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("theme scope changed"));
    expect(screen.getByRole("heading", { name: "My theme" })).toBeTruthy();
  });

  it("rejects an oversized import before reading and clears the input so the same file can be chosen again", async () => {
    const on = actions();
    render(<ThemeLibrary library={[]} drafts={[]} appliedSource={null} actions={on} />);
    const input = screen.getByLabelText("Import theme JSON") as HTMLInputElement;
    const text = vi.fn(async () => "{}");
    const file = { name: "too-large.json", size: 65_537, text } as unknown as File;

    fireEvent.change(input, { target: { files: [file] } });

    expect(text).not.toHaveBeenCalled();
    expect(on.importText).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(screen.getByRole("alert").textContent).toContain("65,536");
  });

  it("reads an in-bound import once and reports failed persistence without a durability claim", async () => {
    const on = actions();
    vi.mocked(on.importText).mockResolvedValue(false);
    render(<ThemeLibrary library={[]} drafts={[]} appliedSource={null} actions={on} />);
    const input = screen.getByLabelText("Import theme JSON") as HTMLInputElement;
    const file = { name: "theme.json", size: 20, text: vi.fn(async () => '{"schemaVersion":1}') } as unknown as File;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(on.importText).toHaveBeenCalledWith('{"schemaVersion":1}'));
    expect(screen.queryByText("Saved on this device")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("could not be imported");
  });
});
