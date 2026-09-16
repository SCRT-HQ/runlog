# Runlog for Stream Deck

Runlog is a referee and run log for dice-driven games: it draws the tables, keeps the score and the clocks, and remembers what happened. This plugin puts a run on the deck's keys: the press the run is waiting on, a move, undo, and a number from the run on each key.

## The keys

- **Connect** opens the connection to your Runlog account, and closes it again.
- **Run** names the run the deck is on; press to cycle through the runs you have open, or pick one in its settings.
- **Next action** presses whatever the run is waiting on, in the step's own words.
- **Press** takes one move, the roll that is waiting, or a preset answer, set in the key's settings.
- **Roll** throws the dice the run is waiting on.
- **Keep rolling for me** hands the dice to the run so it throws them itself, and takes them back again.
- **Apply setup** changes the run's loadout to a setup from your library and hands it out to the tool.
- **Command** sends a setup's operations to the tool once, without changing the run's own setup.
- **Undo** takes back the last result.
- **Metric** shows one number from the run: the score, the unit, a clock, the last result, the leader, or a counter or resource the pack keeps. Set to a counter or a resource it presses too: a tap steps it, a hold takes one back off.
- **Clock** counts the run's clock down. Press to pause or resume it, hold to stop it.
- **Finish the run** ends the run, held rather than pressed.
- **Open in the browser** opens the run, its dock, a new run, the guide, or the pack's rules in your default browser. Set to this pack's profile it opens nothing: it builds a profile for the pack the deck is following and hands it to the Stream Deck app to import.
- **Install a profile** builds one for any pack on your account, picked in its settings, and hands it over the same way. The deck does not have to be on a run of that pack.

Next action, Metric and Clock also sit on a dial on a Stream Deck +.

The plugin also ships laid-out profiles, one per deck for the generic keys and one per deck for every pack it bundles, built from the pack files by `npm run profiles`. The Runlog profile installs with the plugin; a pack's arrives the first time the deck follows a run of that pack, and the deck switches to it unless Connect's settings say not to. A pack the plugin bundles none for gets one built from the run itself, the first time the deck follows a run of it, and handed to the Stream Deck app to import. Once per pack: the packs already offered for are kept in the plugin's settings, and a profile the app already has under the pack's title stops the offer as well.

## What it needs

- The Stream Deck app, 7.1 or later, on macOS 12 or Windows 10 and up.
- A Runlog account, signed in from any key's settings.
- A run synced to that account and open in a browser, a dock or a browser source: the deck presses through the page holding the run.
- Where plans are switched on, Plus to press a run from the deck. Watching one costs nothing.

## Where to read more

The guide's [A Stream Deck at the table](https://runlog.scrthq.com/guide/stream-deck) sets the keys up, page by page. [Runlog](https://runlog.scrthq.com) is the app.
