# infra

The AWS hosting behind Runlog: the API, the site, and the pages that make
an address a service. One workspace of the repository, deployed by the
same pipeline that builds the app.

| Environment | Account | URL |
| --- | --- | --- |
| dev | `AWS_ACCOUNT_ID` on the `dev` environments | https://runlog.dev.scrthq.com |
| prd | `AWS_ACCOUNT_ID` on the `prd` environments | https://runlog.scrthq.com |

## What it creates

A private S3 bucket, a CloudFront distribution reaching it through an Origin
Access Control, an ACM certificate validated against the Route 53 zone already
in that account, and A/AAAA alias records.

Two cache policies, which is the part worth understanding. Built assets carry a
content hash, so a URL can only ever mean one file and is cached for a year.
The shell, the service worker and the manifest keep their names across every
release, so they are never cached at the edge — caching those is how a deploy
reaches nobody while looking perfect from the deploying end.

## How the app reaches the bucket

The site stack publishes it. The deploy workflow builds the app, lays the
hosted pages over the build (`hosted/scripts/overlay.ts`), and hands the directory
to `cdk deploy` as `RUNLOG_APP_DIST`; the stack uploads the hashed assets
with a year's cache and the shell with none, and invalidates the edge.
Three SSM parameters, `/runlog/site/{bucket,distribution,domain}`,
still say where the site is for anything else that needs to know.

## Deploying

The workflow follows the same shape as `SCRT-HQ/shl-cdk-github-iam`, including
the `npm-ci` and `run-cdk` composite actions.

| Trigger | What runs |
| --- | --- |
| Pull request to `main` | Tests against both environments, then `cdk diff` against dev and prd |
| Push to `main` | Deploy dev; then, once a reviewer approves, tag and publish the next release |
| Release published | Deploy prd, from the tag |

Production is reached only through a published release, so it always carries a
version and has always already been to dev. The release itself sits behind
a GitHub Environment named `release`, which requires a reviewer from the
Core team: a merge deploys dev on its own, and the tag, the release,
production and the package publish wait for a person. Both deploy jobs sit
behind Environments named `deploy-dev` and `deploy-prd`, so a reviewer can
be required there too without that rule living in a file anyone editing
the workflow could remove. Each deploys from `main` only, and production
from a `v*` tag as well. The diffs run under `cdk-diff-dev` and
`cdk-diff-prd`, which are
open to this repository's branches, since a diff is what a pull request
asks for. All four hold the same names, below, so the workflow says
nothing about a stage but its name, and a third stage is one more entry
in the stage's configuration, one more in the diff matrix, and two more
environments.

Versions increment automatically from the newest `v*` tag — patch by default,
or pick `minor`/`major` when running the workflow by hand.

### Why the release is cut with a GitHub App token

Anything `GITHUB_TOKEN` does is barred from starting another workflow run:
GitHub blocks it so runs cannot recurse. That applies to a published release
*and* to a pushed tag, so a release created the obvious way would sit there
looking correct while production never deployed — a failure with no error
anywhere.

The release is therefore created with a token minted from the org's GitHub App
(`CODE_MGR_APP_ID` / `CODE_MGR_APP_PRIVATE_KEY`). A release created by the App
is created by the App, so `release: published` fires and *Deploy Production*
picks it up.

Tests run with no AWS credentials at all. The stacks are asserted against a
synthesised template, so they need an account id to render into ARNs and
nothing more — which is what keeps them runnable on a fork's pull request.
Results are published as JUnit XML, the same as the other CDK repositories.

Deployment itself uses the shared `GitHubActionRole`, which trusts this
repository — see `SCRT-HQ/shl-cdk-github-iam`, where the list of repositories
that may assume it lives.

### The rules

The [AWS Solutions rules](https://github.com/cdklabs/cdk-nag) run on every
synth, diff and deploy, from `bin/runlog-infra.ts`, and an error fails the
synth. `npm run test:infra` runs them first, against both environments and
with a build attached, and prints every finding with its path. A finding
is answered one of two ways: the construct is changed, or a suppression
sits beside it with the reason written down. Never by a rerun, and never
at the stack level.

### First time, per account

```bash
npx cdk bootstrap aws://<account>/us-east-1
```

us-east-1 specifically: CloudFront only accepts a certificate issued there, and
keeping the whole stack in one region avoids a cross-region reference for the
sake of one certificate.

### Locally

```bash
npm ci
AWS_ENVIRONMENT=dev CDK_DEFAULT_ACCOUNT=... RUNLOG_DEV_ZONE_ID=... npx cdk diff
```

`AWS_ENVIRONMENT` and `CDK_DEFAULT_ACCOUNT` are the names the shared workflow
actions already set, so nothing has to be translated between them and this
repository. `RUNLOG_ENV` and `RUNLOG_DEV_ACCOUNT` are accepted too.

Account ids come from the environment rather than the repository. They are not
secret — an account id appears in every ARN — but hardcoding them would tie
this repository to one person's AWS.

Zone ids are optional. Without one, CDK looks the zone up, which needs
credentials at synth time and caches the answer into `cdk.context.json` — a
nuisance in a repository that deploys to two accounts, since the cached dev
zone would then be used for prd.

## Publishing the app

The site stack publishes the app itself. `RUNLOG_APP_DIST` names a built
`apps/web/dist` with the hosted pages laid over it, and the stack writes it
to the site bucket in two deployments: the hashed assets first, cached for a
year and never pruned, then the shell, the worker, the manifest and the pages
with `no-cache, must-revalidate` and pruning, each followed by an invalidation
of `/*`. Without the variable the stack creates the site and leaves its
contents alone, which is what the tests and a bare `cdk synth` see.

The pipeline in `.github/workflows/CI-CD.yml` builds the app before every
diff and deploy, so a diff on a pull request names the publish it would make
and a merge to main puts the build on dev. Production deploys a released tag
from `deploy-production.yml`, which builds that tag and nothing else, and
publishes the package once the deploy is done.

To republish or roll back by hand, dispatch that workflow with the tag:

```
gh workflow run deploy-production.yml -R SCRT-HQ/runlog -f tag=v1.4.0
```

## The hosted layer

The app is generic and knows nothing about who runs it. What makes an
address a service — the terms, the privacy policy, the publisher agreement,
pricing, an about page, the open-source notice, `robots.txt`, `sitemap.xml`,
`security.txt`, the image a shared link unfurls with — lives in `hosted/`
as templates, and `hosted/scripts/overlay.ts` lays them over the built app at
publish time with the environment's words filled in (the stage's configuration,
`hosted`). The app finds `hosted.json` at its root and, when it is there,
shows a footer and asks people signed in to accept the terms once per
version; a copy on disk or on GitHub Pages has no such file and shows
nothing.

To change the terms: edit the page, bump `hosted.termsVersion` and
`termsDate` in the stage's configuration, publish. Every signed-in person is asked
once. The pages say only what is certain about the hosted copy; the open
questions for legal review are kept outside the repository.

## Who may open it

Nothing here stands in front of the site. Who may *use* the app is the app's
own question: a hosted build carries a WorkOS AuthKit client id, and asks who
is there before it opens. That lives in the application, and the id reaches
the build from this repository's variables when it publishes — not in this
stack, since an edge function cannot verify an AuthKit session,
and a shared password in front of it would be a second door with a different
key. The one thing this stack knows about it is the Content Security Policy,
which lets the app reach `api.workos.com` and nothing else.

This replaced a shared password baked into a CloudFront Function, and before
that an attempt to use GitHub Pages with private visibility. Even where that is
available it authenticates against GitHub, so every viewer would need an
account with access to the repository — which rules out showing the build to
anybody who is not a collaborator.

## The API

There is one server, and it is behind `/api` on the site's own domain. It
exists for a signed-in player's sessions, the packs they choose, and the
license keys they have typed to open sealed copies, on every device they use —
and it holds nothing for anyone who has not signed in.

A session is a run with people in it, and its log is append-only in the
server's order: `POST /api/sessions` starts one with its first events,
`POST /api/sessions/{id}/events` appends a move and answers with what was
actually added and the log's new tail, `GET /api/sessions/{id}?after=N` reads
everything past what a device has seen. An event carries an id from the
device that made it, so a retry after a lost reply appends nothing twice, and
the server stamps each with its sequence number and author. Two people
appending at once get disjoint ranges from one atomic add on the session's
row, and replay the same list. Undo is an event too, so it never shortens a
log somebody else has built on.
The app works without it: from disk, from the public GitHub Pages build, and
here with nobody signed in.

Same domain rather than a hostname of its own, on purpose. A CloudFront
behavior forwards `/api/*` to an HTTP API, so the app fetches relative, the
Content Security Policy stays `connect-src 'self'`, and there is no CORS, no
second certificate and no second record.

Two conventions follow from that. The distribution rewrites every 403 and 404
into the app's index page, for every path, so the API never answers either: a
bad or missing token is a **401**, an unknown route a **410**, and a missing
item a 200 that says `found: false`. The token — a WorkOS access token the app
already holds, or one the command line got from the device flow — is verified
inside the handler against the client's published key set, not by a gateway
authorizer whose refusal would be a 403. Two WorkOS applications are accepted
per environment: the browser's, and one for the command line with a session
policy fit for a terminal (a month idle, not two days). `GET /api/auth/cli`
tells `runlog login` which client to use, so the package carries neither id.

| Where | What |
| --- | --- |
| `runlog-<env>` | DynamoDB: one row per pack or license keyed by player, a partition per session (its row, its members, one row per event), and a pointer per member. What is *about* each item — and, for a license, the key itself, since it is a line of text. |
| `runlog-<env>-sync-<account>` | S3: the items themselves, one object each, under the player's own prefix. |
| `/runlog/api/url` | SSM: `https://<domain>/api`, what the app reaches. |
| `/runlog/api/endpoint` | SSM: the API Gateway endpoint CloudFront forwards to. |
| `runlog/stripe/secret-key` | Secrets Manager: the Stripe secret key, sandbox in dev and live in prd. |
| `runlog/stripe/webhook-secret` | Secrets Manager: the signing secret of the webhook endpoint that points at `/api/stripe/webhook`. |
| `runlog/stripe/connect-webhook-secret` | Secrets Manager: the signing secret of the Connect webhook endpoint (events from connected accounts) that points at `/api/stripe/connect-webhook`. |
| `runlog/workos/api-key` | Secrets Manager: the environment's WorkOS API key, for creating publisher organisations. |
| `runlog/discord/bot-token` | Secrets Manager: the Runlog Discord application's bot token, for posting into servers that installed it. See [Discord](#discord). |
| `runlog/discord/client-secret` | Secrets Manager: the application's OAuth2 client secret, for verifying a linked account for a server's linked roles. Unfilled, no verification is offered. |

The secrets are defined here and filled out of band. A deploy creates each
with a random placeholder, and the handler treats a value that does not look
like the real thing as "not configured", so the stack stands before any key
exists and a feature stays off until its key arrives. The names carry no
environment: each environment is its own account, so the account a shell is
signed in to is the environment it fills. To fill one:

```bash
aws secretsmanager put-secret-value   --secret-id runlog/stripe/secret-key   --secret-string "$(cat)"   # paste the key, then Ctrl-D
```

The same command signed in to the production account, with the live key,
fills production. On Windows, `hosted/scripts/Set-RunlogSecret.ps1 -Secret
workos/api-key` does the same with a masked prompt, using whatever
credentials and region the AWS CLI resolves (set `AWS_PROFILE` first to
reach another account). Nothing in this repository or its workflows ever
sees a value; rotating one is the same command again.

Deleting leaves a tombstone for thirty days so other devices hear of it; the
object goes at once.

A session is shared by invitation. The owner asks `POST
/api/sessions/{id}/invites` with an email and a role (`player` or `viewer`);
the API mails a link through the domain identity core-infra verified in
us-west-2 and answers with the same link. `GET /api/invites/{token}` is the
one read that needs no account: what the link is for, so the app can say so
before the sign-in it will ask for. `POST /api/invites/{token}/accept` joins
the caller, records that they and every member have played together
(`GET /api/people`), and spends the token for anyone else. Invitations last
seven days, twenty an hour per person, and the owner can withdraw one or
remove a member. The dev account's SES is sandboxed, so dev mail only reaches
addresses verified there.

The command line acts as a person through a key: `POST /api/keys` mints one
(shown once, `rl_` and 32 random bytes; the table keeps only its hash), and
the same `Authorization: Bearer` header then names the caller on every route.
A key cannot mint keys. Signing keys are claimed by proof: `POST
/api/claims/nonce` hands out a nonce, `POST /api/claims` takes the public key
and the nonce signed with the private one, and from then on `GET
/api/authors/{fingerprint}` — the other read that needs no account — answers
who signed a pack, which is what the app's badge shows.

The person themselves is one more row: `GET /api/me` answers who is asking
and creates a profile on first sight (`createdAt`, `lastSeenAt`, and the name
and email the app reports through `PUT /api/me/profile`, since the token does
not carry them). `DELETE /api/me` removes every row and object under the
person; the app keeps its local copies, this is only the server forgetting.

A sealed copy's text is never sent here, by the app's own rule: the key
travels (`/api/licenses/{packId}`), the file stays with the player, and the
manifest lists which licenses exist without repeating the keys.

## Billing

Stripe, through a keyhole (`lib/handlers/stripe.ts`): a customer per
person (made on first use, `workos_user_id` in its metadata), a Checkout
session to start a subscription (`POST /api/billing/checkout {price}`
with `plus-monthly`, `plus-yearly`, `hosted-monthly` or `hosted-yearly`),
a Portal session to manage it (`POST /api/billing/portal`), a re-read of
what Stripe says the person has (`POST /api/billing/refresh`), and the
webhook (`POST /api/stripe/webhook`, no bearer — the signature over the
raw body is the credential; a bad one is a 401, a replay is a no-op, an
unknown event is a 200). `entitlements.active_entitlement_summary.updated`
writes the person's `ENTITLEMENTS` row, which `GET /api/me` returns.

It is all off until the secrets are filled: a `stripe/secret-key` that
does not look like a key means every billing route answers
`{available: false}`. The stage's configuration says whether plans gate anything
(`gates`: dev on, prd off until Stripe is live there) and which prices are
for sale. To set an environment up:

1. `$env:STRIPE_SECRET_KEY = "sk_…"; npx tsx hosted/scripts/stripe-setup.ts` —
   idempotent; makes the features, products, prices and the Portal
   configuration and prints the price ids for the stage's configuration.
2. Register `https://<domain>/api/stripe/webhook` in Stripe for
   `entitlements.active_entitlement_summary.updated`; fill
   `stripe/webhook-secret` with its signing secret and `stripe/secret-key`
   with the key (`hosted/scripts/Set-RunlogSecret.ps1`).
3. Subscribe an address to the `runlog-<env>-alarms` topic: the API's
   errors, a webhook Stripe could not deliver among them, ring it.

## Selling

A priced listing is bought with `POST /api/listings/{packId}/checkout`:
a one-off Checkout on the publisher's connected account, the platform's
share taken as the application fee (`stripe.applicationFeeBps` in
the stage's configuration: 5% for a publisher without the hosted-licensing
subscription, 0% with it), and a pending sale in the ledger. When Stripe's
Connect webhook says it was paid (`POST /api/stripe/connect-webhook`, its
own signing secret), the master is sealed under a fresh license key for
that buyer alone, the file goes to the bucket, a signed-in buyer's account
gets the key so sync carries it, and the receipt mails the key with a link
that fetches the copy without an account. `GET /api/me/purchases` lists a
buyer's sales; `GET /api/purchases/{ref}` and `…/file` are the buyer's, by
account or by the mail's token. The publisher's ledger is
`GET /api/publishers/sales`, `POST …/sales/{ref}/reissue` (the same key,
a fresh link, the mail again) and `POST …/sales/{ref}/revoke`. The server
never holds a signing key; it seals what the publisher signed.

## Listings

A publisher uploads a pack (`PUT /api/publishers/packs/{packId}` with
the signed master text, the head the app computed — title, category,
tags, features, what it needs — and the catalog summary), lists it
(`POST …/listing` with an amount in cents, or nothing for free; a price
makes a product and price on the publisher's connected account, and needs
payouts set up), and takes it down (`DELETE …/listing`) or removes it
(`DELETE …/packs/{packId}`). The catalog reads `GET /api/listings` (public,
a minute's cache) and `GET /api/listings/{packId}` for the summary; a free
listing's text is `GET …/file`, a priced one is delivered sealed to its
buyer. The server parses no pack: the head and summary are the app's word.

## Races

A race is several people playing the same seeded mode of the same pack at
once, each in an ordinary run on their own device; the same seed hands
everyone the same dice, so the runs agree without ever meeting. The server
holds the race (`POST /api/races`: pack, mode, seed, who started it, a
six-letter code), an entry per racer (`POST /api/races/join {code}`), and
the progress each device reports (`PUT /api/races/{id}/entries/me`). The
leaderboard is that progress, ranked on the device. The server never
reduces a run and never sees a pack. The one who started it renames or
ends it (`PATCH`) and can mail the code (`POST …/invites`). Changes ring
the same doorbell as sessions; a socket may watch a race id.

## Live push

Beside the HTTP API there is a WebSocket API — a doorbell, not a channel.
A device with a run open connects to `wss://<domain>/ws?token=<access token>`
(the token rides in the query string because a browser's socket cannot set
a header; it is checked exactly as a bearer is), sends `{"t":"watch","id":
"<session id>"}` for a session it is a member of, and receives
`{"t":"changed","id":"…","seq":n}` whenever another device appends to it,
renames it, or takes a seat. Nothing else travels on it: the device then
syncs over HTTP as it always did, so a socket that lies can only cause a
fetch that finds nothing new.

The stage is named `ws` so that CloudFront can forward the site's `/ws`
path to it unchanged (the stage name is the first path segment of a
WebSocket API's address). Connection rows expire after two hours by TTL,
and a connection the gateway reports gone is dropped the first time a
post to it fails. The app falls back to polling when the socket is closed.

## Discord

The bot is the API. Discord sends each slash command and button press
as an HTTP request to `POST /api/discord/interactions`, signed with the
application's Ed25519 key over the timestamp and the raw body, and waits
three seconds for the answer; there is no gateway connection, no process
that stays up, and nothing to scale but the one handler. A bad signature
is a 401, and with no application configured the route answers 401 to
everything, ping included, so Discord will not accept an endpoint that
cannot answer for a bot.

The application is made once, in Discord's developer portal, and named in
the stage's configuration as `discord.applicationId` and
`discord.publicKey`, both public. Its bot token goes into
`runlog/discord/bot-token`. Its commands are registered with
`hosted/scripts/discord-setup.ts`, which reads the same list the handler
answers (`lib/handlers/discord/commands.ts`), so the two cannot drift;
`DISCORD_GUILD_ID` registers them for one server at once, for
development, and without it for every server, which Discord takes up to
an hour to show. The install link is
`https://discord.com/oauth2/authorize?client_id=<applicationId>&scope=bot+applications.commands&permissions=0`.

`/setup make-role` and `/setup make-channel` have the bot make (or find
by name) a host role and a runs channel and set them; each needs a
permission the install link leaves out (Manage Roles, Manage Channels),
and the command answers with a link that adds it when the bot was
installed without (`app_permissions` on the interaction says).

Linking is Discord's word for who pressed. `/link` mints a six-letter
code bound to the Discord account in the signed request (row
`DISCORD#LINK#<code>`, ten minutes, gone when read) and shows it, to that
person alone, as an address in the app. Opened signed in, the app hands
the code to `POST /api/connections/discord`, which writes
`USER#<sub>/CONNECTION#discord` and the reverse `DISCORD#<id>/USER`.
Nothing of Discord's is kept but the user id and the name it showed; a
link replaces on both sides, `DELETE /api/connections/discord` removes it,
and deleting the account sweeps it.

A server is claimed the same way. `/setup claim`, by someone who can
manage the server (Discord's own permission bits, checked again here),
mints a code bound to the server (`DISCORD#CLAIM#<code>`); handed to
`POST /api/guilds/claim`, it makes the signed-in account the server's
owner (`GUILD#<id>/META`, pointer `USER#<sub>/GUILD#<id>`), replacing a
previous owner, three servers to an account. The owner pays for the
server's plan — the `server` feature, sold as "Runlog for servers"
through the same Stripe plumbing as Plus — and `/setup status` says
whether it is active where plans gate. `/setup role` and `/setup channel`
set who may host and where runs open.

The plan is **not on sale** until the stage says so. With `discord.open`
absent or `false` in the configuration, everyone sees the Servers page,
may claim a server and fill its vault, and sees the plan as coming;
`GET /api/me` says `servers` (there is a bot) and `serversOpen` (it is on
sale). Meanwhile the one way onto the plan is the WorkOS feature flag
named `server`, made in WorkOS per environment and set on the people
trying it: a flag named like a Stripe feature is that feature, the way a
`plus` flag comps Plus, so a flagged account is subscribed as far as the
API and the bot can tell. Setting `discord.open: true` and deploying
offers Checkout to everyone; the flag keeps meaning "comped".

The owner puts packs in the server's **vault** from their profile:
`PUT /api/guilds/{id}/packs/{packId}` takes the pack's text and a summary
the app computed (title, version, the modes by label), and keeps the
text at `guilds/<id>/packs/<packId>.<format>` in the bucket. This is the
one place the hosting holds a pack's text for something other than
handing it back to whoever sent it: the bot reads it to play, and
nobody, the owner included, is ever served it from here — the profile
and `/packs` list what is there, never the text, so a sealed pack's
words go no further than the drawn lines the bot will post. That is a
deliberate bend in the rule the rest of the API keeps, and it is confined
to the vault. Releasing a server, or deleting the account, empties the
vault.

A **run hosted in a server** is a session like any other, owned by the
host's account (a host is linked, so the run is somebody's), played by
the bot as the device at the table: `/run start` creates the session
with the same opening events the app writes, opens a public thread,
mints a live link, and posts and pins the **table card** —
`lib/handlers/discord/card.ts`, rebuilt from the log on every press. The
card follows the thread by default: a press that made a move answers by
turning the pressed message into the move's line and posts a fresh card
at the bottom (one call); a press that made none updates the card in
place (no call); everything else — a command, a timer, the app moving
the run — posts the line, retires the old card (down if it carried
nothing else, stripped to its content if it did, as the opening message
carries the live link) and posts a fresh one. `cardMessageId` and
`cardBare` on the run row say which message the buttons are on and how
to retire it. `/setup cards mode:pinned` keeps one card at the top,
edited in place, for servers that prefer it; the choice is copied onto
each run as it starts (`cardMode`). A press goes through `lib/handlers/discord/play.ts`:
the vault's pack (parsed once per container, by hash), the log folded,
the engine's `drive`/`answer` applied one action at a time, the events
appended under the host's account with ids minted the way the app mints
them, and then the same snapshot the app writes for a shared run and
the same bell rung, so the live link, the metrics route and every widget
work for a run nobody has open. A block that stops to ask (a choice, a
yes or no, a target) is kept on the guild-run row (`DISCORD#RUN#<id>`,
with `DISCORD#THREAD#<id>` pointing at it) as the engine's serializable
`Pending`, and answered on the next press. The bot always throws the
dice itself and the log says so; the pack's text never leaves
`play.ts`. Only the host presses, except to join or leave a moderated
run's roster. This is the one place the hosting reduces a pack, on
purpose, and it is confined to `lib/handlers/discord/`.

Linked roles are the one place the hosting speaks Discord's OAuth. A
server may make a role depend on what Runlog says about a member; the
setup script registers the two keys (`lib/handlers/discord/linked-roles.ts`),
and a verification writes the values: `POST /api/connections/discord/verify`
(signed in) stores a ten-minute state naming the account and answers
Discord's authorize address for `identify role_connections.write`; the
public `GET /api/discord/linked-role/callback` takes the state back,
trades the code for the person's own token with the client secret, asks
who they are, links the account to that Discord account if it was not,
and writes the connection through their token, never the bot's. Discord's
own "Verify" button lands on `GET /api/discord/linked-role`, which sends
the person into the app to begin signed in.

The plan gate (`serverPlanOf` in `interactions.ts`) is satisfied by the
claiming account's grant — bought through Stripe, or the `server` flag —
or, where `discord.serverSku` names a guild-subscription SKU sold through
Discord's own store, by a live entitlement on the server itself
(`guildEntitledFrom` in `rest.ts`, one call per press that needs the
plan). The Servers page marks a server held that way.

The host may also play a hosted run from the app. The run row keeps
`seenSeq`, the log's seq the thread has heard up to; the app's events
route, after appending to a run the bot hosts, hands `{ kind: "moved",
sessionId, seq }` to the job function, which posts one line per move
since `seenSeq` under "From the app", redraws the card, drops a block
that was waiting on a Discord answer (the log moved under it), marks the
run ended if the app ended it, and moves `seenSeq` up. A press from
Discord meanwhile is refused by `expectSeq` rather than built on a table
that moved; the next card is fresh.

A timer at a Discord table has nobody's browser ticking for it. When one
starts or resumes, the handler makes a one-shot **EventBridge Scheduler**
schedule for its deadline, in the stage's `runlog-<env>-timers` group,
that invokes the job function with the timer's name (`{ kind: "timer",
sessionId, clock, at }`); the job stops the timer as run out, at the
moment it ran out, says so in the thread and redraws the card, or makes
a later schedule if a pause moved the deadline. The schedule is named
for the run, the clock and the deadline, so the same deadline asked for
twice is one schedule, and it deletes itself once it has run. Without a
schedule (a copy without the group, or a schedule that never came), the
next press stops the timer first and lands after it. The handler is
told the job's ARN; the job reads its own from each invocation, since a
function's environment cannot name itself. The job keeps the name CDK
gave it: the dashboard stack imports that name, and CloudFormation
refuses to change an export another stack is using, which is what a
fixed name would do.

Discord waits three seconds for an interaction's answer. A press is one
read and one write and answers in its turn; a start is a session, a
thread, a card and a pin, and a cold start plus those may not fit. So
the handler answers "thinking" at once and sends the interaction as an
event to the **job function** (`DiscordJob`, the same bundle with the
`job` entry, thirty seconds, the handler's environment and grants),
which does the work and fills the reply in through the interaction's own
webhook. Everything that could refuse a start has already said so in the
handler's turn; only the work is deferred. A failure in the job leaves
the reply "thinking" until Discord gives up on it, which is the loud
kind of failure this wants.

Setting the bot up as the operator is `docs/discord-bot.md`; what
servers do with it is `docs/discord.md`.

## Monitoring

AWS-native by default, and always on. Both functions run with
`tracing: lambda.Tracing.ACTIVE`, so a request can be opened as an X-Ray
trace and read as time spent in DynamoDB, S3, Secrets Manager, Stripe and
WorkOS; the AWS SDK v3 clients each handler constructs are wrapped with
`captureAWSv3Client`, and the Stripe and WorkOS calls each run inside
their own subsegment (`hosted/infra/lib/handlers/xray.ts`), since both
SDKs speak through `fetch` rather than the `http`/`https` modules X-Ray
patches. A trace never carries a request body, a token or an email —
only the route and the method are annotated. The Lambda Insights layer
(`insightsVersion` on both functions) reports memory, CPU and cold starts
per invocation, no trace required to see them. Wrapping is a no-op
outside Lambda: `AWS_XRAY_DAEMON_ADDRESS` and `_X_AMZN_TRACE_ID` are both
things only the Lambda runtime sets, so `npm test` and the CLI never need
a daemon. An alarm on the `runlog-<env>-alarms` topic (see "Billing"
above) fires when the handler errors repeatedly.

### New Relic, optionally

With an `apm.newRelic` block naming a New Relic account (and the layer's
version for `NewRelicNodeJS24XARM64` in the region, 52 as of writing),
both functions also get New Relic's Lambda layer: the handler becomes the
layer's wrapper, which imports the real one and reports traces, errors
and the function's own logs to that account as well. The license key is a
fifth secret, `runlog/newrelic/license-key`, which the fill script writes
in the shape the extension reads, `{"LicenseKey": "..."}`. The agent is
told to keep request bodies, the authorization header, cookies and
addresses out of what it records, so what reaches New Relic is about the
service, not the people using it. Browser monitoring is deliberately not
part of this: it is a third-party script with a session identifier, and
it would bring a consent banner with it. Absent the block, nothing is
sent there.

```json
"apm": { "newRelic": { "accountId": "1234567", "layerVersion": 52 } }
```

### Dashboards and alarms

Every stage gets its own CloudWatch dashboard, `runlog-<env>` — People (views
by country, screen and version, from the beacon's embedded metric format),
the API (HTTP and WebSocket, requests, errors, latency), the handler
(invocations, errors, throttles, duration, its Lambda Insights memory
utilization and cold start duration, a look at recent errors in its log
group), the bot (Discord interactions by kind and their answer time
against Discord's three seconds, from the route's own embedded metrics;
the job function's invocations, errors, duration and cold start), the
store (DynamoDB, and the sync bucket's daily size and object count), the
edge (CloudFront requests, error rate, cache hit rate), and an alarm
status widget listing every alarm the stage owns. It lives in
`lib/observability-stack.ts`, a stack of its own built after the API and
site stacks so it can read from both without either reaching forward for
the other's resources.

Alongside the API handler's own error alarm, each stage's `Alarms` topic
carries a handful more: the API's 5xx rate, the handler's p95 duration
against its own timeout, the handler being throttled at all, DynamoDB being
throttled at all, CloudFront's 5xx rate, a Discord interaction that was
not answered (the handler threw, or the job could not fill the deferred
reply in), and the job function failing outright. All of them, old and new, ring
the same `runlog-<env>-alarms` topic — **subscribing an address to it is a
step this repository cannot take for you**; do it by hand, once per stage,
the same as the step already named under Billing.

## Environments, secrets and variables

Each stage's account and zone ids are secrets on its environments. Not
because they are secret, an account id is in every ARN, but so they stay
out of the logs, which anyone can read now, and out of a fork's reach;
they matter only to the copy run at this address, never to someone
building the app. The cost is that GitHub masks them, so an ARN in a diff
prints its account as `***`.

| In `cdk-diff-dev`, `deploy-dev`, `cdk-diff-prd`, `deploy-prd` | What it is |
| --- | --- |
| `AWS_ACCOUNT_ID` (secret) | The stage's account |
| `RUNLOG_ZONE_ID` (secret) | The Route 53 zone the stage's domain lives in |
| `WORKOS_CLIENT_ID` (variable) | The AuthKit client the stage's build signs in with; public by design, embedded in the app and in every sign-in URL |
| `RUNLOG_ENV_CONFIG` (variable) | The stage's configuration as one line of JSON: its domain and zone, sign-in clients, mail identity, plans and the words on its pages. `env/example.json` is the shape; on a machine the same document is `env/<stage>.json`, which git ignores |
| `RUNLOG_API_KEY` (secret, `deploy-*` only) | A command-line key for the platform publisher, for seeding the catalog |

And on the repository:

| Name | What it is |
| --- | --- |
| `NPM_CHANNEL` (variable) | `latest` or `next`: which dist-tag a release publishes under |
| `CODE_MGR_APP_ID` (variable), `CODE_MGR_APP_PRIVATE_KEY` (secret) | The org's GitHub App, which cuts releases; held by the organization |

