# Runlog in Discord

The Runlog bot hosts runs in a Discord server: a run lives in a thread,
its table card carries the buttons, one person hosts, and everyone in
the server watches there and by live link. The packs come from the
account that claimed the server, out of its own shelf, and never leave
the server's vault: members see the lines the dice draw, not the pack.

This is the users' side. The operator's, making the bot, is in
[discord-bot.md](discord-bot.md).

## Adding the bot to a server

Whoever runs the hosted copy publishes the bot's install link (the
Runlog Discord has it). Open it, pick your server, accept the permissions
it asks for: to see channels, to post in them and in threads, to open a
public thread per run and close it after, to post embeds, to read what
it posted, and to pin the table card. It never reads members' messages
and never manages people.

Then, in the server, someone who can manage it:

1. **`/setup claim`** — the bot shows an address, to you alone. Open it
   signed in to Runlog and the server is that account's: it pays for the
   server's plan, and chooses its packs. Claiming again from another
   account moves the server to that account. One account may claim
   three.
2. On your profile, under **Servers**, add packs to the server's
   **vault** from your shelf. A pack goes up once, with its modes named
   so the bot can list them, and never comes back down: not to members,
   not to you. `/packs` in the server lists what is there.
3. **`/setup role @Hosts`** to say who may start runs; without a role,
   anyone who can manage the server may. **`/setup channel #runs`** to
   say where runs open; without one, wherever `/run start` is used.
   Or let the bot make them: **`/setup make-role`** makes a "Runlog
   Host" role (or finds one by the name you give) and sets it; **`/setup
   make-channel`** makes a `#runs` channel (or finds one) and sets it.
   The bot is installed without Manage Roles and Manage Channels; the
   first time you ask, it answers with a link that adds the one it needs.
4. **`/setup status`** says all of the above, and whether the server's
   plan is active.

Hosting a run needs the server plan, **Runlog for servers**, held by the
account that claimed the server, where plans are on; or, where the bot's
store page sells it, bought for the server through Discord. Claiming,
filling the vault and setting up need nothing.

## Linked roles

A server can give a role only to members with a Runlog account linked.
Taking such a role sends you through a short verification: to Runlog,
signed in, then to Discord to say which account is yours, then back.
That links the two if they were not, and writes the link on your Discord
profile for the server to read. The Social page offers the same under
"Verify for linked roles"; what it wrote is yours to remove under
Discord's own Connections.

## Linking your account

`/link`, anywhere the bot is, shows an address to you alone. Open it
signed in to Runlog and your Discord account is linked to that Runlog
account: it appears under **Social** on your profile, and can be
unlinked there. Nothing of Discord's is kept but your user id and the
name Discord showed.

A host has to be linked, because a run is somebody's: it lands in the
host's Runlog library like any run, with every move in its log. Watching
and joining a roster need no link at all.

## Hosting a run

`/run start` with a pack from the vault and one of its modes, and a name
if you like. The bot opens a thread, posts the **table card** in it,
pins it, and posts the run's live link.

The card says where the run stands — the unit, the step, the
constraints in play, the latest result, what is on the table, the
clocks — and carries the one press that is due:

- **Begin** / **Next** the unit.
- **Roll** on a table: the bot throws the dice and says what landed.
- A checklist's boxes, then **Done**.
- **Declare** what you are making, typed into a small form, with the
  constraint the dice drew shown as a hint.
- **Close** the unit, once its confirmations are ticked.
- A move the pack offers, or something the run owes that is due.
- **End** the run, with a choice of endings where the pack offers one.
- **Pause** and **Resume** the unit's clock, where the pack runs one;
  **Start** it, where the pack leaves that to the player. A timer that
  runs out is stopped at that moment, whether or not anyone is pressing:
  the thread hears it ran out, the card is redrawn, and whatever the
  pack does when a timer expires is due at the next press.
- **Undo**: the last move taken back, as a move of its own, the way the
  app does it. `/run undo` in the thread does the same.

Only the host presses; a press by anyone else is answered with a note.
The one row anyone may press is the six waves under the card — the same
six the live page offers — which land beside a browser's on the live
page. `/journal` writes a line in the run's journal for the unit, by the
host.
When the pack asks a question mid-step (a yes or no, a choice, a
target), the card shows it and waits for the host. Every move is a line
under the card, in the pack's words, with what kind of thing it is in
bold ("**Twist** No music, no phone…"); a unit beginning or closing, the
run ending, a timer running out, show as a colored bar instead. The
card's latest result sits under the name of the table it came from.

In a **moderated** mode, anyone in the server presses **Join the
roster** and is a contestant by their Discord name; each result with
points shows an **Award** menu to the host, and the standings are on the
card.

In a mode **played by several** (the demo pack's Pairs, say), `/run
start` takes a `players` count within what the mode allows, the host has
seat one, and the card shows the seats and which role each holds this
unit. Anyone takes an open seat with **Take seat**; whoever holds a seat
presses the table like the host does, though only the host ends, undoes
and awards. Where the pack marks a role as the one that acts (the demo's
Thrower), the card says which seat presses this unit, and the other
seats are told whose turn it is. **Leave seat** frees it. **Follow in Runlog** puts the run in
a linked member's own library as a watcher; a linked member who takes a
seat is a player there, and can play the same run from the app.

The host, and anyone who took a seat with a linked account, can play the
same run from the app. The thread hears each move made there a moment
later — the lines, under "From the app", and a fresh card — and a card
that is behind refuses a press with a note, rather than building on a
table that moved.

`/run status` in the thread posts a fresh card and takes the buttons off
the old one. `/run link` posts a fresh live link (the old one stops
working). `/run end` ends the run; the thread stays open to talk about
it, and Discord closes it after a day idle. The log stays, in the host's
library and by link.

## Watching

Everyone in the thread sees the card and the lines. The live link the
bot posted opens the run in a browser for anyone, no account needed;
the same link feeds the stream widgets, so a run hosted in Discord can
be on a stream like any other — see
[streaming-setup.md](streaming-setup.md).

## What is stored, and where the pack goes

- The run: a session in the host's account, its log written by the
  bot as the host's device, one event per move, each saying the bot
  rolled (never that dice were thrown by hand).
- The server: which account claimed it, the host role and channel, and
  which packs are in its vault.
- The vault: the pack's text, in the hosting's bucket, read by the bot
  to play. This is the one place the hosting holds a pack's text for
  something other than handing it back to whoever sent it, and it is
  handed to nobody. What reaches the thread is the drawn line, which is
  the run's, not the pack's; a sealed pack goes no further than that.
- Of Discord's: user ids, guild ids, a thread id and a message id per
  run, and the names Discord showed. No tokens, no messages of anyone's.

Releasing a server from the profile, or deleting the account, removes
the server's rows and empties its vault.
