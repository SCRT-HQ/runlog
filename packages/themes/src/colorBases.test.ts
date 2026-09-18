import { describe, expect, it } from "vitest";

import { assessContrast, getBuiltinColorBase, resolveColors } from "./index.ts";

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

const expectedNewBases = {
  "high-contrast-dark": {
    colorScheme: "dark",
    colors: {
      "surface.page": "#080808",
      "surface.panel": "#141414",
      "surface.raised": "#202020",
      "text.primary": "#ffffff",
      "text.muted": "#dedede",
      "text.onAccent": "#080808",
      "boundary.decorative": "#777777",
      "boundary.control": "#aaaaaa",
      "boundary.strong": "#dedede",
      "interaction.accent": "#ffdb66",
      "interaction.accentTint": "#302a18",
      "interaction.selectedIndicator": "#ffdb66",
      "interaction.focus": "#a9ddff",
      "feedback.success": "#a9efb1",
      "feedback.warning": "#ffe6a6",
      "feedback.danger": "#ffb5a9",
    },
  },
  "high-contrast-light": {
    colorScheme: "light",
    colors: {
      "surface.page": "#ffffff",
      "surface.panel": "#f5f5f5",
      "surface.raised": "#eaeaea",
      "text.primary": "#111111",
      "text.muted": "#333333",
      "text.onAccent": "#ffffff",
      "boundary.decorative": "#777777",
      "boundary.control": "#555555",
      "boundary.strong": "#333333",
      "interaction.accent": "#164a6e",
      "interaction.accentTint": "#dce8ef",
      "interaction.selectedIndicator": "#164a6e",
      "interaction.focus": "#164a6e",
      "feedback.success": "#24552c",
      "feedback.warning": "#794900",
      "feedback.danger": "#8a2222",
    },
  },
  "retro-arcade": {
    colorScheme: "dark",
    colors: {
      "surface.page": "#101810",
      "surface.panel": "#1b281b",
      "surface.raised": "#263426",
      "text.primary": "#ecf7d7",
      "text.muted": "#bdd0ab",
      "text.onAccent": "#101810",
      "boundary.decorative": "#4b6244",
      "boundary.control": "#91ab7e",
      "boundary.strong": "#bdd0ab",
      "interaction.accent": "#a8ed70",
      "interaction.accentTint": "#304427",
      "interaction.selectedIndicator": "#a8ed70",
      "interaction.focus": "#ffd36b",
      "feedback.success": "#a8ed70",
      "feedback.warning": "#ffd36b",
      "feedback.danger": "#ffa38c",
    },
  },
  cyberpunk: {
    colorScheme: "dark",
    colors: {
      "surface.page": "#11151e",
      "surface.panel": "#202837",
      "surface.raised": "#2a3445",
      "text.primary": "#edf2f7",
      "text.muted": "#b9c8d9",
      "text.onAccent": "#11151e",
      "boundary.decorative": "#4d6078",
      "boundary.control": "#8cabc4",
      "boundary.strong": "#b9c8d9",
      "interaction.accent": "#f1ed69",
      "interaction.accentTint": "#414126",
      "interaction.selectedIndicator": "#f1ed69",
      "interaction.focus": "#8bd9ed",
      "feedback.success": "#93e6b5",
      "feedback.warning": "#ffd28a",
      "feedback.danger": "#ffa5a5",
    },
  },
  "cyberpunk-neon": {
    colorScheme: "dark",
    colors: {
      "surface.page": "#160d24",
      "surface.panel": "#30204b",
      "surface.raised": "#3a2959",
      "text.primary": "#f5edff",
      "text.muted": "#cdbbe8",
      "text.onAccent": "#160d24",
      "boundary.decorative": "#69547f",
      "boundary.control": "#ad94c9",
      "boundary.strong": "#cdbbe8",
      "interaction.accent": "#ff64d8",
      "interaction.accentTint": "#522644",
      "interaction.selectedIndicator": "#ff64d8",
      "interaction.focus": "#62cfff",
      "feedback.success": "#a4edc1",
      "feedback.warning": "#ffd27a",
      "feedback.danger": "#ff9a88",
    },
  },
} as const;

describe("built-in revision-1 color bases", () => {
  it.each(Object.entries(expectedBases))("returns and resolves the literal historical %s palette", (id, expected) => {
    const base = getBuiltinColorBase(id, 1);
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

  it("defaults unchanged presets to revision 1", () => {
    expect(getBuiltinColorBase("daylight")?.revision).toBe(1);
    expect(getBuiltinColorBase("daylight", undefined)?.revision).toBe(1);
    expect(getBuiltinColorBase("daylight", 1)?.revision).toBe(1);
  });

  it.each([
    ["system", undefined],
    ["Daylight", undefined],
    ["daylight ", undefined],
    [" daylight", undefined],
    ["daylight", "1"],
    ["daylight", null],
    ["daylight", true],
    [null, 1],
  ])("rejects invalid identity or revision %#", (id, revision) => {
    expect(getBuiltinColorBase(id, revision)).toBeNull();
  });

  it("returns deeply frozen data that cannot poison future lookups", () => {
    const first = getBuiltinColorBase("lights-down", 1);

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.colors)).toBe(true);
    expect(() => {
      (first?.colors as Record<string, string>)["surface.page"] = "#ffffff";
    }).toThrow(TypeError);
    expect(getBuiltinColorBase("lights-down", 1)?.colors["surface.page"]).toBe("#151311");
  });

  it.each(Object.entries(expectedNewBases))("returns and resolves the approved %s palette", (id, expected) => {
    const base = getBuiltinColorBase(id, 1);
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
  });

  it.each(Object.keys(expectedNewBases))("meets the approved contrast gates for %s", (id) => {
    const base = getBuiltinColorBase(id, 1);
    expect(base).not.toBeNull();
    if (!base) return;
    const colors = base.colors;
    const surfaces = ["surface.page", "surface.panel", "surface.raised"] as const;
    const minimumTextContrast = id.startsWith("high-contrast-") ? 7 : 4.5;

    for (const text of ["text.primary", "text.muted"] as const) {
      for (const surface of surfaces) expect(assessContrast(colors[text], colors[surface], minimumTextContrast).passes).toBe(true);
    }
    for (const foreground of ["interaction.accent", "feedback.success", "feedback.warning", "feedback.danger"] as const) {
      for (const surface of surfaces) expect(assessContrast(colors[foreground], colors[surface], 4.5).passes).toBe(true);
    }
    for (const foreground of ["boundary.control", "interaction.focus"] as const) {
      for (const surface of surfaces) expect(assessContrast(colors[foreground], colors[surface], 3).passes).toBe(true);
    }
    for (const foreground of ["interaction.accent", "feedback.warning"] as const) {
      expect(assessContrast(colors["text.onAccent"], colors[foreground], 4.5).passes).toBe(true);
    }
    expect(assessContrast(colors["interaction.selectedIndicator"], colors["interaction.accentTint"], 3).passes).toBe(true);
    for (const text of ["text.primary", "text.muted"] as const) {
      expect(assessContrast(colors[text], colors["interaction.accentTint"], 4.5).passes).toBe(true);
    }
  });
});

describe("versioned Samurai color base", () => {
  const expectedSamurai2 = {
    colorScheme: "dark",
    colors: {
      ...expectedNewBases["cyberpunk-neon"].colors,
      "text.muted": "#b9dfff",
      "boundary.control": "#62cfff",
      "interaction.selectedIndicator": "#62cfff",
    },
  } as const;

  it("keeps the exact historic revision 1 palette deeply frozen", () => {
    const historic = getBuiltinColorBase("cyberpunk-neon", 1);

    expect(historic).toEqual({ id: "cyberpunk-neon", revision: 1, ...expectedNewBases["cyberpunk-neon"] });
    expect(Object.keys(historic?.colors ?? {})).toHaveLength(16);
    expect(Object.isFrozen(historic)).toBe(true);
    expect(Object.isFrozen(historic?.colors)).toBe(true);
  });

  it("returns revision 2 by default and for explicit revision 2", () => {
    const latest = getBuiltinColorBase("cyberpunk-neon");
    const implicitLatest = getBuiltinColorBase("cyberpunk-neon", undefined);
    const explicitLatest = getBuiltinColorBase("cyberpunk-neon", 2);

    expect(latest).toEqual({ id: "cyberpunk-neon", revision: 2, ...expectedSamurai2 });
    expect(implicitLatest).toBe(latest);
    expect(explicitLatest).toBe(latest);
    expect(Object.isFrozen(latest)).toBe(true);
    expect(Object.isFrozen(latest?.colors)).toBe(true);
  });

  it("changes exactly the three approved roles from revision 1", () => {
    const historic = getBuiltinColorBase("cyberpunk-neon", 1);
    const latest = getBuiltinColorBase("cyberpunk-neon", 2);
    expect(historic).not.toBeNull();
    expect(latest).not.toBeNull();
    if (!historic || !latest) return;
    const changedRoles = Object.keys(latest.colors).filter(
      (role) => latest.colors[role as keyof typeof latest.colors] !== historic.colors[role as keyof typeof historic.colors],
    );

    expect(changedRoles).toEqual(["text.muted", "boundary.control", "interaction.selectedIndicator"]);
    expect(latest.colors["text.muted"]).toBe("#b9dfff");
    expect(latest.colors["boundary.control"]).toBe("#62cfff");
    expect(latest.colors["interaction.selectedIndicator"]).toBe("#62cfff");
  });

  it.each([3, "2", null, true, Number.NaN])("rejects unsupported Samurai revision %p", (revision) => {
    expect(getBuiltinColorBase("cyberpunk-neon", revision)).toBeNull();
  });

  it.each(["lights-down", "daylight", "ember", "glaze", "high-contrast-dark", "high-contrast-light", "retro-arcade", "cyberpunk"])(
    "keeps %s at revision 1 and rejects revision 2",
    (id) => {
      expect(getBuiltinColorBase(id)?.revision).toBe(1);
      expect(getBuiltinColorBase(id, 2)).toBeNull();
    },
  );

  it("meets the approved contrast gates", () => {
    const base = getBuiltinColorBase("cyberpunk-neon", 2);
    expect(base).not.toBeNull();
    if (!base) return;
    const colors = base.colors;
    const surfaces = ["surface.page", "surface.panel", "surface.raised"] as const;

    for (const text of ["text.primary", "text.muted"] as const) {
      for (const surface of surfaces) expect(assessContrast(colors[text], colors[surface], 4.5).passes).toBe(true);
    }
    for (const foreground of ["interaction.accent", "feedback.success", "feedback.warning", "feedback.danger"] as const) {
      for (const surface of surfaces) expect(assessContrast(colors[foreground], colors[surface], 4.5).passes).toBe(true);
    }
    for (const foreground of ["boundary.control", "interaction.focus"] as const) {
      for (const surface of surfaces) expect(assessContrast(colors[foreground], colors[surface], 3).passes).toBe(true);
    }
    expect(assessContrast(colors["interaction.selectedIndicator"], colors["interaction.accentTint"], 3).passes).toBe(true);
    for (const text of ["text.primary", "text.muted"] as const) {
      expect(assessContrast(colors[text], colors["interaction.accentTint"], 4.5).passes).toBe(true);
    }
    for (const foreground of ["interaction.accent", "feedback.warning"] as const) {
      expect(assessContrast(colors["text.onAccent"], colors[foreground], 4.5).passes).toBe(true);
    }
  });
});
