# Theme Font Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Validate curated font IDs by role and resolve app/widget font inheritance without trusting CSS strings.

**Architecture:** Extend the DOM-free @runlog/themes package with an immutable font allowlist and a pure resolver. This independently testable prerequisite does not expose unloaded fonts in the app or modify existing rendering. Color-token inventory proceeds separately before the complete presentation schema is frozen.

**Tech Stack:** TypeScript, Vitest, existing npm workspace.

**Spec:** .claude/plans/2026-09-17-custom-theme-authoring-design.md, including accepted display-heading role and expanded catalog direction.

## Global Constraints

- Persist stable font IDs, never a user-supplied CSS font-family string.
- Widget overrides inherit their app equivalents when unset.
- Preserve shared size, line-height, weight, spacing, and control-height tokens.
- No arbitrary CSS, scripts, remote URLs, uploaded fonts, background images, custom component layouts, per-component font sizes, public theme marketplace, or collaborative editing.
- Do not weaken font CSP or introduce remote font downloads.
- No DOM, CSS compilation, asset loading, browser storage or backend behavior in this slice.
- Preserve unrelated worktree files and all progress artifacts. No Superdesign.

## Exact role and ID contract

App roles: ui, prose, numeric, display. Widget roles: widgetUi, widgetProse, widgetNumeric, widgetDisplay; each inherits its corresponding resolved app role unless explicitly overridden.

Allowed IDs:

| ID | Label | Allowed app roles |
| --- | --- | --- |
| system-sans | System sans | ui, prose, display |
| system-serif | System serif | ui, prose, display |
| literata | Literata | ui, prose, display |
| ibm-plex-mono | IBM Plex Mono | ui, prose, numeric, display |
| system-mono | System monospace | numeric, display |
| atkinson-hyperlegible-next | Atkinson Hyperlegible Next | ui, prose, display |
| space-grotesk | Space Grotesk | ui, prose, display |
| oxanium | Oxanium | ui, prose, display |
| vt323 | VT323 | numeric, display |
| press-start-2p | Press Start 2P | display |

Widget roles use the same allowlist as their corresponding app role. Inheritance is represented by an absent own property, never a stored "inherit" ID or null. No aliases, case folding, trimming or fallback for invalid values. Defaults are ui=system-sans, prose=literata, numeric=ibm-plex-mono, display=system-sans.

Definitions expose only id, label and readonly app roles. Loading status, CSS stacks, assets and weight adjustments belong in browser catalog integration, not in the portable data contract. Registration of expanded IDs does not assert assets are installed.

### Task 1: Curated validation and app/widget inheritance

**Files:** Create packages/themes/src/fonts.ts, packages/themes/src/fonts.test.ts. Modify packages/themes/src/index.ts only for exports.

**Interfaces:**

~~~ts
export type AppFontRole = "ui" | "prose" | "numeric" | "display";
export type FontRole = AppFontRole | "widgetUi" | "widgetProse" | "widgetNumeric" | "widgetDisplay";
// FontId is the exact union of the ten IDs in the table.
export interface FontDefinition { readonly id: FontId; readonly label: string; readonly roles: readonly AppFontRole[] }
export const FONT_DEFINITIONS: readonly FontDefinition[];
export const DEFAULT_APP_FONTS: Readonly<Record<AppFontRole, FontId>>;
export type ResolvedFonts = Readonly<Record<FontRole, FontId>>;
export function isFontId(value: unknown): value is FontId;
export function isFontAllowed(role: FontRole, value: unknown): value is FontId;
export function resolveFonts(base: unknown, overrides?: unknown): ResolvedFonts | null;
~~~

Base is a plain record with exactly the four required app roles and optional widget roles. Overrides is a plain record with zero to eight optional roles; undefined defaults to an empty record. Validate base and overrides independently before merging so an override cannot hide invalid base data. Reject arrays, null, unknown own keys (including symbols), accessors and custom prototypes; accept Object.prototype or null prototypes. Inspect descriptors rather than invoke accessors. Only own properties count. Reject invalid values, including own undefined/null. Return null for invalid ordinary input without coercion or side effects. Revoked/hostile JavaScript proxies are outside this JSON-data boundary contract.

Resolve app values first. For each widget role choose its explicit override, then its explicit base widget value, then the resolved corresponding app value. Return a fresh shallow-frozen complete record; definitions, nested roles and defaults are frozen. Do not mutate inputs.

- [ ] **Step 1: Add focused behavioral tests and minimal stubs; demonstrate RED.**

Use public exports from ./index.ts. Include these literal assertions:

~~~ts
const base = { ui: "system-sans", prose: "literata", numeric: "ibm-plex-mono", display: "system-sans" };
expect(resolveFonts(base, { ui: "space-grotesk", display: "oxanium" })).toEqual({
  ui: "space-grotesk", prose: "literata", numeric: "ibm-plex-mono", display: "oxanium",
  widgetUi: "space-grotesk", widgetProse: "literata", widgetNumeric: "ibm-plex-mono", widgetDisplay: "oxanium",
});
expect(resolveFonts({ ...base, widgetNumeric: "vt323" }, { numeric: "system-mono" })?.widgetNumeric).toBe("vt323");
expect(resolveFonts(base, { ui: "press-start-2p" })).toBeNull();
expect(resolveFonts(base, { widgetNumeric: "oxanium" })).toBeNull();
expect(isFontAllowed("display", "press-start-2p")).toBe(true);
expect(isFontId("url(https://example.test/font)")).toBe(false);
~~~

Cover each allowed font via its role-validation behavior, including system-mono restricted from UI/prose and VT323 restricted from UI/prose. Test wrong case, whitespace, CSS stack strings, unknown IDs, nonstrings, inherited keys, unknown base/override keys, missing app roles, symbols, accessor records without calling getters, arrays/null, own undefined, invalid base hidden by valid overrides, explicit widget override over explicit base widget value, no input mutation, and isolation of independent results after attempted writes. Test resetting by removing an override makes the widget inherit again. Frozen exported registry must resist mutation that would change future validation.

Run npm test -- packages/themes/src/fonts.test.ts. Minimal stubs may return false/null so expected positive cases fail by assertion. Record RED output and reason before real implementation.

- [ ] **Step 2: Implement the contract and run GREEN.**

Use a literal readonly registry and own-key/descriptor inspection for bounded known fields. Implement isFontId and role-aware validation from the registry rather than duplicated parallel allowlists. Resolver structure:

~~~ts
// Validate descriptors and keys of base and overrides first.
// Resolve four app roles from override-or-base.
// Resolve widgets from override-or-explicit-base-or-resolved-app.
// Return Object.freeze(freshCompleteRecord).
~~~

No CSS stacks, asset dependencies, semantic color keys, storage format/version or UI changes. Run npm test -- packages/themes and npx tsc --noEmit -p packages/themes/tsconfig.json.

- [ ] **Step 3: Verify, self-review and commit scoped source.**

Run npx prettier --write packages/themes/src/fonts.ts packages/themes/src/fonts.test.ts packages/themes/src/index.ts. Run npm run typecheck and npm test -- --reporter=dot once before committing; describe existing React/jsdom warnings, never claim pristine output. Run git diff --check. Self-review role restrictions, descriptor validation, widget precedence and mutation isolation.

Commit only the three source files with git add packages/themes/src/fonts.ts packages/themes/src/fonts.test.ts packages/themes/src/index.ts and git commit -m "feat: add curated theme font contracts". Write detailed RED/GREEN report in this plan's SDD workspace. Controller reviews and publishes; do not push or stage plan/spec files.

## Coverage and self-review

Implements font ID validation, approved display-role separation and widget inheritance from spec sections 3–4. Complete color registry/resolver, portable theme records, actual font loading, editor, sync and channels remain roadmap slices. No rendering change is represented as delivered here. Every interface above has matching tests; no production schema version is frozen prematurely.
