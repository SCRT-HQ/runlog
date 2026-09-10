# Writing a pack

A pack is a description of a game: what you roll, what the results do to you,
and what counts as finishing. It is data, YAML or JSON, and never code. The
app reads it and becomes your game: the nouns on screen come from your
vocabulary, the steps from your flow.

This guide explains why each part exists. For every field the format accepts,
see [the reference](reference.md), which is generated from the schema and so
cannot be wrong about what loads.

---

## Start here

```bash
npx @scrthq/runlog init my-game.yaml     # a skeleton that already validates
npx @scrthq/runlog validate my-game.yaml # schema, then coherence
```

Put this at the top of your file and your editor will complete fields and
underline mistakes as you type:

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
concept: see *Leaving things out* below.

---

## A complete pack

Everything below is optional except `vocabulary`, `tables`, `phases`, `modes`
and the identifying fields. This one plays end to end:

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

Load it into the app with **Load a pack…**; it stays in your browser.

---

## The parts, and when you need them

### Tables: what the game rolls at you

Four resolutions, because games disagree about what a roll *means*:

- **`lookup`**: a range per entry, `d100` with entries covering 1-100. The
  common case; ranges must tile the whole span with no gap and no overlap.
- **`bands`**: outcome tiers by comparison, `2d10` resolving into strong hit /
  weak hit / miss. What solo journaling games are built on.
- **`opposed`**: your dice against the game's, counting how many of yours beat
  how many of theirs. Ties go to the game.
- **`keyed`**, by name rather than by number. A card's suit, a day of the week.

Entries carry text the player reads and obeys. Most entries need nothing else;
a constraint is prose a human honors.

The app can put the prose in front of them at the moment they affirm it. A
`manual` step's `checklist` and a `finalizeUnit` step's `confirm` take plain
strings, or a point with something to show:

```yaml
        checklist:
          - The Piece is meaningfully different from the others.
          - text: The Constraint has been honored.
            shows: { table: constraint, scope: unit }
```

The results that table produced this unit are listed under the point, each
with a box of its own; ticking them all ticks the point. `scope: subject`
lists what reached this unit's subject instead, and `scope: run` lists
everything. A stage with nothing to show falls back to the point's own box.

A `manual` step with `closesUnit: true` needs no `finalizeUnit` step after
it; keep one where closing is its own act in the game, the way firing is in
The Long Kiln.

### Triggers: the results that reach forward

This is what a tracker is for. "After you finish working, roll a d6." On
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

The action vocabulary is closed and small on purpose: `roll`, `branch`,
`prompt`, `applyState`, `note`, and a dozen more. Packs come from strangers, so
there is no scripting and no `eval`. If you need something the actions
cannot express, reach for `note`: an instruction the player carries out by hand
and ticks off.

### States: what sticks to a thing

```yaml
states:
  locked:
    label: Locked
    short: LK           # goes in the name of the thing itself
    semantics: blocksEdit
```

`semantics` is how the engine knows what a state *does* without knowing what it
means; the reference lists the five.

### Counters and resources

A **counter** tallies. It is for rules of the form "five quiet
turns in a row and the game comes for you".

A **resource** is a numeric track you spend and gain: a progress clock, a word
count, a pantry. Declare `min`, `max` and how to draw it.

### Targeting: the results that reach backwards

Optional. Plenty of games do not damage what you already made, and those
omit it. If yours does, `anchoredOffset` is the well-trodden scheme:

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

Whatever it lands on, the app shows its working: the anchor, the offset, why
it skipped what it skipped.

### Modes: the same game, played differently

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

### Fixtures: proving your tables behave

Ship your own tests and the CLI will replay them. The pack above carries one:
a log of events, and assertions on the state they fold into, by dotted path.

```bash
npx @scrthq/runlog test two-line-days.yaml
```

Worked examples from your game belong here, as data you ship.

A fixture like that one **replays** a log you write by hand; it does not roll
a table, run a trigger, or take a move. That is fine for state you can
construct directly, but it cannot catch a broken trigger or a step that
forgot to record itself as done.

A **play fixture** does. It scripts the same actions the app takes (entering
a unit, declaring a subject, rolling a table, taking a move) and answers
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

Each step of `play` is in [the reference](reference.md). Two things it does
not say: `{ finalize: {} }` also accepts a `manual` step with
`closesUnit: true`, and the step named in `{ step: … }` must be the one the
engine is waiting on, which is what a fixture is for catching.

Any step can carry `answers`, for whatever the engine asks while it runs. A
key is matched in this order:

1. **The request's own key**, exactly: the key the engine names in its error
   when a request goes unanswered, useful for a roll nested inside a table
   entry's own trigger.
2. **A die notation**, like `d100`: matched to requests of that shape in the
   order they are asked; `{ d6: [3, 5] }` answers two successive `d6` asks.
3. **A prompt kind** (`chooseSubject`, `chooseValue`, `chooseState`,
   `confirm`, `text`, `ask`, `chooseTarget`), matched the same way.

With a `seed` on the fixture, a request still unanswered is rolled from it
instead of failing, so a play fixture can assert a whole run plays to
completion without scripting every die. Without one, the fixture fails
naming the request's key, its label, and the script step that asked.

`expect` also accepts `contains`, `absent` and `{ requests: "answered" }`;
the reference has each.

The repository's own test bench, `packs/testing/engine-testing.yaml`, is
mapped feature by feature in [testing-pack.md](testing-pack.md).

---

### Outcomes, and fixing them

Some boxes and moves record what happened rather than promise what will:

- **A checklist that counts.** `optional: true` lets the step go on without
  a point; `tally: landed` counts each box ticked under it. A point that
  `shows` a table the unit never rolled on is not shown at all. Ticks live
  in the log, so a reload keeps them.
- **A move that closes the unit.** `finalizes: true`, for moves that *are*
  the outcome, so nobody closes the unit twice.
- **A move that waits for its moment.** `{ phaseDone: play }` is true once
  that phase is complete, so an outcome move is not offered too early.
- **States that exclude one another.** States sharing a `group` displace
  each other on one holder.
- **A draw whose count is rolled.** `roll d4 into count` and then
  `rollOn … timesFrom: count` draws as many as the die said.

In the app, the board lets a player fix what was recorded: take a state
off a subject or put one on, and nudge a tally up or down. Each correction
goes into the log after a marker and can be undone like any other move.

### Clocks

A unit can run a clock (a stopwatch that times it, or a timer that limits
it), and the app keeps it on screen, ticking, with pause and stop:

```yaml
unit:
  createsSubject: true
  clock: { kind: timer, minutes: 25, label: This Block }   # or { kind: stopwatch }
```

The `startTimer` and `startStopwatch` actions start a clock from a result,
and it ticks the same way. Every clock is four events in the log (started,
paused, resumed, stopped with its time), so a reload lands on a clock still
running, a second device sees the same time, and the finished time stays in
the record. When a timer runs out the app sounds an alert; the player
chooses the sound, or none, under Alerts.

A pack can rule on the clock rather than only watch it. `onTimerExpired`
fires when a timer runs out, as a global trigger or on a table entry's or
card's own `triggers`. The predicates `clockRan` and `clockRanOver` read a
clock live, in minutes, both while it runs and after it stops;
`clockRanOver` is always false for a stopwatch. A pack using either declares
the `clockRules` capability:

```yaml
capabilities: [timers, clockRules]
unit:
  clock: { kind: timer, minutes: 25 }
triggers:
  - on: onTimerExpired
    do:
      - { do: note, text: "The bell." }
tables:
  loading:
    resolution: lookup
    title: Loading
    roll: d6
    entries:
      - id: standard
        range: [1, 6]
        text: "A standard load."
        triggers:
          - on: onFinalize
            when: [{ clockRanOver: unit, is: { gte: 2 } }]
            do:
              - { do: rollOn, table: overrun }
```

### What the room says on entry

`unit.intro` is said once, when the first unit begins, and `unit.onEnter`
every time a unit is entered, with `{n}` standing for its number. Both show
above the first step, in the app and on the bot's card, until the unit's
first step is done, and the rulebook prints them with the walkthrough.

```yaml
unit:
  intro: >-
    The kiln yard is cold this morning. Twelve stages, one piece each,
    and the kiln has opinions.
  onEnter: "Stage {n}. Wedge, throw, and mind what the dice said."
```

### Scoring a run

Most solo games ask "can you beat what you did last time?", which only
works if the app agrees with you about what counts:

```yaml
score:
  counter: cleanBlocks      # exactly one of: counter, resource, units, time
  better: higher            # or lower; default higher, except time which defaults lower
  label: Clean Blocks       # optional; defaults to the counter's or resource's label, "Units closed" (in the pack's unit words), or "Time"
  tiebreak: time            # optional second key: time | units; the same "better" rule as the key (time lower, units higher)
```

A mode can set its own `score`, the same way it sets its own `clock`, in
place of the pack's, not merged with it. A pack that says nothing here still
scores units closed, tiebreak time, which is what a race ranks runs by.

### What it needs in the world

A pack can say what a person needs before they play:

```yaml
requires:
  - { id: game, label: Rocket League, kind: game }
  - { id: barbell, label: A barbell and plates, kind: equipment, optional: true }
```

The catalog shows it on the card and the rulebook lists it under "What you
need"; an entry that `needs` an optional one is drawn again for a player
without it. For anything the pack did not foresee, Undo and roll again.

### Moderated play

Some games are played by people who cannot hold the device because they
are in the match, or on stream. A **moderated** mode puts one person at the
app and everyone else on a roster:

```yaml
modes:
  showdown:
    label: Showdown
    moderated:
      contestants: { min: 2, max: 10 }
      award: first        # or everyone, with an optional firstBonus
```

The roster is names, not accounts. Results that carry `points` are the
challenges; the moderator's **Winners** panel lists them with a button per
contestant, and `award` says whether the first to finish scores or everyone
does. The moderator can add a late arrival, drop someone, or take an award
back; watchers see all of it and press none of it.

A state with `scope: contestant` is a mark the moderator puts on one person
from the scoreboard, and a state with `until: unitEnd` lifts by itself when
the unit closes. A setting the moderator chooses once is a counter set from a
prompt (`modCounter … setFrom`) and read by a draw (`rollOn … timesFrom`).

## Leaving things out

The most common mistake is reaching for machinery you do not need. A training
log has no backwards damage, no decks and no states: omit `targeting`, `decks`
and `states`.

`capabilities` is the other half of that. Declare only what you use,
and an older app refuses your pack with a clear message instead of misplaying
it. The linter warns when you use something you did not declare.

---

## Licensing, and packs you should not publish

`license.id` is an SPDX identifier from the list in [the reference](reference.md),
or `proprietary` or `custom`, which carry their terms in `license.text`; the
app shows the text beside the pack and the rulebook prints it, and any license
may carry one as a notice. The Designer offers all of them in a list and opens
a text box for the terms.

```yaml
license:
  id: MIT
  redistributable: true
```

If your pack is a transcription of a book someone sells, including one you
bought, set `redistributable: false` and keep the file to yourself. The app
honors it: exports of that run record *which* results came up without quoting
what they say, so a log you share carries your work and not the author's words.
A copy you keep for yourself quotes it in full, because personal use is what
the license allows.

The same applies to this repository, which is why the reference pack here is
fictional.

---

## Signing, and what it does not do

Signing needs an account, once. Sign in from the terminal (it shows a short
code and opens your browser to confirm it), and claim your signing key so the
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

`npx @scrthq/runlog upload my-game.yaml` puts a pack into your own library,
on every device you are signed in on. It is private, which is the difference
between this and `release` below. (`publish` still works as an alias.) In CI
nobody is there to confirm a code, so a command-line key that only releases
stands in; see [Releasing from CI](#releasing-from-ci). `login --key` pastes
a key into a machine you sit at but cannot open a browser from, and
`RUNLOG_API` points the command at another address, such as a copy you run
yourself.

If you sell your game, sign your releases:

```bash
npx @scrthq/runlog keygen -o my-key.json          # once, ever
npx @scrthq/runlog sign my-game.yaml --key my-key.json --as "Your Name"
```

`keygen` prints a fingerprint. Publish it, on your site, in a video, on the
back of the book: the public key travels inside the pack, so anyone can
generate one and put any name on it, and the fingerprint is the only thing
that ties a signature to *you*. A reader who compares it against the one the
app shows knows they have your release; one who does not is trusting a name.

Keep the key file private and backed up. Anyone holding it can sign as you, and
losing it means signing under a new fingerprint your players have to learn.

**Signing does not stop anyone copying your pack**, and nothing can. The app has
to read every word of your rules to play them, so anything it can read a buyer
can read too.

It protects your name on the thing: a copy passed around still plays, but one
someone has *edited* can no longer claim to be yours, and the app says so when
it opens. If you are selling, sign your releases, let the shop control who
gets the download, and rely on copyright for the rest.

Editing a signed pack invalidates its signature, so re-sign after every change;
the Design tab removes the signature when you edit.

## Selling copies

```bash
npx @scrthq/runlog issue my-game.yaml --to "Buyer Name" --ref order-8f3a   --key my-key.json --as "Your Name" --seal
```

That produces one file per buyer and a license key to send with it. Three
things happen at once:

- **The copy is stamped** with the buyer's name, shown to them in the app and
  written into every log they export.
- **The stamp is inside the signature**, so deleting the name leaves a copy
  that no longer verifies.
- **`--seal` encrypts it**, so the file cannot be opened in an editor and
  stripped, and without the license key it is inert.

The sealed `.rlpack` is a distribution format, not the pack format; your
working file stays plain YAML.

For a checkout of your own, the container is the library half of the
`@scrthq/runlog` package; its format is in [selling.md](selling.md).

Batch a release with a shell loop:

```bash
while IFS=, read -r name ref; do
  npx @scrthq/runlog issue my-game.yaml --to "$name" --ref "$ref" --key my-key.json --seal
done < buyers.csv
```

### What this does not do

It stops a buyer deleting the two lines that name them and re-uploading the
file; it does not stop someone determined, or anyone retyping the game from a
book they own. [selling.md](selling.md) has the whole of what it protects and
what it does not.

---

## When it will not load

The validator runs three gates in order, and stops at the first:

1. **Version.** An engine that does not know your `schemaVersion` refuses
   rather than guessing.
2. **Shape.** The schema. Unknown keys are errors, not warnings; a typo
   would otherwise silently do nothing, all game.
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

---

## Sharing it

Three ways, in increasing order of ceremony:

- **A link.** The Design tab's *Copy a link* puts the whole pack, signature
  included, in the URL's fragment, which browsers never send to any server.
  A small pack is a couple of thousand characters, a large one closer to
  twenty thousand, which most chat apps truncate; the app tells you which
  you have.
- **The file.** Send the `.yaml`. Works everywhere, no size limit.
- **A release.** `runlog bundle` for a single JSON artifact, signed, attached
  to whatever you publish.

## Shipping it

```bash
npx @scrthq/runlog bundle ./my-game.yaml -o dist/my-game.pack.json
```

Bundling normalizes and stamps the pack into a single JSON file to attach to
a release; YAML stays the thing to author and version, since comments
survive and diffs read.

## Releasing from CI

A pack under version control can be released the way software is: tag it,
and a workflow checks it, signs it, and ships it. The workflows in
[`examples/github-actions`](../examples/github-actions/README.md), copied
into `.github/workflows/`, do that for a release from your own hands
(`self-publish.yml`) or to the catalog (`catalog-release.yml`); its README
has the two secrets they need, `RUNLOG_API_KEY` and `RUNLOG_SIGNING_KEY`,
set once in the repository's settings, never in the files. The catalog seals
a copy for each buyer under a fresh key, and your signing key never leaves
the runner's memory.

`runlog release` refuses an unsigned pack and a pack whose signature no
longer matches its text, and checks that the release tag agrees with the
pack's `version` when the workflow does. Without `--price` or `--free` it
keeps the listing as it was, so a new version of a pack already on sale
goes up at the same price; `--draft` uploads without listing.

## Running the app from your machine

```bash
npx @scrthq/runlog serve --open
```

The command carries the app and puts it on a local port, offline. Packs and
runs live in that browser; the served copy has no sign-in or sync. `--port`,
`--host` and `--dir` do what they say.

## The paper

A game on a table comes with paper, and yours is written from the pack:

```bash
npx @scrthq/runlog docs ./my-game.yaml -o dist/docs
```

That writes five documents, each as HTML (print it from a browser for a
PDF) and as Markdown. The Designer makes the same five as PDFs, with a
preview, in its Documents panel:

- **Rulebook**: everything in reading order, from what you need to the
  endings, every table with every entry.
- **Quick start**: enough to play the first time, with a pointer to the
  reference card for the tables.
- **Reference card**: every table in columns, the states, the moves, and a
  "frequently forgotten" list built from the pack's global triggers, tally
  thresholds and mode notes.
- **Run log sheet**: a form to write a run on by hand.
- **Summary**: what a catalog shows before anyone has the pack. It never
  prints an entry, a trigger, an ending's text or a mode's notes, whether or
  not the pack is redistributable.

Because they are generated, they cannot fall behind the rules; regenerate
them with each release rather than editing the output.
