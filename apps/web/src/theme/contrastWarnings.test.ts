import { describe, expect, it } from "vitest";

import {
  assessContrast,
  createThemeRecordFromPreset,
  parseOpaqueColor,
  presentationSnapshotKey,
  resolveThemeRecord,
  type HexColor,
  type PresentationSnapshotV1,
} from "@runlog/themes";

import { CONTRAST_PAIRS, type ContrastPairDefinition } from "./contrastCatalog.ts";
import { type BrowserColorSampler, type ContrastSamplingRequest } from "./browserColorSampler.ts";
import { isContrastAcknowledged, sampleContrastPairs } from "./contrastWarnings.ts";

function makeSnapshot(): PresentationSnapshotV1 {
  const record = createThemeRecordFromPreset({ id: "contrast", name: "Contrast", presetId: "rainbow-road" });
  if (!record.ok) throw new Error("record fixture");
  const snapshot = resolveThemeRecord(record.value);
  if (!snapshot.ok) throw new Error("snapshot fixture");
  return snapshot.value;
}

function makeSampler(
  snapshot: PresentationSnapshotV1,
  sample: (request: ContrastSamplingRequest, index: number) => { foreground: HexColor; background: HexColor } | null = () => ({
    foreground: parseOpaqueColor("#000")!,
    background: parseOpaqueColor("#fff")!,
  }),
): BrowserColorSampler & { readonly requests: ContrastSamplingRequest[] } {
  const requests: ContrastSamplingRequest[] = [];
  return {
    snapshotKey: presentationSnapshotKey(snapshot),
    requests,
    sample(request) {
      requests.push(request);
      return sample(request, requests.length - 1);
    },
    dispose() {},
  };
}

const EXACT_IDS = [
  "app.text.primary.page",
  "app.text.primary.panel",
  "app.text.primary.raised",
  "app.text.muted.page",
  "app.text.muted.panel",
  "app.text.muted.raised",
  "app.text.accent.page",
  "app.text.accent.panel",
  "app.text.accent.raised",
  "app.text.success.page",
  "app.text.success.panel",
  "app.text.success.raised",
  "app.text.warning.page",
  "app.text.warning.panel",
  "app.text.warning.raised",
  "app.text.danger.page",
  "app.text.danger.panel",
  "app.text.danger.raised",
  "app.action.primary.rest",
  "app.action.primary.hover",
  "app.action.destructive.rest",
  "app.action.destructive.hover",
  "app.selection.text-primary.accent-tint",
  "app.selection.text-muted.accent-tint",
  "app.selection.text-primary.radio",
  "app.selection.text-muted.radio",
  "app.selection.indicator.selected-raised",
  "app.control.boundary.page",
  "app.control.boundary.panel",
  "app.control.boundary.raised",
  "app.control.focus-hover.page",
  "app.control.focus-hover.panel",
  "app.control.focus-hover.raised",
  "app.selection.indicator.page",
  "app.selection.indicator.panel",
  "app.selection.indicator.raised",
  "app.feedback.warning-chip.page",
  "app.feedback.warning-chip.panel",
  "app.feedback.warning-chip.raised",
  "app.feedback.notice.text",
  "app.feedback.live-heat.text",
  "app.feedback.ghost-danger-boundary.page",
  "app.feedback.ghost-danger-boundary.panel",
  "app.feedback.ghost-danger-boundary.raised",
  "app.feedback.ghost-danger-hover.page",
  "app.feedback.ghost-danger-hover.panel",
  "app.feedback.ghost-danger-hover.raised",
  "app.feedback.danger-forget.text",
  "app.feedback.danger-threshold.text",
  "app.feedback.danger-signature.text",
  "app.feedback.danger-incoming.text",
  "app.feedback.danger-die.value",
  "app.graphic.coverage-success",
  "app.graphic.coverage-gap",
  "app.graphic.coverage-over",
  "widget.text.primary.solid",
  "widget.text.primary.clear",
  "widget.text.primary.none",
  "widget.text.muted.solid",
  "widget.text.muted.clear",
  "widget.text.muted.none",
  "widget.text.accent.solid",
  "widget.text.accent.clear",
  "widget.text.accent.none",
  "widget.text.success.solid",
  "widget.text.success.clear",
  "widget.text.success.none",
  "widget.text.warning.solid",
  "widget.text.warning.clear",
  "widget.text.warning.none",
] as const;

type ExpectedMetadata = readonly [
  contexts: readonly string[],
  kind: ContrastPairDefinition["kind"],
  minimum: ContrastPairDefinition["minimum"],
  foregroundRoles: ContrastPairDefinition["foregroundRoles"],
  backgroundRoles: ContrastPairDefinition["backgroundRoles"],
  suggestionRole: ContrastPairDefinition["suggestionRole"],
];

const EXPECTED_METADATA = {
  "app.text.primary.page": [["primary text on page surfaces"], "text", 4.5, ["text.primary"], ["surface.page"], "text.primary"],
  "app.text.primary.panel": [["primary text on panel surfaces"], "text", 4.5, ["text.primary"], ["surface.panel"], "text.primary"],
  "app.text.primary.raised": [["primary text on raised surfaces"], "text", 4.5, ["text.primary"], ["surface.raised"], "text.primary"],
  "app.text.muted.page": [["secondary text on page surfaces"], "text", 4.5, ["text.muted"], ["surface.page"], "text.muted"],
  "app.text.muted.panel": [["secondary text on panel surfaces"], "text", 4.5, ["text.muted"], ["surface.panel"], "text.muted"],
  "app.text.muted.raised": [["secondary text on raised surfaces"], "text", 4.5, ["text.muted"], ["surface.raised"], "text.muted"],
  "app.text.accent.page": [
    ["links and accent text on page surfaces"],
    "text",
    4.5,
    ["interaction.accent"],
    ["surface.page"],
    "interaction.accent",
  ],
  "app.text.accent.panel": [
    ["links and accent text on panel surfaces"],
    "text",
    4.5,
    ["interaction.accent"],
    ["surface.panel"],
    "interaction.accent",
  ],
  "app.text.accent.raised": [
    ["links and accent text on raised surfaces"],
    "text",
    4.5,
    ["interaction.accent"],
    ["surface.raised"],
    "interaction.accent",
  ],
  "app.text.success.page": [
    ["success text and glyphs on page surfaces"],
    "text",
    4.5,
    ["feedback.success"],
    ["surface.page"],
    "feedback.success",
  ],
  "app.text.success.panel": [
    ["success text and glyphs on panel surfaces"],
    "text",
    4.5,
    ["feedback.success"],
    ["surface.panel"],
    "feedback.success",
  ],
  "app.text.success.raised": [
    ["success text and glyphs on raised surfaces"],
    "text",
    4.5,
    ["feedback.success"],
    ["surface.raised"],
    "feedback.success",
  ],
  "app.text.warning.page": [
    ["warning text and glyphs on page surfaces"],
    "text",
    4.5,
    ["feedback.warning"],
    ["surface.page"],
    "feedback.warning",
  ],
  "app.text.warning.panel": [
    ["warning text and glyphs on panel surfaces"],
    "text",
    4.5,
    ["feedback.warning"],
    ["surface.panel"],
    "feedback.warning",
  ],
  "app.text.warning.raised": [
    ["warning text and glyphs on raised surfaces"],
    "text",
    4.5,
    ["feedback.warning"],
    ["surface.raised"],
    "feedback.warning",
  ],
  "app.text.danger.page": [
    ["danger text and glyphs on page surfaces"],
    "text",
    4.5,
    ["feedback.danger"],
    ["surface.page"],
    "feedback.danger",
  ],
  "app.text.danger.panel": [
    ["danger text and glyphs on panel surfaces"],
    "text",
    4.5,
    ["feedback.danger"],
    ["surface.panel"],
    "feedback.danger",
  ],
  "app.text.danger.raised": [
    ["danger text and glyphs on raised surfaces"],
    "text",
    4.5,
    ["feedback.danger"],
    ["surface.raised"],
    "feedback.danger",
  ],
  "app.action.primary.rest": [["primary buttons"], "text", 4.5, ["text.onAccent"], ["interaction.accent"], "text.onAccent"],
  "app.action.primary.hover": [
    ["hovered primary buttons"],
    "text",
    4.5,
    ["text.onAccent"],
    ["interaction.accent", "text.primary"],
    "text.onAccent",
  ],
  "app.action.destructive.rest": [["destructive primary buttons"], "text", 4.5, ["text.onAccent"], ["feedback.warning"], "text.onAccent"],
  "app.action.destructive.hover": [
    ["hovered destructive primary buttons"],
    "text",
    4.5,
    ["text.onAccent"],
    ["feedback.warning", "text.primary"],
    "text.onAccent",
  ],
  "app.selection.text-primary.accent-tint": [
    ["primary text on selected fills"],
    "text",
    4.5,
    ["text.primary"],
    ["interaction.accentTint"],
    "text.primary",
  ],
  "app.selection.text-muted.accent-tint": [
    ["secondary text on selected fills"],
    "text",
    4.5,
    ["text.muted"],
    ["interaction.accentTint"],
    "text.muted",
  ],
  "app.selection.text-primary.radio": [
    ["checked setup radio primary text"],
    "text",
    4.5,
    ["text.primary"],
    ["interaction.accent", "surface.raised"],
    "text.primary",
  ],
  "app.selection.text-muted.radio": [
    ["checked setup radio secondary text"],
    "text",
    4.5,
    ["text.muted"],
    ["interaction.accent", "surface.raised"],
    "text.muted",
  ],
  "app.selection.indicator.selected-raised": [
    ["checked radio inner boundary"],
    "nonText",
    3,
    ["interaction.selectedIndicator"],
    ["interaction.accent", "surface.raised"],
    "interaction.selectedIndicator",
  ],
  "app.control.boundary.page": [
    ["control boundaries on page surfaces"],
    "nonText",
    3,
    ["boundary.control"],
    ["surface.page"],
    "boundary.control",
  ],
  "app.control.boundary.panel": [
    ["control boundaries on panel surfaces"],
    "nonText",
    3,
    ["boundary.control"],
    ["surface.panel"],
    "boundary.control",
  ],
  "app.control.boundary.raised": [
    ["control boundaries on raised surfaces"],
    "nonText",
    3,
    ["boundary.control"],
    ["surface.raised"],
    "boundary.control",
  ],
  "app.control.focus-hover.page": [
    ["keyboard focus rings and meaningful hover borders on page surfaces"],
    "focus",
    3,
    ["interaction.focus"],
    ["surface.page"],
    "interaction.focus",
  ],
  "app.control.focus-hover.panel": [
    ["keyboard focus rings and meaningful hover borders on panel surfaces"],
    "focus",
    3,
    ["interaction.focus"],
    ["surface.panel"],
    "interaction.focus",
  ],
  "app.control.focus-hover.raised": [
    ["keyboard focus rings and meaningful hover borders on raised surfaces"],
    "focus",
    3,
    ["interaction.focus"],
    ["surface.raised"],
    "interaction.focus",
  ],
  "app.selection.indicator.page": [
    ["selected borders, rules and fills on page surfaces"],
    "nonText",
    3,
    ["interaction.selectedIndicator"],
    ["surface.page"],
    "interaction.selectedIndicator",
  ],
  "app.selection.indicator.panel": [
    ["selected borders, rules and fills on panel surfaces"],
    "nonText",
    3,
    ["interaction.selectedIndicator"],
    ["surface.panel"],
    "interaction.selectedIndicator",
  ],
  "app.selection.indicator.raised": [
    ["selected borders, rules and fills on raised surfaces"],
    "nonText",
    3,
    ["interaction.selectedIndicator"],
    ["surface.raised"],
    "interaction.selectedIndicator",
  ],
  "app.feedback.warning-chip.page": [
    ["warning chips on page surfaces"],
    "text",
    4.5,
    ["feedback.warning"],
    ["feedback.warningBackground", "feedback.warning", "surface.page"],
    "feedback.warning",
  ],
  "app.feedback.warning-chip.panel": [
    ["warning chips on panel surfaces"],
    "text",
    4.5,
    ["feedback.warning"],
    ["feedback.warningBackground", "feedback.warning", "surface.panel"],
    "feedback.warning",
  ],
  "app.feedback.warning-chip.raised": [
    ["warning chips on raised surfaces"],
    "text",
    4.5,
    ["feedback.warning"],
    ["feedback.warningBackground", "feedback.warning", "surface.raised"],
    "feedback.warning",
  ],
  "app.feedback.notice.text": [
    ["notice text"],
    "text",
    4.5,
    ["feedback.warning", "text.primary"],
    ["feedback.warningBackground", "feedback.warning", "surface.panel"],
    "feedback.warning",
  ],
  "app.feedback.live-heat.text": [
    ["live heat animation peak"],
    "text",
    4.5,
    ["text.primary"],
    ["feedback.warningBackground", "feedback.warning", "surface.panel"],
    "text.primary",
  ],
  "app.feedback.ghost-danger-boundary.page": [
    ["ghost danger boundaries on page surfaces"],
    "nonText",
    3,
    ["feedback.warning", "boundary.decorative"],
    ["surface.page"],
    "feedback.warning",
  ],
  "app.feedback.ghost-danger-boundary.panel": [
    ["ghost danger boundaries on panel surfaces"],
    "nonText",
    3,
    ["feedback.warning", "boundary.decorative"],
    ["surface.panel"],
    "feedback.warning",
  ],
  "app.feedback.ghost-danger-boundary.raised": [
    ["ghost danger boundaries on raised surfaces"],
    "nonText",
    3,
    ["feedback.warning", "boundary.decorative"],
    ["surface.raised"],
    "feedback.warning",
  ],
  "app.feedback.ghost-danger-hover.page": [
    ["hovered ghost danger controls on page surfaces"],
    "text",
    4.5,
    ["feedback.warning"],
    ["feedback.dangerBackground", "feedback.warning", "surface.page"],
    "feedback.warning",
  ],
  "app.feedback.ghost-danger-hover.panel": [
    ["hovered ghost danger controls on panel surfaces"],
    "text",
    4.5,
    ["feedback.warning"],
    ["feedback.dangerBackground", "feedback.warning", "surface.panel"],
    "feedback.warning",
  ],
  "app.feedback.ghost-danger-hover.raised": [
    ["hovered ghost danger controls on raised surfaces"],
    "text",
    4.5,
    ["feedback.warning"],
    ["feedback.dangerBackground", "feedback.warning", "surface.raised"],
    "feedback.warning",
  ],
  "app.feedback.danger-forget.text": [
    ["forget action danger text"],
    "text",
    4.5,
    ["feedback.danger"],
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
    "feedback.danger",
  ],
  "app.feedback.danger-threshold.text": [
    ["danger threshold text"],
    "text",
    4.5,
    ["feedback.danger"],
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
    "feedback.danger",
  ],
  "app.feedback.danger-signature.text": [
    ["bad signature text"],
    "text",
    4.5,
    ["feedback.danger"],
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
    "feedback.danger",
  ],
  "app.feedback.danger-incoming.text": [
    ["bad incoming content text"],
    "text",
    4.5,
    ["text.primary"],
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
    "text.primary",
  ],
  "app.feedback.danger-die.value": [
    ["challenge die value"],
    "text",
    4.5,
    ["feedback.danger", "text.primary"],
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
    "feedback.danger",
  ],
  "app.graphic.coverage-success": [
    ["coverage success segment"],
    "nonText",
    3,
    ["feedback.successBackground", "interaction.accentTint"],
    ["surface.panel"],
    "feedback.successBackground",
  ],
  "app.graphic.coverage-gap": [
    ["coverage gap stripe"],
    "nonText",
    3,
    ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
    ["surface.panel"],
    "feedback.dangerBackground",
  ],
  "app.graphic.coverage-over": [
    ["coverage over segment"],
    "nonText",
    3,
    ["feedback.warningBackground", "feedback.warning"],
    ["surface.panel"],
    "feedback.warningBackground",
  ],
  "widget.text.primary.solid": [
    ["widget primary text in solid mode"],
    "text",
    4.5,
    ["widget.text"],
    ["widget.panel", "widget.ground"],
    "widget.text",
  ],
  "widget.text.primary.clear": [["widget primary text in clear mode"], "text", 4.5, ["widget.text"], ["widget.panel"], "widget.text"],
  "widget.text.primary.none": [["widget primary text in none mode"], "text", 4.5, ["widget.text"], [], "widget.text"],
  "widget.text.muted.solid": [
    ["widget secondary text in solid mode"],
    "text",
    4.5,
    ["widget.textMuted"],
    ["widget.panel", "widget.ground"],
    "widget.textMuted",
  ],
  "widget.text.muted.clear": [
    ["widget secondary text in clear mode"],
    "text",
    4.5,
    ["widget.textMuted"],
    ["widget.panel"],
    "widget.textMuted",
  ],
  "widget.text.muted.none": [["widget secondary text in none mode"], "text", 4.5, ["widget.textMuted"], [], "widget.textMuted"],
  "widget.text.accent.solid": [
    ["widget accent text in solid mode"],
    "text",
    4.5,
    ["widget.accent"],
    ["widget.panel", "widget.ground"],
    "widget.accent",
  ],
  "widget.text.accent.clear": [["widget accent text in clear mode"], "text", 4.5, ["widget.accent"], ["widget.panel"], "widget.accent"],
  "widget.text.accent.none": [["widget accent text in none mode"], "text", 4.5, ["widget.accent"], [], "widget.accent"],
  "widget.text.success.solid": [
    ["widget ticker outcome in solid mode"],
    "text",
    4.5,
    ["feedback.success"],
    ["widget.panel", "widget.ground"],
    "feedback.success",
  ],
  "widget.text.success.clear": [
    ["widget ticker outcome in clear mode"],
    "text",
    4.5,
    ["feedback.success"],
    ["widget.panel"],
    "feedback.success",
  ],
  "widget.text.success.none": [["widget ticker outcome in none mode"], "text", 4.5, ["feedback.success"], [], "feedback.success"],
  "widget.text.warning.solid": [
    ["widget ticker warning in solid mode"],
    "text",
    4.5,
    ["feedback.warning"],
    ["widget.panel", "widget.ground"],
    "feedback.warning",
  ],
  "widget.text.warning.clear": [
    ["widget ticker warning in clear mode"],
    "text",
    4.5,
    ["feedback.warning"],
    ["widget.panel"],
    "feedback.warning",
  ],
  "widget.text.warning.none": [["widget ticker warning in none mode"], "text", 4.5, ["feedback.warning"], [], "feedback.warning"],
} satisfies Record<(typeof EXACT_IDS)[number], ExpectedMetadata>;

describe("the closed contrast catalog", () => {
  it("contains exactly the 70 stable unique pair IDs", () => {
    expect(CONTRAST_PAIRS.map(({ id }) => id)).toEqual(EXACT_IDS);
    expect(new Set(CONTRAST_PAIRS.map(({ id }) => id)).size).toBe(70);
  });

  it("pins every pair's contexts, kind, threshold, role arrays and suggestion role", () => {
    expect(Object.keys(EXPECTED_METADATA)).toEqual(EXACT_IDS);
    for (const pair of CONTRAST_PAIRS) {
      expect([pair.contexts, pair.kind, pair.minimum, pair.foregroundRoles, pair.backgroundRoles, pair.suggestionRole], pair.id).toEqual(
        EXPECTED_METADATA[pair.id as keyof typeof EXPECTED_METADATA],
      );
    }
  });

  it("keeps decorative roles out of mandatory checks and freezes the catalog", () => {
    expect(
      CONTRAST_PAIRS.some(({ foregroundRoles, backgroundRoles }) =>
        [...foregroundRoles, ...backgroundRoles].some((role) => role.includes("moveAccent")),
      ),
    ).toBe(false);
    expect(CONTRAST_PAIRS.some(({ foregroundRoles }) => foregroundRoles.length === 1 && foregroundRoles[0] === "boundary.decorative")).toBe(
      false,
    );
    expect(CONTRAST_PAIRS.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(CONTRAST_PAIRS)).toBe(true);
  });
});

describe("contrast report evaluation", () => {
  it("uses raw ratios at threshold boundaries and keeps sampler failures unavailable", () => {
    const snapshot = makeSnapshot();
    const sampler = makeSampler(snapshot, (_request, index) => {
      if (index === 0) return { foreground: parseOpaqueColor("#777")!, background: parseOpaqueColor("#fff")! };
      if (index === 1) throw new Error("readback failed");
      if (index === 2) return null;
      return { foreground: parseOpaqueColor("#000")!, background: parseOpaqueColor("#fff")! };
    });

    const report = sampleContrastPairs(snapshot, { widgetPreviewBackdrop: parseOpaqueColor("#123456") }, sampler);

    expect(Number(report.pairs[0]!.ratio!.toFixed(1))).toBe(4.5);
    expect(report.pairs[0]).toMatchObject({ status: "fail", foreground: "#777777", background: "#ffffff" });
    expect(report.pairs[0]!.ratio).toBe(assessContrast(parseOpaqueColor("#777")!, parseOpaqueColor("#fff")!, 4.5).ratio);
    expect(report.pairs[1]).toMatchObject({ status: "unsupported", ratio: null, foreground: null, background: null });
    expect(report.pairs[2]).toMatchObject({ status: "unsupported", ratio: null, foreground: null, background: null });
    expect(report.failures.map(({ id }) => id)).toEqual(["app.text.primary.page"]);
    expect(report.summary).toBe("Contrast warnings");
    expect(report.notices).toEqual(["External background not verified"]);
    for (const result of report.pairs) {
      expect(result.suggestion, result.id).toContain(result.suggestionRole);
      for (const context of result.contexts) expect(result.suggestion, `${result.id}/${context}`).toContain(context);
    }
  });

  it("makes solid widgets definitive and external modes conditional or unverified", () => {
    const snapshot = makeSnapshot();
    const sampled = makeSampler(snapshot);
    const withBackdrop = sampleContrastPairs(snapshot, { widgetPreviewBackdrop: parseOpaqueColor("#ABC") }, sampled);

    expect(withBackdrop.pairs.find(({ id }) => id === "widget.text.primary.solid")?.status).toBe("pass");
    expect(withBackdrop.pairs.find(({ id }) => id === "widget.text.primary.clear")?.status).toBe("conditional-pass");
    expect(withBackdrop.pairs.find(({ id }) => id === "widget.text.primary.none")?.status).toBe("conditional-pass");
    expect(sampled.requests.find((request) => request.backgroundCss.includes("82%"))).toMatchObject({
      scope: "widget",
      backdropCss: "#aabbcc",
    });

    const noBackdropSampler = makeSampler(snapshot);
    const withoutBackdrop = sampleContrastPairs(snapshot, { widgetPreviewBackdrop: null }, noBackdropSampler);
    for (const result of withoutBackdrop.pairs.filter(({ id }) => id.endsWith(".clear") || id.endsWith(".none"))) {
      expect(result).toMatchObject({ status: "unverified", ratio: null, foreground: null, background: null });
    }
    expect(noBackdropSampler.requests).toHaveLength(60);
    expect(withoutBackdrop.notices).toEqual(["External background not verified"]);
    expect(withoutBackdrop.summary).toBe("Passes checked contrast pairs");
  });

  it("uses every literal CSS recipe and lets explicit feedback backgrounds win", () => {
    const derived = makeSnapshot();
    const derivedSampler = makeSampler(derived);
    sampleContrastPairs(derived, { widgetPreviewBackdrop: parseOpaqueColor("#fff") }, derivedSampler);
    const requestFor = (id: string) => derivedSampler.requests[CONTRAST_PAIRS.findIndex((pair) => pair.id === id)];

    expect(requestFor("app.action.primary.hover")).toMatchObject({
      foregroundCss: "var(--on-accent)",
      backgroundCss: "color-mix(in oklab, var(--accent) 85%, var(--text))",
    });
    expect(requestFor("app.action.destructive.hover")?.backgroundCss).toBe("color-mix(in oklab, var(--warn) 85%, var(--text))");
    expect(requestFor("app.feedback.warning-chip.panel")?.backgroundCss).toBe("color-mix(in oklab, var(--warn) 14%, transparent)");
    expect(requestFor("app.feedback.notice.text")).toMatchObject({
      foregroundCss: "color-mix(in oklab, var(--warn) 55%, var(--text))",
      backgroundCss: "color-mix(in oklab, var(--warn) 12%, var(--panel))",
    });
    expect(requestFor("app.feedback.live-heat.text")?.backgroundCss).toBe("color-mix(in oklab, var(--warn) 35%, transparent)");
    expect(requestFor("app.feedback.ghost-danger-boundary.page")?.foregroundCss).toBe("color-mix(in oklab, var(--warn) 40%, var(--line))");
    expect(requestFor("app.feedback.ghost-danger-hover.raised")?.backgroundCss).toBe("color-mix(in oklab, var(--warn) 10%, transparent)");
    for (const [id, percent] of [
      ["app.feedback.danger-forget.text", 12],
      ["app.feedback.danger-threshold.text", 8],
      ["app.feedback.danger-signature.text", 10],
      ["app.feedback.danger-incoming.text", 10],
    ] as const) {
      expect(requestFor(id)?.backgroundCss).toBe(`color-mix(in oklab, var(--err) ${percent}%, var(--panel))`);
    }
    expect(requestFor("app.feedback.danger-die.value")).toMatchObject({
      foregroundCss: "color-mix(in oklab, var(--err) 60%, var(--text))",
      backgroundCss: "color-mix(in oklab, var(--err) 18%, var(--panel))",
    });
    expect(requestFor("app.graphic.coverage-gap")?.foregroundCss).toBe("color-mix(in oklab, var(--err) 25%, var(--panel))");
    expect(requestFor("widget.text.primary.solid")?.backgroundCss).toBe("color-mix(in srgb, var(--panel) 92%, transparent)");
    expect(requestFor("widget.text.primary.clear")?.backgroundCss).toBe("color-mix(in srgb, var(--panel) 82%, transparent)");
    expect(requestFor("widget.text.primary.none")?.backgroundCss).toBe("transparent");

    const explicit = {
      ...derived,
      feedbackBackgrounds: {
        "feedback.successBackground": { mode: "explicit" as const, color: parseOpaqueColor("#010203")! },
        "feedback.warningBackground": { mode: "explicit" as const, color: parseOpaqueColor("#040506")! },
        "feedback.dangerBackground": { mode: "explicit" as const, color: parseOpaqueColor("#070809")! },
      },
    };
    const explicitSampler = makeSampler(explicit);
    sampleContrastPairs(explicit, { widgetPreviewBackdrop: parseOpaqueColor("#fff") }, explicitSampler);
    const explicitBranches = {
      "app.feedback.warning-chip.page": ["backgroundCss", "var(--warning-background)"],
      "app.feedback.warning-chip.panel": ["backgroundCss", "var(--warning-background)"],
      "app.feedback.warning-chip.raised": ["backgroundCss", "var(--warning-background)"],
      "app.feedback.notice.text": ["backgroundCss", "var(--warning-background)"],
      "app.feedback.live-heat.text": ["backgroundCss", "var(--warning-background)"],
      "app.feedback.ghost-danger-hover.page": ["backgroundCss", "var(--danger-background)"],
      "app.feedback.ghost-danger-hover.panel": ["backgroundCss", "var(--danger-background)"],
      "app.feedback.ghost-danger-hover.raised": ["backgroundCss", "var(--danger-background)"],
      "app.feedback.danger-forget.text": ["backgroundCss", "var(--danger-background)"],
      "app.feedback.danger-threshold.text": ["backgroundCss", "var(--danger-background)"],
      "app.feedback.danger-signature.text": ["backgroundCss", "var(--danger-background)"],
      "app.feedback.danger-incoming.text": ["backgroundCss", "var(--danger-background)"],
      "app.feedback.danger-die.value": ["backgroundCss", "var(--danger-background)"],
      "app.graphic.coverage-success": ["foregroundCss", "var(--success-background)"],
      "app.graphic.coverage-gap": ["foregroundCss", "var(--danger-background)"],
      "app.graphic.coverage-over": ["foregroundCss", "var(--warning-background)"],
    } as const;
    expect(
      CONTRAST_PAIRS.filter(({ foregroundRoles, backgroundRoles }) =>
        [...foregroundRoles, ...backgroundRoles].some((role) => role.endsWith("Background")),
      ).map(({ id }) => id),
    ).toEqual(Object.keys(explicitBranches));
    for (const [id, [side, css]] of Object.entries(explicitBranches)) {
      const index = CONTRAST_PAIRS.findIndex((pair) => pair.id === id);
      expect(explicitSampler.requests[index]?.[side], id).toBe(css);
    }
  });

  it("normalizes keys, rejects stale samplers and invalid inputs, and keys every appearance category", () => {
    const snapshot = makeSnapshot();
    const sampler = makeSampler(snapshot);
    const normalized = sampleContrastPairs(snapshot, { widgetPreviewBackdrop: "#ABC" as HexColor }, sampler);
    const canonical = sampleContrastPairs(snapshot, { widgetPreviewBackdrop: parseOpaqueColor("#aabbcc") }, makeSampler(snapshot));
    expect(normalized.acknowledgementKey).toBe(canonical.acknowledgementKey);
    expect(normalized.acknowledgementKey).toBe(`contrast-v1\0${presentationSnapshotKey(snapshot)}\0#aabbcc`);

    const noBackdrop = sampleContrastPairs(snapshot, { widgetPreviewBackdrop: null }, makeSampler(snapshot));
    expect(noBackdrop.acknowledgementKey).not.toBe(normalized.acknowledgementKey);
    const appearanceChanges: PresentationSnapshotV1[] = [
      { ...snapshot, colorScheme: snapshot.colorScheme === "dark" ? "light" : "dark" },
      { ...snapshot, colors: { ...snapshot.colors, "surface.page": parseOpaqueColor("#010101")! } },
      { ...snapshot, fonts: { ...snapshot.fonts, ui: snapshot.fonts.ui === "system-sans" ? "system-serif" : "system-sans" } },
      {
        ...snapshot,
        feedbackBackgrounds: {
          ...snapshot.feedbackBackgrounds,
          "feedback.warningBackground": { mode: "explicit", color: parseOpaqueColor("#010203")! },
        },
      },
    ];
    for (const changed of appearanceChanges) {
      const changedReport = sampleContrastPairs(changed, { widgetPreviewBackdrop: parseOpaqueColor("#aabbcc") }, makeSampler(changed));
      expect(changedReport.acknowledgementKey).not.toBe(normalized.acknowledgementKey);
    }

    expect(() => sampleContrastPairs(snapshot, { widgetPreviewBackdrop: "red" as HexColor }, sampler)).toThrow(TypeError);
    expect(() =>
      sampleContrastPairs(
        { ...snapshot, colors: { ...snapshot.colors, "surface.page": "bad" as HexColor } },
        { widgetPreviewBackdrop: null },
        sampler,
      ),
    ).toThrow(TypeError);
    expect(() => sampleContrastPairs(snapshot, { widgetPreviewBackdrop: null }, { ...sampler, snapshotKey: "stale" })).toThrow(TypeError);
  });

  it("compares acknowledgement exactly without mutating or hiding warnings", () => {
    const snapshot = makeSnapshot();
    const report = sampleContrastPairs(
      snapshot,
      { widgetPreviewBackdrop: parseOpaqueColor("#fff") },
      makeSampler(snapshot, () => ({ foreground: parseOpaqueColor("#777")!, background: parseOpaqueColor("#fff")! })),
    );
    const before = JSON.stringify(report);

    expect(isContrastAcknowledged(report, report.acknowledgementKey)).toBe(true);
    expect(isContrastAcknowledged(report, `${report.acknowledgementKey} `)).toBe(false);
    expect(isContrastAcknowledged(report, null)).toBe(false);
    expect(JSON.stringify(report)).toBe(before);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.pairs)).toBe(true);
    expect(report.pairs.every(Object.isFrozen)).toBe(true);
  });
});
