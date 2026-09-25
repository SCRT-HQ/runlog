// @vitest-environment jsdom
import { createThemeRecordFromPreset } from "@runlog/themes";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEVICE_ONLY_SYNC, type ThemeSyncView } from "./sync/view.ts";
import { ThemeLibrary, themeSyncLabel, type ThemeLibraryActions } from "./ThemeLibrary.tsx";
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

    expect(screen.getAllByTestId("builtin-theme")).toHaveLength(16);
    expect(screen.getByRole("heading", { name: "Daylight" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My theme" })).toBeTruthy();
    expect(screen.getAllByText("Light").length).toBeGreaterThan(0);
    expect(screen.getByText((text) => text.includes("Applied") && text.includes("Saved on this device"))).toBeTruthy();
  });

  it("shows each color vision theme's palette and checks on its card, and nothing on the others", () => {
    render(<ThemeLibrary library={[]} drafts={[]} appliedSource={null} actions={actions()} />);

    const card = (label: string) => screen.getByRole("heading", { name: label }).closest("article") as HTMLElement;
    expect(
      within(card("Cobalt dark")).getByText("Blue, amber and coral status colors; checked with protan and deutan simulation"),
    ).toBeTruthy();
    expect(within(card("Oxblood light")).getByText("Teal, bronze and deep red status colors; checked with tritan simulation")).toBeTruthy();
    expect(within(card("Daylight")).queryByText(/simulation/)).toBeNull();
    for (const article of screen.getAllByTestId("builtin-theme")) expect(article.textContent).not.toMatch(/\bsafe\b/i);
  });

  it("offers create, built-in copy, saved edit/duplicate/rename/export and recovery actions", async () => {
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

const on = (over: Partial<ThemeSyncView> = {}): ThemeSyncView => ({
  ...DEVICE_ONLY_SYNC,
  mode: "on",
  retry: vi.fn(),
  dismissNotice: vi.fn(),
  ...over,
});

describe("theme sync status", () => {
  it.each([
    [DEVICE_ONLY_SYNC, "Saved on this device"],
    [{ ...DEVICE_ONLY_SYNC, mode: "off" as const }, "Saved on this device"],
    [on({ items: new Map([["t1", { kind: "synced" }]]) }), "Synced"],
    [on({ items: new Map([["t1", { kind: "pending" }]]) }), "Saved on this device, not synced yet"],
    [on({ phase: "offline", items: new Map([["t1", { kind: "pending" }]]) }), "Saved on this device, waiting for a connection"],
    [on({ phase: "sign-in", items: new Map([["t1", { kind: "pending" }]]) }), "Not synced: sign in again"],
    [on({ items: new Map([["t1", { kind: "held", hold: "retry-exhausted", detail: null }]]) }), "Not synced"],
    [on({ items: new Map([["t1", { kind: "held", hold: "library-full", detail: null }]]) }), "Not synced: library full"],
    [
      on({ items: new Map([["t1", { kind: "held", hold: "invalid", detail: "$.name: Expected a name" }]]) }),
      "Not synced: the server did not accept this theme",
    ],
  ] as Array<[ThemeSyncView, string]>)("words each state plainly", (view, text) => {
    expect(themeSyncLabel(view, "t1")).toBe(text);
  });

  it("offers Retry sync only when the tries ran out, and it is reachable by keyboard", () => {
    const view = on({ items: new Map([["t1", { kind: "held", hold: "retry-exhausted", detail: null }]]) });
    render(<ThemeLibrary library={[saved("t1", "Kiln")]} drafts={[]} appliedSource={null} actions={actions()} sync={view} />);
    const retry = screen.getByRole("button", { name: "Retry sync for Kiln" });
    expect(retry.tagName).toBe("BUTTON");
    expect(retry.tabIndex).not.toBe(-1);
    fireEvent.click(retry);
    expect(view.retry).toHaveBeenCalledTimes(1);
  });

  it("keeps Download JSON on a theme the full library could not take", () => {
    const view = on({ items: new Map([["t1", { kind: "held", hold: "library-full", detail: null }]]) });
    render(<ThemeLibrary library={[saved("t1", "Kiln")]} drafts={[]} appliedSource={null} actions={actions()} sync={view} />);
    expect(screen.getByText((t) => t.includes("Not synced: library full"))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download Kiln JSON" })).toBeTruthy();
  });

  it("names both themes in a conflict notice and lets it be dismissed", () => {
    const view = on({ notices: [{ kind: "conflict-copy", themeId: "t1", copyId: "t2" }] });
    render(
      <ThemeLibrary
        library={[saved("t1", "Kiln"), saved("t2", "Kiln (conflict copy)")]}
        drafts={[]}
        appliedSource={null}
        actions={actions()}
        sync={view}
      />,
    );
    const text = 'Another device changed "Kiln". Your version is saved as "Kiln (conflict copy)".';
    expect(screen.getByRole("status").textContent).toContain(text);
    fireEvent.click(screen.getByRole("button", { name: `Dismiss: ${text}` }));
    expect(view.dismissNotice).toHaveBeenCalledWith(0);
  });

  it("capitalizes the fallback name when a recovery notice's original theme is gone from the library", () => {
    const view = on({ notices: [{ kind: "recovery-copy", themeId: "gone", copyId: "t2" }] });
    render(<ThemeLibrary library={[saved("t2", "Kiln (recovered)")]} drafts={[]} appliedSource={null} actions={actions()} sync={view} />);
    expect(screen.getByRole("status").textContent).toContain(
      'A theme was deleted on another device. Your changes are saved as "Kiln (recovered)".',
    );
  });

  it("capitalizes the fallback name when a kept-on-the-server notice's theme is gone from the library", () => {
    const view = on({ notices: [{ kind: "kept-server", themeId: "gone", copyId: null }] });
    render(<ThemeLibrary library={[]} drafts={[]} appliedSource={null} actions={actions()} sync={view} />);
    expect(screen.getByRole("status").textContent).toContain("A theme was changed on another device, so it was not deleted.");
  });

  it("gives each notice's Dismiss button a distinct accessible name", () => {
    const view = on({
      notices: [
        { kind: "conflict-copy", themeId: "t1", copyId: "t2" },
        { kind: "kept-server", themeId: "t3", copyId: null },
      ],
    });
    render(
      <ThemeLibrary
        library={[saved("t1", "Kiln"), saved("t2", "Kiln (conflict copy)"), saved("t3", "Glaze")]}
        drafts={[]}
        appliedSource={null}
        actions={actions()}
        sync={view}
      />,
    );
    const first = screen.getByRole("button", {
      name: `Dismiss: Another device changed "Kiln". Your version is saved as "Kiln (conflict copy)".`,
    });
    const second = screen.getByRole("button", { name: `Dismiss: "Glaze" was changed on another device, so it was not deleted.` });
    expect(first).not.toBe(second);
    fireEvent.click(second);
    expect(view.dismissNotice).toHaveBeenCalledWith(1);
  });

  it("says the themes are on the account only when syncing", () => {
    const { rerender } = render(<ThemeLibrary library={[]} drafts={[]} appliedSource={null} actions={actions()} sync={on()} />);
    expect(screen.getByText("Built-in bases and the themes on your account.")).toBeTruthy();
    rerender(<ThemeLibrary library={[]} drafts={[]} appliedSource={null} actions={actions()} />);
    expect(screen.getByText("Built-in bases and themes saved only on this device.")).toBeTruthy();
  });
});
