import type { ColorTokenId } from "@runlog/themes";

export type ContrastKind = "text" | "nonText" | "focus";

export interface ContrastPairDefinition {
  readonly id: string;
  readonly contexts: readonly string[];
  readonly kind: ContrastKind;
  readonly minimum: 4.5 | 3;
  readonly foregroundRoles: readonly ColorTokenId[];
  readonly backgroundRoles: readonly ColorTokenId[];
  readonly suggestionRole: ColorTokenId;
}

export const CONTRAST_CATALOG_VERSION = "contrast-v1";

function pair(
  id: string,
  contexts: readonly string[],
  kind: ContrastKind,
  foregroundRoles: readonly ColorTokenId[],
  backgroundRoles: readonly ColorTokenId[],
  suggestionRole: ColorTokenId = foregroundRoles[0]!,
): ContrastPairDefinition {
  return Object.freeze({
    id,
    contexts: Object.freeze([...contexts]),
    kind,
    minimum: kind === "text" ? 4.5 : 3,
    foregroundRoles: Object.freeze([...foregroundRoles]),
    backgroundRoles: Object.freeze([...backgroundRoles]),
    suggestionRole,
  });
}

const surfaces = [
  ["page", "surface.page"],
  ["panel", "surface.panel"],
  ["raised", "surface.raised"],
] as const;

const textRoles = [
  ["primary", "text.primary", "primary text"],
  ["muted", "text.muted", "secondary text"],
  ["accent", "interaction.accent", "links and accent text"],
  ["success", "feedback.success", "success text and glyphs"],
  ["warning", "feedback.warning", "warning text and glyphs"],
  ["danger", "feedback.danger", "danger text and glyphs"],
] as const;

const definitions: ContrastPairDefinition[] = [];

for (const [name, role, context] of textRoles) {
  for (const [surface, surfaceRole] of surfaces) {
    definitions.push(pair(`app.text.${name}.${surface}`, [`${context} on ${surface} surfaces`], "text", [role], [surfaceRole]));
  }
}

definitions.push(
  pair("app.action.primary.rest", ["primary buttons"], "text", ["text.onAccent"], ["interaction.accent"]),
  pair("app.action.primary.hover", ["hovered primary buttons"], "text", ["text.onAccent"], ["interaction.accent", "text.primary"]),
  pair("app.action.destructive.rest", ["destructive primary buttons"], "text", ["text.onAccent"], ["feedback.warning"]),
  pair(
    "app.action.destructive.hover",
    ["hovered destructive primary buttons"],
    "text",
    ["text.onAccent"],
    ["feedback.warning", "text.primary"],
  ),
  pair("app.selection.text-primary.accent-tint", ["primary text on selected fills"], "text", ["text.primary"], ["interaction.accentTint"]),
  pair("app.selection.text-muted.accent-tint", ["secondary text on selected fills"], "text", ["text.muted"], ["interaction.accentTint"]),
  pair(
    "app.selection.text-primary.radio",
    ["checked setup radio primary text"],
    "text",
    ["text.primary"],
    ["interaction.accent", "surface.raised"],
  ),
  pair(
    "app.selection.text-muted.radio",
    ["checked setup radio secondary text"],
    "text",
    ["text.muted"],
    ["interaction.accent", "surface.raised"],
  ),
  pair(
    "app.selection.indicator.selected-raised",
    ["checked radio inner boundary"],
    "nonText",
    ["interaction.selectedIndicator"],
    ["interaction.accent", "surface.raised"],
  ),
);

for (const [surface, surfaceRole] of surfaces) {
  definitions.push(
    pair(`app.control.boundary.${surface}`, [`control boundaries on ${surface} surfaces`], "nonText", ["boundary.control"], [surfaceRole]),
  );
}
for (const [surface, surfaceRole] of surfaces) {
  definitions.push(
    pair(
      `app.control.focus-hover.${surface}`,
      [`keyboard focus rings and meaningful hover borders on ${surface} surfaces`],
      "focus",
      ["interaction.focus"],
      [surfaceRole],
    ),
  );
}
for (const [surface, surfaceRole] of surfaces) {
  definitions.push(
    pair(
      `app.selection.indicator.${surface}`,
      [`selected borders, rules and fills on ${surface} surfaces`],
      "nonText",
      ["interaction.selectedIndicator"],
      [surfaceRole],
    ),
  );
}

for (const [surface, surfaceRole] of surfaces) {
  definitions.push(
    pair(
      `app.feedback.warning-chip.${surface}`,
      [`warning chips on ${surface} surfaces`],
      "text",
      ["feedback.warning"],
      ["feedback.warningBackground", "feedback.warning", surfaceRole],
    ),
  );
}
definitions.push(
  pair(
    "app.feedback.notice.text",
    ["notice text"],
    "text",
    ["feedback.warning", "text.primary"],
    ["feedback.warningBackground", "feedback.warning", "surface.panel"],
    "feedback.warning",
  ),
  pair(
    "app.feedback.live-heat.text",
    ["live heat animation peak"],
    "text",
    ["text.primary"],
    ["feedback.warningBackground", "feedback.warning", "surface.panel"],
  ),
);
for (const [surface, surfaceRole] of surfaces) {
  definitions.push(
    pair(
      `app.feedback.ghost-danger-boundary.${surface}`,
      [`ghost danger boundaries on ${surface} surfaces`],
      "nonText",
      ["feedback.warning", "boundary.decorative"],
      [surfaceRole],
      "feedback.warning",
    ),
  );
}
for (const [surface, surfaceRole] of surfaces) {
  definitions.push(
    pair(
      `app.feedback.ghost-danger-hover.${surface}`,
      [`hovered ghost danger controls on ${surface} surfaces`],
      "text",
      ["feedback.warning"],
      ["feedback.dangerBackground", "feedback.warning", surfaceRole],
    ),
  );
}
definitions.push(
  pair(
    "app.feedback.danger-forget.text",
    ["forget action danger text"],
    "text",
    ["feedback.danger"],
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
  ),
  pair(
    "app.feedback.danger-threshold.text",
    ["danger threshold text"],
    "text",
    ["feedback.danger"],
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
  ),
  pair(
    "app.feedback.danger-signature.text",
    ["bad signature text"],
    "text",
    ["feedback.danger"],
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
  ),
  pair(
    "app.feedback.danger-incoming.text",
    ["bad incoming content text"],
    "text",
    ["text.primary"],
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
  ),
  pair(
    "app.feedback.danger-die.value",
    ["challenge die value"],
    "text",
    ["feedback.danger", "text.primary"],
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
    "feedback.danger",
  ),
  pair(
    "app.graphic.coverage-success",
    ["coverage success segment"],
    "nonText",
    ["feedback.successBackground", "interaction.accentTint"],
    ["surface.panel"],
    "feedback.successBackground",
  ),
  pair(
    "app.graphic.coverage-gap",
    ["coverage gap stripe"],
    "nonText",
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
    ["surface.panel"],
    "feedback.dangerBackground",
  ),
  pair(
    "app.graphic.coverage-over",
    ["coverage over segment"],
    "nonText",
    ["feedback.warningBackground", "feedback.warning"],
    ["surface.panel"],
    "feedback.warningBackground",
  ),
);

const widgetRoles = [
  ["primary", "widget.text", "widget primary text"],
  ["muted", "widget.textMuted", "widget secondary text"],
  ["accent", "widget.accent", "widget accent text"],
  ["success", "feedback.success", "widget ticker outcome"],
  ["warning", "feedback.warning", "widget ticker warning"],
] as const;
for (const [name, role, context] of widgetRoles) {
  definitions.push(
    pair(`widget.text.${name}.solid`, [`${context} in solid mode`], "text", [role], ["widget.panel", "widget.ground"]),
    pair(`widget.text.${name}.clear`, [`${context} in clear mode`], "text", [role], ["widget.panel"]),
    pair(`widget.text.${name}.none`, [`${context} in none mode`], "text", [role], []),
  );
}

export const CONTRAST_PAIRS: readonly ContrastPairDefinition[] = Object.freeze(definitions);
