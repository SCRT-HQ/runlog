# Writing a pack

A pack is a description of a game: what you roll, what the results do to you,
and what counts as finishing. It is data — YAML or JSON — and never code. The
app reads it and becomes your game: every noun on screen comes from your
vocabulary, every step from your flow.

This guide is the *why*. For every field the format accepts, see
[the reference](reference.md), which is generated from the schema and so cannot
be wrong about what loads.

---

## Start here

```bash
npx @scrthq/runlog init my-game.yaml     # a skeleton that already validates
npx @scrthq/runlog validate my-game.yaml # schema, then coherence
```

Put this at the top of your file and your editor will complete fields and
underline mistakes as you type. It is the single biggest difference between
this being pleasant and being a chore:

```yaml
# yaml-language-server: $schema=https://runlog.dev/schema/pack-1.schema.json
```

(In VS Code that needs the YAML extension. For JSON, use `"$schema"` as a
normal key.)

---

## The idea

Most games of this shape are the same machine wearing different clothes:

> You enter a **unit**. Something is rolled at you. You make a **subject**
> under whatever constraint came up. Occasionally a result reaches *backwards*
> and damages something you already made. Tallies accumulate. Eventually you
> stop, and how you stop is itself a rule.

The engine knows only that machine. Your pack supplies the clothes.

| The engine's word | A ceramics game | A writing game | A training log |
| --- | --- | --- | --- |
| run | a firing | a draft | a training block |
| unit | a stage | a scene | a session |
| subject | a piece | a passage | a set |

You declare those words once, and the interface speaks them everywhere:

```yaml
vocabulary:
  run: { one: Firing, many: Firings }
  unit: { one: Stage, many: Stages }
  subject: { one: Piece, many: Pieces }
  finalize: Fire          # the verb for closing a unit
```

If your game has no word for one of these, it probably does not need that
concept — see *Leaving things out* below.

---

## A complete pack

Everything below is optional except `vocabulary`, `tables`, `phases`, `modes`
and the identifying fields. This one is small enough to read in a sitting and
plays end to end:

```yaml
# yaml-language-server: $schema=https://runlog.dev/schema/pack-1.schema.json
schemaVersion: 1
id: com.example.two-line-days
version: 0.1.0
title: Two-Line Days
author: You
description: A tiny daily writing game.
license: { id: MIT, redistributable: true }
capabilities: [counters]

vocabulary:
  run: { one: Week, many: Weeks }
  unit: { one: Day, many: Days }
  subject: { one: Entry, many: Entries }
  finalize: Close

unit: { min: 1, max: 7 }

tables:
  weather:
    resolution: lookup
    title: The Weather
    description: Rolled on entering a Day, to see what you are writing against.
    roll: d6
    entries:
      - { id: w-clear, range: [1, 2], text: "Clear. Write whatever you like." }
      - { id: w-close, range: [3, 4], text: "Close. Every sentence must be under ten words." }
      - { id: w-storm, range: [5, 6], text: "Storm. No adjectives." }

counters:
  streak:
    label: Days in a row
    initial: 0
    incrementOn:
      - { on: unitFinalized }

phases:
  - id: enter
    label: Open the Day
    steps:
      - kind: rollTable
        table: weather
        label: Roll the Weather

  - id: write
    label: Write
    steps:
      - kind: declareSubject
        label: What is this Entry called?
      - kind: manual
        label: Write two lines.
        description: The app cannot see this. It only records that you did it.

  - id: close
    label: Close
    steps:
      - kind: finalizeUnit
        label: Close the Day

endings:
  - id: kept
    label: Kept
    text: Keep the week. Read it back in a month.

modes:
  standard:
    label: A Week
    description: Seven Days, or stop whenever you like.

defaultMode: standard

fixtures:
  - name: Closing a Day advances the streak
    mode: standard
    events:
      - { t: RunStarted, mode: standard }
      - { t: UnitEntered }
      - { t: UnitFinalized }
    expect:
      - { path: counters.streak, equals: 1 }
```

Save it, then:

```bash
npx @scrthq/runlog validate two-line-days.yaml --strict
```

Load it into the app with **Load a pack…** — it stays in your browser and goes
nowhere else.

---

## The parts, and when you need them

### Tables — what the game rolls at you

Four resolutions, because games disagree about what a roll *means*:

- **`lookup`** — a range per entry. `d100` with entries covering 1–100. The
  common case, and the one the linter checks hardest: ranges must tile the
  whole span exactly, with no gap and no overlap.
- **`bands`** — outcome tiers by comparison. `2d10` resolving into strong hit /
  weak hit / miss. This is what solo journaling games are built on.
- **`opposed`** — your dice against the game's, counting how many of yours beat
  how many of theirs. Ties go to the game.
- **`keyed`** — by name rather than by number. A card's suit, a day of the week.

Entries carry text the player reads and obeys. Most entries need nothing else —
a constraint is prose a human honors, not something to model.

What the app *can* do is put the prose in front of them at the moment they
affirm it. A `manual` step's `checklist` and a `finalizeUnit` step's `confirm`
take plain strings, or a point with something to show:

```yaml
        checklist:
          - The Piece is meaningfully different from the others.
          - text: The Constraint has been honored.
            shows: { table: constraint, scope: unit }
```

The results that table produced this unit are listed under the point, each
with a box of its own; ticking them all ticks the point. `scope: subject`
lists what reached this unit's subject instead — a setback that landed on
this piece — and `scope: run` lists everything. A stage with nothing to show
falls back to the point's own box.

### Triggers — the results that reach forward

The thing a tracker is genuinely for. "After you finish working, roll a d6." On
paper that is forgotten an hour later; here it resurfaces at the moment it
falls due.

```yaml
      - id: w-storm
        range: [5, 6]
        text: "Storm. No adjectives."
        triggers:
          - on: afterWork
            do:
              - { do: roll, dice: d6, into: r }
              - do: branch
                on: r
                cases:
                  - is: { gte: 5 }
                    then:
                      - { do: note, text: "Delete your favorite line." }
```

The action vocabulary is closed and small on purpose — `roll`, `branch`,
`prompt`, `applyState`, `note`, and a dozen more. Packs come from strangers, so
there is no scripting and never any `eval`. If you need something the actions
cannot express, reach for `note`: an instruction the player carries out by hand
and ticks off. The app is a bookkeeper, not an enforcer.

### States — what sticks to a thing

```yaml
states:
  locked:
    label: Locked
    short: LK           # goes in the name of the thing itself
    semantics: blocksEdit
```

`semantics` is how the engine knows what a state *does* without knowing what it
means: `blocksEdit`, `makesUntargetable`, `excludesFromResult`, `locksValue`,
`removesFromPlay`.

### Counters and resources

A **counter** tallies. It is the answer to any rule of the form "five quiet
turns in a row and the game comes for you" — nobody tracks a streak reliably
across an evening.

A **resource** is a numeric track you spend and gain: a progress clock, a word
count, a pantry. Declare `min`, `max` and how to draw it.

### Targeting — the results that reach backwards

Optional. Plenty of games never damage what you already made, and those should
simply omit it. If yours does, `anchoredOffset` is the well-trodden scheme:

```yaml
targeting:
  strategy: anchoredOffset
  offsetFrom: onesDigit
  wraparound: true
  skipIneligible: true
  bands:
    - { range: [70, 79], anchor: newest, direction: before }
    - { range: [80, 89], anchor: oldest, direction: after }
    - { range: [90, 99], anchor: playerChoice }
```

Other strategies: `playerChoice`, `random`, `oldest`, `newest`, `none`.

Whatever it lands on, the app shows its working — the anchor, the offset, why
it skipped what it skipped. Not decoration: a tool that hands you a verdict
with no visible reasoning is a tool players stop believing.

### Modes — the same game, played differently

Modes are deltas over the base ruleset, not separate games:

```yaml
modes:
  short:
    label: Short Week
    units: { fixed: 3 }
    disable:
      counters: [streak]
  shared:
    label: Shared Week
    seeded: true          # everyone with the same seed meets the same rolls
  pairs:
    label: Pairs
    players: { min: 2, max: 4, rotate: clockwise, roles: [...] }
```

### Fixtures — proving your tables behave

Ship your own tests and the CLI will replay them. The pack above carries one:
a log of events, and assertions against the state they fold into, each naming a
dotted path into the run.

```yaml
fixtures:
  - name: Closing a Day advances the streak
    events:
      - { t: RunStarted, mode: standard }
      - { t: UnitEntered }
      - { t: UnitFinalized }
    expect:
      - { path: counters.streak, equals: 1 }
```

```bash
npx @scrthq/runlog test two-line-days.yaml
```

If your game has worked examples written out somewhere, this is where they
belong — as data you ship, so the behavior is proven against your rules
rather than against somebody's reading of them.

A fixture like that one **replays** a log you write by hand — it never rolls a
table, runs a trigger, or takes a move. That is fine for asserting on state you
can construct directly, but it cannot catch a broken trigger or a step that
forgot to record itself as done, because nothing ever drove them.

A **play fixture** does: it scripts the same actions the app takes — entering
a unit, declaring a subject, rolling a table, taking a move — and answers
whatever the engine asks along the way.

```yaml
fixtures:
  - name: A 30 on the Kiln Check dictates the Form
    mode: standard
    play:
      - { enter: 1 }
      - { step: enter }
      - { declare: Bowl }
      - { step: work }
      - { finalize: {} }
      - { enter: 2 }
      - { step: enter }
      - { step: check, answers: { d100: 30, d6: 4 } }
    expect:
      - { path: outcomes.length, equals: 2 }
      - { path: outcomes.1.entryId, equals: form-cup }
      - { requests: answered }
```

Each step of `play` is one of:

- `{ enter: n }` — enter the next unit; fails the fixture if it is not
  actually unit `n`.
- `{ declare: "Bowl" }` — declare the current unit's subject. The active step
  must be a `declareSubject` step.
- `{ step: "<phaseId>" }` or `{ step: "<phaseId>#<index>" }` — run whatever the
  active step is, the way the app would: a `rollTable` step rolls (and rolls
  again for any extra roll still owed this unit), an `actions` step runs its
  actions, a `manual` step is ticked and completed, and a `finalizeUnit` step
  finalizes the unit. The step named must actually be the one the engine is
  waiting on — a fixture drifting out of step with the pack's own flow is
  exactly what this is for catching.
- `{ finalize: {} }` — finalize the current unit: any confirmations are ticked
  and the unit closes. The active step must be `finalizeUnit`.
- `{ move: "<moveId>" }` — take a move.
- `{ settle: "<obligation label or id>" }` — settle a due obligation.
- `{ tick: "<checklist item text>" }` — tick one checklist item on the active
  step by hand, without completing it. Only needed if a checklist gates
  something you care about asserting on.

Any step can carry `answers`, a map used to answer whatever the engine asks
while it runs. A key is matched in this order:

1. **The request's own key**, exactly — the deterministic key the engine
   names in its error when a request goes unanswered, useful for a roll
   nested inside a table entry's own trigger.
2. **A die notation**, like `d100` or `d6` — matched to requests of that
   shape in the order they are asked. `{ d100: 21, d6: 3 }` answers the
   first `d100` and the first `d6` the engine asks for; `{ d6: [3, 5] }`
   answers two successive `d6` asks in order.
3. **A prompt kind** — `chooseSubject`, `chooseValue`, `chooseState`,
   `confirm`, `text`, `ask`, `chooseTarget` — matched the same way as a die
   notation.

If a mode's seed is set on the fixture and a request still has no answer, it
is rolled from that seed instead of failing — which is what lets a play
fixture assert a whole run plays to completion without scripting every die.
Failing that, the fixture fails with a message naming the request's key, its
label, and which script step asked for it.

`expect` accepts `equals` as above, plus `contains` and `absent` for asserting
on an array without spelling out its whole contents, and
`{ requests: "answered" }` — always true once a play fixture completes, and
there mostly for a reader working out what the fixture is claiming.

The repository's own test bench, `packs/testing/engine-testing.yaml`, plays
as a game called Night Watch, and [testing-pack.md](testing-pack.md) maps each
of its entries to the feature it exercises.

---

### Outcomes, and fixing them

Some boxes and moves record what happened rather than promise what will.
The format has a few pieces for that:

- **A checklist that counts.** Give a point `optional: true` and the step
  does not wait for it; give it `tally: landed` and every box ticked under
  it adds one to that counter (and unticking takes it back). A point that
  `shows` a table the unit never rolled on is not shown at all — there is
  nothing to promise about. Ticks live in the log, so a reload keeps them.
- **A move that closes the unit.** `finalizes: true` on a move records the
  rest of the flow as done and finalizes the unit when it is taken. For
  moves that *are* the outcome — landed, missed, done, left — so nobody is
  asked to close the unit a second time.
- **A move that waits for its moment.** The predicate `{ phaseDone: play }`
  is true once that phase is complete in the current unit. An outcome move
  that is available before there is anything to have an outcome about is a
  button people press by accident.
- **States that exclude one another.** States sharing a `group` cannot both
  be on one holder: applying one takes the others off. Landed is not also
  missed.
- **A draw whose count is rolled.** `roll d4 into count` and then
  `rollOn … timesFrom: count` draws as many as the die said.

And in the app, the board lets a player fix what was recorded: take a state
off a subject or put one on, and nudge a tally up or down. Each correction
goes into the log after a marker that says so, and can be undone like any
other move. The log stays the truth; it just admits that people mistype.

### Clocks

A unit can run a clock — a stopwatch that times it, or a timer that limits
it — and the app keeps it on screen, ticking, with pause and stop:

```yaml
unit:
  createsSubject: true
  clock: { kind: timer, minutes: 25, label: This Block }   # or { kind: stopwatch }
```

`auto` (the default) starts it when the unit is entered and stops it when
the unit closes; `auto: false` leaves the start to the player. A mode can
set its own `clock`. The `startTimer` and `startStopwatch` actions start a
clock from a result — a rest clock after a loading, fifteen minutes for a
room — and it ticks the same way. Every clock is four events in the log
(started, paused, resumed, stopped with its time), so a reload lands on a
clock still running, a second device sees the same time, and the finished
time stays in the record. When a timer runs out the app sounds an alert;
the player chooses the sound, or none, under Alerts.

### What it needs in the world

A pack can say what a person needs before they play — the game and a system
that runs it, a mod or a training pack, a wheel, a kitchen, supplies:

```yaml
requires:
  - { id: game, label: Rocket League, kind: game }
  - { id: barbell, label: A barbell and plates, kind: equipment, optional: true }
```

The catalog shows it on the card and the rulebook lists it under "What you
need". The optional ones are asked about when a run starts, and a table
entry can say it `needs` one of them: a run that lacks it draws again
instead of landing there, so the dice never demand a barbell from someone
without one. For anything the pack did not foresee, Undo and roll again.

### Moderated play

Some games are played by people who cannot hold the device — they are in
the match, or on stream. A **moderated** mode puts one person at the app
and everyone else on a roster:

```yaml
modes:
  showdown:
    label: Showdown
    moderated:
      contestants: { min: 2, max: 10 }
      award: first        # or everyone, with an optional firstBonus
```

The roster is names, not accounts. Every result the flow draws lands on
everyone, the way a run-wide state always has; the ones that carry
`points` are the challenges, and the moderator's **Winners** panel lists
them with a button per contestant. Awarding one puts its points on that
contestant's score; `first` closes the challenge, `everyone` leaves it open
for each contestant once, with `firstBonus` extra for whoever was first.
The scoreboard is in the side column, and the moderator can add a late
arrival, drop someone, or take an award back as a correction. Watchers of
the session see all of it and press none of it.

A state with `scope: contestant` is a mark the moderator puts on one
person from the scoreboard — spared from the curse, out of the region —
and a state with `until: unitEnd`, of any scope, lifts by itself when the
unit closes. A setting the moderator chooses once is a counter set from a
prompt (`modCounter … setFrom`) and read by a draw (`rollOn … timesFrom`),
which they can nudge between units like any tally.

Two packs are built this way: **Rocket League: Showdown**, which asks how
many mechanics a match draws, and **Elden Ring: Trial**, with curses that
are the game's own status effects acted out in the game, each drawn with
the item that cures it, and Spared for whoever has it.

## Leaving things out

The most common mistake is reaching for machinery you do not need. A training
log has no backwards damage, no decks and no states: omit `targeting`, `decks`
and `states` entirely. A pack that declares nothing it does not use is easier
to read, easier to change, and validates faster.

`capabilities` is the other half of that. Declare only what you actually use,
and an older app refuses your pack with a clear message instead of misplaying
it. The linter warns when you use something you did not declare.

---

## Licensing, and packs you should not publish

`license.id` is one of the common SPDX identifiers (CC0-1.0, CC-BY-4.0 and
the other Creative Commons variants, MIT, Apache-2.0, BSD-3-Clause,
Unlicense, OGL-1.0a, ORC) or `proprietary` or `custom`. The last two carry
their terms in `license.text`, which the app shows beside the pack and the
rulebook prints; any license may carry a `text` for a notice of its own. The
Designer offers all of them in a list and opens a text box for the terms.

```yaml
license:
  id: MIT
  redistributable: true
```

If your pack is a transcription of a book someone sells — including one you
bought — set `redistributable: false` and keep the file to yourself. The app
honors it: exports of that run record *which* results came up without quoting
what they say, so a log you share carries your work and not the author's words.
A copy you keep for yourself quotes it in full, because personal use is what
the license allows.

The same applies to this repository, which is why the reference pack here is
fictional.

---

## Signing, and what it does not do

Signing needs an account, once. Sign in from the terminal — it shows a short
code and opens your browser to confirm it — and claim your signing key so the
app can put your name beside it:

```bash
npx @scrthq/runlog login                 # a code to confirm in your browser
npx @scrthq/runlog keygen -o my-key.json # once, if you have no signing key yet
npx @scrthq/runlog claim my-key.json     # proves the key is yours
```

The sign-in lasts as long as you keep using it (a month idle, at most), and
renews itself. `npx @scrthq/runlog logout` forgets it.

From then on `sign` and `issue` work with that key, and a pack signed with it
shows "Signed by Your Name" in the app, where the name is your account's and
not the file's. A key nobody has claimed still signs, arithmetically, but the
command line refuses it and the app says no account stands behind it.

`npx @scrthq/runlog publish my-game.yaml` puts a pack straight into your
library, on every device you are signed in on. In CI nobody is there to
confirm a code, so make a command-line key on your profile page in the app,
one that only releases, and set it as `RUNLOG_API_KEY` there, and put your signing key file's contents
in `RUNLOG_SIGNING_KEY` so `sign` needs no file; `login --key` pastes a key
into a machine you sit at but cannot open a browser from. With `RUNLOG_API`
you can point the command at another address, such as a copy you run
yourself. [Releasing from CI](#releasing-from-ci)
below has the workflows.

If you sell your game, sign your releases:

```bash
npx @scrthq/runlog keygen -o my-key.json          # once, ever
npx @scrthq/runlog sign my-game.yaml --key my-key.json --as "Your Name"
```

`keygen` prints a fingerprint. Publish it — on your site, in a video, on the
back of the book. That fingerprint is the only thing that ties a signature to
*you*: the public key travels inside the pack, so anyone can generate one and
put any name on it. A reader who compares your published fingerprint against
the one the app shows knows they have your release. A reader who does not is
trusting a name.

Keep the key file private and backed up. Anyone holding it can sign as you, and
losing it means signing under a new fingerprint your players have to learn.

**Signing does not stop anyone copying your pack**, and nothing can. The app has
to read every word of your rules to play them, so anything it can read a buyer
can read too. Any scheme claiming otherwise either does not work or has given
up on working offline.

What it does is protect your name on the thing. A copy passed around still
plays; a copy someone has *edited* can no longer claim to be yours, and the app
says so plainly when it opens. If you are selling, the practical stack is: sign
your releases, let the shop you sell through control who gets the download, and
rely on copyright for the rest — which is what the rest of the industry does,
because it is what actually works.

Editing a signed pack invalidates its signature, so re-sign after every change.
The Design tab removes the signature when you edit, rather than leaving a stale
one that would make your own edit look like tampering.

## Selling copies

```bash
npx @scrthq/runlog issue my-game.yaml --to "Buyer Name" --ref order-8f3a   --key my-key.json --as "Your Name" --seal
```

That produces one file per buyer and a license key to send with it. Three
things happen at once, and they only work together:

- **The copy is stamped** with the buyer's name, shown to them in the app and
  written into every log they export. Told to them, not done to them: a
  deterrent nobody knows about deters nobody.
- **The stamp is inside the signature**, so deleting the name leaves a copy
  that no longer verifies. The choice is between a copy that names you and one
  that visibly is not the author's release.
- **`--seal` encrypts it.** The file is binary, not YAML, so it cannot be
  opened in an editor and stripped; and without the license key it is inert, so
  passing the file on means passing on a key issued to one person.

Your own working file stays plain YAML and every tool keeps working on it. The
sealed `.rlpack` is a distribution format, not the pack format.

Selling from your own checkout instead of a shell? The container is the library half
of the `@scrthq/runlog` package, and its format is written up in
[selling.md](selling.md).

Batch a release with a shell loop:

```bash
while IFS=, read -r name ref; do
  npx @scrthq/runlog issue my-game.yaml --to "$name" --ref "$ref" --key my-key.json --seal
done < buyers.csv
```

### What this does not do

It does not stop someone determined. The app has to show the rules to play
them, so a person willing to read their own browser — or to build this
open-source app with one line changed — reaches the plaintext. It does not stop
anyone retyping the game from a book they own.

Those are out of scope on purpose. What it stops is the leak that actually
happens: a buyer opening the file they downloaded, deleting the two lines that
name them, and re-uploading it. That takes a text editor and thirty seconds
against a plain file, and against a sealed one it takes intent, tools, and a
willingness to strip your name off something.

---

## When it will not load

The validator runs three gates in order, and stops at the first:

1. **Version.** An engine that does not know your `schemaVersion` refuses
   rather than guessing.
2. **Shape.** The schema. Unknown keys are errors, not warnings — a typo in a
   field name would otherwise silently do nothing, all game.
3. **Coherence.** The linter, which catches what the schema cannot:

| Message | What it means |
| --- | --- |
| `table/range-gap` | Your `d100` ranges leave a number unreachable. |
| `table/range-overlap` | Two entries claim the same roll. |
| `ref/unknown-table` | An action rolls on a table that is not there. |
| `flow/no-finalize` | No phase closes a unit, so a run can never progress. |
| `deck/overdraw` | You deal more cards at the start than the deck holds. |
| `counter/inert` | A counter nothing increments and nothing reads. |
| `trigger/unreachable-point` | A pack-level trigger on a moment a run never reaches. |
| `capability/undeclared` | You used a feature you did not declare. |

Use `--strict` in CI so warnings fail too:

```yaml
# .github/workflows/pack.yml
name: Pack
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx @scrthq/runlog validate my-game.yaml --strict
      - run: npx @scrthq/runlog test my-game.yaml
```

That is the whole release process: a pack that validates strictly and passes
its own fixtures is one someone else can play.

---

## Sharing it

Three ways, in increasing order of ceremony:

- **A link.** The Design tab's *Copy a link* puts the whole pack in the URL's
  fragment — the part browsers never send to any server. Paste it into a mail
  and the recipient has your game, with nothing in between having seen it and
  nothing to keep running. A signature travels with it. The cost is length: a
  small pack is a couple of thousand characters, a large one closer to twenty
  thousand, which most chat apps will truncate. The app tells you which you
  have.
- **The file.** Send the `.yaml`. Works everywhere, no size limit.
- **A release.** `runlog bundle` for a single JSON artifact, signed, attached
  to whatever you publish.

## Shipping it

```bash
npx @scrthq/runlog bundle ./my-game.yaml -o dist/my-game.pack.json
```

Bundling normalizes and stamps the pack into a single JSON file, which is the
convenient thing to attach to a release. YAML remains the better thing to
author and to keep under version control — comments survive, and diffs read.

## Releasing from CI

A pack under version control can be released the way software is: tag it,
and a workflow checks it, signs it, and ships it. Two secrets are involved,
both set once in the repository's settings, never in the files:

| Secret | What it is | Where it comes from |
| --- | --- | --- |
| `RUNLOG_API_KEY` | a command-line key for your account | the app's profile page, the *Command line* section; it names you for the signature's claim check and, for the catalog, uploads as your publisher |
| `RUNLOG_SIGNING_KEY` | your signing key file, whole | the contents of the `runlog-key.json` that `keygen` wrote and `claim` tied to your account |

Then one of the workflows in
[`examples/github-actions`](../examples/github-actions/README.md), copied
into `.github/workflows/`:

- **`check.yml`** on every push: `validate --strict` and `test`.
- **`self-publish.yml`** when a GitHub release is published: sign, write the
  documents, and attach the signed pack, the bundle, and the paper to the
  release. What you sell or give away from your own hands.
- **`catalog-release.yml`** when a release is published: sign, then
  `runlog release --price 3.00` uploads the pack to the catalog as your
  publisher and lists it; the catalog seals a copy for each buyer under a
  fresh key, and your signing key never leaves the runner's memory.

`runlog release` refuses an unsigned pack and a pack whose signature no
longer matches its text, and checks that the release tag agrees with the
pack's `version` when the workflow does. Without `--price` or `--free` it
keeps the listing as it was, so a new version of a pack already on sale
goes up at the same price; `--draft` uploads without listing.

## Running the app from your machine

```bash
npx @scrthq/runlog serve --open
```

The command carries the app: this puts it on a local port, offline, with
nothing else installed. Packs and runs live in that browser. Sign-in and
sync belong to the hosted address; the served copy has neither. `--port`,
`--host` and `--dir` do what they say.

## The paper

A game on a table comes with paper, and yours is written from the pack:

```bash
npx @scrthq/runlog docs ./my-game.yaml -o dist/docs
```

That writes five documents, each as HTML (open it in a browser and print it
for a PDF; the page breaks and columns are already right) and as Markdown.
The Designer makes the same five as PDFs too, laid out in the browser:

- **Rulebook** — everything in reading order: what you need, the terms, a
  unit step by step, the modes, every table with every entry, cards, states,
  tallies, moves, how consequences reach back, what is always in effect, and
  the endings.
- **Quick start** — enough to play the first time. The flow, the default
  mode, the endings, and a pointer to the reference card for the tables.
- **Reference card** — every table in columns, the states, the moves, and a
  "frequently forgotten" list built from the pack's global triggers, tally
  thresholds and mode notes.
- **Run log sheet** — a form to write a run on by hand: a line per rolled
  table per unit, boxes for the tallies, a line for the run's states.
- **Summary** — what a catalog shows before anyone has the pack. It names the
  tables and how they are rolled, counts the parts, lists the modes and what
  you need — and never prints an entry, a trigger, an ending's text or a
  mode's notes. That is the line between describing a game and giving it
  away, and it holds whether or not the pack is redistributable.

The same five are in the Designer's Documents panel, with a preview, so you
can read the summary a stranger will see before you publish. Because they
are generated, they cannot fall behind the rules; regenerate them with each
release rather than editing the output.
