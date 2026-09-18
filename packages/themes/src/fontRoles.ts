import type { AppFontRole, FontRole } from "./fonts.ts";

export interface FontRoleDefinition {
  readonly id: FontRole;
  readonly label: string;
  readonly group: "app" | "widgets";
  readonly inherits?: AppFontRole;
}

const definitions = [
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
] satisfies FontRoleDefinition[];

export const FONT_ROLE_DEFINITIONS: readonly FontRoleDefinition[] = Object.freeze(
  definitions.map((definition) => Object.freeze(definition)),
);
