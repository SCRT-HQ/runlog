# Theme Color Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Establish semantic color validation, deterministic widget inheritance, optional feedback-background overrides, and immutable historical color bases without changing rendering.

**Architecture:** Extend @runlog/themes with a metadata-only color registry and pure resolver. Existing four presets become immutable revision-1 color data; renderer aliases and derived mix recipes remain a subsequent integration slice. This is a color-resolution contract, not the final portable snapshot format: null in the feedback-background result is an internal derived-mode marker, never accepted as user color input.

**Tech Stack:** TypeScript, Vitest, existing npm workspace; no runtime dependencies.

**Spec:** .claude/plans/2026-09-17-custom-theme-authoring-design.md, including approved optional feedback backgrounds.

## Global Constraints

- Accept opaque sRGB colors in #RGB, #RRGGBB, and rgb(...) forms; reuse parseOpaqueColor rather than introduce a different parser.
- Normalize to lowercase six-digit hex.
- Widget overrides inherit their app equivalents when unset.
- Preserve existing theme IDs and saved preferences.
- System remains a selection policy, not a mutable base palette.
- No arbitrary CSS, scripts, remote URLs, uploaded fonts, background images, custom component layouts, per-component font sizes, public theme marketplace, or collaborative editing.
- Feedback backgrounds support optional independent opaque overrides, with existing context-specific derived treatments when absent.
- No production CSS, browser rendering, storage, sync, asset, or backend changes in this slice.
- Preserve unrelated files and recovery artifacts; no Superdesign.

## Binding registry

Each definition has id, label, group (surfaces, text, boundaries, interaction, feedback, widgets), and kind (core, widget, feedbackBackground). Widget entries additionally have inherits pointing to their exact core key. Freeze the array and each definition. No CSS selectors or CSS property strings enter this shared registry.

| ID | Label | Group | Kind / inheritance |
| --- | --- | --- | --- |
| surface.page | Page background | surfaces | core |
| surface.panel | Panel background | surfaces | core |
| surface.raised | Raised surface | surfaces | core |
| text.primary | Primary text | text | core |
| text.muted | Secondary text | text | core |
| text.onAccent | Text on accent | text | core |
| boundary.decorative | Decorative divider | boundaries | core |
| boundary.control | Control boundary | boundaries | core |
| boundary.strong | Strong boundary | boundaries | core |
| interaction.accent | Accent | interaction | core |
| interaction.accentTint | Accent tint | interaction | core |
| interaction.selectedIndicator | Selected indicator | interaction | core |
| interaction.focus | Keyboard focus | interaction | core |
| feedback.success | Success foreground | feedback | core |
| feedback.warning | Warning foreground | feedback | core |
| feedback.danger | Danger foreground | feedback | core |
| widget.ground | Widget ground | widgets | widget / surface.page |
| widget.panel | Widget panel | widgets | widget / surface.panel |
| widget.text | Widget text | widgets | widget / text.primary |
| widget.textMuted | Widget secondary text | widgets | widget / text.muted |
| widget.accent | Widget accent | widgets | widget / interaction.accent |
| feedback.successBackground | Success background | feedback | feedbackBackground |
| feedback.warningBackground | Warning background | feedback | feedbackBackground |
| feedback.dangerBackground | Danger background | feedback | feedbackBackground |

Colors with distinct semantic jobs remain independently controllable even when preset defaults match. An accent override does not silently override explicit core focus/success/selected values in the base. Widget unset inheritance uses the final resolved core value, not its original base value.

## Immutable revision-1 bases

Use these exact normalized values (audited from styles.css). Copy shared defaults into distinct core role values, not shared mutable objects.

| Source / semantic keys | lights-down | daylight | ember | glaze |
| --- | --- | --- | --- | --- |
| surface.page | #151311 | #edeae2 | #1a1210 | #101a17 |
| surface.panel | #1e1b18 | #e4e0d6 | #241915 | #17231f |
| surface.raised | #26221e | #dbd6ca | #2e211c | #1e2d28 |
| boundary.decorative, boundary.control | #3a342e | #cbc4b7 | #45312a | #2b3a34 |
| boundary.strong | #5a524a | #a89f91 | #6a4d42 | #4a5f57 |
| text.primary | #ece5d8 | #1c1a17 | #f1e4d3 | #e4ece6 |
| text.muted | #b3a99b | #4a453e | #bfa48f | #9db3a8 |
| interaction.accent, interaction.selectedIndicator, interaction.focus, feedback.success | #9fd3b6 | #3d7a5b | #a9cbb0 | #a8dcc0 |
| interaction.accentTint | #3b5f4c | #b9d6c5 | #4a5f4f | #33584a |
| text.onAccent | #151311 | #f4f2ec | #1a1210 | #101a17 |
| feedback.warning | #e0a94f | #9c6a15 | #f2b45a | #e6b15c |
| feedback.danger | #e4736b | #b4433a | #f08070 | #e78a80 |

Only daylight is light scheme. All other bases are dark. Bases contain only the sixteen required core keys, so widgets inherit and feedback backgrounds default to derived mode. Do not add stylistic/accessibility candidates to this historical catalog yet.

### Task 1: Registry, resolution and immutable base lookup

**Files:** Create packages/themes/src/colorRegistry.ts, colorResolver.ts, colorBases.ts, colorResolver.test.ts, colorBases.test.ts. Modify packages/themes/src/index.ts for exports. Existing parser/font files remain unchanged.

**Interfaces:**

~~~ts
export type CoreColorTokenId =
  | "surface.page" | "surface.panel" | "surface.raised"
  | "text.primary" | "text.muted" | "text.onAccent"
  | "boundary.decorative" | "boundary.control" | "boundary.strong"
  | "interaction.accent" | "interaction.accentTint" | "interaction.selectedIndicator" | "interaction.focus"
  | "feedback.success" | "feedback.warning" | "feedback.danger";
export type WidgetColorTokenId = "widget.ground" | "widget.panel" | "widget.text" | "widget.textMuted" | "widget.accent";
export type FeedbackBackgroundTokenId = "feedback.successBackground" | "feedback.warningBackground" | "feedback.dangerBackground";
export type ColorTokenId = CoreColorTokenId | WidgetColorTokenId | FeedbackBackgroundTokenId;
export type ColorTokenDefinition =
  | { readonly id: CoreColorTokenId; readonly label: string; readonly group: string; readonly kind: "core" }
  | { readonly id: WidgetColorTokenId; readonly label: string; readonly group: "widgets"; readonly kind: "widget"; readonly inherits: CoreColorTokenId }
  | { readonly id: FeedbackBackgroundTokenId; readonly label: string; readonly group: "feedback"; readonly kind: "feedbackBackground" };
export const COLOR_DEFINITIONS: readonly ColorTokenDefinition[];
export function isColorTokenId(value: unknown): value is ColorTokenId;
export interface ResolvedColors {
  readonly values: Readonly<Record<CoreColorTokenId | WidgetColorTokenId, HexColor>>;
  readonly feedbackBackgrounds: Readonly<Record<FeedbackBackgroundTokenId, HexColor | null>>;
}
export function resolveColors(base: unknown, overrides?: unknown): ResolvedColors | null;
export type BuiltinColorBaseId = "lights-down" | "daylight" | "ember" | "glaze";
export interface BuiltinColorBase {
  readonly id: BuiltinColorBaseId;
  readonly revision: 1;
  readonly colorScheme: "light" | "dark";
  readonly colors: Readonly<Record<CoreColorTokenId, HexColor>>;
}
export function getBuiltinColorBase(id: unknown, revision?: unknown): BuiltinColorBase | null;
~~~

The unions indicated above must literally contain the listed keys, or be derived from a typed literal registry; no broad string index signature replaces the allowlist.

Base is a plain record with every core key and optional widget/background keys. Overrides is a plain record with zero to 24 known keys; omitted/undefined overrides mean empty. Reject arrays, null, missing required core keys, unknown own keys including symbols, custom prototypes and accessors; accept Object.prototype and null prototypes. Inspect own descriptors without invoking getters. All present values must parse through parseOpaqueColor, including optional backgrounds: own undefined/null and "derived" are invalid input. Validate base independently before overrides, so an override cannot conceal corrupt base data. Invalid ordinary input returns null; JavaScript proxies are outside this JSON boundary contract.

For each core key choose override then base. For each widget key choose explicit override then explicit base widget key then final resolved inherited core key. For each feedback-background key choose explicit override then explicit base value then null. Null is only a renderer-facing derived-treatment marker: do not output arbitrary CSS, calculate one approximate mix, or claim full contrast verification. Freeze the fresh result and both nested maps. Never mutate inputs.

getBuiltinColorBase defaults omitted/undefined revision to numeric 1; rejects unknown ID, system, different case, whitespace, strings such as "1", and any other revision. Return deeply frozen records so callers cannot alter future resolution. Validate literal colors through the existing parser when constructing bases; no unsafe cast over external input. Do not fallback to a different preset on bad identity/revision.

- [ ] **Step 1: Write public behavioral tests, stubs and observe RED.**

Tests import ./index.ts. Use a literal 16-key base fixture copied from lights-down in the table (not obtained through a resolver under test).

~~~ts
const result = resolveColors(base, {
  "text.primary": "#AbC", "surface.panel": "rgb(0 0 0)",
  "feedback.warningBackground": "#123",
});
expect(result?.values["text.primary"]).toBe("#aabbcc");
expect(result?.values["widget.text"]).toBe("#aabbcc");
expect(result?.values["widget.panel"]).toBe("#000000");
expect(result?.feedbackBackgrounds).toEqual({
  "feedback.successBackground": null,
  "feedback.warningBackground": "#112233",
  "feedback.dangerBackground": null,
});
expect(resolveColors(base, { "feedback.warningBackground": null })).toBeNull();
expect(resolveColors({ ...base, "text.primary": "red" }, { "text.primary": "#fff" })).toBeNull();
expect(getBuiltinColorBase("system")).toBeNull();
expect(getBuiltinColorBase("daylight", 2)).toBeNull();
expect(getBuiltinColorBase("daylight")?.colorScheme).toBe("light");
~~~

Also assert literal complete expected core and widget values for an empty override; every role accepted and unknown key rejected; key case/space mismatch; missing core; malformed base/override shape; symbols; non-enumerable own data (accepted when valid) versus accessor getters (rejected without calls); own undefined; inherited keys/custom prototypes; rgb/hex normalization; invalid alpha/CSS input; explicit widget override beats base widget and explicit base widget beats changed app; deleting widget override restores final-app inheritance when base unset; background reset restores derived null when base unset, or explicit base background otherwise; accent changes leave separately set focus/success core values intact; no input mutation; frozen returned maps and registry metadata resist poisoning subsequent calls.

Historical lookup tests exercise all four bases through resolveColors, asserting literal expected palettes from the table, all five widget inheritances, derived background markers, revision/scheme, and immutability. Literal historical values are an intentional compatibility contract, not a source-text test.

Run npm test -- packages/themes/src/colorResolver.test.ts packages/themes/src/colorBases.test.ts. Minimal false/null stubs may expose public interfaces; record assertion failures for missing behavior before real implementation.

- [ ] **Step 2: Implement registry/resolver/bases and verify GREEN.**

Use the registry as the single allowlist/inheritance source. Keep validation private in colorResolver.ts; reject unknown keys before looking up values. Use own descriptors, parse each color, then resolve in core/widget/background order:

~~~ts
// Core: validOverrides[key] ?? validBase[key].
// Widget: validOverrides[key] ?? validBase[key] ?? values[definition.inherits].
// Background: validOverrides[key] ?? validBase[key] ?? null.
// Freeze fresh maps and outer result.
~~~

Keep colorBases.ts data-only and side-effect-free. Package import must not require DOM/browser globals. New keys are not wired to existing CSS until the migration slice.

Run focused tests then npm test -- packages/themes and npx tsc --noEmit -p packages/themes/tsconfig.json. Record GREEN counts.

- [ ] **Step 3: Format, verify, self-review and commit.**

Run npx prettier --write on the six touched files. Run npm run typecheck, npm test -- --reporter=dot, and git diff --check. Existing baseline warnings remain disclosed. Review every historical value, fallback order, background marker and rejection boundary. Commit only source/tests with message "feat: add semantic theme color resolution". Write detailed test evidence to this plan's SDD task report. Controller reviews, pushes, opens PR and enables auto-merge.

## Self-review and coverage

This implements core color-role validation, default/widget resolution, optional feedback-background overrides and immutable existing color bases from spec sections 3–5. Portable documents, final snapshots and recipe versioning, CSS aliases, actual status backgrounds, presets/fonts, editor, storage, sync and channels remain roadmap work. Public color keys follow audited semantics; no user color can contain null, CSS or alpha. All interface names and required key sets match. Data contracts do not assert that every consumer has already migrated or passed accessibility checks.
