import type { FontId, ResolvedColors, ResolvedFonts } from "@runlog/themes";

export type PresentationScope = "app" | "widget";

const COLOR_PROPERTIES = {
  "surface.page": "--bg",
  "surface.panel": "--panel",
  "surface.raised": "--panel-2",
  "text.primary": "--text",
  "text.muted": "--muted",
  "text.onAccent": "--on-accent",
  "boundary.decorative": "--line",
  "boundary.control": "--control-boundary",
  "boundary.strong": "--line-2",
  "interaction.accent": "--accent",
  "interaction.accentTint": "--accent-dim",
  "interaction.selectedIndicator": "--selected-indicator",
  "interaction.focus": "--focus",
  "feedback.success": "--success",
  "feedback.warning": "--warn",
  "feedback.danger": "--err",
  "widget.ground": "--widget-ground",
  "widget.panel": "--widget-panel",
  "widget.text": "--widget-text",
  "widget.textMuted": "--widget-text-muted",
  "widget.accent": "--widget-accent",
  "feedback.successBackground": "--success-background",
  "feedback.warningBackground": "--warning-background",
  "feedback.dangerBackground": "--danger-background",
} as const;

const FONT_PROPERTIES = {
  ui: "--font-ui",
  prose: "--font-prose",
  numeric: "--font-mono",
  technical: "--font-technical",
  display: "--font-display",
  widgetUi: "--font-widget-ui",
  widgetProse: "--font-widget-prose",
  widgetNumeric: "--font-widget-mono",
  widgetTechnical: "--font-widget-technical",
  widgetDisplay: "--font-widget-display",
} as const;

const LEGACY_PROPERTIES = ["--surface", "--surface-raised", "--text-muted", "--danger", "--serif", "--mono"] as const;

const MANAGED_PROPERTIES = [
  ...Object.values(COLOR_PROPERTIES),
  ...Object.values(FONT_PROPERTIES),
  ...LEGACY_PROPERTIES,
  "color-scheme",
] as const;
type ManagedProperty = (typeof MANAGED_PROPERTIES)[number];

export type BrowserPresentation = Readonly<Record<ManagedProperty, string | null>>;

const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SYSTEM_SERIF = '"Iowan Old Style", "Palatino Linotype", Georgia, serif';
const SYSTEM_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const FONT_STACKS: Readonly<Record<FontId, string>> = Object.freeze({
  "system-sans": SYSTEM_SANS,
  "system-serif": SYSTEM_SERIF,
  "system-mono": SYSTEM_MONO,
  literata: `"Literata Variable", ${SYSTEM_SERIF}`,
  "ibm-plex-mono": `"IBM Plex Mono", ${SYSTEM_MONO}`,
  "atkinson-hyperlegible-next": `"Atkinson Hyperlegible Next Variable", ${SYSTEM_SANS}`,
  "space-grotesk": `"Space Grotesk Variable", ${SYSTEM_SANS}`,
  oxanium: `"Oxanium Variable", ${SYSTEM_SANS}`,
  vt323: `"VT323", ${SYSTEM_MONO}`,
  "press-start-2p": `"Press Start 2P", ${SYSTEM_MONO}`,
});

export function compilePresentation(
  colors: ResolvedColors,
  fonts: ResolvedFonts,
  colorScheme: "light" | "dark",
  scope: PresentationScope = "app",
): BrowserPresentation {
  const presentation = {
    "--bg": colors.values["surface.page"],
    "--panel": colors.values["surface.panel"],
    "--panel-2": colors.values["surface.raised"],
    "--text": colors.values["text.primary"],
    "--muted": colors.values["text.muted"],
    "--on-accent": colors.values["text.onAccent"],
    "--line": colors.values["boundary.decorative"],
    "--control-boundary": colors.values["boundary.control"],
    "--line-2": colors.values["boundary.strong"],
    "--accent": colors.values["interaction.accent"],
    "--accent-dim": colors.values["interaction.accentTint"],
    "--selected-indicator": colors.values["interaction.selectedIndicator"],
    "--focus": colors.values["interaction.focus"],
    "--success": colors.values["feedback.success"],
    "--warn": colors.values["feedback.warning"],
    "--err": colors.values["feedback.danger"],
    "--widget-ground": colors.values["widget.ground"],
    "--widget-panel": colors.values["widget.panel"],
    "--widget-text": colors.values["widget.text"],
    "--widget-text-muted": colors.values["widget.textMuted"],
    "--widget-accent": colors.values["widget.accent"],
    "--success-background": colors.feedbackBackgrounds["feedback.successBackground"],
    "--warning-background": colors.feedbackBackgrounds["feedback.warningBackground"],
    "--danger-background": colors.feedbackBackgrounds["feedback.dangerBackground"],
    "--font-ui": FONT_STACKS[fonts.ui],
    "--font-prose": FONT_STACKS[fonts.prose],
    "--font-mono": FONT_STACKS[fonts.numeric],
    "--font-technical": FONT_STACKS[fonts.technical],
    "--font-display": FONT_STACKS[fonts.display],
    "--font-widget-ui": FONT_STACKS[fonts.widgetUi],
    "--font-widget-prose": FONT_STACKS[fonts.widgetProse],
    "--font-widget-mono": FONT_STACKS[fonts.widgetNumeric],
    "--font-widget-technical": FONT_STACKS[fonts.widgetTechnical],
    "--font-widget-display": FONT_STACKS[fonts.widgetDisplay],
    "--surface": colors.values["surface.panel"],
    "--surface-raised": colors.values["surface.raised"],
    "--text-muted": colors.values["text.muted"],
    "--danger": colors.values["feedback.danger"],
    "--serif": FONT_STACKS[fonts.prose],
    "--mono": FONT_STACKS[fonts.numeric],
    "color-scheme": colorScheme,
  } satisfies Record<ManagedProperty, string | null>;

  if (scope === "widget") {
    presentation["--bg"] = colors.values["widget.ground"];
    presentation["--panel"] = colors.values["widget.panel"];
    presentation["--text"] = colors.values["widget.text"];
    presentation["--muted"] = colors.values["widget.textMuted"];
    presentation["--accent"] = colors.values["widget.accent"];
    presentation["--font-ui"] = FONT_STACKS[fonts.widgetUi];
    presentation["--font-prose"] = FONT_STACKS[fonts.widgetProse];
    presentation["--font-mono"] = FONT_STACKS[fonts.widgetNumeric];
    presentation["--font-technical"] = FONT_STACKS[fonts.widgetTechnical];
    presentation["--font-display"] = FONT_STACKS[fonts.widgetDisplay];
  }

  presentation["--surface"] = presentation["--panel"];
  presentation["--surface-raised"] = presentation["--panel-2"];
  presentation["--text-muted"] = presentation["--muted"];
  presentation["--danger"] = presentation["--err"];
  presentation["--serif"] = presentation["--font-prose"];
  presentation["--mono"] = presentation["--font-technical"];

  return Object.freeze(presentation);
}

export function applyPresentation(presentation: BrowserPresentation, root: HTMLElement): void {
  for (const property of MANAGED_PROPERTIES) {
    const value = presentation[property];
    if (value === null) root.style.removeProperty(property);
    else root.style.setProperty(property, value);
  }
}

export function clearPresentation(root: HTMLElement): void {
  for (const property of MANAGED_PROPERTIES) root.style.removeProperty(property);
}
