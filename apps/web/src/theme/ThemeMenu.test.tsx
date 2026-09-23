// @vitest-environment jsdom
import { createThemeRecordFromPreset, resolveThemeRecord, type BuiltinColorBaseId } from "@runlog/themes";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotForBuiltin, type BootAppearanceV1 } from "./appearance.ts";
import type { ThemeContextValue } from "./ThemeProvider.tsx";
import type { SavedThemeRow } from "./themeStorage.ts";
import { ThemeMenu } from "./ThemeMenu.tsx";

const contrastBoundary = vi.hoisted(() => ({ answers: [] as boolean[], calls: [] as unknown[] }));
vi.mock("./ThemeContrastReview.tsx", () => ({
  useThemeContrastReview: () => ({
    report: null,
    acknowledgementKey: null,
    problem: null,
    dialog: null,
    analyze: () => null,
    review: (snapshot: unknown) => {
      contrastBoundary.calls.push(snapshot);
      return Promise.resolve(contrastBoundary.answers.shift() ?? true);
    },
  }),
}));

const commands = vi.hoisted(() => ({ system: 0, builtins: [] as string[], saved: [] as Array<[string, number]> }));
const themeBoundary = vi.hoisted(() => ({ value: null as ThemeContextValue | null }));
vi.mock("./ThemeProvider.tsx", () => ({
  useThemes: () => themeBoundary.value,
}));

function row(id: string, name: string, presetId: BuiltinColorBaseId, localRevision: number): SavedThemeRow {
  const record = createThemeRecordFromPreset({ id, name, presetId });
  if (!record.ok) throw new Error("invalid test theme");
  return { kind: "saved", id, localRevision, record: record.value };
}

function context(overrides: Partial<ThemeContextValue> = {}): ThemeContextValue {
  const applied: BootAppearanceV1 = { schemaVersion: 1, mode: "system" };
  return {
    scopeKey: "anon:themes",
    status: "ready",
    library: [],
    drafts: [],
    problem: null,
    applied,
    appliedSource: null,
    sourceRemoved: false,
    reload: async () => {},
    saveTheme: async () => {
      throw new Error("unused");
    },
    deleteTheme: async () => {
      throw new Error("unused");
    },
    saveDraft: async () => {
      throw new Error("unused");
    },
    deleteDraft: async () => {
      throw new Error("unused");
    },
    finalizeDraft: async () => {
      throw new Error("unused");
    },
    applySystem: async () => {
      commands.system += 1;
    },
    applyBuiltin: async (id) => {
      commands.builtins.push(id);
    },
    applySaved: async (id, revision) => {
      commands.saved.push([id, revision]);
    },
    ...overrides,
  };
}

beforeEach(() => {
  commands.system = 0;
  commands.builtins = [];
  commands.saved = [];
  contrastBoundary.answers = [];
  contrastBoundary.calls = [];
  themeBoundary.value = context();
});

afterEach(cleanup);

describe("theme menu", () => {
  it("groups every built-in once by validated scheme, then color vision, and keeps certified high-contrast presets last", () => {
    render(<ThemeMenu />);
    const select = screen.getByRole("combobox", { name: "Theme" });
    const children = Array.from(select.children);
    expect(children.map((child) => (child.tagName === "OPTGROUP" ? child.getAttribute("label") : child.textContent))).toEqual([
      "Match the system",
      "Light themes",
      "Dark themes",
      "Color vision themes",
      "High-contrast themes",
    ]);

    const light = within(screen.getByRole("group", { name: "Light themes" }));
    const dark = within(screen.getByRole("group", { name: "Dark themes" }));
    const vision = within(screen.getByRole("group", { name: "Color vision themes" }));
    const high = within(screen.getByRole("group", { name: "High-contrast themes" }));
    expect(light.getByRole("option", { name: "Stardust" })).toBeTruthy();
    expect(dark.getByRole("option", { name: "Spacewalk" })).toBeTruthy();
    expect(light.queryByRole("option", { name: "Cobalt light" })).toBeNull();
    expect(dark.queryByRole("option", { name: "Cobalt dark" })).toBeNull();
    expect(vision.getAllByRole("option").map((option) => [option.textContent, option.getAttribute("value")])).toEqual([
      ["Cobalt dark", "builtin:red-green-dark"],
      ["Cobalt light", "builtin:red-green-light"],
      ["Oxblood dark", "builtin:blue-yellow-dark"],
      ["Oxblood light", "builtin:blue-yellow-light"],
    ]);
    expect(high.getAllByRole("option").map((option) => option.textContent)).toEqual(["High contrast dark", "High contrast light"]);
    expect(screen.getAllByRole("option")).toHaveLength(17);
    for (const option of screen.getAllByRole("option").slice(1)) expect(option.getAttribute("value")).toMatch(/^builtin:/);
  });

  it("shows an applied color vision theme as selected and applies another by id", async () => {
    themeBoundary.value = context({ applied: { schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("blue-yellow-light") } });
    render(<ThemeMenu />);

    expect((screen.getByRole("option", { name: "Oxblood light" }) as HTMLOptionElement).selected).toBe(true);
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "builtin:red-green-dark" } });
    await waitFor(() => expect(commands.builtins).toEqual(["red-green-dark"]));
  });

  it("puts custom themes in their light or dark group with namespaced values and an explicit Custom label", () => {
    themeBoundary.value = context({
      library: [row("ember", "Custom Ember", "daylight", 3), row("night", "Night Shift", "cyberpunk", 7)],
    });
    render(<ThemeMenu />);

    const light = within(screen.getByRole("group", { name: "Light themes" }));
    const dark = within(screen.getByRole("group", { name: "Dark themes" }));
    expect((light.getByRole("option", { name: "Custom Ember · Custom" }) as HTMLOptionElement).value).toBe("saved:ember");
    expect((dark.getByRole("option", { name: "Night Shift · Custom" }) as HTMLOptionElement).value).toBe("saved:night");
    expect((screen.getByRole("option", { name: "Ember" }) as HTMLOptionElement).value).toBe("builtin:ember");
    expect(screen.queryByRole("group", { name: "My themes" })).toBeNull();
  });

  it("applies system and built-ins through provider commands and exposes Manage themes and Restore default", async () => {
    const open = vi.fn();
    render(<ThemeMenu onOpenThemes={open} />);

    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "builtin:ember" } });
    await waitFor(() => expect(commands.builtins).toEqual(["ember"]));
    fireEvent.click(screen.getByRole("button", { name: "Restore default" }));
    await waitFor(() => expect(commands.system).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Manage themes" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("runs saved selection through contrast review and applies only after acceptance", async () => {
    const saved = row("night", "Night Shift", "cyberpunk", 7);
    themeBoundary.value = context({ library: [saved] });
    contrastBoundary.answers = [false, true];
    render(<ThemeMenu />);

    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "saved:night" } });
    await waitFor(() => expect(contrastBoundary.calls).toHaveLength(1));
    expect(commands.saved).toEqual([]);

    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "saved:night" } });
    await waitFor(() => expect(commands.saved).toEqual([["night", 7]]));
    const resolved = resolveThemeRecord(saved.record);
    expect(resolved.ok).toBe(true);
    expect(contrastBoundary.calls[1]).toEqual(resolved.ok ? resolved.value : null);
  });

  it("shows a generic retained selection when the applied custom snapshot is no longer representable", () => {
    themeBoundary.value = context({
      applied: { schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("daylight") },
      appliedSource: { schemaVersion: 1, id: "old-account-secret", localRevision: 9, snapshotKey: "not-used-by-menu" },
      sourceRemoved: true,
    });
    render(<ThemeMenu />);

    const selected = screen.getByRole("option", { name: "Current appearance (retained)" }) as HTMLOptionElement;
    expect(selected.selected).toBe(true);
    expect(document.body.textContent).not.toContain("old-account-secret");
  });
});
