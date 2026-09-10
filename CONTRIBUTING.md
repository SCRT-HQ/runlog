# Contributing

Two different things live here, and they have different rules.

**Writing a pack** needs no knowledge of this codebase at all: see
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

CI runs the same commands. If they pass locally they pass there.

`.npmrc` asks npm not to install a package version younger than a week, so
a compromised release has time to be noticed before it reaches anyone
here. npm 11.10 and later enforce it; an older npm ignores the line.

The build knows whether there is anything to sign into from one variable:

| | |
| --- | --- |
| `VITE_WORKOS_CLIENT_ID` set | "Sign in" in the header. Set by the deploy from the stage environment's `WORKOS_CLIENT_ID` variable. |
| unset | No sign-in at all, and no request to WorkOS. Local development, the test-suite, a file on disk and the public GitHub Pages build all run this way. |

To work on sign-in locally, put the staging client id in `apps/web/.env.local`
and run `npm run dev`; `http://localhost:5173/` is a registered callback. To
have an API as well, set `VITE_RUNLOG_API_ORIGIN` there to a hosted Runlog
(the dev site, say): the dev server proxies `/api` and `/ws` to it, so live
links, widgets by link, sync and purchases work at localhost as they do
hosted, against that site's data. `apps/web/.env.example` shows both.
Anything else the app talks to has to be named in the Content Security Policy
in `hosted/infra/lib/site-stack.ts`, and today that is `api.workos.com` alone.

---

## The shape of the thing

```
packages/
  rules-schema/   The contract. Zod definitions, the published JSON Schema, the linter.
  engine/         Pure TypeScript. Events, reducer, targeting, triggers. No DOM.
  cli/            validate · bundle · test · init · sign · release. What a designer runs in CI.
apps/
  web/            The React app.
packs/
  demo/           The reference pack. Fictional.
  sketches/       The rest that ship, each unlike the others on purpose.
docs/             The contracts and walkthroughs, indexed by reader in docs/README.md.
hosted/           The hosting: what makes one address a service. See hosted/README.md.
```

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
  a schema cannot: ranges that do not tile, dangling references, counters
  nothing reads.
- **`packages/engine`** is pure TypeScript. No DOM, no React, no `Math.random`;
  a random source is always passed in, so nothing can accidentally become
  unreproducible.
- **`apps/web`** is the only place allowed to know it is in a browser.

### A run is its event log

`reduce(pack, events) → RunState`. Nothing is stored directly. Undo, replay,
shared seeds and the export are all the same feature seen from different
angles, which is why they are cheap.

If you find yourself wanting to mutate state directly, the answer is almost
always a new event.

### Packs are data, never code

The action vocabulary is closed and small, the predicates are a whitelist,
and there is no scripting and no `eval` anywhere: packs come from strangers.
If a pack needs something the actions cannot express, it writes a `note`: an
instruction the player carries out by hand and ticks off.

### Execution can be interrupted

A pack may need a die roll or a judgment mid-way through resolving something.
Rather than making everything async, execution throws to unwind, the caller
collects an answer, and the whole block is re-run from the top with the answers
replayed. Answer keys are derived from the position in the action tree, so a
re-run asks the same questions in the same order.

The consequence that matters: **an interrupted block commits nothing.** Events
land only when the whole thing finishes.

---

## What tests are for here

Tests in this repo are expected to say *why* they exist. A test named "works
correctly" that asserts an implementation detail is worse than no test: it
freezes an accident and tells the next person nothing.

Most of the tests worth reading came from a real failure. Some examples:

- `[].every()` is `true`, so an absent `skipWhen` skipped every phase. Eight
  tests, one of which asserts that `all` and `any` genuinely disagree.
- Table rolls ran, committed their events, and never recorded the step as
  done, so the log filled up while the game appeared to refuse to move.
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

- **`domain-neutrality.test.ts`**: no identifier in the published schema may
  name one craft. Prose examples may name any domain; a *property name* may
  not, because a pack author in another field then has to write `afterCompose`
  about a deadlift.
- **`license-boundary.test.ts`**: nothing git tracks may name the private game
  or cite a particular rulebook as a source. See
  [Licensing](#licensing-and-what-is-deliberately-absent) below.
- **`schema.test.ts` / `docs.test.ts`**: the published schema and the
  generated reference must match what the code actually does. Run
  `npm run schema:emit` and `npm run docs:emit` and commit the results.

---

## Licensing, and what is deliberately absent

This repository is a general engine. It contains no particular game, by
design.

This was built alongside a game whose rulebook forbids reproducing or
adapting it, so the architecture answers that structurally rather than
hopefully: the engine here is general, any transcription lives in a
gitignored private pack, and the two only ever meet in one person's browser.
`tests/license-boundary.test.ts` enforces it against what git actually tracks.

Packs carry their own license, and the app honors it: a pack marked
`redistributable: false` never has its text embedded in an export meant for
anyone else, a shared log records *which* results came up without quoting what
they say. A copy you keep for yourself quotes them in full, because personal
use is what such a license allows.

---

## House style

- **Comments explain why, never what.** The code says what it does. If a
  comment restates it, delete the comment; if the code needs one to be legible,
  usually the code should change instead.
- **Name things for the general case.** This began as a companion to one music
  game and the pull toward its vocabulary is constant. `unit`, `subject`,
  `run`, never `room`, `track`, `bar`.
- **Report, do not resolve.** Contradictions between rules, disagreements with
  the environment, honor-system checks: show the player what is in tension and
  let them rule on it. These games want human judgment, and a tool that
  silently decides is one people stop trusting.
- **Show the working.** Anything derived (a targeting result especially)
  carries its derivation, and the UI renders it.

### How it looks

The design has two voices. The pack's author speaks in a book serif, Literata,
because the rules are a rulebook. The player speaks in the same face in italic,
because a name is a note in the margin. The referee (the app) speaks in IBM
Plex Mono, because it keeps a ledger and its figures have to line up. Both faces
ship in the bundle: the hosting's Content Security Policy allows no font host,
and the worker precaches them like everything else.

Two accents have one job each: celadon is the referee's "fine", kiln amber is
consequence. Four looks (lights down, daylight, ember and glaze) share every
other decision and differ only in the ground, chosen from the header and
remembered on this machine. With no choice made, the operating system's
preference picks between the first two.

---

## Checks

A pull request runs the app's checks, the hosting's checks and a diff of
both stages. The merge queue then runs the checks again on main with the
queued pull requests merged onto it, which is what will actually land; it
does not repeat the diffs, which are for reading. A fork's pull request gets
the checks and no diffs, since nothing that reaches AWS runs for it.

The ruleset requires two checks: the pull request's title, and `Checks`, a
job that waits for every other check and passes only when they all did (a
diff skipped where it is meant to be skipped counts as passed). So a new
job, a renamed one or a bigger matrix is a change to the workflow alone;
add it to the `needs` of `Checks` and the ruleset follows.

## Releases

Every merge to main deploys to dev on its own. The tag and the release
wait for a reviewer from the Core team (the `release` environment), and
production and the npm package deploy from the release. Merges that land
while a release waits fold into the next one: approving the newest releases
everything merged so far. The version is the tag, and nothing in the
repository carries it.

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

## Adding a pack

The bundled packs are read from `packs/` by the app's catalog, so a new one
is a file there plus its lines in the `check:packs` and `test:packs`
scripts. Do not state how many packs there are in the README, the docs or
the guide: nothing keeps such a number true, so name a few instead.

## Changing the format

The pack format is a published contract other people's files depend on.

- **Additive changes**, a new optional field, a new variant in a discriminated
  union, are fine. Bump the schema's minor version.
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

AI narration. Arbitrary scripting in packs: the action vocabulary is closed,
and a pack that needs more writes a `note` for the player to carry out.

If you want one of these, open an issue and say what it unlocks.
