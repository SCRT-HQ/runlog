import { describe, expect, it } from "vitest";

import { getBuiltinColorBase, resolveColors } from "./index.ts";

const expectedBases = {
  "lights-down": {
    colorScheme: "dark",
    colors: {
      "surface.page": "#151311",
      "surface.panel": "#1e1b18",
      "surface.raised": "#26221e",
      "text.primary": "#ece5d8",
      "text.muted": "#b3a99b",
      "text.onAccent": "#151311",
      "boundary.decorative": "#3a342e",
      "boundary.control": "#3a342e",
      "boundary.strong": "#5a524a",
      "interaction.accent": "#9fd3b6",
      "interaction.accentTint": "#3b5f4c",
      "interaction.selectedIndicator": "#9fd3b6",
      "interaction.focus": "#9fd3b6",
      "feedback.success": "#9fd3b6",
      "feedback.warning": "#e0a94f",
      "feedback.danger": "#e4736b",
    },
  },
  daylight: {
    colorScheme: "light",
    colors: {
      "surface.page": "#edeae2",
      "surface.panel": "#e4e0d6",
      "surface.raised": "#dbd6ca",
      "text.primary": "#1c1a17",
      "text.muted": "#4a453e",
      "text.onAccent": "#f4f2ec",
      "boundary.decorative": "#cbc4b7",
      "boundary.control": "#cbc4b7",
      "boundary.strong": "#a89f91",
      "interaction.accent": "#3d7a5b",
      "interaction.accentTint": "#b9d6c5",
      "interaction.selectedIndicator": "#3d7a5b",
      "interaction.focus": "#3d7a5b",
      "feedback.success": "#3d7a5b",
      "feedback.warning": "#9c6a15",
      "feedback.danger": "#b4433a",
    },
  },
  ember: {
    colorScheme: "dark",
    colors: {
      "surface.page": "#1a1210",
      "surface.panel": "#241915",
      "surface.raised": "#2e211c",
      "text.primary": "#f1e4d3",
      "text.muted": "#bfa48f",
      "text.onAccent": "#1a1210",
      "boundary.decorative": "#45312a",
      "boundary.control": "#45312a",
      "boundary.strong": "#6a4d42",
      "interaction.accent": "#a9cbb0",
      "interaction.accentTint": "#4a5f4f",
      "interaction.selectedIndicator": "#a9cbb0",
      "interaction.focus": "#a9cbb0",
      "feedback.success": "#a9cbb0",
      "feedback.warning": "#f2b45a",
      "feedback.danger": "#f08070",
    },
  },
  glaze: {
    colorScheme: "dark",
    colors: {
      "surface.page": "#101a17",
      "surface.panel": "#17231f",
      "surface.raised": "#1e2d28",
      "text.primary": "#e4ece6",
      "text.muted": "#9db3a8",
      "text.onAccent": "#101a17",
      "boundary.decorative": "#2b3a34",
      "boundary.control": "#2b3a34",
      "boundary.strong": "#4a5f57",
      "interaction.accent": "#a8dcc0",
      "interaction.accentTint": "#33584a",
      "interaction.selectedIndicator": "#a8dcc0",
      "interaction.focus": "#a8dcc0",
      "feedback.success": "#a8dcc0",
      "feedback.warning": "#e6b15c",
      "feedback.danger": "#e78a80",
    },
  },
} as const;

describe("built-in revision-1 color bases", () => {
  it.each(Object.entries(expectedBases))("returns and resolves the literal historical %s palette", (id, expected) => {
    const base = getBuiltinColorBase(id);
    const resolved = resolveColors(base?.colors);

    expect(base).toEqual({ id, revision: 1, ...expected });
    expect(Object.keys(base?.colors ?? {})).toEqual(Object.keys(expected.colors));
    expect(resolved?.values).toEqual({
      ...expected.colors,
      "widget.ground": expected.colors["surface.page"],
      "widget.panel": expected.colors["surface.panel"],
      "widget.text": expected.colors["text.primary"],
      "widget.textMuted": expected.colors["text.muted"],
      "widget.accent": expected.colors["interaction.accent"],
    });
    expect(resolved?.feedbackBackgrounds).toEqual({
      "feedback.successBackground": null,
      "feedback.warningBackground": null,
      "feedback.dangerBackground": null,
    });
  });

  it("defaults only omitted or undefined revisions to revision 1", () => {
    expect(getBuiltinColorBase("daylight")?.revision).toBe(1);
    expect(getBuiltinColorBase("daylight", undefined)?.revision).toBe(1);
    expect(getBuiltinColorBase("daylight", 1)?.revision).toBe(1);
  });

  it.each([
    ["system", undefined],
    ["Daylight", undefined],
    ["daylight ", undefined],
    [" daylight", undefined],
    ["daylight", 2],
    ["daylight", "1"],
    ["daylight", null],
    ["daylight", true],
    [null, 1],
  ])("rejects invalid identity or revision %#", (id, revision) => {
    expect(getBuiltinColorBase(id, revision)).toBeNull();
  });

  it("returns deeply frozen data that cannot poison future lookups", () => {
    const first = getBuiltinColorBase("lights-down");

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.colors)).toBe(true);
    expect(() => {
      (first?.colors as Record<string, string>)["surface.page"] = "#ffffff";
    }).toThrow(TypeError);
    expect(getBuiltinColorBase("lights-down")?.colors["surface.page"]).toBe("#151311");
  });
});
