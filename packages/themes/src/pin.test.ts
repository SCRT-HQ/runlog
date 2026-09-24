import { describe, expect, it } from "vitest";
import type { BuiltinColorBaseId } from "./colorBases.ts";
import { COLOR_DEFINITIONS } from "./colorRegistry.ts";
import { FONT_ROLE_DEFINITIONS } from "./fontRoles.ts";
import { FONT_DEFINITIONS } from "./fonts.ts";
import {
  decodePresentationPin,
  encodePresentationPin,
  PRESENTATION_PIN_MAX_LENGTH,
  PRESENTATION_PIN_V1_COLORS,
  PRESENTATION_PIN_V1_FEEDBACK,
  PRESENTATION_PIN_V1_FONTS,
} from "./pin.ts";
import { BUILTIN_PRESETS } from "./presets.ts";
import { createThemeRecordFromPreset } from "./records.ts";
import { parsePresentationSnapshot, presentationSnapshotKey, resolveThemeRecord, type PresentationSnapshotV1 } from "./snapshot.ts";

function builtin(id: BuiltinColorBaseId): PresentationSnapshotV1 {
  const record = createThemeRecordFromPreset({ id: "theme-1", name: "Pinned", presetId: id });
  if (!record.ok) throw new Error(`no record for ${id}`);
  const snapshot = resolveThemeRecord(record.value);
  if (!snapshot.ok) throw new Error(`no snapshot for ${id}`);
  return snapshot.value;
}

/** Every feedback background explicit and the longest id each font role allows: the longest version 1 pin there is. */
function widest(): PresentationSnapshotV1 {
  const long = "atkinson-hyperlegible-next";
  const mono = "ibm-plex-mono";
  const parsed = parsePresentationSnapshot({
    ...builtin("lights-down"),
    feedbackBackgrounds: {
      "feedback.successBackground": { mode: "explicit", color: "#123456" },
      "feedback.warningBackground": { mode: "explicit", color: "#abcdef" },
      "feedback.dangerBackground": { mode: "explicit", color: "#fedcba" },
    },
    fonts: {
      ui: long,
      prose: long,
      numeric: mono,
      technical: mono,
      display: long,
      widgetUi: long,
      widgetProse: long,
      widgetNumeric: mono,
      widgetTechnical: mono,
      widgetDisplay: long,
    },
  });
  if (!parsed.ok) throw new Error("widest fixture is invalid");
  return parsed.value;
}

const sorted = (values: readonly string[]) => [...values].sort();

describe("a pinned theme in an address", () => {
  it("round-trips every built-in exactly, in URL-safe characters and under the limit", () => {
    for (const preset of BUILTIN_PRESETS) {
      const snapshot = builtin(preset.id);
      const text = encodePresentationPin(snapshot);
      expect(text).toMatch(/^[0-9a-z.-]+$/);
      expect(text.length).toBeLessThanOrEqual(378);
      const decoded = decodePresentationPin(text);
      expect(decoded.ok && presentationSnapshotKey(decoded.value)).toBe(presentationSnapshotKey(snapshot));
    }
  });

  it("keeps the widest possible pin well under the limit and round-trips explicit feedback backgrounds", () => {
    const snapshot = widest();
    const text = encodePresentationPin(snapshot);
    expect(text.length).toBe(393);
    expect(text.length).toBeLessThan(PRESENTATION_PIN_MAX_LENGTH);
    const decoded = decodePresentationPin(text);
    expect(decoded.ok && presentationSnapshotKey(decoded.value)).toBe(presentationSnapshotKey(snapshot));
  });

  it("freezes the version 1 order to exactly the registry's tokens and roles", () => {
    const valueTokens = COLOR_DEFINITIONS.filter(({ kind }) => kind !== "feedbackBackground").map(({ id }) => id);
    const feedbackTokens = COLOR_DEFINITIONS.filter(({ kind }) => kind === "feedbackBackground").map(({ id }) => id);
    // A token added to or removed from the registry needs pin version 2, not an edit here.
    expect(sorted(PRESENTATION_PIN_V1_COLORS)).toEqual(sorted(valueTokens));
    expect(sorted(PRESENTATION_PIN_V1_FEEDBACK)).toEqual(sorted(feedbackTokens));
    expect(sorted(PRESENTATION_PIN_V1_FONTS)).toEqual(sorted(FONT_ROLE_DEFINITIONS.map(({ id }) => id)));
    expect([PRESENTATION_PIN_V1_COLORS.length, PRESENTATION_PIN_V1_FEEDBACK.length, PRESENTATION_PIN_V1_FONTS.length]).toEqual([25, 3, 10]);
    expect(Object.isFrozen(PRESENTATION_PIN_V1_COLORS)).toBe(true);
    expect(Object.isFrozen(PRESENTATION_PIN_V1_FEEDBACK)).toBe(true);
    expect(Object.isFrozen(PRESENTATION_PIN_V1_FONTS)).toBe(true);
  });

  it("pins the exact position order, not just the set, for version 1", () => {
    // A sorted-set comparison would pass if two entries traded places, which would silently
    // reinterpret every pin already copied into OBS. Compare the literal order instead.
    expect(PRESENTATION_PIN_V1_COLORS).toEqual([
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
    ]);
    expect(PRESENTATION_PIN_V1_FEEDBACK).toEqual(["feedback.successBackground", "feedback.warningBackground", "feedback.dangerBackground"]);
    expect(PRESENTATION_PIN_V1_FONTS).toEqual([
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
    ]);
  });

  it("encodes a fixed built-in to an exact golden string", () => {
    // A regression here means a position moved. Recompute deliberately; never update this
    // string to make a failure go away without checking whether an old pin just broke.
    expect(encodePresentationPin(builtin("ember"))).toBe(
      "1.d.1a12102419152e211cf1e4d3bfa48f1a121045312a45312a6a4d42a9cbb04a5f4fa9cbb0a9cbb0a9cbb045312aa9cbb0a9cbb0a9cbb0f2b45af080701a1210241915f1e4d3bfa48fa9cbb0" +
        ".-.-.-.system-sans.literata.ibm-plex-mono.ibm-plex-mono.system-sans.system-sans.literata.ibm-plex-mono.ibm-plex-mono.system-sans",
    );
  });

  it("accepts every catalog font id in the version 1 grammar", () => {
    for (const font of FONT_DEFINITIONS) expect(font.id).toMatch(/^[a-z0-9-]{1,32}$/);
  });

  it("carries no theme name, id or preset id", () => {
    const record = createThemeRecordFromPreset({ id: "theme-secret-7", name: "Kiln Secret", presetId: "ember" });
    if (!record.ok) throw new Error("record");
    const snapshot = resolveThemeRecord(record.value);
    if (!snapshot.ok) throw new Error("snapshot");
    expect(encodePresentationPin(snapshot.value)).not.toMatch(/kiln|secret|theme-secret|ember/i);
  });

  it("refuses to encode an invalid snapshot", () => {
    const broken = { ...builtin("ember"), colorScheme: "dim" } as unknown as PresentationSnapshotV1;
    expect(() => encodePresentationPin(broken)).toThrow(TypeError);
  });

  it("rejects malformed, oversized and hostile text before anything is applied", () => {
    const good = encodePresentationPin(builtin("ember"));
    const fonts = good.split(".").slice(-10);
    const cases: unknown[] = [
      undefined,
      null,
      42,
      { pin: good },
      "",
      "1",
      "1.",
      `2${good.slice(1)}`,
      `1.x${good.slice(3)}`,
      good.toUpperCase(),
      good.slice(0, -1),
      `${good}.system-sans`,
      ` ${good}`,
      `${good}\n`,
      good.replace(/\.[a-z0-9-]+$/, ".comic-sans"),
      // VT323 is a numeric and display font, never a UI font.
      good.replace(fonts.join("."), ["vt323", ...fonts.slice(1)].join(".")),
      "1.d.;background:url(https://example.invalid/x)",
      `1.d.${"0".repeat(149)}g.-.-.-.${fonts.join(".")}`,
      "1.d.".padEnd(PRESENTATION_PIN_MAX_LENGTH + 1, "a"),
      "1.d.".padEnd(200_000, "a"),
    ];
    for (const input of cases) expect(decodePresentationPin(input).ok, String(input).slice(0, 40)).toBe(false);
    expect(decodePresentationPin("1.d.".padEnd(PRESENTATION_PIN_MAX_LENGTH + 1, "a"))).toEqual({
      ok: false,
      issues: [{ path: "$", message: "Pinned theme is empty or too long" }],
    });
    expect(decodePresentationPin(`2${good.slice(1)}`)).toEqual({
      ok: false,
      issues: [{ path: "$", message: "Unsupported pinned theme version" }],
    });
  });

  it("treats a text exactly at the length limit as length-valid but malformed, not too long", () => {
    const text = "1.d.".padEnd(PRESENTATION_PIN_MAX_LENGTH, "a");
    expect(text.length).toBe(PRESENTATION_PIN_MAX_LENGTH);
    expect(decodePresentationPin(text)).toEqual({
      ok: false,
      issues: [{ path: "$", message: "Malformed pinned theme" }],
    });
  });

  it("never throws, whatever it is given", () => {
    const alphabet = "0123456789abcdefdl.-#%&=;:/()ABZ é";
    let seed = 7;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    for (let round = 0; round < 2000; round++) {
      const length = next() % 420;
      let text = next() % 2 === 0 ? "1." : "";
      for (let i = 0; i < length; i++) text += alphabet[next() % alphabet.length];
      expect(() => decodePresentationPin(text)).not.toThrow();
    }
  });
});
