# The stream API

A run shared by live link is readable by anything that can fetch a URL:
a streaming plugin, a stream deck button, a chat bot, a second screen of
your own. The live link's token is the key; there is no account, no
sign-in and no rate of your own to manage beyond politeness.

Everything here is on the hosted address, `https://runlog.scrthq.com`. A
copy of Runlog you run yourself as a static site has no server, so nothing
here applies to it; a copy run with its own hosting answers the same way
at its own address.

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
  "words": { "run": "Firing", "unit": "Day", "units": "Days" },
  "status": "active",
  "ending": null,
  "unit": 4,
  "where": "Morning · Draw the weather",
  "quoted": true,
  "standings": [{ "name": "Mira", "points": 12, "place": 1, "states": ["Tired"] }],
  "contestants": 3,
  "subjects": [{ "id": 1, "type": "bowl", "states": ["glazed"], "finalized": false }],
  "counters": [{ "id": "cracks", "label": "Cracks", "value": 2 }],
  "resources": [{ "id": "wood", "label": "Wood", "value": 6, "max": 10, "display": "boxes" }],
  "clocks": [{ "id": "day", "label": "Day 4", "kind": "timer", "seconds": 600, "status": "running", "elapsedMs": 83210, "expired": false }],
  "progress": { "unitsDone": 3, "elapsedMs": 1490233 },
  "forcedUnits": 0
}
```

What the fields mean:

| Field | What it is |
| --- | --- |
| `ready` | `false` until the owner's device has written a snapshot: the run is shared but nothing has been played since. Then only `run` and `serverAt` are present. |
| `run` | The run as the server knows it: id, pack, name, and when it ended if it has. |
| `at` | When the snapshot was taken, on the owner's device. Clocks are as of this moment. |
| `serverAt` | The server's clock when it answered; the difference from `at` is how old the numbers are. |
| `words` | The pack's own words for a run and its unit, so a caption can say "Day 4" for one game and "Room 4" for another. |
| `status`, `ending` | `active` or `ended`, and the ending's name once there is one. |
| `unit`, `where` | The unit the run is in, and the phase and step it is waiting on. |
| `standings` | Contestants in a moderated run, by place. Empty when nobody is on the roster. |
| `subjects` | What the run tracks (tracks, bowls, rooms: the pack's word), with their states. |
| `counters`, `resources` | The pack's counters, and its resources with their maximum and how the pack draws them. |
| `clocks` | The clocks that are running, paused or just done. See below. |
| `progress` | Units closed, and time elapsed on the run. |
| `quoted` | Whether the pack's license lets its text be quoted; the metrics carry no text either way. |

A wrong or missing token answers `{ "found": false }` with status 200; a
run its owner deleted answers 410.

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

`rolled` is the first kind: the dice as they were thrown, with the value
already decided, so a plugin can play the same throw. Other kinds follow
the same shape. Ignore kinds you do not know. It closes when the
link is revoked, and after a while idle; reconnect with a small backoff.

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

Poll no faster than every few seconds; the socket exists so you need
not. Keep the token out of anything you publish: whoever has it can
watch. Nothing here writes to the run.

## From the app

The widgets under **Stream** in the run's side column draw the same
snapshot, on pages of their own, and **Everything, stacked** puts them in
one column for a single browser source. See the guide's
[Streaming a run](https://runlog.scrthq.com/#guide/streaming) for those.
