# The Discord bot: setting it up as the operator

One bot, made once by whoever runs a hosted copy of Runlog; server
owners install that bot with its link. Nobody sets up a bot of their
own. This is the operator's side: the Discord application, what to
enable in it, and what the stage needs to know. What server owners and
members do is in [discord.md](discord.md).

The bot has no process. Discord sends every slash command and button
press as a signed HTTP request to `/api/discord/interactions` on the
API, which answers in one turn; the bot never connects to Discord's
gateway, so it needs no intents, no host, and nothing that stays up.
`hosted/infra/README.md` says how that is built.

## What you need

- A hosted copy deployed: the API answers the endpoint, and only with
  the application named in its configuration.
- Access to the stage's configuration document (`env/<stage>.json` on a
  machine, the `RUNLOG_ENV_CONFIG` variable on its GitHub environment)
  and to its AWS account, to fill one secret.
- A Discord account with a developer team or your own developer
  applications.

Do it once per stage: a development application against the dev copy,
a production application against production. The two are unrelated in
Discord, so a bot in your test server can be broken freely.

## 1. Make the application

At <https://discord.com/developers/applications>, **New Application**.
Name it what the servers will see: "Runlog" for production, "Runlog
(dev)" for development.

**General Information** shows two values you need:

- **Application ID** — public; it is in every install link.
- **Public Key** — public; it is what Discord signs interactions with,
  and what the API checks them against.

Leave the **Interactions Endpoint URL** empty for now. Discord verifies
it the moment you save it, by sending a signed ping, and the API answers
only once it knows the key.

## 2. Tell the stage

The stage's configuration document is one JSON object per stage: in
CI, the `RUNLOG_ENV_CONFIG` variable on the GitHub environment that
deploys the stage (Settings → Environments → `dev` or `prd` →
Variables); on your own machine, `hosted/infra/env/<stage>.json`, which
git ignores, with `env/example.json` as the template. See
`docs/self-hosting.md`. In it, add:

```json
"discord": {
  "applicationId": "<Application ID>",
  "publicKey": "<Public Key>",
  "open": false
}
```

`open` is whether the server plan is on sale. Leave it `false` while
the bot is being tried; everyone still sees the Servers page, claims
servers and fills vaults, and the plan shows as coming. The people
trying it get the `server` feature flag in WorkOS instead, which is the
plan as far as the API is concerned.

Deploy the stage. The API now answers the endpoint.

## 3. The bot user and its token

**Bot** tab:

- **Reset Token**, copy it once, and put it in the stage's secret:

  ```powershell
  hosted/scripts/Set-RunlogSecret.ps1 -Secret discord/bot-token
  ```

  (or `aws secretsmanager put-secret-value --secret-id runlog/discord/bot-token --secret-string "$(cat)"`
  signed in to the stage's account). The handler reads it on its next
  cold start; no deploy. Nothing in the repository ever sees it.
- **Public Bot**: on, so any server can install it.
- **Requires OAuth2 Code Grant**: off.
- **Privileged Gateway Intents** (Presence, Server Members, Message
  Content): all off. The bot has no gateway connection; it reads only
  what Discord sends it and what it posted itself.

## 4. The endpoint

Back on **General Information**, set **Interactions Endpoint URL** to

```
https://<domain>/api/discord/interactions
```

and save. Discord sends a ping; the API answers pong; the field turns
green. If it does not: the stage is not deployed with the key, the key
is wrong, or the domain is not the stage's. `curl -i` against the
address answers `401 discord is not configured here` in the first case
and `401 bad signature` to anything not from Discord in the others.

## 5. Installation

**Installation** tab:

- **Install Link**: Discord Provided Link.
- **Installation Contexts**: Guild Install only. The bot hosts runs in
  servers; it has nothing to do in a person's DMs.
- **Default Install Settings → Guild Install**:
  - Scopes: `applications.commands`, `bot`.
  - Permissions: View Channels, Send Messages, Send Messages in Threads,
    Create Public Threads, Embed Links, Read Message History, Manage
    Messages.

Those are exactly the permissions the setup script (next) puts in the
install link it prints, and no more: the bot opens a public thread per
run, posts and pins the table card in it, and posts a line per move.
Manage Messages is for the pin. It never closes a thread (Discord does,
after a day idle), never reads members' messages and never manages
people. Three more are asked for only when a server asks for what they
are for: Manage Roles and Manage Channels, when it runs `/setup
make-role` or `/setup make-channel`, and Create Private Threads, when a
run is started with `private:true` or the server has set `/setup threads
kind:private`. Each command answers with a link that adds the one it
needs, and a server that never uses them never grants any.

**OAuth2** tab: nothing, unless you set up linked roles (step 9). The
bot itself uses no Discord OAuth; linking a Runlog account to a Discord
account goes the other way, through a code the bot mints.

## 6. Register the commands

From the repository, with the application's id and its token in the
environment for one command:

```powershell
$env:DISCORD_APPLICATION_ID = "<Application ID>"
$env:DISCORD_BOT_TOKEN = "<token>"
$env:DISCORD_GUILD_ID = "<your test server's id>"   # development only
npx tsx hosted/scripts/discord-setup.ts
```

The script registers the command list the handler answers
(`hosted/infra/lib/handlers/discord/commands.ts`), so the two cannot
drift, and prints the install link. With `DISCORD_GUILD_ID` set, the
commands appear in that one server at once; without it they are
registered for every server, which Discord takes up to an hour to show.
Register for every server once the bot is meant for everyone. Running
the script again replaces the list, so a retired command disappears.

## 7. Try it

1. Open the install link, pick your test server, accept.
2. In the server, `/setup claim`, open the address it gives you signed in
   to Runlog: the server is yours, on the profile's Servers page.
3. Put a pack in its vault there — the demo pack is fine.
4. `/setup role @Hosts` if you want a role to host; without one, anyone
   who can manage the server may.
5. `/run start pack: The Long Kiln mode: Standard Firing`. A thread
   opens with the card; play a unit from its buttons. The thread carries
   a live link; open it in a browser, or put a widget from it in OBS,
   and watch the run move as you press.
6. `/run end` closes the run and the thread.

## 8. Selling the plan through Discord (optional)

Runlog for servers is sold from the Runlog profile through Stripe. Discord
can sell it too, from the bot's own store page, as a **guild
subscription**: whoever buys it there puts the plan on the server, and
the bot treats that server as holding the plan, the same as one whose
claiming account subscribed here.

1. **Monetization** in the developer portal: enable it (Discord asks for
   a payout account and a team; the terms are theirs). Create a SKU of
   type **Guild Subscription** named for the plan, with its price. Publish
   it.
2. Copy the SKU's id into the stage's configuration as
   `discord.serverSku`, and deploy. The handler now asks Discord, per
   press that needs the plan, whether the server holds a live entitlement
   to that SKU, and `/setup status` says "active through Discord's store"
   when it does. The Servers page marks such a server.
3. Nothing else changes: the claiming account still chooses the vault,
   and a server may hold the plan both ways. Without `serverSku`, the
   store is never asked.

Discord takes its cut on that sale and handles the refunds; Stripe never
sees it. The one grant this does not give is the account-side one: a
server bought through Discord does not put the plan on the claiming
account's other servers.

## 9. Linked roles (optional)

A server can make a role depend on a member having a Runlog account
linked: Discord calls these **linked roles**. The bot registers what a
server may ask about a member (linked at all; linked at least so many
days ago), and a verification — the member consenting once, at Discord —
writes those values onto their Discord profile for the server to read.

1. **OAuth2** tab: copy the **Client Secret** (reset it once, if you have
   never seen it) into the secret `runlog/discord/client-secret` with
   `Set-RunlogSecret.ps1`. Add a redirect:
   `https://<domain>/api/discord/linked-role/callback`.
2. **General Information**: set **Linked Roles Verification URL** to
   `https://<domain>/api/discord/linked-role`.
3. Run the setup script (step 6) again; it registers the two metadata
   keys alongside the commands and prints both addresses above.
4. In a server: **Server Settings → Roles → a role → Links → Add
   requirement → Runlog**, and choose "Runlog account linked". Members
   who take that role are sent through the verification: to the app,
   signed in, then to Discord to consent, then back. The Social page
   also offers "Verify for linked roles" to anyone already linked, and
   "Link with Discord" to anyone not yet linked, which links without a
   code.

Only the person can write to their own connection, so a verification is
theirs to begin; unlinking on the Social page does not erase what was
written, and a member removes the connection themselves under Discord's
Connections. Without the client secret, nothing above is offered.

## When something is off

- **"This copy of Runlog cannot host runs"** or **"token is not filled
  in"**: the stage has no `discord` block, or the secret is still the
  deploy's placeholder. Fill it; the next cold start reads it.
- **"Discord would not open a thread here"**: the bot lacks Create
  Public Threads in that channel, or the channel is one threads cannot
  be made in. Reinstall with the link the script prints, or pick a
  channel with `/setup channel`.
- **Commands are missing from the menu**: registered for every server
  less than an hour ago, or registered for a different guild id. Run the
  script with `DISCORD_GUILD_ID` for the server you are in.
- **The endpoint will not save**: see step 4.
- **A press says "the card may be stale"**: the card is rebuilt from the
  log on every press, so a button from an old card can name a step that
  has passed. `/run status` posts a fresh one.
- **"This interaction failed" or "thinking" that never ends**: the
  stage's CloudWatch dashboard, `runlog-<env>`, has a section for the
  bot: every interaction by kind, how long each kind took to answer
  against Discord's three seconds, and the job function's cold starts
  beside it. Two alarms ring the stage's topic for exactly these: an
  interaction not answered, and the job failing outright.

## Where things are

| What | Where |
| --- | --- |
| Application id and public key | The stage's configuration, `discord.applicationId` and `discord.publicKey`; the handler's `DISCORD_APPLICATION_ID` and `DISCORD_PUBLIC_KEY` |
| Whether the plan is on sale | `discord.open`; the handler's `DISCORD_OPEN` |
| The store's SKU, where Discord sells the plan | `discord.serverSku`; the handler's `DISCORD_SERVER_SKU` |
| The bot token | Secrets Manager `runlog/discord/bot-token` |
| The OAuth2 client secret, for linked roles | Secrets Manager `runlog/discord/client-secret`; without it, no verification is offered |
| Who has the plan meanwhile | The WorkOS feature flag `server`, per environment, on the people trying it |
| The commands | `hosted/infra/lib/handlers/discord/commands.ts`, registered by `hosted/scripts/discord-setup.ts` |
| The handler | `hosted/infra/lib/handlers/discord/` and the route in `api.ts` |
| How it is doing | The bot section of the `runlog-<env>` CloudWatch dashboard; alarms `runlog-<env>-discord-failures` and `runlog-<env>-discord-job-errors` |
| Timers waiting to run out | EventBridge Scheduler, group `runlog-<env>-timers`: one schedule per running timer, gone once it has run |
| A server's rows and vault | `GUILD#<id>` in the table, `guilds/<id>/packs/` in the bucket |
