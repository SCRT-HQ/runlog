# Control profiles

A control profile maps run results to operations performed by an attached game tool. Load a profile under **Settings → Stream → Control**. Profiles are separate from packs; every pack here also works without an attached tool.

The format is in [docs/stream-api.md](../../docs/stream-api.md), under "Driving a game".

| Profile | Pack | What it needs |
| --- | --- | --- |
| `elden-ring-tarnishedtool.json` | Elden Ring: TarnishedTool | Tarnished Tool with a control tab |

## What these carry, and what they leave out

Everything in a profile here is an operation the tool performs without being told anything about your game: a named toggle, a named number, a button the tool already has. Those are the same on every machine.

Profiles omit two kinds of machine-specific values.

**Special effects by id.** `speffect.apply` applies a game status effect directly. It takes a number from the game's own data, and nothing here ships one: an incorrect id may apply an unintended effect without reporting an error. Find one you want in the tool's own Advanced tab, which lists what is on the player, and add a row for it.

**Coordinates.** `warp.position` takes a block id and three numbers, and those are yours rather than ours: save the position in the tool, read them off it, and put them in a row.

What this profile uses instead is `warp.grace`, which names a place, and `player.drop`, which needs no map at all. The tool already ships every grace in the game and already updates them when the game patches, so a profile that says "Church of Elleh" keeps meaning that; three numbers written down here would not. Spell a grace exactly as the tool's own list does, and give the area where two of them share a name.

## The profile is generated

`elden-ring-tarnishedtool.json` is not written by hand, and neither are the pack's states and tables. One file holds the whole of it, and the three outputs are built from it:

```bash
python packs/profiles/build-tarnishedtool.py
```

The generator defines each result's state, text, weight, and tool operation together. This keeps fifty-nine curses, seventy-five states, and a hundred and eleven profile rows in sync. The weights are relative; the script fits them to a d100 exactly, so adding an entry does not mean re-tuning a hundred numbers by hand and leaving a gap nobody notices.

Edit the script, run it, and commit what it produced.

## Using one

Open the run, then **Settings → Stream → Control → Import**. The panel will say if a rule can never fire against the pack you are playing, which is the usual sign that a profile and a pack have drifted apart.

To make your own profile, edit one in the panel and export it. The included profiles are examples.
