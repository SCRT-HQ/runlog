# Setups

What a tool attached to the game is set to while a run lasts, and what the player
is handed to start with. A setup is written for a tool rather than for a pack, so
one fits every pack for the same game. The format is
[`setup-1.schema.json`](../../packages/rules-schema/schema/setup-1.schema.json).

Every file here is for TarnishedTool, which drives Elden Ring.

## Kinds

Each setup declares a `group`, which decides the key it lands on when a Stream
Deck profile is laid out:

| Group | What it is | Key |
| --- | --- | --- |
| `loadout` | A build: weapons, armor, stats | Apply setup |
| `items` | Things the player is given | Apply setup |
| `unlocks` | The world opened up: the map, a region, every gesture | Apply setup |
| `warp` | Somewhere to be moved to | Command |
| `effects` | The terms of play: speed, damage taken, no rolling | Apply setup |

A profile places one key per kind, and that key browses: a press moves to the
next of that kind, a hold applies the one on the face. A setup with
`standout: true` gets a key of its own instead and its kind's cycle skips it.

## Where the builds come from

The thirty-seven build loadouts follow
[Fextralife's Elden Ring build progression](https://eldenring.wiki.fextralife.com/Builds),
seven beginner, ten midgame, ten lategame and ten endgame. Each file names the
page it follows in its own header comment, and says so in its description so the
credit travels with the file.

**Theirs:** the weapon, the armor, the talismans and the spells, which is the
build.

**Ours:** the stat spread and the reinforcement levels. Their pages state
requirements and a target level rather than a spread, and usually no upgrade
level at all, so the rest is filled in to make a loadout that works the moment it
is handed over. Weapons are levelled for where a build sits in a run rather than
maxed, roughly +6 at beginner through +25 at endgame, halved for somber weapons.
Each build hands over the talisman pouches its talismans need and the memory
stones its spells need, because a loadout you cannot wear or cast is not one.

The twenty-two warps are ours, one per region, named from the tool's own grace
list.

## Adding one

Names are the thing that goes wrong. Every weapon, item, ash and grace must be
spelled exactly as TarnishedTool spells it, and the authority is
[`tarnishedtool.json`](../../apps/web/src/control/lists/tarnishedtool.json),
extracted from the tool's own resources. A name that is not in it reaches the
tool, matches nothing, and leaves a hole in somebody's loadout mid-run with no
error anybody sees.

`apps/web/src/control/shipped-setups.test.ts` holds every file here to that list,
along with upgrade ceilings, grace areas, numeric bounds and unique ids and
titles. So:

1. Write the file, and add it to `check:packs` in the root `package.json`.
2. Run `npm run profiles -w streamdeck` and commit what moves.
3. Editing a file that already shipped means bumping its `version:`. A library
   reaches a setup by id and version, so an edit in place at the version it
   already had is one nobody holding the old copy is ever offered.
