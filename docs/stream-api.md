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
Streamlabs, StreamElements and Streamer.bot, see the guide, from
[Streaming a run](https://runlog.scrthq.com/play/guide/streaming) on.

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
| `counter` | A tally the pack shows moved: a death counted, a streak sent back to zero. Hidden counters are not told. | `counter`, its id; `label`, in the pack's words; `value`, where it is now; `was`, where it was. |
| `unit-closed` | A unit was finalized. | `unit`, the one closed; `unitsDone`, how many so far. |
| `run-ended` | The run ended. | `ending`, its name; `unitsDone`. |
| `ask` | Something outside asked the run for a move or a roll (see Asks below). Sent by the server. | `ask`, its id; `kind`, `move` or `roll`; `move`, the move's id; `name` and `via` as given; `policy`, `ask` or `auto`. |
| `asked` | The host answered an ask. Sent by the server. | The same fields, plus `accepted`, true or false, and `reason` when declined. |

`rolled` is sent by whichever device threw, so a plugin can play the same
throw. The rest are sent by the run's owner's device after each move,
whichever device made it, so a table speaks with one voice; they say what
happened in words a listener without the pack can use, and a result's `n`
lets a listener drop one it has already shown. An undo says nothing: what
it unmade is not there when the state is next read. Others may
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

## Asks: `POST` or `GET /api/public/runs/<runId>/asks?k=<askKey>`

The one thing outside the table that may move the run, and it may only
ask. A chat command, a channel-point redeem, a button on a stream deck
sends the ask and the run's host answers it: it lands in a tray at the
table, where the host presses Accept or Decline, or, where the host has
said so, the table takes it the moment it lands. Accepted, it becomes an
ordinary move in the log, stamped with who asked and how.

```json
{ "kind": "move", "move": "died", "name": "viewer_42", "via": "channel-points" }
{ "kind": "roll", "name": "viewer_42", "via": "bits" }
```

`kind: "move"` takes a move the pack offers at any time, by its id in the
pack; `kind: "roll"` rolls the table the run is waiting on, if it is
waiting on one. `name` (40 characters) and `via` (32) are for the log and
the tray, as given.

The same four fields may travel as query parameters instead, for a tool
that cannot post a body. Streamer.bot's Fetch URL is the case this exists
for: it sends a `GET` and nothing else.

```
GET /api/public/runs/<runId>/asks?k=<askKey>&kind=move&move=died&name=viewer_42&via=channel-points
```

The answer carries `ok`, one sentence in `say` written for a chat line,
the new ask's `id`, and the run's open asks, oldest first:

```json
{
  "ok": true,
  "say": "viewer_42 asked for died. The table answers next.",
  "ask": "3f9a1c0b2d4e",
  "asks": [{ "id": "3f9a1c0b2d4e", "kind": "move", "move": "died", "name": "viewer_42", "via": "channel-points", "at": "2026-09-09T20:14:03.120Z" }]
}
```

`say` is the whole of what a bot needs to put in chat, refusals included,
so nothing has to branch on a status to be useful. It says what happened,
never why the rule exists: a rate-limited press answers "Too quick.
viewer_42 can ask again in 11 seconds."

### Naming the whole ask in one field

A tool often has exactly one thing worth sending. A channel-point reward
carries its own name and little else, so `ask` takes the place of `kind`
and `move` together:

```
GET /api/public/runs/<runId>/asks?k=<askKey>&ask=Salvage%20a%20Piece&name=viewer_42
```

The word `roll`, in any case, is a roll. Anything else is a move, matched
against what the table is offering: by id first, then by the label the
pack gives it, ignoring case. A name matching more than one move is
refused and asks for the id. A name matching nothing is refused with the
menu below, so chat is told what there is rather than only what there is
not.

An id that matches nothing on offer is still sent on. The menu is only as
fresh as the last snapshot, and the table is the one that knows, so a
stale list must never refuse a move that is really there.

This is what lets one action serve every reward: name the reward after the
move, and send `ask=%rewardName%`.

### What may be asked for

The same address with **no `kind`** is a question rather than a press:

```
GET /api/public/runs/<runId>/asks?k=<askKey>
```

```json
{
  "ok": true,
  "say": "Ask for a roll, or a move: Salvage a Piece.",
  "roll": true,
  "moves": [{ "id": "salvage", "label": "Salvage a Piece" }]
}
```

`roll` says whether a table is waiting; `moves` are the moves on offer at
this moment, by id and label. Offered, not declared: whether a move is
available depends on the pack's conditions and on what the run has already
spent once, so the run's own device works it out and publishes it with the
rest of its snapshot. A run whose device has not published since this
existed names nothing, which reads as a run with nothing to ask for.

This is what a `!moves` command reads. It is also why a bare address is
harmless: pressed with nothing after the key, it answers a question.

### What became of one ask

The verdict is never known when a press is answered: under either policy
the table's own device decides, a moment later or a minute later. A press
answers with the new ask's `id`, and that id reads back:

```
GET /api/public/runs/<runId>/asks?k=<askKey>&of=<askId>
```

```json
{ "ok": true, "answer": "declined", "reason": "nothing to roll right now",
  "say": "viewer_42 asked for a roll. The table said no: nothing to roll right now." }
```

`answer` is `accepted`, `declined`, or `waiting`. A move is named by its
label rather than its id, since the sentence is for chat. An id this run
no longer remembers answers `ok: false`, since a run keeps only its last
few asks.

A press, a short wait and one of these is the whole round trip for a tool
that can only fetch a URL. Under the act-as-it-lands policy the table
answers within a second or two, so a brief delay is enough. Where the host
accepts by hand a verdict may be minutes away, and the socket's `asked`
gesture is the right way to hear it.

Reading a verdict is not a press and does not count against the limit.

### The same press twice

A press may carry a `ref` of the caller's own: a redemption id, a message
id, anything stable for that one press. A press whose `ref` has been seen
before on this run answers with the first press's `ask` id and the same
sentence, marked `"repeat": true`, and queues nothing. A retry after a
reply that never arrived looks exactly like the press that was lost.

With no `ref`, two presses alike in name, kind and move within three
seconds are read the same way, which is what a double-click is. Anything
beyond that is a person pressing again on purpose, and meets the limit
below.

| Status | Meaning |
| --- | --- |
| 403 | No key, the wrong key, or the run is not taking asks. |
| 410 | The run has ended. |
| 422 | `kind` is not `move` or `roll`, or a `move` has no id. |
| 429 | Too many: one ask a name every twenty seconds, thirty a minute for the run. |

Those are the `POST` form's codes. **The `GET` form always answers 200**,
refusals included, with the verdict in `ok` and the reason in `say`. A
tool that can only fetch a URL tends to treat any other status as a failed
action and stop, which would lose the one sentence worth having; the
codes are kept where a client can read them.

**The key is not the live token.** The token is in every widget address
and so in a streaming scene; a leaked address must let strangers watch,
never press. The key is minted by the host under **Settings → Stream →
Chat**, shown once with the full address to post to, and revoked on its
own; the live link stays. Where plans are on, asks are part of Plus, like
the link they ride beside.

Whether an ask was *taken* is a later question than whether it was
accepted here, under either policy: the host's device does the acting.
`say` reports that the ask is in, and the verdict arrives on the socket as
the `asked` gesture above, so a bot can tell the channel "the forfeit is
in" or "no such move right now". A declined ask carries a `reason` in a
few words.

## Stream keys: the account's own, not the run's

Every address above names one run and carries a secret that dies with it,
so a scene wired for tonight's run is wrong for tomorrow's. An account can
instead hold two keys of its own, minted under **Settings → Stream →
Chat**, shown once and kept only as hashes.

| Key | For |
| --- | --- |
| watch | Widgets, the numbers, the socket. |
| press | Asks. |

They are separate on purpose. A watch key is in every widget address and
so in a streaming scene; an address that gets out should let strangers
watch and never press.

### `POST` or `GET /api/public/stream/asks?k=<pressKey>`

The ask address that outlives a run. Every field above travels the same
way; what changes is that no run is named:

```
GET /api/public/stream/asks?k=<pressKey>&ask=%rewardName%&name=%userName%&ref=%redemptionId%
```

It reaches the run in play: of the runs that account is taking asks on,
the one moved most recently. `run=<runId>` names another, for anyone
keeping two going at once. The answer carries `runId`, so a bot can say
which one it reached.

Taking asks stays the host's word, per run, under **Settings → Stream →
Chat**. A press key makes the wiring outlive a run; it does not switch
anything on. A run that is not taking asks is passed over, and an account
with none answers `No run is taking asks right now.`

A watch key is refused here. What watches must never also press.

### `GET /api/public/stream/metrics?k=<watchKey>`

The same document the per-run metrics address answers with, reached
without a run id or a link's token. A `!score` command should not ask
anyone to pick a live link apart for the pieces inside it.

It answers for the run in play, or for `run=<runId>`, and carries `runId`
alongside. Only a run open to watchers; an account with none answers
`ok: false`.

### The socket on a watch key: `wss://…/ws?k=<watchKey>`

The same doorbell, opened without naming a run. It watches the run in
play, or `run=<runId>`, and carries the gestures above exactly as the
per-run socket does.

Which run it watches is settled when it connects. A socket open across the
start of a new run goes on watching the old one; `run-ended` on the old
run is the moment to open it again. A press key is refused here, as it is
by every address that reads.

### `GET /api/public/stream/runs?k=<watchKey>`

What that key may draw: the account's runs that are open to watch, newest
first, and which is in play.

```json
{
  "ok": true,
  "runs": [{ "id": "01RUN", "name": "Thursday", "packTitle": "Any Given Day", "updatedAt": "2026-09-10T23:04:11.02Z" }],
  "inPlay": "01RUN",
  "say": "One run to watch."
}
```

`inPlay` is the run moved most recently, which is the one being played
without anyone having to say so. It is what a widget draws when nobody has
chosen; choosing is done at the widget's end and remembered there, since
one answer here could never serve two sources pointed at two runs.

Only runs their host has opened to watchers appear. A key for a scene does
not quietly make the rest of an account readable, and a run that ends
leaves the list rather than being drawn all night.

Minting a key again replaces it, and the one it replaces stops working at
once. That is how a key is rotated: there is no reading one back, because
the server keeps only the hash.

## Politeness

Poll no faster than every five seconds; the socket exists so you need
not, and a widget is one reader on one machine, never one per viewer.
Keep the token out of anything you publish: whoever has it can watch,
and a widget pasted into a shared overlay carries it. If it gets out,
**Stop sharing** and share again; the old token is dead the moment you
do. Nothing here writes to the run except an ask, and an ask only asks.

## From the app

The widgets under **Stream** in the run's side column draw the same
snapshot, on pages of their own, and **Everything, stacked** puts them in
one column for a single browser source. See the guide's
[Streaming a run](https://runlog.scrthq.com/play/guide/streaming) for those,
and the pages after it for the apps.
