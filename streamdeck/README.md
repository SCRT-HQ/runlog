# Runlog for Stream Deck

Runlog is a referee and run log for dice-driven games: it draws the tables, keeps the score and the clocks, and remembers what happened. This plugin puts a run on the deck's keys: the press the run is waiting on, a move, undo, and a number from the run on each key.

## The keys

- **Connect** opens the connection to your Runlog account, and closes it again.
- **Run** names the run the deck is on; press to cycle through the runs you have open, or pick one in its settings.
- **Next action** presses whatever the run is waiting on, in the step's own words.
- **Press** takes one move, the roll that is waiting, or a preset answer, set in the key's settings.
- **Roll** throws the dice the run is waiting on.
- **Apply setup** changes the run's loadout to a setup from your library and hands it out to the tool.
- **Undo** takes back the last result.
- **Metric** shows one number from the run: the score, the unit, a clock, the last result, the leader, or a counter or resource the pack keeps.
- **Open in the browser** opens the run, the guide, or the pack's rules in your default browser.

Next action and Metric also sit on a dial on a Stream Deck +.

The plugin also ships laid-out profiles, one per deck for the generic keys and one per deck for every pack it bundles, built from the pack files by `npm run profiles`. The Runlog profile installs with the plugin; a pack's arrives the first time the deck follows a run of that pack, and the deck switches to it unless Connect's settings say not to.

## What it needs

- The Stream Deck app, 7.1 or later, on macOS 12 or Windows 10 and up.
- A Runlog account, signed in from any key's settings.
- A run synced to that account and open in a browser, a dock or a browser source: the deck presses through the page holding the run.
- Where plans are switched on, Plus to press a run from the deck. Watching one costs nothing.

## Where to read more

The guide's [A Stream Deck at the table](https://runlog.scrthq.com/guide/stream-deck) sets the keys up, page by page. [Runlog](https://runlog.scrthq.com) is the app.
