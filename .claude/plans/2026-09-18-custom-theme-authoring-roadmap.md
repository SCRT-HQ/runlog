# Custom Theme Authoring Delivery Roadmap

Spec: .claude/plans/2026-09-17-custom-theme-authoring-design.md.
Status: user approved written spec and requested implementation on 2026-09-18.
Extension requested: additional curated fonts and retro arcade/cyberpunk built-in themes.

## Delivery strategy

Execute independently reviewable subplans in order. Produce each detailed subplan after inspecting its dependency contracts, before its code is written. This roadmap is the cross-feature coverage map, not a substitute for exact task briefs.

1. **Shared data contracts.** Strict opaque colors and contrast arithmetic landed in PR #382. Current executable plan: 2026-09-18-theme-font-contract-plan.md (curated IDs and app/widget font inheritance). Semantic color roles, immutable versioned bases, portable records and complete resolved snapshots follow the consumer audit.
2. **Catalog and style integration.** Audit every actual color/font consumer; bridge legacy CSS names, preserve theme IDs and widget modes, add accessible preset families and approved stylistic presets, bundle licensed font assets offline. Dedicated verification records cover contrast, type metrics, payload, and non-color cues.
3. **Local library and authoring.** Account-scoped IndexedDB data and drafts, strict import/export, isolated component previews, warnings, explicit Save/Apply and safe recovery. No automatic upload of guest themes.
4. **Account sync.** Server-owned revisions, authorization, bounded records/quotas, idempotent retries, tombstones, edit/delete conflict copies, and device-specific applied snapshots. Requires actual backend interface discovery rather than adapting session events.
5. **Following and pinned outputs.** Local appearance propagation, portable URL snapshots, protected source-device publication and read-only external appearance channels. Preserve old URLs and separate run permissions.
6. **Release acceptance.** Combined migration, keyboard/reflow, font, contrast, cross-account and multi-device tests; actual browser sources/OBS, native accessibility and forced-colors verification recorded separately.

Every spec section is covered by a delivery group: sections 3–5 by groups 1–2; section 6 by group 3; section 7 by groups 1–3 and 6; section 8 by groups 3–4; section 9 by group 5; sections 10–11 by every relevant boundary and group 6. Documentation and progress capture accompany every group.

## Expanded catalog boundaries

The user requested stylistic variety within the approved tokenized editor, not arbitrary CSS or layout changes. Proposed retro arcade and cyberpunk presets use color and font-role choices without flashing, scanlines, animation, or changing the shared type scale. Contrast checks still apply to shipped presets; custom overrides remain allowed with warnings.

The user accepted the updated visual direction: readable controls/prose with a separate expressive display-heading role, and numeric faces appropriate for timers. Catalog candidates include Atkinson Hyperlegible Next, Space Grotesk, Oxanium, VT323 and Press Start 2P alongside existing choices. Production inclusion requires verified upstream license, available weights, glyph coverage, offline bundling and payload checks.

Cyberpunk Neon is accepted as an additional direction alongside the original yellow-accent Cyberpunk and Retro Arcade. Its candidate palette uses aubergine #160d24, purple panels #30204b, pink accent #ff64d8, blue focus #62cfff, lavender text #f5edff, secondary text #cdbbe8, amber warnings #ffd27a and coral errors #ff9a88. Selected preview contrast pairs pass; this is not full accessibility certification or production acceptance.

## Execution and checkpoints

- Worktree: .worktrees/redesign-phase6, branch feat/theme-registry-contracts from origin/main 455746fd after PR #382.
- Prior documentation PR #381 merged; approval of the spec is now recorded.
- Preserve unrelated root changes and retained browser evidence.
- Use rightsized GPT-5.6 agents for bounded discovery/implementation/review where available.
- Each completed reviewed slice is pushed, PR-created and auto-merge-enabled; continue approved work through publication checkpoints.
- Do not advertise local-only intermediate authoring as completion of the synchronized first release.
- Retain .superpowers progress, test evidence, review reports and resume records across sessions.

## Publisher authorization decision

Approved by the user: account authentication plus a per-channel device-local secret, stored only as a hash server-side; explicit transfer rotates the secret and invalidates the old publisher. It never appears in widget URLs, synced themes, exports or logs. This is an accepted implementation constraint, not a shipped backend feature.

## Color audit boundary

Current palette values conflate control and decorative boundaries, and general accents with focus, success and selection. The color registry plan will separate those semantic jobs while preserving existing preset values. Widget clear/solid/none modes remain authoritative; current panels use 82% or 92% opacity mixes, so contrast depends on effective backgrounds.

An upcoming design decision concerns independent feedback background overrides versus application-owned derived mixes. Existing warning/error/success fills are mixtures, not independent palette values. Resolve that authoring boundary before freezing the complete color snapshot schema.
