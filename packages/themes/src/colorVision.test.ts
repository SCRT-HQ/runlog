import { describe, expect, it } from "vitest";

import { contrastRatio, getBuiltinColorBase, type BuiltinColorBase, type HexColor } from "./index.ts";

/**
 * Checks for the color-vision presets. Each meaningful pair is drawn the way the app draws it
 * (color-mix in OKLab, alpha over its backdrop), simulated at full severity with Machado,
 * Oliveira and Fernandes 2009 and with Brettel, Vienot and Mollon 1997 (libDaltonLens sRGB
 * parameters), and compared by OKLab distance. Simulation is an evaluation aid: passing here
 * does not prove that every person with that difference can tell the colors apart.
 */
type Vec = readonly [number, number, number];
type Matrix = readonly [number, number, number, number, number, number, number, number, number];
type Deficiency = "protan" | "deutan" | "tritan";

const each = (v: Vec, f: (n: number) => number): Vec => [f(v[0]), f(v[1]), f(v[2])];
const apply = (m: Matrix, [x, y, z]: Vec): Vec => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
];
const lerp = (p: Vec, q: Vec, t: number): Vec => [p[0] * t + q[0] * (1 - t), p[1] * t + q[1] * (1 - t), p[2] * t + q[2] * (1 - t)];
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const encoded = (hex: string): Vec => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Vec;
const toHex = (v: Vec) => `#${v.map((n) => `0${Math.round(clamp(n) * 255).toString(16)}`.slice(-2)).join("")}` as HexColor;
const linear = (hex: string) => each(encoded(hex), (n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
const fromLinear = (v: Vec) => toHex(each(v, (n) => (clamp(n) <= 0.0031308 ? 12.92 * clamp(n) : 1.055 * clamp(n) ** (1 / 2.4) - 0.055)));
// Ottosson's OKLab: linear sRGB to LMS, cube root, to Lab; and back.
const TO_LMS: Matrix = [
  0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619, 0.2817188376, 0.6299787005,
];
const LMS_TO_LAB: Matrix = [
  0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371, 0.7827717662, -0.808675766,
];
const LAB_TO_LMS: Matrix = [1, 0.3963377774, 0.2158037573, 1, -0.1055613458, -0.0638541728, 1, -0.0894841775, -1.291485548];
const FROM_LMS: Matrix = [
  4.0767416621, -3.3077115913, 0.2309699292, -1.2684380046, 2.6097574011, -0.3413193965, -0.0041960863, -0.7034186147, 1.707614701,
];
const oklab = (hex: string) => apply(LMS_TO_LAB, each(apply(TO_LMS, linear(hex)), Math.cbrt));
const distance = (x: string, y: string) => {
  const [p, q] = [oklab(x), oklab(y)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
// color-mix(in oklab, a p%, b); and color-mix(a p%, transparent) composited over an opaque backdrop.
const mix = (a: string, p: number, b: string) =>
  fromLinear(
    apply(
      FROM_LMS,
      each(apply(LAB_TO_LMS, lerp(oklab(a), oklab(b), p / 100)), (n) => n ** 3),
    ),
  );
const over = (a: string, p: number, backdrop: string) => toHex(lerp(encoded(a), encoded(backdrop), p / 100));

// Machado 2009 at severity 1.0, and Brettel 1997 as two half-plane projections split by `side`.
const MACHADO: Record<Deficiency, Matrix> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
const BRETTEL: Record<Deficiency, readonly [Matrix, Matrix, Vec]> = {
  protan: [
    [0.1451, 1.20165, -0.34675, 0.10447, 0.85316, 0.04237, 0.00429, -0.00603, 1.00174],
    [0.14115, 1.16782, -0.30897, 0.10495, 0.8573, 0.03776, 0.00431, -0.00586, 1.00155],
    [0.00048, 0.00416, -0.00464],
  ],
  deutan: [
    [0.36198, 0.86755, -0.22953, 0.26099, 0.64512, 0.09389, -0.01975, 0.02686, 0.99289],
    [0.37009, 0.8854, -0.25549, 0.25767, 0.63782, 0.10451, -0.0195, 0.02741, 0.99209],
    [-0.00293, -0.00645, 0.00938],
  ],
  tritan: [
    [1.01277, 0.13548, -0.14826, -0.01243, 0.86812, 0.14431, 0.07589, 0.805, 0.11911],
    [0.93678, 0.18979, -0.12657, 0.06154, 0.81526, 0.1232, -0.37562, 1.12767, 0.24796],
    [0.03901, -0.02788, -0.01113],
  ],
};
const machado = (d: Deficiency) => (hex: string) => fromLinear(apply(MACHADO[d], linear(hex)));
const brettel = (d: Deficiency) => (hex: string) => {
  const [one, two, side] = BRETTEL[d];
  const v = linear(hex);
  return fromLinear(apply(v[0] * side[0] + v[1] * side[1] + v[2] * side[2] >= 0 ? one : two, v));
};

function rendered(c: BuiltinColorBase["colors"]) {
  return {
    ...c,
    "coverage.gap": mix(c["feedback.danger"], 25, c["surface.panel"]),
    "die.settled": mix(c["feedback.danger"], 50, c["boundary.strong"]),
    "die.body": mix(c["feedback.danger"], 18, c["surface.panel"]),
  };
}
type Role = keyof ReturnType<typeof rendered>;

// Floors in OKLab distance. A: status against status. B: interaction beside status. C: focus against
// selection. D: patterned graphics (coverage segments, settled dice).
const PAIRS: readonly (readonly [string, Role, Role, number])[] = [
  ["A", "feedback.success", "feedback.danger", 0.1],
  ["A", "feedback.success", "feedback.warning", 0.1],
  ["A", "feedback.warning", "feedback.danger", 0.1],
  ["B", "interaction.accent", "feedback.danger", 0.08],
  ["B", "interaction.selectedIndicator", "feedback.danger", 0.08],
  ["B", "interaction.focus", "feedback.danger", 0.08],
  ["B", "interaction.accent", "feedback.warning", 0.08],
  ["B", "interaction.focus", "feedback.warning", 0.08],
  ["C", "interaction.focus", "interaction.selectedIndicator", 0.06],
  ["D", "interaction.accentTint", "coverage.gap", 0.06],
  ["D", "interaction.accentTint", "feedback.warning", 0.06],
  ["D", "coverage.gap", "feedback.warning", 0.06],
  ["D", "interaction.accentTint", "die.settled", 0.06],
];

function distinctionMisses(id: string, deficiencies: readonly Deficiency[]): string[] {
  const base = getBuiltinColorBase(id, 1);
  if (base === null) return [`${id} is not a built-in base`];
  const r = rendered(base.colors);
  const visions: [string, (hex: string) => string][] = [["normal", (hex) => hex]];
  for (const d of deficiencies) visions.push([`${d} (Machado)`, machado(d)], [`${d} (Brettel)`, brettel(d)]);
  return PAIRS.flatMap(([tier, a, b, floor]) =>
    visions.flatMap(([vision, see]) => {
      const gap = distance(see(r[a]), see(r[b]));
      return gap < floor ? [`${tier} ${a} / ${b} under ${vision}: ${gap.toFixed(3)} < ${floor}`] : [];
    }),
  );
}

// Rendered pairs from styles.css and the Theme Studio catalog that colorBases.test.ts does not gate.
function contrastMisses(id: string): string[] {
  const base = getBuiltinColorBase(id, 1);
  if (base === null) return [`${id} is not a built-in base`];
  const c = rendered(base.colors);
  const radio = mix(c["interaction.accent"], 10, c["surface.raised"]);
  const solid = over(c["surface.panel"], 92, c["surface.page"]);
  const pairs: [string, string, string, number][] = [
    ["onAccent on primary hover", c["text.onAccent"], mix(c["interaction.accent"], 85, c["text.primary"]), 4.5],
    ["onAccent on destructive hover", c["text.onAccent"], mix(c["feedback.warning"], 85, c["text.primary"]), 4.5],
    ["notice text", mix(c["feedback.warning"], 55, c["text.primary"]), mix(c["feedback.warning"], 12, c["surface.panel"]), 4.5],
    ["live heat text", c["text.primary"], over(c["feedback.warning"], 35, c["surface.panel"]), 4.5],
    ["forget hover text", c["feedback.danger"], mix(c["feedback.danger"], 12, c["surface.panel"]), 4.5],
    ["threshold text", c["feedback.danger"], mix(c["feedback.danger"], 8, c["surface.panel"]), 4.5],
    ["bad signature text", c["feedback.danger"], mix(c["feedback.danger"], 10, c["surface.panel"]), 4.5],
    ["bad incoming text", c["text.primary"], mix(c["feedback.danger"], 10, c["surface.panel"]), 4.5],
    ["challenge die value", mix(c["feedback.danger"], 60, c["text.primary"]), c["die.body"], 4.5],
    ["text on radio fill", c["text.primary"], radio, 4.5],
    ["muted on radio fill", c["text.muted"], radio, 4.5],
    ["selected on radio fill", c["interaction.selectedIndicator"], radio, 3],
  ];
  for (const role of ["text.primary", "text.muted", "interaction.accent", "feedback.success", "feedback.warning"] as const) {
    pairs.push([`widget ${role} on solid panel`, c[role], solid, 4.5]);
  }
  for (const s of ["surface.page", "surface.panel", "surface.raised"] as const) {
    pairs.push(
      [`selected on ${s}`, c["interaction.selectedIndicator"], c[s], 3],
      [`warning chip on ${s}`, c["feedback.warning"], over(c["feedback.warning"], 14, c[s]), 4.5],
      [`ghost danger hover on ${s}`, c["feedback.warning"], over(c["feedback.warning"], 10, c[s]), 4.5],
      [`ghost danger boundary on ${s}`, mix(c["feedback.warning"], 40, c["boundary.decorative"]), c[s], 3],
    );
  }
  return pairs.flatMap(([name, fg, bg, min]) => {
    const ratio = contrastRatio(fg as HexColor, bg as HexColor);
    return ratio < min ? [`${name}: ${ratio.toFixed(2)} < ${min}`] : [];
  });
}

const TARGETS: Record<string, readonly Deficiency[]> = {
  "red-green-dark": ["protan", "deutan"],
  "red-green-light": ["protan", "deutan"],
  "blue-yellow-dark": ["tritan"],
  "blue-yellow-light": ["tritan"],
};

describe("color-vision presets", () => {
  it.each(Object.entries(TARGETS))(
    "keeps the meaningful pairs of %s apart in normal vision and its target simulations",
    (id, deficiencies) => {
      expect(distinctionMisses(id, deficiencies)).toEqual([]);
    },
  );

  it.each(Object.keys(TARGETS))("passes the rendered contrast pairs for %s", (id) => {
    expect(contrastMisses(id)).toEqual([]);
  });

  it("catches the red-green collision in a palette that was not tuned for it", () => {
    expect(distinctionMisses("daylight", ["protan", "deutan"]).filter((miss) => miss.startsWith("A "))).not.toEqual([]);
  });
});
