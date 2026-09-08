# Streaming a run: OBS, Streamlabs, StreamElements, Streamer.bot

Runlog has no plugin to install. A run's widgets are web pages, and every
streaming app already knows how to show a web page: as a **browser
source** in a scene, as a **dock** beside it, or as a **custom widget**
in an overlay editor. This guide walks through each, naming the fields
as the apps name them. The numbers behind the widgets are a public JSON
document and a socket that rings, described in
[the stream API](stream-api.md), which is what an automation tool like
Streamer.bot reads.

Everything below assumes the hosted copy at `https://runlog.scrthq.com`.
A copy you run with your own hosting answers the same way at its own
address; a static copy has no server, so only the pop-out window works.

## Before anything: the address that works on a stream

A widget can read the run two ways, and only one of them works inside a
streaming app.

- **From this device.** The plain widget address reads the run from the
  browser's own storage, the same log the app plays from. That is what
  **Open** gives you: a pop-out window on the machine you play on, which
  you could window-capture.
- **By live link.** With a live link shared, the address can carry the
  link's token, and the widget reads the run from the server instead.
  This is what a browser source needs. OBS and Streamlabs run their own
  private browser with nothing in its storage, so a plain address there
  shows "This run is not on this device," however many times you
  refresh it.

So, once, for each run you stream:

1. In the run, under **People at the table**, choose **Share a live link**
   (part of Plus where plans are on).
2. Open the run's **Settings**, then **Stream**.
3. Tick **Clear background** so your scene shows through, and tick
   **For another machine** so the address carries the token.
4. Pick a size (1.25× suits most captures), then **Copy address** on the
   widget you want.

The address looks like this:

```
https://runlog.scrthq.com/play#widget/clock/01J…?bg=clear&scale=1.25&t=…
```

The `t=` part is the live link's token. Whoever has it can watch the run,
so keep the address out of anything you publish. **Stop sharing** kills
the token; share again and every copied address needs replacing.

## OBS Studio: a browser source

In a scene, **Sources** → **+** → **Browser**, name it after the widget,
and set:

| Field | Value |
| --- | --- |
| **URL** | The copied widget address, token and all. |
| **Width** and **Height** | From the table below, at size 1.25×. Scale the source in the scene after; the page adapts to the box you give it. |
| **FPS** | 30. The only motion is a clock's tenths and the ticker's slide; 60 buys nothing. |
| **Custom CSS** | Leave OBS's default. `body { background-color: rgba(0, 0, 0, 0); … }` is exactly what `bg=clear` expects. |
| **Shutdown source when not visible** | Tick it. A widget that is off scene costs nothing, and it re-reads the run the moment it is shown again. |
| **Refresh browser when scene becomes active** | Optional. The widget re-reads on its own; this only helps after a **Stop sharing**, when you have pasted a fresh address. |

Suggested sizes, at 1.25×:

| Widget | Width × height | What it is |
| --- | --- | --- |
| Clock | 480 × 200 | The unit's stopwatch or timer, large. |
| Step | 520 × 380 | The current step, the constraints in play, the latest result. |
| Stats | 520 × 560 | Unit, units done, time, step, constraints, score. |
| Scoreboard | 480 × 440 | Standings in a moderated run. Grows with the roster. |
| Trackers | 480 × 420 | Resources and counters as bars and boxes. Grows with the pack. |
| Race | 560 × 440 | The race leaderboard. |
| Everything, stacked | 460 × 1080 | The panels above in one column, for one source down the side of a scene. |

A widget's colors are the app's theme tokens, so a scene that needs the
clock in white on nothing can say so in **Custom CSS**, under OBS's own
line:

```css
:root { --text: #fff; --panel: transparent; --line: transparent; --raise: none; }
```

The widget follows the run within a second while its socket is up, and
within six seconds by polling if the socket drops. Clocks tick from the
log's timestamps, so they agree with the app to the tenth even after a
long shutdown.

## Streamlabs Desktop: the same source

Streamlabs Desktop's browser is the OBS one. **Sources** → **Add Source**
→ **Browser Source**, then **URL**, **Width**, **Height** and **Custom CSS**
exactly as above. Its own gallery of "widgets" (alert box, chat box,
goals) is a separate thing; a Runlog widget is a plain browser source and
lives alongside them.

## A dock for the run's controls

OBS can keep a signed-in web page docked beside the preview: **View** →
**Docks** → **Custom Browser Docks**. Give it a name ("Runlog") and the
URL `https://runlog.scrthq.com/play`, then **Apply**. The dock opens the
app; sign in inside it, once. OBS keeps that sign-in between sessions,
the way a browser would.

Open the run in the dock and it is a second device at your table: a
move you make there is on your other screens through sync in a moment,
the dice you throw there are the dice your watchers see land, and the
run's Settings and Stream panels are right there for copying addresses.
One thing to know: signing in sends the page through the sign-in service
and back, and the dock lands on your library rather than the run, so open
the run once more after the first sign-in.

## StreamElements: a custom widget

StreamElements draws its overlays in its own editor, and a **Custom
widget** there can fetch the run's numbers straight from the stream API,
because that route answers any origin. In the overlay editor, **Add
widget** → **Static / Custom** → **Custom widget**, open the widget's
**Settings** → **Open editor**, and paste the four tabs below. The run id
and token go in the **Fields** tab, so they can be edited from the
widget's sidebar rather than the code.

**HTML**

```html
<div class="runlog">
  <div class="where">…</div>
  <div class="score">…</div>
  <div class="clock"></div>
  <div class="latest"></div>
</div>
```

**CSS**

```css
.runlog { font-family: "IBM Plex Mono", ui-monospace, monospace; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.6); display: grid; gap: .3em; }
.runlog .where { font-size: 1.1em; opacity: .85; }
.runlog .score { font-size: 2em; font-weight: 600; }
.runlog .clock { font-size: 3em; font-variant-numeric: tabular-nums; }
.runlog .latest { font-family: Georgia, serif; font-size: 1em; max-width: 30ch; }
```

**JS**

```js
let url = null;
let doc = null;

window.addEventListener("onWidgetLoad", (obj) => {
  const f = obj.detail.fieldData;
  url = `https://runlog.scrthq.com/api/public/runs/${encodeURIComponent(f.runId)}/metrics?t=${encodeURIComponent(f.token)}`;
  read();
  setInterval(read, 5000);
  setInterval(tick, 100);
});

async function read() {
  if (!url) return;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const next = await res.json();
    if (next.found === false) return;
    doc = next;
    draw();
  } catch (e) {
    /* offline for a moment: keep what we have */
  }
}

function draw() {
  if (!doc || !doc.ready) return;
  const words = doc.words || { unit: "Unit" };
  text(".where", doc.status === "ended" ? `Ended · ${doc.ending || ""}` : `${words.unit} ${doc.unit} · ${doc.where || ""}`);
  text(".score", doc.score ? doc.score.text : "");
  text(".latest", doc.latest ? doc.latest.text : "");
}

function tick() {
  if (!doc || !doc.ready || !doc.clocks || !doc.clocks[0]) return text(".clock", "");
  const c = doc.clocks[0];
  const since = c.status === "running" ? Date.now() - Date.parse(doc.at) : 0;
  const elapsed = c.elapsedMs + since;
  const ms = c.seconds === null ? elapsed : Math.max(0, c.seconds * 1000 - elapsed);
  const s = Math.floor(ms / 1000);
  text(".clock", `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
}

function text(sel, value) {
  document.querySelector(sel).textContent = value;
}
```

**Fields**

```json
{
  "runId": { "type": "text", "label": "Run id (from the live link)", "value": "" },
  "token": { "type": "text", "label": "Live link token (the t= part)", "value": "" }
}
```

The widget polls every five seconds; do not go faster. The token sits in
the widget's fields, which nobody but you sees, but the overlay is yours
to export and share, so strip it before you do.

StreamElements' chatbot can read the same document with
`$(customapi https://runlog.scrthq.com/api/public/runs/<runId>/metrics?t=<token>)`,
but it posts whatever the URL returns and cannot pick one field from a
JSON document, so that would paste the whole thing into chat. For a
`!score` command, use an automation tool that can read JSON, below.

## Streamer.bot: dice alerts and a `!score` command

Streamer.bot runs on the streaming machine and can hold a socket to the
run, act when it rings, fetch the numbers, and drive OBS.

**A dice alert.** Under **Servers/Clients** → **WebSocket Clients**, add
one with the address `wss://runlog.scrthq.com/ws?run=<runId>&t=<token>`
and auto-reconnect on. Then make an action with the trigger **WebSocket
Client** → **Message** for that client. The message arrives as one JSON
string, `{"t":"gesture","kind":"rolled",…}` when dice land and
`{"t":"changed",…}` on every move; parse it (a *Set argument from JSON*
sub-action, or two lines of C#) and act only when `kind` is `rolled`.
From there the usual sub-actions apply: **OBS** → **Set Source
Visibility** to flash a dice overlay, a sound, a chat line such as
`Rolled {total} on {label}`. The gesture's `data` carries the dice as
thrown, the total, the roll's label and its notation; see
[the stream API](stream-api.md#the-bell) for the shape.

**A `!score` command.** Make a command action for `!score` whose
sub-action is **Core** → **Network** → **Fetch URL** on
`https://runlog.scrthq.com/api/public/runs/<runId>/metrics?t=<token>`
with *parse as JSON* on and a prefix of your choosing, say `run`. The
document's fields become arguments, so a **Twitch** → **Send Message to
Channel** of `%run.words.unit% %run.unit% · %run.score.text%` says
"Day 4 · 3 days" in the pack's own words. `%run.latest.text%` is the
last result rolled, for a `!last` command.

Aitum and Lumia Stream have the same two pieces under their own names:
an HTTP request action with JSON parsing, and a WebSocket or webhook
trigger. The addresses and the fields are the same.

## When it does not follow the run

- **"This run is not on this device."** The address has no token. Share
  a live link and copy the address with **For another machine** ticked.
- **"This link is not open any more."** Sharing was stopped, or a new link
  was minted. Copy the address again.
- **"Nothing written to the run yet."** The run is shared but nobody has
  made a move since; play one.
- **The clock is right but nothing else moves.** The socket is down and
  the widget is polling; it catches up within six seconds. If it never
  does, the machine's network blocks WebSockets to the host, which the
  poll works around on its own.
- **A dice alert never fires while the source is hidden.** With
  *Shutdown source when not visible* on, a hidden widget is closed and
  hears no gestures; it re-reads the run's state when shown, so nothing
  about the run is lost, only the throw. An automation tool holds its own
  socket and is not affected.
