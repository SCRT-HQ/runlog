import { assessContrast, parseOpaqueColor, presentationSnapshotKey, type HexColor, type PresentationSnapshotV1 } from "@runlog/themes";

import { CONTRAST_CATALOG_VERSION, CONTRAST_PAIRS, type ContrastPairDefinition } from "./contrastCatalog.ts";
import type { BrowserColorSampler, ContrastSamplingRequest } from "./browserColorSampler.ts";

export type ContrastStatus = "pass" | "fail" | "conditional-pass" | "conditional-fail" | "unverified" | "unsupported";

export interface ContrastPairResult extends ContrastPairDefinition {
  readonly status: ContrastStatus;
  readonly ratio: number | null;
  readonly foreground: HexColor | null;
  readonly background: HexColor | null;
  readonly suggestion: string;
}

export interface ContrastReport {
  readonly snapshotKey: string;
  readonly acknowledgementKey: string;
  readonly pairs: readonly ContrastPairResult[];
  readonly failures: readonly ContrastPairResult[];
  readonly notices: readonly string[];
  readonly summary: "Passes checked contrast pairs" | "Contrast warnings" | "Some contrast checks unavailable";
}

const roleCss = {
  "surface.page": "var(--bg)",
  "surface.panel": "var(--panel)",
  "surface.raised": "var(--panel-2)",
  "text.primary": "var(--text)",
  "text.muted": "var(--muted)",
  "text.onAccent": "var(--on-accent)",
  "boundary.decorative": "var(--line)",
  "boundary.control": "var(--control-boundary)",
  "interaction.accent": "var(--accent)",
  "interaction.accentTint": "var(--accent-dim)",
  "interaction.selectedIndicator": "var(--selected-indicator)",
  "interaction.focus": "var(--focus)",
  "feedback.success": "var(--success)",
  "feedback.warning": "var(--warn)",
  "feedback.danger": "var(--err)",
  "widget.text": "var(--text)",
  "widget.textMuted": "var(--muted)",
  "widget.accent": "var(--accent)",
} as const;

type SurfaceName = "page" | "panel" | "raised";

function surfaceCss(name: SurfaceName): string {
  return roleCss[name === "page" ? "surface.page" : name === "panel" ? "surface.panel" : "surface.raised"];
}

function appRequest(foregroundCss: string, backgroundCss: string, backdropCss: string = roleCss["surface.page"]): ContrastSamplingRequest {
  return { scope: "app", foregroundCss, backgroundCss, backdropCss };
}

function feedbackCss(snapshot: PresentationSnapshotV1, name: "success" | "warning" | "danger", fallback: string): string {
  return snapshot.feedbackBackgrounds[`feedback.${name}Background`].mode === "explicit" ? `var(--${name}-background)` : fallback;
}

function requestFor(
  pair: ContrastPairDefinition,
  snapshot: PresentationSnapshotV1,
  previewBackdrop: HexColor | null,
): ContrastSamplingRequest | null {
  const id = pair.id;
  if (id.startsWith("app.text.")) {
    const [, , role, surface] = id.split(".") as [
      string,
      string,
      "primary" | "muted" | "accent" | "success" | "warning" | "danger",
      SurfaceName,
    ];
    const foregroundRole =
      role === "primary"
        ? "text.primary"
        : role === "muted"
          ? "text.muted"
          : role === "accent"
            ? "interaction.accent"
            : (`feedback.${role}` as "feedback.success" | "feedback.warning" | "feedback.danger");
    const backgroundCss = surfaceCss(surface);
    return appRequest(roleCss[foregroundRole], backgroundCss, backgroundCss);
  }

  const fixed: Readonly<Record<string, ContrastSamplingRequest>> = {
    "app.action.primary.rest": appRequest("var(--on-accent)", "var(--accent)"),
    "app.action.primary.hover": appRequest("var(--on-accent)", "color-mix(in oklab, var(--accent) 85%, var(--text))"),
    "app.action.destructive.rest": appRequest("var(--on-accent)", "var(--warn)"),
    "app.action.destructive.hover": appRequest("var(--on-accent)", "color-mix(in oklab, var(--warn) 85%, var(--text))"),
    "app.selection.text-primary.accent-tint": appRequest("var(--text)", "var(--accent-dim)"),
    "app.selection.text-muted.accent-tint": appRequest("var(--muted)", "var(--accent-dim)"),
    "app.selection.text-primary.radio": appRequest("var(--text)", "color-mix(in oklab, var(--accent) 10%, var(--panel-2))"),
    "app.selection.text-muted.radio": appRequest("var(--muted)", "color-mix(in oklab, var(--accent) 10%, var(--panel-2))"),
    "app.selection.indicator.selected-raised": appRequest(
      "var(--selected-indicator)",
      "color-mix(in oklab, var(--accent) 10%, var(--panel-2))",
    ),
  };
  if (fixed[id]) return fixed[id];

  for (const [prefix, foregroundCss] of [
    ["app.control.boundary.", "var(--control-boundary)"],
    ["app.control.focus-hover.", "var(--focus)"],
    ["app.selection.indicator.", "var(--selected-indicator)"],
  ] as const) {
    if (id.startsWith(prefix)) {
      const backgroundCss = surfaceCss(id.slice(prefix.length) as SurfaceName);
      return appRequest(foregroundCss, backgroundCss, backgroundCss);
    }
  }

  if (id.startsWith("app.feedback.warning-chip.")) {
    const surface = surfaceCss(id.slice("app.feedback.warning-chip.".length) as SurfaceName);
    return appRequest("var(--warn)", feedbackCss(snapshot, "warning", "color-mix(in oklab, var(--warn) 14%, transparent)"), surface);
  }
  if (id === "app.feedback.notice.text") {
    return appRequest(
      "color-mix(in oklab, var(--warn) 55%, var(--text))",
      feedbackCss(snapshot, "warning", "color-mix(in oklab, var(--warn) 12%, var(--panel))"),
      "var(--panel)",
    );
  }
  if (id === "app.feedback.live-heat.text") {
    return appRequest("var(--text)", feedbackCss(snapshot, "warning", "color-mix(in oklab, var(--warn) 35%, transparent)"), "var(--panel)");
  }
  if (id.startsWith("app.feedback.ghost-danger-boundary.")) {
    const surface = surfaceCss(id.slice("app.feedback.ghost-danger-boundary.".length) as SurfaceName);
    return appRequest("color-mix(in oklab, var(--warn) 40%, var(--line))", surface, surface);
  }
  if (id.startsWith("app.feedback.ghost-danger-hover.")) {
    const surface = surfaceCss(id.slice("app.feedback.ghost-danger-hover.".length) as SurfaceName);
    return appRequest("var(--warn)", feedbackCss(snapshot, "danger", "color-mix(in oklab, var(--warn) 10%, transparent)"), surface);
  }

  const dangerBackgrounds: Readonly<Record<string, number>> = {
    "app.feedback.danger-forget.text": 12,
    "app.feedback.danger-threshold.text": 8,
    "app.feedback.danger-signature.text": 10,
    "app.feedback.danger-incoming.text": 10,
    "app.feedback.danger-die.value": 18,
  };
  const dangerPercent = dangerBackgrounds[id];
  if (dangerPercent !== undefined) {
    const foregroundCss =
      id === "app.feedback.danger-incoming.text"
        ? "var(--text)"
        : id === "app.feedback.danger-die.value"
          ? "color-mix(in oklab, var(--err) 60%, var(--text))"
          : "var(--err)";
    return appRequest(
      foregroundCss,
      feedbackCss(snapshot, "danger", `color-mix(in oklab, var(--err) ${dangerPercent}%, var(--panel))`),
      "var(--panel)",
    );
  }
  if (id === "app.graphic.coverage-success") {
    return appRequest(feedbackCss(snapshot, "success", "var(--accent-dim)"), "var(--panel)", "var(--panel)");
  }
  if (id === "app.graphic.coverage-gap") {
    return appRequest(feedbackCss(snapshot, "danger", "color-mix(in oklab, var(--err) 25%, var(--panel))"), "var(--panel)", "var(--panel)");
  }
  if (id === "app.graphic.coverage-over") {
    return appRequest(feedbackCss(snapshot, "warning", "var(--warn)"), "var(--panel)", "var(--panel)");
  }

  if (id.startsWith("widget.text.")) {
    const [, , role, mode] = id.split(".") as [
      string,
      string,
      "primary" | "muted" | "accent" | "success" | "warning",
      "solid" | "clear" | "none",
    ];
    const foregroundCss =
      role === "primary"
        ? "var(--text)"
        : role === "muted"
          ? "var(--muted)"
          : role === "accent"
            ? "var(--accent)"
            : role === "success"
              ? "var(--success)"
              : "var(--warn)";
    if (mode !== "solid" && previewBackdrop === null) return null;
    return {
      scope: "widget",
      foregroundCss,
      backgroundCss:
        mode === "solid"
          ? "color-mix(in srgb, var(--panel) 92%, transparent)"
          : mode === "clear"
            ? "color-mix(in srgb, var(--panel) 82%, transparent)"
            : "transparent",
      backdropCss: mode === "solid" ? "var(--bg)" : previewBackdrop!,
    };
  }

  throw new TypeError(`Unknown contrast pair: ${id}`);
}

function suggestionFor(pair: ContrastPairDefinition): string {
  const counterpart = pair.backgroundRoles.length > 0 ? pair.backgroundRoles.join(", ") : "the sampled external backdrop";
  return `Adjust ${pair.suggestionRole} for more contrast against ${counterpart} in ${pair.contexts.join(", ")}.`;
}

function unavailable(pair: ContrastPairDefinition, status: "unverified" | "unsupported"): ContrastPairResult {
  return Object.freeze({ ...pair, status, ratio: null, foreground: null, background: null, suggestion: suggestionFor(pair) });
}

export function sampleContrastPairs(
  snapshot: PresentationSnapshotV1,
  options: { readonly widgetPreviewBackdrop: HexColor | null },
  sampler: BrowserColorSampler,
): ContrastReport {
  const snapshotKey = presentationSnapshotKey(snapshot);
  const backdrop = options.widgetPreviewBackdrop === null ? null : parseOpaqueColor(options.widgetPreviewBackdrop);
  if (options.widgetPreviewBackdrop !== null && backdrop === null) throw new TypeError("Invalid widget preview backdrop");
  if (sampler.snapshotKey !== snapshotKey) throw new TypeError("Contrast sampler snapshot does not match report snapshot");

  const pairs = CONTRAST_PAIRS.map((pair): ContrastPairResult => {
    const request = requestFor(pair, snapshot, backdrop);
    if (request === null) return unavailable(pair, "unverified");
    let sampled: ReturnType<BrowserColorSampler["sample"]>;
    try {
      sampled = sampler.sample(request);
    } catch {
      return unavailable(pair, "unsupported");
    }
    if (sampled === null) return unavailable(pair, "unsupported");
    const foreground = parseOpaqueColor(sampled.foreground);
    const background = parseOpaqueColor(sampled.background);
    if (foreground === null || background === null) return unavailable(pair, "unsupported");
    const assessment = assessContrast(foreground, background, pair.minimum);
    const conditional = pair.id.endsWith(".clear") || pair.id.endsWith(".none");
    const status: ContrastStatus = conditional
      ? assessment.passes
        ? "conditional-pass"
        : "conditional-fail"
      : assessment.passes
        ? "pass"
        : "fail";
    return Object.freeze({
      ...pair,
      status,
      ratio: assessment.ratio,
      foreground,
      background,
      suggestion: suggestionFor(pair),
    });
  });
  const failures = pairs.filter(({ status }) => status === "fail" || status === "conditional-fail");
  const summary =
    failures.length > 0
      ? "Contrast warnings"
      : pairs.some(({ status }) => status === "unsupported")
        ? "Some contrast checks unavailable"
        : "Passes checked contrast pairs";
  const acknowledgementKey = `${CONTRAST_CATALOG_VERSION}\0${snapshotKey}\0${backdrop ?? "none"}`;
  return Object.freeze({
    snapshotKey,
    acknowledgementKey,
    pairs: Object.freeze([...pairs]),
    failures: Object.freeze([...failures]),
    notices: Object.freeze(["External background not verified"]),
    summary,
  });
}

export function isContrastAcknowledged(report: ContrastReport, key: string | null): boolean {
  return key !== null && key === report.acknowledgementKey;
}
