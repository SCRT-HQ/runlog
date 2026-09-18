# Theme Color Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Establish one strict, dependency-free color parser and contrast evaluator shared by future browser and backend theme consumers.

**Architecture:** A private TypeScript workspace package, @runlog/themes, owns portable theme data contracts. This first independently testable slice implements only opaque color parsing and contrast assessment; subsequent contract work extends the same package with token/font registries and versioned theme records. No existing application theme rendering changes in this slice.

**Tech Stack:** TypeScript with existing strict monorepo settings, npm workspaces, Vitest.

**Spec:** .claude/plans/2026-09-17-custom-theme-authoring-design.md (user approved 2026-09-18).

## Global Constraints

- Accept opaque sRGB colors in #RGB, #RRGGBB, and rgb(...) forms.
- RGB accepts comma-separated or space-separated channels, with either integer 0–255 channels or percentage 0–100 channels.
- Reject mixed units, out-of-range values, alpha, named colors, CSS expressions, URLs, and variable references.
- Normalize to lowercase six-digit hex.
- Do not round a failing value upward to a pass.
- Invalid data cannot be saved or applied; accessibility warnings are a different category and do not impose that restriction.
- No arbitrary CSS, scripts, remote URLs, uploaded fonts, background images, custom component layouts, per-component font sizes, public theme marketplace, or collaborative editing.
- Preserve current built-in IDs, saved preferences, widget backgrounds, and application behavior in this additive foundation slice.
- Preserve unrelated changes and all recovery artifacts. No Superdesign. Use test-first implementation.
- Do not introduce runtime third-party dependencies for parsing or luminance arithmetic.

## Scope and next contracts

The complete feature is split into independently reviewable subplans instead of a single speculative backend/UI change. The master roadmap is .claude/plans/2026-09-18-custom-theme-authoring-roadmap.md. This plan implements the color boundary needed before token schemas, accessible preset evaluation, and imported/synced payload validation. It does not claim those downstream features are complete.

## File structure

- Create packages/themes/package.json: private ESM workspace with source TypeScript export.
- Create packages/themes/tsconfig.json: inherit ../../tsconfig.base.json and include src/**/*.ts, with Node types for tests.
- Create packages/themes/src/color.ts: parsing and canonical color type.
- Create packages/themes/src/contrast.ts: luminance, contrast ratio, and threshold assessment.
- Create packages/themes/src/index.ts: public exports only.
- Create packages/themes/src/color.test.ts and contrast.test.ts: literal, behavioral cases.
- Modify root package.json: include this package in the explicit typecheck command.
- Modify package-lock.json: record workspace linkage only, using npm install --package-lock-only --ignore-scripts.

No browser, backend, CSS, font asset, or rendering files change.

### Task 1: Strict opaque color input and measured contrast

**Files:** All files in the file structure above.

**Interfaces:**

Produces the following exports; none requires DOM or browser APIs:

~~~ts
export type HexColor = string & { readonly __hexColor: unique symbol };
export function parseOpaqueColor(input: unknown): HexColor | null;
export function relativeLuminance(color: HexColor): number;
export function contrastRatio(foreground: HexColor, background: HexColor): number;
export interface ContrastAssessment {
  ratio: number;
  minimum: number;
  passes: boolean;
}
export function assessContrast(
  foreground: HexColor,
  background: HexColor,
  minimum: 3 | 4.5 | 7,
): ContrastAssessment;
~~~

Consumes no earlier feature code. Downstream consumers must parse external values before invoking branded-color arithmetic. No CSS string is forwarded to DOM as a side effect.

- [ ] **Step 1: Create test-first package scaffolding and input cases.**

Use the existing deck-profiles private-workspace style:

~~~json
{
  "name": "@runlog/themes",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
~~~

Write behavior tests through the public index. Include the following literal cases:

~~~ts
import { describe, expect, it } from "vitest";
import { parseOpaqueColor } from "./index.ts";

describe("opaque theme colors", () => {
  it.each([
    ["#AbC", "#aabbcc"],
    ["  #A0b1C2  ", "#a0b1c2"],
    ["rgb(255, 0, 128)", "#ff0080"],
    ["RGB(255 0 128)", "#ff0080"],
    ["rgb(100% 0% 50%)", "#ff0080"],
    ["rgb(0%, 100%, 0%)", "#00ff00"],
    ["rgb(.5% 0% 100%)", "#0100ff"],
    ["rgb(0 0 0)", "#000000"],
  ])("normalizes %s", (input, output) => {
    expect(parseOpaqueColor(input)).toBe(output);
  });

  it.each([
    null, undefined, 123, {}, [], "",
    "red", "transparent", "currentColor", "#12", "#1234", "#12345678",
    "rgb(256 0 0)", "rgb(-1, 0, 0)", "rgb(0.5 0 0)",
    "rgb(101% 0% 0%)", "rgb(100% 0 0)", "rgb(1e2 0 0)",
    "rgb(1, 2 3)", "rgb(1 2 3 / 1)", "rgba(1,2,3,1)",
    "rgb(1 2)", "rgb(1 2 3 4)", "var(--text)", "url(https://example.test)",
    "#ffffff; color: red", "rgb(1 2 3) trailing",
  ])("rejects invalid or unsafe input %j", input => {
    expect(parseOpaqueColor(input)).toBeNull();
  });
});
~~~

The expected break is accepting unsafe/out-of-grammar data or failing normalization, not a source-code text mismatch. Add whitespace and case handling around the RGB function without accepting comments or embedded CSS.

- [ ] **Step 2: Run the parser tests red.**

Run: npm test -- packages/themes/src/color.test.ts
Record the expected missing implementation/public export failure. If needed add empty implementations returning null to show the positive cases fail by assertion before implementing real behavior. Do not count a typo as RED evidence.

- [ ] **Step 3: Implement parsing and test green.**

Implement anchored hex and RGB grammar. Reject nonstrings before trimming. Parse exactly three channels; every channel must use the same unit family. Integer channels are digits only. Percentage channels permit decimals, including .5%, but must be finite and within bounds. Do not use browser CSS parsing, parseInt on unchecked input, CSS.supports, or permissive numeric coercion that accepts trailing garbage.

Normalize each percentage with Math.round(value * 255 / 100), then output a two-digit lowercase channel. Treat RGB function spelling case-insensitively. Allow surrounding whitespace but no extra payload after the expression. A reasonable explicit input-length bound of 256 characters avoids unbounded field processing; reject longer strings rather than truncating.

Run: npm test -- packages/themes/src/color.test.ts
Expected: all valid/invalid cases pass.

- [ ] **Step 4: Add contrast tests red before implementing arithmetic.**

~~~ts
import { describe, expect, it } from "vitest";
import { assessContrast, contrastRatio, parseOpaqueColor, relativeLuminance } from "./index.ts";

const black = parseOpaqueColor("#000")!;
const white = parseOpaqueColor("#fff")!;

describe("theme contrast", () => {
  it("measures black and white as the endpoints", () => {
    expect(relativeLuminance(black)).toBe(0);
    expect(relativeLuminance(white)).toBe(1);
    expect(contrastRatio(black, white)).toBe(21);
    expect(contrastRatio(white, black)).toBe(21);
    expect(contrastRatio(black, black)).toBe(1);
  });

  it("does not upgrade a near-threshold text color by rounding", () => {
    const result = assessContrast(parseOpaqueColor("#777777")!, white, 4.5);
    expect(result.ratio).toBeCloseTo(4.478089, 5);
    expect(result.minimum).toBe(4.5);
    expect(result.passes).toBe(false);
    expect(assessContrast(parseOpaqueColor("#767676")!, white, 4.5).passes).toBe(true);
  });

  it("applies the caller's pair target, not an implicit text default", () => {
    expect(assessContrast(parseOpaqueColor("#888888")!, white, 3).passes).toBe(true);
    expect(assessContrast(parseOpaqueColor("#888888")!, white, 4.5).passes).toBe(false);
    expect(assessContrast(parseOpaqueColor("#666666")!, white, 7).passes).toBe(false);
    expect(assessContrast(parseOpaqueColor("#555555")!, white, 7).passes).toBe(true);
  });
});
~~~

Also test known chromatic luminance coefficients with pure red, green and blue (0.2126, 0.7152, 0.0722), and near-black #0a0a0a/#0b0b0b values across the linearization boundary. Derive literal expected numbers independently from the formula, not the production helper.

Run: npm test -- packages/themes/src/contrast.test.ts
Expected: missing contrast exports or assertion failures from minimal stubs, then record the reason.

- [ ] **Step 5: Implement luminance and assessment, then verify.**

~~~ts
const linear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

// Normalize each canonical hex channel to 0..1, linearize, then:
// luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
// ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
// passes = ratio >= minimum; preserve full precision in the return value.
~~~

Keep presentation rounding out of this package. Keep UI warning acknowledgment out of this package. Return fresh assessment objects and no mutable global state.

Run: npm test -- packages/themes/src/color.test.ts packages/themes/src/contrast.test.ts
Expected: all tests pass. Run npx tsc --noEmit -p packages/themes/tsconfig.json.

- [ ] **Step 6: Integrate workspace verification and perform self-review.**

Add tsc --noEmit -p packages/themes/tsconfig.json to the root typecheck chain without changing existing checks. Run npm install --package-lock-only --ignore-scripts; inspect the lockfile diff and preserve unrelated packages. Run npx prettier --write only the created/modified source/config files (package-lock remains formatter-ignored). Run npm run typecheck and npm test -- --reporter=dot once before commit; known baseline warnings must be described, not claimed absent. Run git diff --check.

Review grammar boundaries, weighted luminance branches, threshold comparisons, exports, and the scope of lockfile changes. Record RED/GREEN commands and counts in the task report. Do not add parser internals to the public API just for tests.

- [ ] **Step 7: Commit the independently usable contract.**

~~~sh
git add packages/themes package.json package-lock.json
git commit -m "feat(themes): add validated color and contrast contracts"
~~~

The controller performs task and branch review, pushes a feature branch, opens a conventional-title PR, and enables auto-merge. Do not stage unrelated artifacts or change the current theme menu in this task.

## Self-review and coverage boundary

This task directly implements the opaque-color input boundary and numerical contrast requirements. All other spec areas are mapped to the master roadmap rather than presented as covered by this PR. Interfaces use the same names across parser, evaluator and tests. Tests cover normalization, unsafe values, unit mixing, chromatic weighting and unrounded thresholds.

The brief must carry Global Constraints as well as Task 1. Preserve reports and recovery notes after publication under the user's standing instruction.
