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

import { CONTRAST_PAIRS } from "./contrastCatalog.ts";
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

describe("the closed contrast catalog", () => {
  it("contains exactly the 70 stable unique pair IDs", () => {
    expect(CONTRAST_PAIRS.map(({ id }) => id)).toEqual(EXACT_IDS);
    expect(new Set(CONTRAST_PAIRS.map(({ id }) => id)).size).toBe(70);
  });

  it("uses the binding thresholds, kinds and role metadata", () => {
    expect(CONTRAST_PAIRS.filter(({ minimum }) => minimum === 4.5)).toHaveLength(54);
    expect(CONTRAST_PAIRS.filter(({ minimum }) => minimum === 3)).toHaveLength(16);
    expect(CONTRAST_PAIRS.filter(({ kind }) => kind === "focus").map(({ id }) => id)).toEqual([
      "app.control.focus-hover.page",
      "app.control.focus-hover.panel",
      "app.control.focus-hover.raised",
    ]);
    expect(
      CONTRAST_PAIRS.some(({ foregroundRoles, backgroundRoles }) =>
        [...foregroundRoles, ...backgroundRoles].some((role) => role.includes("moveAccent")),
      ),
    ).toBe(false);
    expect(CONTRAST_PAIRS.some(({ foregroundRoles }) => foregroundRoles.length === 1 && foregroundRoles[0] === "boundary.decorative")).toBe(
      false,
    );
    expect(CONTRAST_PAIRS.find(({ id }) => id === "app.action.primary.hover")).toMatchObject({
      foregroundRoles: ["text.onAccent"],
      backgroundRoles: ["interaction.accent", "text.primary"],
      minimum: 4.5,
    });
    expect(CONTRAST_PAIRS.find(({ id }) => id === "app.feedback.danger-die.value")).toMatchObject({
      foregroundRoles: ["feedback.danger", "text.primary"],
      backgroundRoles: ["feedback.dangerBackground", "feedback.danger", "surface.panel"],
    });
    expect(CONTRAST_PAIRS.find(({ id }) => id === "widget.text.primary.clear")).toMatchObject({
      foregroundRoles: ["widget.text"],
      backgroundRoles: ["widget.panel"],
      minimum: 4.5,
    });
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
    for (const [index, pair] of CONTRAST_PAIRS.entries()) {
      if (pair.backgroundRoles.includes("feedback.warningBackground")) {
        expect(explicitSampler.requests[index]?.backgroundCss, pair.id).toBe("var(--warning-background)");
      }
      if (pair.backgroundRoles.includes("feedback.dangerBackground")) {
        const property = pair.id === "app.graphic.coverage-gap" ? "foregroundCss" : "backgroundCss";
        expect(explicitSampler.requests[index]?.[property], pair.id).toBe("var(--danger-background)");
      }
      if (pair.backgroundRoles.includes("feedback.successBackground")) {
        expect(explicitSampler.requests[index]?.foregroundCss, pair.id).toBe("var(--success-background)");
      }
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
