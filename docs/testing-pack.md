# The test bench, and what each part of it exercises

`packs/testing/engine-testing.yaml` is the engine's test bench: every
construct the pack format accepts appears in it at least once, and
`packages/rules-schema/src/features.test.ts` fails if a feature the schema
knows about ever stops being reachable from it. It plays as a game called
**Night Watch**, a season of nights at a small observatory, so that a person
at the keypad reads a run and not a list of scenarios. This page is the map
back from the game's words to the feature each of them is there to prove.

The ids in the first column are the ones fixtures, the catalog test and the
features test depend on. The prose can be rewritten freely; the ids cannot.

## Forcing an entry

Every lookup table tiles its whole span, so any line can be forced from the
keypad by typing a number inside its range, or picked outright from the
Table button beside the pad, which lists the lines and lands a roll on
whichever one you choose. The Sky's ten lines are ten numbers wide each
(1-10, 11-20, and so on); the Eyepiece is one face of a d6 per line.

## Vocabulary and the unit

| Engine word | In the game |
| --- | --- |
| run | Watch |
| unit | Night |
| subject | Plate |
| finalize | Record it |

The unit runs a stopwatch (`clock: { kind: stopwatch }`, the exposure clock),
creates a subject, and allows 1 to 99 units. The journal is enabled and
required.

## States

| Id | In-game name | Exercises |
| --- | --- | --- |
| `blocks-edit` | Fixed | `semantics: [blocksEdit]` |
| `untargetable` | Clouded | `semantics: [makesUntargetable]` |
| `excluded` | Struck | `semantics: [excludesFromResult]` |
| `locks-value` | Vaulted | `semantics: [locksValue]` |
| `removed-play` | Broken | `semantics: [removesFromPlay]` |
| `posture-a`, `posture-b`, `posture-c` | Blue Filter, Yellow Filter, Red Filter | three states sharing a `group`, which displace each other on one subject |
| `temporary` | Dewed | `until: unitEnd`; lifts by itself when the unit closes |
| `coldbench` | The Long Freeze | a run-scoped state, on the run rather than any subject |
| `flagged` | Commended | a contestant-scoped state, marked by the moderator in a moderated run |
| `marked` | Circled | applied by the `grants` shorthand rather than an explicit `applyState` |

## Counters, resources, decks and requirements

| Id | In-game name | Exercises |
| --- | --- | --- |
| counter `streak` | Quiet nights | `incrementOn` a phase completing, `resetOn` an outcome from a table, and a `oncePerRun` threshold trigger at 3 |
| counter `hiddenCount` | Smudges | a `hidden` counter, incremented on `unitFinalized`, set by `modCounter setFrom` and `by`, and raised by a `tally` checklist item |
| resource `pressure` | Nerve | a `number` resource, added into the opposed roll by `addResource` |
| resource `fuel` | Lamp oil | a `boxes` resource, clamped to its `max` |
| resource `momentum` | Seeing | a `bar` resource whose `min` sits below zero |
| deck `hand` | Notebook | a bespoke deck: `drawAtStart`, `unique`, `carriesOver`, `grantCard`, `discardCard`; the Folded Slip carries an `immediately` trigger |
| deck `cards52` | The Cards | a `standard52` deck with `includeJokers`, resolved by `rank` on the Almanac |
| requirement `kit` | A spare eyepiece | an `optional` requirement a table entry `needs` |
| requirements `keypad`, `scorecard` | dice or the keypad; a log book and a pencil | required requirements of kind `other` and `supplies` |

## Moves

| Id | In-game name | Exercises |
| --- | --- | --- |
| `chooseAndMark` | Mount the yellow filter | `prompt chooseSubject` with `eligibleOnly`, then `applyState` to `{ var }` |
| `pickValue` | Set the exposure | `prompt chooseValue` with `options` |
| `pickState` | Note a condition | `prompt chooseState` |
| `confirmChoice` | Check the clock | `prompt confirm` |
| `captureNote` | Write in the margin | `prompt text` into a var, then a `persistent` note |
| `liftLock` | Sign the plate out of the vault | `removeState` from `thisSubject` |
| `chooseThree` | Sweep the field | `rollOn` with `times: 3` and `choose: one` |
| `rollFromCount` | Count the flashes | `roll` into a var, then `rollOn` with `timesFrom` |
| `branchDemo` | Test the seeing | `branch` with an `in` case, an `is` case and an `else` |
| `branchAgainstStreak` | Trust the quiet | `branch` with an `is: { gteCounter }` bound |
| `startTimerDemo` | Open the shutter for five minutes | `startTimer` from a move rather than a clock declaration |
| `setMomentumFromRoll` | Rate the seeing | `modResource setFrom` |
| `fillFuel` | Refill the lamp | `modResource set` |
| `setCounterFromRoll` | Count the smudges | `modCounter setFrom` |
| `rewindDemo` | Go back a Night | `rewind`; a `oncePerRun` move |
| `askGated` | Log a sighting | an `ask` predicate under `available` |

## Tables and entries

### `bench`, The Sky (d100 lookup, ten bands of ten)

| Id | Range | In-game name | Exercises |
| --- | --- | --- | --- |
| `bc-quiet` | 1-10 | A still sky | `setFlag` |
| `bc-chain` | 11-20 | Something in the field | `rollOn` chaining into a second table |
| `bc-reach` | 21-30 | Cloud drifts back | `resolveTarget` from `currentRoll` (the 21-30 band: newest, before), then `applyState` to `targetSubject` |
| `bc-afterwork` | 31-40 | Dew forming | an `afterWork` obligation with a label and a `persistent` note |
| `bc-onfinalize` | 41-50 | A late visitor | an `onFinalize` obligation |
| `bc-end` | 51-60 | The lamp goes out | `modCounter set`, then `endRunAttempt` |
| `bc-requires` | 61-70 | Two plates side by side | a `requires` predicate on an entry, and the `when` action with `then` and `else` |
| `bc-needs` | 71-80 | The spare eyepiece | `needs` a requirement, so a run without it draws again; `grantCard` |
| `bc-grants` | 81-90 | Worth a second look | the `grants` shorthand |
| `bc-scored` | 91-100 | The clearest night of the season | `tags` and `points` for a moderated run; `extraRoll` with `unit: next` |

### `chained`, The Eyepiece (d6 lookup)

| Id | Face | In-game name | Exercises |
| --- | --- | --- | --- |
| `cn-1` | 1 | Nothing there | `discardCard` |
| `cn-2` | 2 | The director's note | `resolveTarget` from `event` (the `eventFallback` roll), then `applyState` of `locks-value` |
| `cn-3` | 3 | A flaw in the glass | `resolveTarget` from `choice`, then `applyState` of `excluded` |
| `cn-4` | 4 | Blue haze | `applyState` to `thisSubject` |
| `cn-5` | 5 | Red haze | `grants` of a state inside a `group` |
| `cn-6` | 6 | Look again | `extraRoll` with `unit: current` |

### `ladder`, The Weather (2d6 bands, open at both ends)

| Id | Band | In-game name | Exercises |
| --- | --- | --- | --- |
| `ld-low` | 5 or under | Fog by morning | an obligation deferred to `onEnterUnit`, gated by a `when` predicate on a flag; the open low band |
| `ld-mid` | 6 through 9 | Holding | an obligation deferred to `onDeclareSubject`; the closed middle band |
| `ld-high` | 10 or over | Hail | `applyState` to `allPriorSubjects`; the open high band |

### `duel`, The Storm (opposed: d6 plus Nerve against three d8)

| Id | Beats | In-game name | Exercises |
| --- | --- | --- | --- |
| `du-0` | 0 | The long freeze | `applyState` to `run`, then `forceUnit` |
| `du-1` | 1 | One gust turned | `modResource by` and `modCounter by` |
| `du-2` | 2 | Two gusts turned | an obligation deferred to `onDeclareRunOver`, with a `when` on `unitIndex` |
| `du-3` | 3 | The storm breaks | `applyState` to `allSubjects` |

### `rankcall`, The Almanac (keyed by card rank)

`rk-a` through `rk-k`, one line per rank of the standard deck: keyed
resolution, reached by `resolveOn`/`resolveBy` on the `cards52` deck.

### Targeting

`anchoredOffset` from the ones digit, with every anchor (newest before, oldest
after, player choice), `wraparound`, `skipIneligible`, and an `eventFallback`
with `missOn`.

## Phases

| Id | In-game name | Exercises |
| --- | --- | --- |
| `enter` | Open the dome | a `rollTable` step that is `optional`, with `skipWhen` on a flag and `into` |
| `declare` | Name the plate | `declareSubject` with `constrainedBy` a table, and a `skipWhen` |
| `secondary` | The first Night's weather | a phase-level `skipWhen` (`unitIndex gte 2`), with two `rollTable` steps |
| `work` | The exposure | a `manual` checklist with a plain item, an `optional` one, a `tally` one and a `shows` one |
| `actionsPhase` | Close the dome | an `actions` step outside any table, with `skipWhen` |
| `close` | Record it | `finalizeUnit` with `confirm`, one plain item and one `shows` |

## Modes

| Id | In-game name | Exercises |
| --- | --- | --- |
| `solo` | Alone on the Hill | the default mode, with a `perUnit` override on unit 2 (`skipPhases` and `extra`) |
| `seeded` | The Same Sky | `seeded: true` |
| `together` | The Crew | `players` two to four, `rotate: clockwise`, three `roles`, and the mode's own `clock` (a ten-minute timer) |
| `moderated` | The Contest | `moderated` with `contestants` two to four, `award: everyone` and `firstBonus` |
| `endless` | The Long Season | `units: { max: 99 }` |
| `minimal` | A Calm Season | `disable` of a table, a phase and a counter |

## Triggers

| Where | In-game name | Exercises |
| --- | --- | --- |
| pack-level `triggers`, `onRunEnd` | Dawn | a global trigger with a `not` flag predicate and a `persistent` note |
| counter `streak` | Three quiet nights | a counter threshold trigger, `oncePerRun` |

## Endings

| Id | In-game name | Exercises |
| --- | --- | --- |
| `logged` | The Log Closed | a plain ending |
| `exhausted` | The Season's End | an ending with a `requires` counter predicate |
| `cut-short` | Called Down | an ending for stopping early |

## Fixtures

The pack carries seventeen replay fixtures, each named for what it proves
(tables, reaching back, deferred obligations, units, extra rolls, states,
moderated play, counters, resources, clocks, decks, journal and checklist).
`npm run test:packs` replays them; `npm run check:packs` validates the pack
with `--strict`.
