# Repository workflow

## Publishing completed work

After completing and reviewing a change, run the relevant verification, commit
the intended changes, push the feature branch, create a pull request against
`main`, and enable auto-merge. This is the user's standing instruction for this
repository; do not ask them to select an integration option each time.

When executing an approved multi-slice plan, continue to the next in-scope slice
after opening a PR and enabling auto-merge. Publication is a checkpoint, not a
reason to end the work. Pause for a genuine blocker, a material scope/design
decision, or a specific review that needs the user's input; do not request
routine re-approval for work already covered by the plan.

Respect required checks, reviews, branch protection, and the merge queue. Do not
bypass them, force-push, or merge directly into `main`. If verification fails or
publishing is blocked, report the blocker instead of claiming completion.

Keep progress and recovery records current when working from a plan. Preserve
unrelated user changes and recovery artifacts.

## Design-system direction

Users should eventually be able to create custom themes. While refining styles,
prefer semantic color roles and shared typography/spacing tokens over hardcoded
values or component rules tied to a built-in theme ID. Preserve existing theme
IDs, saved preferences, and specialized widget backgrounds. Check keyboard focus
and contrast when changing colors. A theme editor, custom-theme storage/import
format, and account synchronization need their own design before implementation.
