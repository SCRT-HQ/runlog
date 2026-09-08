# Contributing

Two quite different things live here, and they have different rules.

**Writing a pack** needs no knowledge of this codebase at all — see
[the authoring guide](docs/authoring.md). Packs are data; you never touch
TypeScript.

**Changing the engine** is what follows.

---

## Getting set up

```bash
npm install
npm run dev          # the app, on localhost
npm test             # the whole suite
npm run typecheck    # all four projects
npm run check:packs  # every shipped pack, --strict
npm run build        # static output in apps/web/dist
```

CI runs exactly those. If they pass locally they pass there.

---

## The shape of the thing

```
pack (YAML/JSON, validated)
        │
        ▼
   engine (pure, event-sourced, zero DOM)
        │
        ▼
   UI (React) ────────► environment port (a mock today)
```

- **`packages/rules-schema`** is the contract. Zod is the single source of
  truth; the published JSON Schema is derived from it, so what your editor
  autocompletes cannot drift from what the app enforces. `lint.ts` catches what
  a schema cannot — ranges that do not tile, dangling references, counters
  nothing reads.
- **`packages/engine`** is pure TypeScript. No DOM, no React, no `Math.random`
  — a random source is always passed in, so nothing can accidentally become
  unreproducible.
- **`apps/web`** is the only place allowed to know it is in a browser.

### A run is its event log

`reduce(pack, events) → RunState`. Nothing is stored directly. Undo, replay,
shared seeds and the export are all the same feature seen from different
angles, which is why they are cheap.

If you find yourself wanting to mutate state directly, the answer is almost
always a new event.

### Execution can be interrupted

A pack may need a die roll or a judgment mid-way through resolving something.
Rather than making everything async, execution throws to unwind, the caller
collects an answer, and the whole block is re-run from the top with the answers
replayed. Answer keys are derived from the position in the action tree, so a
re-run asks the same questions in the same order.

The consequence that matters: **an interrupted block commits nothing.** Events
land only when the whole thing finishes. Half-resolved never reaches history.

---

## What tests are for here

Tests in this repo are expected to say *why* they exist. A test named "works
correctly" that asserts an implementation detail is worse than no test — it
freezes an accident and tells the next person nothing.

Most of the tests worth reading came from a real failure. Some examples:

- `[].every()` is `true`, so an absent `skipWhen` skipped every phase. Eight
  tests, one of which asserts that `all` and `any` genuinely disagree.
- Table rolls ran, committed their events, and never recorded the step as
  done — so the log filled up while the game appeared to refuse to move.
- Counter thresholds were declared, validated, and never fired, because
  nothing evaluated them. The number on screen was right, so it looked like it
  worked.
- The offline worker missed a cache match on a module script and the bare
  `fetch` behind it rejected: a blank page, an empty console, and the entire
  app sitting in the cache.

When you fix something like that, write the test that would have caught it and
say in a comment what it was.

### Guards

Three tests exist to stop whole classes of drift, and they will fail loudly:

- **`domain-neutrality.test.ts`** — no identifier in the published schema may
  name one craft. Prose examples may name any domain; a *property name* may
  not, because a pack author in another field then has to write `afterCompose`
  about a deadlift.
- **`license-boundary.test.ts`** — nothing git tracks may name the private game
  or cite a particular rulebook as a source. See the licensing note in the
  README.
- **`schema.test.ts` / `docs.test.ts`** — the published schema and the
  generated reference must match what the code actually does. Run
  `npm run schema:emit` and `npm run docs:emit` and commit the results.

---

## House style

- **Comments explain why, never what.** The code says what it does. If a
  comment restates it, delete the comment; if the code needs one to be legible,
  usually the code should change instead.
- **Name things for the general case.** This began as a companion to one music
  game and the pull toward its vocabulary is constant. `unit`, `subject`,
  `run` — never `room`, `track`, `bar`.
- **Report, do not resolve.** Contradictions between rules, disagreements with
  the environment, honor-system checks: show the player what is in tension and
  let them rule on it. These games want human judgment, and a tool that
  silently decides is one people stop trusting.
- **Show the working.** Anything derived — a targeting result especially —
  carries its derivation, and the UI renders it. A verdict with no visible
  reasoning is the thing players distrust most.

---

## Releases

Every merge to main deploys to dev and is tagged and released from there;
production deploys from the release. The version is the tag, and nothing in
the repository carries it.

A pull request's title becomes the title of its squash commit on main, and
that title is written in [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
form; a check on every pull request holds it to that:

```
feat(run): move the clock under the unit name
fix(engine): stop a paused timer from expiring
docs: say how a run is scored
feat(schema)!: drop the old targeting shape
```

A type, an optional scope in parentheses, a colon, and a short description
in lowercase that reads as an instruction, with no period. The types are
`feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `test`, `build`, `ci`,
`chore` and `revert`; the scopes are `run`, `designer`, `library`, `catalog`,
`profile`, `live`, `engine`, `schema`, `cli`, `packs`, `hosted`, `ci`,
`docs`, `deps` and `release`. Commits inside a branch can say what they like;
only the title lands on main.

How big the step is comes from the titles since the last tag:

- a `!` after the type, or a `BREAKING CHANGE:` footer in the pull request's
  description: a new major version. For a change after which a pack or a
  log from before no longer loads, or plays differently.
- any `feat`: a new minor version. For anything a player or an author can
  see or do that they could not before.
- otherwise: a patch.

The release notes are those titles grouped by type, as `cliff.toml` says:
breaking changes, new, fixed, faster, documentation, dependencies,
housekeeping. The whole changelog, back to the first release, is attached to
every release as `CHANGELOG.md`; it is not kept in the tree, because nothing
but the deploy may write to main.

A manual run of the CI workflow can still name the bump outright; its
default, auto, reads the titles.

## Changing the format

The pack format is a published contract other people's files depend on.

- **Additive changes** — a new optional field, a new variant in a discriminated
  union — are fine. Bump the schema's minor version.
- **Anything that changes how an existing pack plays** needs `schemaVersion` to
  go up, and the engine declares which versions it supports.
- **Unknown keys are errors, not warnings.** A typo in a field name would
  otherwise do nothing, silently, all game.
- New engine features that a pack depends on get a **capability**, so an older
  app refuses a newer pack with a clear message instead of misplaying it.

After changing anything in `rules-schema`:

```bash
npm run schema:emit
npm run docs:emit
npm test
```

---

## Deliberately not built

Networked multiplayer — co-op here is same-room, pass-the-device. AI narration.
Arbitrary scripting in packs. A pack registry: a URL and a file are enough
until the format has proven itself.

If you want one of these, open an issue and say what it unlocks. They are
absent on purpose, but none of them is sacred.
