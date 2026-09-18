# Custom theme authoring and accessible presets

Date: 2026-09-17
Status: written specification approved by the user on 2026-09-18; implementation authorized.
Scope: first release, including account synchronization and external widget presentation.
Implementation status: foundational color-contract slice in progress. Detailed subplans are linked from 2026-09-18-custom-theme-authoring-roadmap.md.

## 1. Outcome and approved decisions

Users can create named themes by overriding registered color and font-family tokens. Themes apply consistently across the application, controls, dialogs, pop-outs, and widgets without bringing back inconsistent type sizes or spacing.

The user approved:

- A guided editor with advanced semantic-token controls.
- Colors entered as hex or RGB; fonts selected from a curated list.
- Website and widget coverage, preserving the shared typographic hierarchy.
- Built-in high-contrast themes and palettes evaluated for protan, deutan, and tritan color-vision differences.
- Contrast warnings that remain visible but can be explicitly overridden.
- Account synchronization in the first release; the active selection remains device-specific.
- Separate saving and applying; isolated previews and local drafts.
- Widgets follow the applied app appearance by default, with optional snapshot-based pinning.
- Pinned snapshots survive edits or deletion of their originating library theme.
- External widget links follow the appearance applied by the device that created the link, not the receiving browser's preferences.
- Remote widget consumers receive resolved presentation values, not the private theme library.
- JSON import/export, safe recovery, and conflict preservation.

Detailed policies below make those decisions implementable. They are part of the written-spec review, not claims of existing behavior.

## 2. Existing foundation and boundaries

Discovery used the landed redesign source at main commit `8d54a762cb5e3d773ed067bbf0e2ec8316bf65ba`.

| Existing area | Design consequence |
| --- | --- |
| `apps/web/src/theme/theme.ts` | Preserve existing theme IDs and migrate the `runlog.theme` preference without losing the user's choice. |
| `apps/web/src/theme/ThemeMenu.tsx` | Retain quick theme selection; add a path to theme management. |
| `apps/web/src/styles.css` | Extend semantic roles and bridge old CSS variable aliases; do not expose every incidental CSS variable. |
| `apps/web/src/fonts.css` | Keep fonts self-hosted or system-provided; no external font service. |
| `apps/web/src/settings/DeviceSettings.tsx` | Themes intentionally live in the account menu; do not bury quick selection inside run settings. |
| `apps/web/src/sync/client.ts`, `engine.ts`, `bus.ts` | Reuse authentication and sync conventions; themes need their own resource contract, not run events. |
| `apps/web/src/widget/route.ts`, `WidgetView.tsx` | Preserve eight widget kinds, scale, background modes, run access, and legacy theme URLs. |

Existing choices are System, Lights down, Daylight, Ember, and Glaze. System remains a selection policy, not a mutable base palette.

The backend contract for theme resources and appearance channels is new. Exact endpoint placement, database integration, and transport reuse require targeted discovery during implementation planning. This design does not assert that existing sync supports them already.

### Alternatives considered

1. A palette-only generator is simpler but does not satisfy font selection and advanced role overrides.
2. A typed token editor is selected: guided entry, advanced roles, strict parsing, shared rendering, and portable data.
3. Arbitrary CSS or a full typography/layout studio would expand the security and compatibility surface and undermine the recently established consistency; excluded.

### Non-goals

No arbitrary CSS, scripts, remote URLs, uploaded fonts, background images, custom component layouts, per-component font sizes, public theme marketplace, or collaborative editing. Theme changes do not alter gameplay, permissions, subscription entitlements, or run data. No claim of complete WCAG conformance follows merely from passing palette checks.

## 3. Architecture and ownership

Separate six responsibilities:

1. **Token and font registry:** stable public keys, labels, descriptions, accepted values, defaults, inheritance, and preview grouping.
2. **Theme resolver:** a pure conversion from a versioned base plus validated overrides into a complete presentation snapshot.
3. **Accessibility evaluator:** contrast results and pair-level suggestions, independent of persistence and application.
4. **Theme library:** local persistence, account-scoped synchronization, revisions, conflicts, import, and export.
5. **Appearance controller:** the device's applied snapshot, System policy, local window notifications, safe fallback, and widget pinning.
6. **Authoring UI:** library management, draft editing, preview, warnings, and explicit save/apply actions.

Components consume resolved CSS custom properties, not theme IDs. Built-in palettes use the same registry and resolver as custom themes. Compatibility aliases keep existing consumers functioning while targeted audits remove hardcoded theme-dependent colors and font families.

An applied appearance is a resolved snapshot, not a live pointer to a mutable library record. Saving or receiving a newer revision does not silently change the screen. The selector can indicate that a newer saved version is available; applying it is explicit.

### Data flow

Draft edits → validated overrides → resolved preview → accessibility evaluation.

Save → local library revision → account sync.

Apply → resolved device snapshot → local following windows → authorized external appearance channels.

Pin → immutable resolved snapshot, independent of subsequent library and device changes.

## 4. Token contract

Public keys describe intent, not selectors. The initial registry covers:

| Group | Roles |
| --- | --- |
| Surfaces | Page, panel, raised panel, interactive/selected surfaces |
| Text | Primary, secondary/muted, inverse/on-accent |
| Boundaries | Decorative divider, meaningful control boundary, stronger boundary |
| Interaction | Accent, accent tint, selected indicator, keyboard focus |
| Feedback | Success, warning, danger, and their foreground/background pairs where rendered |
| Widgets | Widget ground, panel, text, secondary text, accent, and role-level font overrides |
| Fonts | UI/controls, prose, numeric/monospace |

This is the required coverage, not permission to invent unused roles. Planning must inventory actual consumers and produce the exact stable key-to-CSS mapping. A shared foreground used over several surfaces must be checked against every applicable surface.

Widget overrides inherit their app equivalents when unset. The existing clear/solid/none background modes remain separate rendering policies; a theme cannot force an opaque ground into a transparent widget mode.

### Color input

Accept opaque sRGB colors in `#RGB`, `#RRGGBB`, and `rgb(...)` forms. RGB accepts comma-separated or space-separated channels, with either integer 0–255 channels or percentage 0–100 channels. Reject mixed units, out-of-range values, alpha, named colors, CSS expressions, URLs, and variable references. Normalize to lowercase six-digit hex.

Transparency remains controlled by existing widget background modes and application-owned state treatments. Users do not enter RGBA or eight-digit hex in this release. Validate imported and synced data with the same rules as editor input.

Invalid partial input stays in the field with an associated message while the preview keeps its last valid value. Invalid data cannot be saved or applied; accessibility warnings are a different category and do not impose that restriction.

### Font input

Persist stable font IDs, never a user-supplied CSS font-family string. Initial choices use existing assets and system stacks:

- UI and prose: System sans, System serif, Literata, IBM Plex Mono.
- Numeric: System monospace or IBM Plex Mono.
- Widget equivalents: inherit, or select from the same role-appropriate list.

Registry entries provide their complete fallback stacks, supported styles, and loading behavior. Additional bundled fonts require license, payload, weight/style, and layout verification before inclusion. System fonts may differ between machines; a pinned snapshot preserves the font choice, not identical installed font files.

Preserve shared size, line-height, weight, spacing, and control-height tokens. Existing widget scale continues to work. Test the available families at actual rendered weights and against long content.

## 5. Theme records, revisions, and portability

A saved theme contains a schema version, stable theme ID, plain-text name, base preset ID and revision, token overrides, and a content revision. Account ownership is assigned by the authenticated server, never trusted from imported data. Server synchronization metadata is separate from portable theme content.

Bases are versioned and immutable. Updating a built-in palette must not silently alter existing custom themes. Export includes the referenced base's validated token values as well as overrides, allowing the receiver to reproduce the theme without the same historical preset installed. Resolved snapshots include the token schema version, color scheme, complete normalized values, and font IDs.

Changing the base in the editor preserves explicit overrides and previews the result before saving. Resetting one field removes its override; resetting all fields removes all overrides but preserves the theme's identity and name.

Import creates a new theme ID and never overwrites a local or account theme merely because its file carries the same ID or name. Export excludes account identifiers, synchronization metadata, drafts, appearance-channel credentials, and any run/share token.

Apply bounded input handling on client and server: one theme per import, maximum 64 KiB decoded JSON, a name of 1–80 Unicode code points after trimming, and only registered keys. Unknown schema versions and keys fail with actionable messages rather than silently dropping user data. Do not render names as HTML.

JSON export is an explicit download. No remote file fetching or import-by-URL is included.

## 6. Authoring workflow

### Entry and library

Keep the quick theme selector in its current locations. Group built-ins and My themes, retain Match the system, and add Manage themes. Management must be available to guests without requiring an account prompt.

The library supports create from preset, duplicate, rename, delete, import, export, edit, and apply. Built-ins cannot be edited in place. Editing one creates a custom copy. Theme cards communicate the name, light/dark scheme, applied state, and synchronization state without relying on color swatches alone.

### Editor

Group fields into Colors, Fonts, Advanced roles, and Widgets. Basic fields expose the useful shared roles; advanced fields expose the remaining registered roles. Each control shows a human label, token key, current value, inherited/default value, and Reset to base.

The preview contains representative application controls, prose, numeric data, focused/selected states, feedback, and actual widget renderers. Use representative data rather than private run content by default. Provide widget background and scale previews without changing real widgets.

Keep editor controls and recovery actions in a known readable palette outside the draft's style scope. On narrow screens, editing and preview must remain reachable without horizontal page scrolling.

### Draft, Save, and Apply

Drafts are device-local and account-scoped, restored after a restart, and never synchronized or published to widget channels. Leaving with unsaved changes offers Save draft, Discard, or Keep editing.

Save commits a valid theme to the library and queues sync. Save does not apply. Apply operates on a saved revision; if edits are unsaved, offer an explicit Save and apply action. A combined action must show both outcomes if saving succeeds but external propagation is delayed.

A preview never writes root appearance, saved preferences, appearance channels, or another window's state.

### Delete and recovery

Deleting a library theme does not destroy its applied or pinned snapshots. Active devices retain the appearance and label it as a retained copy whose source was removed. They can restore a default or save a new copy. Deletion syncs as a tombstone so an offline device cannot casually resurrect it.

Provide Restore default appearance in the quick selector and a directly reachable recovery entry that boots with safe styling before reading custom values. Restoration changes the device appearance, not the library. It updates following consumers but leaves pins untouched. An invalid stored appearance falls back safely without destroying recoverable library records.

## 7. Accessibility model and built-in presets

### Checks and warnings

For ordinary text, evaluate 4.5:1; for qualifying large text, evaluate 3:1. Compute against actual rendered backgrounds and do not round a failing value upward to a pass. Pair definitions must include hover, focus, selection, and feedback states where they affect presentation. [W3C: Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

Evaluate required visual information in controls and meaningful graphics against adjacent colors at 3:1. Do not incorrectly treat every decorative divider as a mandatory control boundary. Focus indicators must also receive dedicated visibility checks. [W3C: Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

Warnings name the roles, show measured ratio and target, identify affected contexts, and offer a suggested correction. Suggestions never mutate the theme without consent. Apply with warnings requires explicit acknowledgment for that resolved revision; changing relevant values invalidates the acknowledgment. Warnings remain visible after acknowledgment and are recomputed rather than trusted from imports.

A clean palette result is labeled as passing the checked contrast pairs, not as an accessibility certification. Disabled or decorative exceptions must be documented, not used to hide meaningful text failures.

### Presets

Ship high-contrast light and high-contrast dark. Their ordinary text target is at least 7:1, with at least 4.5:1 for qualifying large text, while preserving necessary non-text contrast. These are product targets based on enhanced text contrast, not a claim of whole-application AAA conformance. [W3C: Contrast Enhanced](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html)

Include preset families evaluated for protan, deutan, and tritan differences, with light and dark variants. The implementation's palette-selection work must evaluate actual status and interaction combinations, not simply recolor a screenshot or apply a filter to the whole UI.

All presets need labels, icons, shape, or other non-color indicators wherever color communicates meaning. This requirement applies to existing themes too. Color-vision simulation is an evaluation aid, not proof that every person with that difference can distinguish a palette. [W3C: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)

Do not call a preset universally “color-blind safe.” Describe its intended palette characteristics and the checks performed. Actual palette hex values are implementation deliverables governed by these acceptance criteria, not arbitrary values frozen before testing.

Honor operating-system forced colors rather than overriding them globally. Preserve keyboard focus, text scaling, reduced-motion behavior, and readable error/status messages.

### External backgrounds

In clear mode, verify text on the rendered panel where it exists; in none mode, external-background contrast cannot be guaranteed. Preview on selectable sample backgrounds and explicitly label the result as conditional. Unknown external backgrounds receive an “External background not verified” notice, not a passing badge.

## 8. Persistence and account synchronization

Guests get local themes and JSON import/export. Signed-in accounts get local caching and synchronized saved definitions. Offer explicit import of guest-local themes into the account; do not silently upload them on sign-in.

Keep account stores and drafts isolated. Sign-out stops authenticated synchronization and appearance publication, clears credentials, and prevents private records from appearing in the guest library. The current appearance can remain as presentation-only values with no account metadata; the private library is not exposed through that copy.

Use server-assigned revisions and conditional writes. Never resolve concurrent edits solely with device wall clocks. On a conflicting edit, keep the server revision and preserve the local candidate as a clearly named conflict copy. Do not automatically apply either. An edit racing a delete is also preserved as a separate recovery copy rather than reviving the deleted ID.

Local save must complete before the UI claims “Saved on this device.” Remote confirmation is required before “Synced.” Storage failure must leave the draft usable and offer export; do not claim durability for memory-only data.

Offline mutations retain their base revision and an idempotency key. Retries are bounded/backed off and resume on connectivity or an explicit retry. Authentication errors request sign-in; validation errors identify the record; neither erases local work. Coalesce repeated unsent updates where safe, keeping delete ordering and conflict evidence intact.

Receiving remote library changes updates the library only. The device's active selection and resolved snapshot remain unchanged until Apply. System selection follows that device's OS light/dark preference; those transitions count as applied appearance changes for its following widgets.

## 9. Pop-outs, pins, and remote widget channels

### Local behavior

Local following windows subscribe to the applied appearance controller. They do not observe drafts or mutable library records. Pinned windows use their own complete snapshot. Pinning resolves the current appearance immediately, including a System choice, so later OS changes do not change the pin.

Existing widget scale and background policies remain independent of theme selection. Browser-native controls outside application styling remain governed by the browser/OS.

### External follow links

A new external follow link references a narrowly scoped appearance channel associated with the creating browser device and an existing authorized widget-sharing context. Its resolved presentation is retained server-side so OBS or another machine can read it when the creator is closed.

The creator publishes only applied snapshots, including intentional Restore default and System light/dark changes. Other signed-in devices may sync the library but cannot silently become that channel's publisher.

The channel read capability exposes only schema version, color scheme, normalized presentation values, font IDs, and a revision. It exposes no private theme name, theme library, account metadata, draft, or write credential. It grants no run-read or control permission; those remain independently authorized by the existing widget access mechanism.

Authenticated channel management must verify ownership. Publisher authority must be separately bound to the originating device; a caller-supplied device ID is not authorization. The implementation plan must select a protected device capability or equivalent existing mechanism, with explicit replacement/revocation. Do not put publisher credentials in widget URLs.

Initial channel publication must succeed before a new hosted follow link is described as ready. When the source is offline, consumers retain the last successfully published snapshot. Management displays pending/stale publication; broadcast content is not covered with transient sync notifications.

Appearance channels are explicitly revocable, and their lifecycle is tied to the related sharing context. Revocation stops future reads but cannot retract presentation values already delivered or cached. Reopening a revoked or missing link without a cache uses a safe fallback and an appropriate setup error.

Local-only environments cannot publish a hosted channel. They support local follow and portable pinning, with a clear explanation that live cross-device following requires the hosted service.

### Pinned links

New pinned links carry a bounded, normalized presentation snapshot in their URL fragment, separate from existing run-access information. They must not require the private theme library to render and must work on a fresh browser. The snapshot has a fixed token allowlist and strict decoded size limit; reject malformed or oversized payloads before application.

Pins contain no names, account IDs, or credentials beyond the widget's independently existing run-access mechanism. The interface makes clear that presentation values travel with the link.

“Update pinned theme” explicitly creates a refreshed snapshot. For copied browser-source links, it produces a replacement URL and explains that the external source must be updated; previously copied URLs do not mutate. An open local pop-out can update its own route directly.

Legacy `theme=ember` and other built-in URL pins continue to work with their historical semantics. Legacy unpinned links retain receiving-device behavior; new generated follow links carry explicit source-channel identity. Do not reinterpret old links as following a nonexistent creator.

### Failure ordering

Choose a valid explicit snapshot/channel result when available, otherwise a last-known valid snapshot for that same channel, otherwise a known built-in fallback. Do not substitute another account's cached state. Invalid remote data never becomes inline CSS. Theme failures must not broaden access to run data or prevent the user reaching recovery controls.

## 10. Compatibility, security, and observability

- Validate registry keys and values on every trust boundary: editor, import, storage restoration, account sync, and widget input.
- Keep theme payloads data-only. Compile known values to application-owned CSS properties.
- Do not weaken font CSP or introduce remote font downloads.
- Apply server request-size limits, account quotas, and rate limits. Reaching a limit preserves local work and offers export; enforcement values belong in the implementation plan alongside existing backend limits.
- Keep run/watch/press capabilities separate from appearance publication and never log bearer tokens or full widget URLs.
- Record error categories and resource revisions for diagnosis without recording private theme names or full user palettes by default.
- Migrate existing device preferences transactionally; failure retains the original choice and a recoverable record.
- Keep pinned snapshots and versioned bases resolvable across schema upgrades; unknown future versions are rejected without destructive migration.
- Do not use theme ID checks to special-case component presentation when semantic roles suffice.

## 11. Verification and release gates

| Area | Required evidence |
| --- | --- |
| Registry/resolver | Every public role maps to intended consumers; inheritance, base revisions, resets, deterministic resolution, and invalid values tested. |
| Fonts | Every allowed role/family combination checked for loading, fallback, long content, numeric alignment, and offline behavior. |
| Contrast | Threshold boundaries, multiple surfaces, state treatments, warning acknowledgment invalidation, and conditional external backgrounds tested. |
| Presets | All required contrast pairs pass; non-color cues reviewed; color-vision evaluation method and limitations recorded. |
| Editor | Keyboard-only create/edit/save/apply/reset/import/export, responsive layout, preview isolation, and draft recovery verified. |
| Storage | Quota/permission failure, corrupt data, migrations, removed bases, and retained active snapshots tested. |
| Sync | Offline retry, concurrent edits, edit/delete conflict, duplicate delivery, sign-out/account switch, and authorization isolation tested. |
| Widgets | All eight kinds, three background modes, scale range, local follow, fresh-browser remote follow, pins, legacy URLs, and revocation tested. |
| Publication | One device's Apply reaches its channels only; Save, draft edits, and other-device library changes do not publish. |
| Recovery | Unreadable custom colors, invalid snapshots, unavailable channels, and missing fonts leave a usable escape path. |

Use unit tests for parsing/resolution, component tests for authoring and accessibility feedback, backend integration tests for ownership/revisions, and browser tests for propagation, fonts, reflow, and actual computed colors.

Automated results do not replace native forced-colors, screen-reader, real-device zoom/touch, authenticated multi-device, or OBS/browser-source acceptance. Record those separately and do not label unperformed checks as passing.

Preserve the prior redesign's human-acceptance boundary; this feature does not retroactively complete it.

## 12. Delivery boundaries for the subsequent plan

This is one coordinated feature with separable implementation slices:

1. Inventory consumers and define versioned token/font/snapshot contracts; lock down migration behavior.
2. Route application and widget styling through those contracts; retain existing appearances.
3. Implement accessibility evaluation and the new built-in presets with measured evidence.
4. Implement local library, import/export, drafts, editor, and safe Apply/recovery.
5. Implement account resource storage and revision-aware synchronization.
6. Implement local follow, immutable pins, and remote appearance channels with security/lifecycle tests.
7. Complete cross-surface acceptance, documentation, and rollout.

The detailed plan follows written-spec approval. It must identify exact files, tests, backend dependencies, quota choices, migrations, and incremental rollout controls. Intermediate PRs must not advertise an incomplete synchronized feature as released.

For each completed and verified slice: commit scoped changes, push, create a conventionally titled PR, enable auto-merge, and continue in-scope work unless a material decision or blocker requires the user. Never bypass checks or merge protection.

## 13. Design review and next action

Self-review checklist:

- Requirements and approved decisions are represented.
- Saving, syncing, applying, and pinning have distinct effects.
- External widgets do not depend on private library access or shared browser storage.
- Accessibility warnings remain overridable without being mislabeled as resolved.
- Data validation, conflict handling, safe recovery, and legacy URLs have explicit behavior.
- Concrete palette values and implementation mechanics are assigned to testable delivery work rather than falsely presented as already implemented.

Next action: execute detailed subplans under 2026-09-18-custom-theme-authoring-roadmap.md. The user approved this written spec and requested implementation on 2026-09-18. Publication alone was not the approval; the user's subsequent instruction was.

### Catalog extension requested with approval

Expand offered fonts and built-in themes, including retro arcade and cyberpunk styles. These remain tokenized palettes and curated font selections, not permission for arbitrary CSS, flashing, scanlines, animation, or layout changes. Exact font-role defaults and palette choices will be recorded with the catalog subplan after license, payload, available-weight, and readability discovery. Shared contracts can proceed independently of those choices.

The user subsequently accepted the interactive examples, including Cyberpunk Neon as an alternative pink/blue/purple palette alongside the yellow-accent Cyberpunk. The updated direction adds a display-heading role so expressive faces do not force pixel typography onto controls or prose. The catalog roadmap records candidate values and fonts; acceptance of the visual direction does not substitute for production accessibility and cross-surface verification.
