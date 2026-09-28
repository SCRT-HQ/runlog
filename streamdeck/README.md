# Runlog for Stream Deck

Runlog runs dice-driven games and records their results, scores, and clocks. This plugin puts the next action, moves, undo, and run metrics on Stream Deck keys.

## The keys

- **Connect** opens the connection to your Runlog account, and closes it again.
- **Run** names the run the deck is on; press to cycle through the runs you have open, or pick one in its settings.
- **Next action** presses whatever the run is waiting on, in the step's own words.
- **Press** takes one move or a preset answer, set in the key's settings.
- **Roll** throws the dice the run is waiting on.
- **Keep rolling for me** turns automatic rolling on or off.
- **Apply setup** changes the run's loadout to a setup from your library and hands it out to the tool.
- **Command** sends a setup's operations to the tool once, without changing the run's own setup.
- **Undo** takes back the last result.
- **Metric** shows one number from the run: the score, the unit, the last result, the leader, or a counter or resource the pack keeps. Set to a counter or resource, a tap steps it and a hold takes one back off. Use **Clock** for the run's clock.
- **Clock** counts the run's clock down. Press to pause or resume it, hold to stop it.
- **Finish the run** ends the run, held rather than pressed.
- **Open in the browser** opens the run, its dock, a new run, the guide, or the pack's rules in your default browser. A key still set to the old profile option says **Set up**; use **Install a profile** instead.
- **Install a profile** creates a profile for a selected pack on your account and offers it to the Stream Deck app. The deck does not have to be on a run of that pack. For a pack bundled with the plugin, it installs the bundled profile instead.

Next action, Metric and Clock also sit on a dial on a Stream Deck +.

The plugin ships a Runlog profile and a profile for each bundled pack, with layouts for each deck built from the pack files by `npm run profiles`. The Runlog profile installs with the plugin. When the deck first follows a run of a bundled pack, the pack profile installs and the deck switches to it unless you disable that switch in Connect's settings.

For a pack without a bundled profile, the plugin builds one from the run and asks the Stream Deck app to import it. When the plugin can read the Stream Deck profile folder, it offers the profile again on the next attach if you decline the import or delete the profile later. If a profile under the pack's title is already installed, it skips the offer to avoid a duplicate. If the plugin cannot read that folder, it cannot check for an installed profile and offers the build only once per pack.

## What it needs

- The Stream Deck app, 7.1 or later, on macOS 12 or Windows 10 and up.
- A Runlog account, signed in from any key's settings.
- A run synced to that account and open in a browser, a dock or a browser source: the deck presses through the page holding the run.
- Where plans are switched on, Plus to press a run from the deck. Watching one costs nothing.

## Where to read more

The guide's [A Stream Deck at the table](https://runlog.scrthq.com/guide/stream-deck) sets the keys up, page by page. [Runlog](https://runlog.scrthq.com) is the app.
