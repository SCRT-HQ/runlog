import type { CoreColorTokenId, DecorationColorTokenId, FeedbackBackgroundTokenId, WidgetColorTokenId } from "./colorRegistry.ts";
import type { FontRole } from "./fonts.ts";
import { parsePresentationSnapshot, type PresentationSnapshotV1 } from "./snapshot.ts";
import { invalid, type ThemeValidationResult } from "./validation.ts";

/**
 * A presentation snapshot small enough to travel in a widget's address.
 *
 * Version 1 is positional text: `1.<d|l>.<25 colors as 150 hex digits>.<3 feedback
 * backgrounds, each - or 6 hex digits>.<10 font ids>`, dot separated and lowercase,
 * so it needs no escaping in a URL. It carries presentation values only: no theme
 * name, theme id or account. The orders below are frozen for version 1; a token
 * added to the registry is a new version, never a reshuffle of this one.
 */
export const PRESENTATION_PIN_MAX_LENGTH = 512;

export const PRESENTATION_PIN_V1_COLORS = Object.freeze([
  "surface.page",
  "surface.panel",
  "surface.raised",
  "text.primary",
  "text.muted",
  "text.onAccent",
  "boundary.decorative",
  "boundary.control",
  "boundary.strong",
  "interaction.accent",
  "interaction.accentTint",
  "interaction.selectedIndicator",
  "interaction.moveAccent",
  "interaction.moveAccent2",
  "interaction.moveAccent3",
  "interaction.moveAccent4",
  "interaction.focus",
  "feedback.success",
  "feedback.warning",
  "feedback.danger",
  "widget.ground",
  "widget.panel",
  "widget.text",
  "widget.textMuted",
  "widget.accent",
] as const satisfies readonly (CoreColorTokenId | DecorationColorTokenId | WidgetColorTokenId)[]);

export const PRESENTATION_PIN_V1_FEEDBACK = Object.freeze([
  "feedback.successBackground",
  "feedback.warningBackground",
  "feedback.dangerBackground",
] as const satisfies readonly FeedbackBackgroundTokenId[]);

export const PRESENTATION_PIN_V1_FONTS = Object.freeze([
  "ui",
  "prose",
  "numeric",
  "technical",
  "display",
  "widgetUi",
  "widgetProse",
  "widgetNumeric",
  "widgetTechnical",
  "widgetDisplay",
] as const satisfies readonly FontRole[]);

const FEEDBACK = "(-|[0-9a-f]{6})";
const V1 = new RegExp(
  `^1\\.([dl])\\.([0-9a-f]{${PRESENTATION_PIN_V1_COLORS.length * 6}})\\.${FEEDBACK}\\.${FEEDBACK}\\.${FEEDBACK}((?:\\.[a-z0-9-]{1,32}){${PRESENTATION_PIN_V1_FONTS.length}})$`,
);

export function encodePresentationPin(input: PresentationSnapshotV1): string {
  const parsed = parsePresentationSnapshot(input);
  if (!parsed.ok) throw new TypeError(`Invalid presentation snapshot at ${parsed.issues[0]?.path ?? "$"}`);
  const snapshot = parsed.value;
  const text = [
    "1",
    snapshot.colorScheme === "dark" ? "d" : "l",
    PRESENTATION_PIN_V1_COLORS.map((id) => snapshot.colors[id].slice(1)).join(""),
    ...PRESENTATION_PIN_V1_FEEDBACK.map((id) => {
      const background = snapshot.feedbackBackgrounds[id];
      return background.mode === "derived" ? "-" : background.color.slice(1);
    }),
    ...PRESENTATION_PIN_V1_FONTS.map((role) => snapshot.fonts[role]),
  ].join(".");
  if (text.length > PRESENTATION_PIN_MAX_LENGTH) throw new RangeError("Pinned theme is longer than an address allows");
  return text;
}

export function decodePresentationPin(input: unknown): ThemeValidationResult<PresentationSnapshotV1> {
  if (typeof input !== "string") return invalid("$", "Expected pinned theme text");
  if (input.length === 0 || input.length > PRESENTATION_PIN_MAX_LENGTH) return invalid("$", "Pinned theme is empty or too long");
  if (!input.startsWith("1.")) return invalid("$", "Unsupported pinned theme version");
  const match = V1.exec(input);
  if (match === null) return invalid("$", "Malformed pinned theme");
  const [, scheme, hex, success, warning, danger, fontTail] = match as unknown as readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const colors: Record<string, string> = {};
  PRESENTATION_PIN_V1_COLORS.forEach((id, index) => {
    colors[id] = `#${hex.slice(index * 6, index * 6 + 6)}`;
  });
  const feedbackBackgrounds: Record<string, unknown> = {};
  [success, warning, danger].forEach((value, index) => {
    feedbackBackgrounds[PRESENTATION_PIN_V1_FEEDBACK[index]!] =
      value === "-" ? { mode: "derived" } : { mode: "explicit", color: `#${value}` };
  });
  const fontIds = fontTail.slice(1).split(".");
  const fonts: Record<string, string> = {};
  PRESENTATION_PIN_V1_FONTS.forEach((role, index) => {
    fonts[role] = fontIds[index]!;
  });

  return parsePresentationSnapshot({
    schemaVersion: 1,
    tokenVersion: 1,
    colorScheme: scheme === "d" ? "dark" : "light",
    colors,
    feedbackBackgrounds,
    fonts,
  });
}
