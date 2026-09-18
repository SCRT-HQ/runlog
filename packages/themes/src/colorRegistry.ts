export type CoreColorTokenId =
  | "surface.page"
  | "surface.panel"
  | "surface.raised"
  | "text.primary"
  | "text.muted"
  | "text.onAccent"
  | "boundary.decorative"
  | "boundary.control"
  | "boundary.strong"
  | "interaction.accent"
  | "interaction.accentTint"
  | "interaction.selectedIndicator"
  | "interaction.focus"
  | "feedback.success"
  | "feedback.warning"
  | "feedback.danger";

export type WidgetColorTokenId = "widget.ground" | "widget.panel" | "widget.text" | "widget.textMuted" | "widget.accent";

export type DecorationColorTokenId = "interaction.moveAccent";

export type FeedbackBackgroundTokenId = "feedback.successBackground" | "feedback.warningBackground" | "feedback.dangerBackground";

export type ColorTokenId = CoreColorTokenId | DecorationColorTokenId | WidgetColorTokenId | FeedbackBackgroundTokenId;

export type ColorTokenDefinition =
  | {
      readonly id: CoreColorTokenId;
      readonly label: string;
      readonly group: string;
      readonly kind: "core";
    }
  | {
      readonly id: DecorationColorTokenId;
      readonly label: string;
      readonly group: "interaction";
      readonly kind: "decoration";
      readonly inherits: CoreColorTokenId;
    }
  | {
      readonly id: WidgetColorTokenId;
      readonly label: string;
      readonly group: "widgets";
      readonly kind: "widget";
      readonly inherits: CoreColorTokenId;
    }
  | {
      readonly id: FeedbackBackgroundTokenId;
      readonly label: string;
      readonly group: "feedback";
      readonly kind: "feedbackBackground";
    };

const definitions = [
  { id: "surface.page", label: "Page background", group: "surfaces", kind: "core" },
  { id: "surface.panel", label: "Panel background", group: "surfaces", kind: "core" },
  { id: "surface.raised", label: "Raised surface", group: "surfaces", kind: "core" },
  { id: "text.primary", label: "Primary text", group: "text", kind: "core" },
  { id: "text.muted", label: "Secondary text", group: "text", kind: "core" },
  { id: "text.onAccent", label: "Text on accent", group: "text", kind: "core" },
  {
    id: "boundary.decorative",
    label: "Decorative divider",
    group: "boundaries",
    kind: "core",
  },
  { id: "boundary.control", label: "Control boundary", group: "boundaries", kind: "core" },
  { id: "boundary.strong", label: "Strong boundary", group: "boundaries", kind: "core" },
  { id: "interaction.accent", label: "Accent", group: "interaction", kind: "core" },
  {
    id: "interaction.accentTint",
    label: "Accent tint",
    group: "interaction",
    kind: "core",
  },
  {
    id: "interaction.selectedIndicator",
    label: "Selected indicator",
    group: "interaction",
    kind: "core",
  },
  {
    id: "interaction.moveAccent",
    label: "Move card accent",
    group: "interaction",
    kind: "decoration",
    inherits: "interaction.selectedIndicator",
  },
  {
    id: "interaction.focus",
    label: "Keyboard focus",
    group: "interaction",
    kind: "core",
  },
  { id: "feedback.success", label: "Success foreground", group: "feedback", kind: "core" },
  { id: "feedback.warning", label: "Warning foreground", group: "feedback", kind: "core" },
  { id: "feedback.danger", label: "Danger foreground", group: "feedback", kind: "core" },
  {
    id: "widget.ground",
    label: "Widget ground",
    group: "widgets",
    kind: "widget",
    inherits: "surface.page",
  },
  {
    id: "widget.panel",
    label: "Widget panel",
    group: "widgets",
    kind: "widget",
    inherits: "surface.panel",
  },
  {
    id: "widget.text",
    label: "Widget text",
    group: "widgets",
    kind: "widget",
    inherits: "text.primary",
  },
  {
    id: "widget.textMuted",
    label: "Widget secondary text",
    group: "widgets",
    kind: "widget",
    inherits: "text.muted",
  },
  {
    id: "widget.accent",
    label: "Widget accent",
    group: "widgets",
    kind: "widget",
    inherits: "interaction.accent",
  },
  {
    id: "feedback.successBackground",
    label: "Success background",
    group: "feedback",
    kind: "feedbackBackground",
  },
  {
    id: "feedback.warningBackground",
    label: "Warning background",
    group: "feedback",
    kind: "feedbackBackground",
  },
  {
    id: "feedback.dangerBackground",
    label: "Danger background",
    group: "feedback",
    kind: "feedbackBackground",
  },
] satisfies ColorTokenDefinition[];

export const COLOR_DEFINITIONS: readonly ColorTokenDefinition[] = Object.freeze(definitions.map((definition) => Object.freeze(definition)));

const colorTokenIds = new Set<string>(COLOR_DEFINITIONS.map(({ id }) => id));

export function isColorTokenId(value: unknown): value is ColorTokenId {
  return typeof value === "string" && colorTokenIds.has(value);
}
