# Control profiles

What a tool attached to the game should do when a result lands. A profile
is loaded in a run under **Settings → Stream → Control**, and it is not
part of any pack: a pack that only worked with one program attached to
one game would not be a pack, and every pack here plays with nothing
attached at all.

The format is in [docs/stream-api.md](../../docs/stream-api.md), under
"Driving a game".

| Profile | Pack | What it needs |
| --- | --- | --- |
| `elden-ring-interference.json` | Elden Ring: Interference | Tarnished Tool with a control tab |

## What these carry, and what they leave out

Everything in a profile here is an operation the tool performs without
being told anything about your game: a named toggle, a named number, a
button the tool already has. Those are the same on every machine.

Two kinds of thing are deliberately absent, because they are not.

**Special effects by id.** `speffect.apply` is the most interesting
operation the tool has, and the reason a curse can be the real thing
rather than something you act out. It takes a number from the game's own
data, and nothing here ships one: an id is easy to get wrong, and a wrong
one is a mystery rather than an error. Find one you want in the tool's own
Advanced tab, which lists what is on the player, and add a row for it.

**Places to be moved to.** `warp.position` takes a block id and three
coordinates. Those are yours, not ours: save the position in the tool,
read the numbers off it, and put them in a row. What the Interference
profile does instead is send you back to where you last rested, which
needs no coordinates and cannot strand you somewhere you have not
opened.

## Using one

Open the run, then **Settings → Stream → Control → Import**. The panel
will say if a rule can never fire against the pack you are playing, which
is the usual sign that a profile and a pack have drifted apart.

Editing a profile in the panel and exporting it again is the way to make
your own; these are a starting point rather than a standard.
