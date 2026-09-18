import { describe, expect, it } from "vitest";

import { COLOR_DEFINITIONS, isColorTokenId, resolveColors, type CoreColorTokenId } from "./index.ts";

const lightsDownBase = {
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
};

const expectedLightsDownValues = {
  ...lightsDownBase,
  "interaction.moveAccent": "#9fd3b6",
  "interaction.moveAccent2": "#9fd3b6",
  "interaction.moveAccent3": "#3a342e",
  "interaction.moveAccent4": "#9fd3b6",
  "widget.ground": "#151311",
  "widget.panel": "#1e1b18",
  "widget.text": "#ece5d8",
  "widget.textMuted": "#b3a99b",
  "widget.accent": "#9fd3b6",
};

const expectedDefinitions = [
  ["surface.page", "Page background", "surfaces", "core"],
  ["surface.panel", "Panel background", "surfaces", "core"],
  ["surface.raised", "Raised surface", "surfaces", "core"],
  ["text.primary", "Primary text", "text", "core"],
  ["text.muted", "Secondary text", "text", "core"],
  ["text.onAccent", "Text on accent", "text", "core"],
  ["boundary.decorative", "Decorative divider", "boundaries", "core"],
  ["boundary.control", "Control boundary", "boundaries", "core"],
  ["boundary.strong", "Strong boundary", "boundaries", "core"],
  ["interaction.accent", "Accent", "interaction", "core"],
  ["interaction.accentTint", "Accent tint", "interaction", "core"],
  ["interaction.selectedIndicator", "Selected indicator", "interaction", "core"],
  ["interaction.moveAccent", "Move card accent", "interaction", "decoration", "interaction.selectedIndicator"],
  ["interaction.moveAccent2", "Move card accent 2", "interaction", "decoration", "interaction.focus"],
  ["interaction.moveAccent3", "Move card accent 3", "interaction", "decoration", "boundary.decorative"],
  ["interaction.moveAccent4", "Move card accent 4", "interaction", "decoration", "interaction.accent"],
  ["interaction.focus", "Keyboard focus", "interaction", "core"],
  ["feedback.success", "Success foreground", "feedback", "core"],
  ["feedback.warning", "Warning foreground", "feedback", "core"],
  ["feedback.danger", "Danger foreground", "feedback", "core"],
  ["widget.ground", "Widget ground", "widgets", "widget", "surface.page"],
  ["widget.panel", "Widget panel", "widgets", "widget", "surface.panel"],
  ["widget.text", "Widget text", "widgets", "widget", "text.primary"],
  ["widget.textMuted", "Widget secondary text", "widgets", "widget", "text.muted"],
  ["widget.accent", "Widget accent", "widgets", "widget", "interaction.accent"],
  ["feedback.successBackground", "Success background", "feedback", "feedbackBackground"],
  ["feedback.warningBackground", "Warning background", "feedback", "feedbackBackground"],
  ["feedback.dangerBackground", "Danger background", "feedback", "feedbackBackground"],
] as const;

describe("semantic color registry", () => {
  it("publishes the complete metadata allowlist and widget inheritance map", () => {
    expect(
      COLOR_DEFINITIONS.map((definition) => [
        definition.id,
        definition.label,
        definition.group,
        definition.kind,
        ...(definition.kind === "widget" || definition.kind === "decoration" ? [definition.inherits] : []),
      ]),
    ).toEqual(expectedDefinitions);
    expect(COLOR_DEFINITIONS.every((definition) => isColorTokenId(definition.id))).toBe(true);
  });

  it.each(expectedDefinitions.map(([id]) => id))("recognizes the allowed role %s", (id) => {
    expect(isColorTokenId(id)).toBe(true);
  });

  it.each(["Surface.page", "surface.page ", "surface", "system", "", null, 1, {}])("rejects a non-role identity %j", (value) => {
    expect(isColorTokenId(value)).toBe(false);
  });

  it("freezes the registry and its definitions against cross-call poisoning", () => {
    expect(Object.isFrozen(COLOR_DEFINITIONS)).toBe(true);
    expect(COLOR_DEFINITIONS.every(Object.isFrozen)).toBe(true);
    expect(() => {
      (COLOR_DEFINITIONS[0] as { label: string }).label = "Poisoned";
    }).toThrow(TypeError);
    expect(COLOR_DEFINITIONS[0]?.label).toBe("Page background");
    expect(isColorTokenId("surface.page")).toBe(true);
  });
});

describe("semantic color resolution", () => {
  it("accepts a historical 16-core base and resolves inherited optional roles with empty overrides", () => {
    const result = resolveColors(lightsDownBase);

    expect(result?.values).toEqual(expectedLightsDownValues);
    expect(result?.feedbackBackgrounds).toEqual({
      "feedback.successBackground": null,
      "feedback.warningBackground": null,
      "feedback.dangerBackground": null,
    });
  });

  it("normalizes overrides and makes unset widgets inherit final core values", () => {
    const result = resolveColors(lightsDownBase, {
      "text.primary": "#AbC",
      "surface.panel": "rgb(0 0 0)",
      "feedback.warningBackground": "#123",
    });

    expect(result?.values["text.primary"]).toBe("#aabbcc");
    expect(result?.values["widget.text"]).toBe("#aabbcc");
    expect(result?.values["widget.panel"]).toBe("#000000");
    expect(result?.feedbackBackgrounds).toEqual({
      "feedback.successBackground": null,
      "feedback.warningBackground": "#112233",
      "feedback.dangerBackground": null,
    });
  });

  it("accepts and normalizes all 28 roles when present", () => {
    const result = resolveColors(lightsDownBase, {
      "surface.page": "#ABC",
      "surface.panel": "#ABC",
      "surface.raised": "#ABC",
      "text.primary": "#ABC",
      "text.muted": "#ABC",
      "text.onAccent": "#ABC",
      "boundary.decorative": "#ABC",
      "boundary.control": "#ABC",
      "boundary.strong": "#ABC",
      "interaction.accent": "#ABC",
      "interaction.accentTint": "#ABC",
      "interaction.selectedIndicator": "#ABC",
      "interaction.moveAccent": "rgb(1 2 3)",
      "interaction.moveAccent2": "rgb(2 3 4)",
      "interaction.moveAccent3": "rgb(3 4 5)",
      "interaction.moveAccent4": "rgb(4 5 6)",
      "interaction.focus": "#ABC",
      "feedback.success": "#ABC",
      "feedback.warning": "#ABC",
      "feedback.danger": "#ABC",
      "widget.ground": "#ABC",
      "widget.panel": "#ABC",
      "widget.text": "#ABC",
      "widget.textMuted": "#ABC",
      "widget.accent": "#ABC",
      "feedback.successBackground": "#ABC",
      "feedback.warningBackground": "#ABC",
      "feedback.dangerBackground": "#ABC",
    });

    expect(result?.values).toMatchObject({
      "interaction.moveAccent": "#010203",
      "interaction.moveAccent2": "#020304",
      "interaction.moveAccent3": "#030405",
      "interaction.moveAccent4": "#040506",
    });
    expect(Object.values(result?.values ?? {}).filter((value) => value === "#aabbcc")).toHaveLength(21);
    expect(Object.values(result?.feedbackBackgrounds ?? {})).toEqual(Array(3).fill("#aabbcc"));
  });

  it("applies move-accent override, base value, and final selected-indicator inheritance precedence", () => {
    const baseWithMoveAccent = { ...lightsDownBase, "interaction.moveAccent": "#123" };

    expect(
      resolveColors(baseWithMoveAccent, {
        "interaction.selectedIndicator": "#234",
        "interaction.moveAccent": "rgb(4 5 6)",
      })?.values["interaction.moveAccent"],
    ).toBe("#040506");
    expect(resolveColors(baseWithMoveAccent, { "interaction.selectedIndicator": "#234" })?.values["interaction.moveAccent"]).toBe(
      "#112233",
    );
    expect(resolveColors(lightsDownBase, { "interaction.selectedIndicator": "#234" })?.values["interaction.moveAccent"]).toBe("#223344");
  });

  it.each([
    ["interaction.moveAccent2", "interaction.focus"],
    ["interaction.moveAccent3", "boundary.decorative"],
    ["interaction.moveAccent4", "interaction.accent"],
  ] as const)("applies %s override, base value, and final %s inheritance precedence", (role, inheritedRole) => {
    const baseWithAccent = { ...lightsDownBase, [role]: "#123" };

    expect(resolveColors(baseWithAccent, { [inheritedRole]: "#234", [role]: "rgb(4 5 6)" })?.values[role]).toBe("#040506");
    expect(resolveColors(baseWithAccent, { [inheritedRole]: "#234" })?.values[role]).toBe("#112233");
    expect(resolveColors(lightsDownBase, { [inheritedRole]: "#234" })?.values[role]).toBe("#223344");
  });

  it.each(["interaction.moveAccent", "interaction.moveAccent2", "interaction.moveAccent3", "interaction.moveAccent4"] as const)(
    "validates an explicit %s independently in a base or override",
    (role) => {
      expect(resolveColors({ ...lightsDownBase, [role]: "red" })).toBeNull();
      expect(resolveColors(lightsDownBase, { [role]: "red" })).toBeNull();
      expect(resolveColors({ ...lightsDownBase, [role]: "#123" })?.values[role]).toBe("#112233");
      expect(resolveColors(lightsDownBase, { [role]: "rgb(1 2 3)" })?.values[role]).toBe("#010203");
    },
  );

  it.each(["red", "#1234", "rgb(1 2 3 / 1)", "var(--selected-indicator)", null, undefined])(
    "rejects an explicitly invalid move accent %j in a base or override",
    (value) => {
      expect(resolveColors({ ...lightsDownBase, "interaction.moveAccent": value })).toBeNull();
      expect(resolveColors(lightsDownBase, { "interaction.moveAccent": value })).toBeNull();
    },
  );

  it.each([
    null,
    undefined,
    [],
    "#fff",
    42,
    {},
    { ...lightsDownBase, "text.primary": "red" },
    { ...lightsDownBase, "widget.text": null },
    { ...lightsDownBase, "feedback.successBackground": "derived" },
  ])("rejects malformed base input %#", (base) => {
    expect(resolveColors(base, { "text.primary": "#fff" })).toBeNull();
  });

  it.each([null, [], "#fff", 42])("rejects malformed override input %#", (overrides) => {
    expect(resolveColors(lightsDownBase, overrides)).toBeNull();
  });

  it("treats omitted and explicit undefined override arguments as empty", () => {
    expect(resolveColors(lightsDownBase, undefined)).toEqual(resolveColors(lightsDownBase));
  });

  it.each([{ Unknown: "#fff" }, { "surface.page ": "#fff" }, { "Surface.page": "#fff" }])(
    "rejects unknown, case-mismatched, and space-mismatched keys %#",
    (extra) => {
      expect(resolveColors({ ...lightsDownBase, ...extra })).toBeNull();
      expect(resolveColors(lightsDownBase, extra)).toBeNull();
    },
  );

  it("rejects symbol keys in bases and overrides", () => {
    const symbol = Symbol("color");
    expect(resolveColors({ ...lightsDownBase, [symbol]: "#fff" })).toBeNull();
    expect(resolveColors(lightsDownBase, { [symbol]: "#fff" })).toBeNull();
  });

  it("accepts non-enumerable own data properties", () => {
    const overrides = Object.defineProperty({}, "text.primary", {
      configurable: true,
      value: "rgb(255, 0, 128)",
    });

    expect(resolveColors(lightsDownBase, overrides)?.values["text.primary"]).toBe("#ff0080");
  });

  it("rejects accessors without invoking their getters", () => {
    let calls = 0;
    const overrides = Object.defineProperty({}, "text.primary", {
      get() {
        calls += 1;
        return "#fff";
      },
    });

    expect(resolveColors(lightsDownBase, overrides)).toBeNull();
    expect(calls).toBe(0);
  });

  it.each([undefined, null, "derived", "red", "#1234", "rgb(1 2 3 / 1)", "var(--color)"])(
    "rejects present invalid color value %j",
    (value) => {
      expect(resolveColors(lightsDownBase, { "feedback.warningBackground": value })).toBeNull();
    },
  );

  it("rejects custom prototypes and inherited properties while accepting null prototypes", () => {
    const inherited = Object.create({ "text.primary": "#fff" }) as Record<string, unknown>;
    Object.assign(inherited, lightsDownBase);
    expect(resolveColors(inherited)).toBeNull();

    const nullPrototypeBase = Object.assign(Object.create(null) as Record<string, unknown>, lightsDownBase);
    const nullPrototypeOverrides = Object.assign(Object.create(null) as Record<string, unknown>, {
      "text.primary": "#abc",
    });
    expect(resolveColors(nullPrototypeBase, nullPrototypeOverrides)?.values["text.primary"]).toBe("#aabbcc");
  });

  it("applies widget override, base widget, and final-core inheritance precedence", () => {
    const baseWithWidget = { ...lightsDownBase, "widget.text": "#222" };
    expect(resolveColors(baseWithWidget, { "text.primary": "#333" })?.values["widget.text"]).toBe("#222222");
    expect(
      resolveColors(baseWithWidget, {
        "text.primary": "#333",
        "widget.text": "#444",
      })?.values["widget.text"],
    ).toBe("#444444");

    const overrides: Record<string, unknown> = {
      "text.primary": "#333",
      "widget.text": "#444",
    };
    delete overrides["widget.text"];
    expect(resolveColors(lightsDownBase, overrides)?.values["widget.text"]).toBe("#333333");
  });

  it("restores derived or explicit base backgrounds when an override is deleted", () => {
    const overrides: Record<string, unknown> = { "feedback.warningBackground": "#123" };
    expect(resolveColors(lightsDownBase, overrides)?.feedbackBackgrounds["feedback.warningBackground"]).toBe("#112233");
    delete overrides["feedback.warningBackground"];
    expect(resolveColors(lightsDownBase, overrides)?.feedbackBackgrounds["feedback.warningBackground"]).toBeNull();
    expect(
      resolveColors({ ...lightsDownBase, "feedback.warningBackground": "#456" }, overrides)?.feedbackBackgrounds[
        "feedback.warningBackground"
      ],
    ).toBe("#445566");
  });

  it("keeps separately assigned core roles independent from accent changes", () => {
    const result = resolveColors(
      {
        ...lightsDownBase,
        "interaction.focus": "#111",
        "feedback.success": "#222",
        "interaction.selectedIndicator": "#333",
      },
      { "interaction.accent": "#fff" },
    );

    expect(result?.values["interaction.accent"]).toBe("#ffffff");
    expect(result?.values["interaction.focus"]).toBe("#111111");
    expect(result?.values["feedback.success"]).toBe("#222222");
    expect(result?.values["interaction.selectedIndicator"]).toBe("#333333");
    expect(result?.values["widget.accent"]).toBe("#ffffff");
  });

  it("does not mutate inputs and returns fresh deeply frozen results", () => {
    const base = Object.freeze({ ...lightsDownBase });
    const overrides = Object.freeze({ "text.primary": "#abc" });
    const first = resolveColors(base, overrides);
    const second = resolveColors(base, overrides);

    expect(base).toEqual(lightsDownBase);
    expect(overrides).toEqual({ "text.primary": "#abc" });
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.values)).toBe(true);
    expect(Object.isFrozen(first?.feedbackBackgrounds)).toBe(true);
    expect(() => {
      (first?.values as Record<CoreColorTokenId, string>)["text.primary"] = "#000000";
    }).toThrow(TypeError);
    expect(second?.values["text.primary"]).toBe("#aabbcc");
  });
});
