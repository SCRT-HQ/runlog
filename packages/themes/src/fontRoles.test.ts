import { describe, expect, it } from "vitest";

import { FONT_ROLE_DEFINITIONS } from "./index.ts";

describe("font role metadata", () => {
  it("publishes the ordered app and widget roles with exact labels and inheritance", () => {
    expect(FONT_ROLE_DEFINITIONS).toEqual([
      { id: "ui", label: "UI and controls", group: "app" },
      { id: "prose", label: "Prose", group: "app" },
      { id: "numeric", label: "Numeric readouts", group: "app" },
      { id: "technical", label: "Technical text", group: "app" },
      { id: "display", label: "Display headings", group: "app" },
      { id: "widgetUi", label: "Widget UI and controls", group: "widgets", inherits: "ui" },
      { id: "widgetProse", label: "Widget prose", group: "widgets", inherits: "prose" },
      { id: "widgetNumeric", label: "Widget numeric readouts", group: "widgets", inherits: "numeric" },
      { id: "widgetTechnical", label: "Widget technical text", group: "widgets", inherits: "technical" },
      { id: "widgetDisplay", label: "Widget display headings", group: "widgets", inherits: "display" },
    ]);
  });

  it("freezes the collection and every entry", () => {
    expect(Object.isFrozen(FONT_ROLE_DEFINITIONS)).toBe(true);
    expect(FONT_ROLE_DEFINITIONS.every(Object.isFrozen)).toBe(true);
    expect(() => {
      (FONT_ROLE_DEFINITIONS[0] as { label: string }).label = "Changed";
    }).toThrow(TypeError);
  });
});
