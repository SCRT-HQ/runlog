# The stream API

A run shared by live link is readable by anything that can fetch a URL:
a streaming plugin, a stream deck button, a chat bot, a second screen of
your own. The live link's token is the key; there is no account, no
sign-in and no rate of your own to manage beyond politeness.

Everything here is on the hosted address, `https://runlog.scrthq.com`. A
copy of Runlog you run yourself as a static site has no server, so nothing
here applies to it; a copy run with its own hosting answers the same way
at its own address.

For the widgets that draw these numbers, and how to put them in OBS,
Streamlabs, StreamElements and Streamer.bot, see
[streaming-setup.md](streaming-setup.md).

## Getting a link

In the run, under **People at the table**, **Share a live link** (part of
Plus where plans are on). The link is `https://runlog.scrthq.com/r/<runId>?t=<token>`.
Take `<runId>` and `<token>` from it. **Stop sharing** kills the token;
share again and a new one is minted.

## The numbers: `GET /api/public/runs/<runId>/metrics?t=<token>`

One flat JSON document: the run's state as the owner's device last wrote
it, with the log left out. Any origin may read it (`access-control-allow-origin: *`),
and it is never cached. Poll it every few seconds, or open the socket
below and fetch it when the socket rings.

```json
{
  "found": true,
  "ready": true,
  "run": { "id": "01J…", "packId": "com.scrthq.runlog.kiln", "packTitle": "The Long Kiln", "name": null, "endedAt": null },
  "at": "2026-09-07T20:14:03.120Z",
  "serverAt": "2026-09-07T20:14:05.001Z",
  "v": 1,
  "packId": "com.scrthq.runlog.kiln",
  "packTitle": "The Long Kiln",
  "runName": null,
  "mode": "Standard",
  "modeId": "standard",
  "words": { "run": "Firing", "unit": "Day", "units": "Days" },
  "status": "active",
  "ending": null,
  "unit": 4,
  "where": "Morning · Draw the weather",
  "step": "Draw the weather",
  "stepKind": "rollTable",
  "phases": [{ "id": "morning", "label": "Morning", "state": "current" }, { "id": "work", "label": "Work", "state": "todo" }],
  "constraints": ["No stacking today."],
  "quoted": true,
  "standings": [{ "name": "Mira", "points": 12, "place": 1, "states": ["Tired"] }],
  "contestants": 3,
  "subjects": [{ "id": 1, "name": "Bowl 1", "type": "bowl", "states": ["glazed"], "finalized": false, "hits": ["Crawl"] }],
  "counters": [{ "id": "cracks", "label": "Cracks", "value": 2 }],
  "resources": [{ "id": "wood", "label": "Wood", "value": 6, "max": 10, "display": "boxes" }],
  "clocks": [{ "id": "u4:unit", "label": "Day 4", "kind": "timer", "seconds": 600, "status": "running", "elapsedMs": 83210, "expired": false }],
  "progress": { "unitsDone": 3, "elapsedMs": 1490233, "timed": true },
  "score": { "label": "Days", "text": "3 days", "value": 3, "better": "higher" },
  "forcedUnits": 0,
  "unitResults": [{ "table": "Weather", "text": "A dry wind from the east.", "hit": null }],
  "latest": { "where": "Day 4 · Morning", "text": "A dry wind from the east." }
}
```

What the fields mean:

| Field | What it is |
| --- | --- |
| `ready` | `false` until the owner's device has written a snapshot: the run is shared but nothing has been played since. Then only `run` and `serverAt` are present. |
| `run` | The run as the server knows it: id, pack, name, and when it ended if it has. |
| `at` | When the snapshot was taken, on the owner's device. Clocks are as of this moment. |
| `serverAt` | The server's clock when it answered; the difference from `at` is how old the numbers are. |
| `v` | The snapshot's shape, `1`. A field marked *newer* below is absent from snapshots written by an older app. |
| `mode`, `modeId` | The mode being played, as a label and as the pack's id for it. *newer* |
| `words` | The pack's own words for a run and its unit, so a caption can say "Day 4" for one game and "Room 4" for another. |
| `status`, `ending` | `active` or `ended`, and the ending's name once there is one. |
| `unit`, `where` | The unit the run is in, and the phase and step it is waiting on, in one line. |
| `step`, `stepKind` | The step on its own, and its kind: `manual`, `rollTable`, `declareSubject`, `finalizeUnit` and so on. Null between units. *newer* |
| `phases` | The unit's phases and where each stands: `done`, `current`, `skipped` (with `why`) or `todo`. |
| `constraints` | Rules drawn earlier this unit that the current step must honor, in the pack's words. Empty when there are none. *newer* |
| `quoted` | Whether the pack's license lets its text be quoted. Where it does not, `constraints`, `unitResults` and `latest` still carry the drawn lines: that much is the run, not the pack. |
| `standings` | Contestants in a moderated run, by place. Empty when nobody is on the roster. |
| `subjects` | What the run tracks (tracks, bowls, rooms: the pack's word), with their states and the results that hit them. |
| `counters`, `resources` | The pack's counters, and its resources with their maximum and how the pack draws them. |
| `clocks` | The clocks that are running, paused or just done. See below. |
| `progress` | Units closed, and time elapsed on the run. `timed` says the run keeps time by unit clocks; without them, `elapsedMs` is wall time since the start, which the pages leave unshown. |
| `score` | What the pack says this run scores, worded and ready to show: a label, the text, the number, and which way is better. With no score declared, units closed. |
| `unitResults` | Every result rolled this unit, in the order the dice landed. *newer* |
| `latest` | The most recent result: where it landed and its words. Null with nothing rolled yet. *newer* |
| `race` | The race this run is in, if any: name, whether it has ended, how many are racing, and standings with a line each. Absent outside a race. |
| `paper` | The pack's summary and the mode's page as document trees, where the pack may be quoted. Large, and only a page that renders it wants it; a plugin ignores it. |

Everything the widgets draw is here. The one thing left out is `log`, the
run's last sixty lines, which the whole-run route below carries.

A wrong or missing token answers `{ "found": false }` with status 200; a
run its owner deleted answers 410.

### Chat commands from the numbers

A `!score` command wants one line; the document already has it. `score.text`
is the run's score in the pack's words ("3 days", "14 points"), `words.unit`
and `unit` say where the run is ("Day 4"), `latest.text` is the last result
rolled, and `standings[0].name` leads a moderated run. Fetch, pick, post;
no reducing needed.

### Ticking a clock

A clock's `elapsedMs` is as of `at`. To show it now:

```js
const since = clock.status === "running" ? Date.now() - Date.parse(doc.at) : 0;
const elapsed = clock.elapsedMs + since;
const shown = clock.seconds === null ? elapsed : Math.max(0, clock.seconds * 1000 - elapsed);
```

A `timer` counts down from `seconds`; a `stopwatch` (`seconds: null`)
counts up. `expired` is true once a timer has run out. This is what the
app's own Clock widget does, so a plugin agrees with it.

## The bell: `wss://runlog.scrthq.com/ws?run=<runId>&t=<token>`

A WebSocket that says when the run moves, so a plugin need not poll
hard. It accepts the same token and watches that one run. Each message is
JSON:

```json
{ "t": "changed", "id": "01J…", "seq": 42 }
```

`seq` climbs with every move. On a message, fetch the metrics again. The
socket carries no state of its own; it only rings.

The socket also carries **gestures**: things happening at the table that
are not moves, passed straight through and stored nowhere:

```json
{ "t": "gesture", "id": "01J…", "kind": "rolled", "from": "Mira", "at": "2026-09-07T20:14:03.120Z",
  "data": { "dice": [{ "faces": 20, "display": "14", "label": "d20" }], "total": 14, "label": "Kiln Check", "notation": "1d20" } }
```

The kinds:

| `kind` | When | `data` |
| --- | --- | --- |
| `rolled` | The player threw dice, and they have landed. | `dice`: each die's `faces`, what it shows (`display`) and its `label`; `total`; the roll's `label`; its `notation`, such as `2d6`. |
| `outcome` | A result landed: the dice, or a choice, drew a line of a table. | `n`, the result's number from the start of the run (the snapshot's log uses the same); `unit`; `table`, its title; `text`, the line drawn, in the pack's words; `subject`, by name, when the result reached one. |
| `award` | The moderator gave a result's points to a contestant. | `n`, the result awarded; `contestant`, by name; `points`; `table`; `text`. |
| `clock` | A clock started, paused, resumed or stopped. | `clock`, its id; `label`; `kind`, `stopwatch` or `timer`; `status`: `started`, `paused`, `resumed` or `stopped`; on `stopped`, `expired`. |
| `unit-closed` | A unit was finalized. | `unit`, the one closed; `unitsDone`, how many so far. |
| `run-ended` | The run ended. | `ending`, its name; `unitsDone`. |

`rolled` is sent by whichever device threw, so a plugin can play the same
throw. The rest are sent by the run's owner's device after each move,
whichever device made it, so a table speaks with one voice; they say what
happened in words a listener without the pack can use, and a result's `n`
lets a listener drop one it has already shown. An undo says nothing: what
it unmade is simply not there when the state is next read. Others may
follow the same shape; ignore kinds you do not know. A gesture is not a
move, so a `changed` message does not follow it; the move it belongs to
rings on its own once the result is written. The socket closes when the
link is revoked, and after a while idle; reconnect with a small backoff.
Nothing may be sent on it; a message from a plugin is dropped.

## The whole run: `GET /api/public/runs/<runId>?t=<token>`

What the live page itself reads. Where the pack's license lets its text
travel (a free catalog listing, or a pack marked redistributable), the
answer is `access: "full"` with the pack's source and the run's whole
event log, and you reduce it yourself with the engine from this
repository. Where it may not, the answer is `access: "snapshot"` with the
same snapshot the metrics route flattens, plus its last sixty log lines
in words where the pack allows quoting and by reference where it does
not. This route has no CORS header; it is for the app and for servers.

## Reactions: `POST /api/public/runs/<runId>/reactions?t=<token>`

Anyone with the link may wave at the table. The body is JSON, `{ "emoji": "🔥", "name": "Mira" }`;
the emoji is one of 👏 🔥 😮 😂 💀 ❤️ and the name is optional. The
answer is the run's last thirty reactions, oldest first, which the run
route above also carries as `reactions`. The socket rings on each one.
An ended run answers 410.

## Politeness

Poll no faster than every five seconds; the socket exists so you need
not, and a widget is one reader on one machine, never one per viewer.
Keep the token out of anything you publish: whoever has it can watch,
and a widget pasted into a shared overlay carries it. If it gets out,
**Stop sharing** and share again; the old token is dead the moment you
do. Nothing here writes to the run.

## From the app

The widgets under **Stream** in the run's side column draw the same
snapshot, on pages of their own, and **Everything, stacked** puts them in
one column for a single browser source. See the guide's
[Streaming a run](https://runlog.scrthq.com/#guide/streaming) for those,
and [streaming-setup.md](streaming-setup.md) for the apps.
