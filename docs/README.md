# The documentation, by who you are

Runlog has two kinds of writing. The **guide** is in the app, under Menu
or at `/play/guide` on the hosted address, for people playing, making,
and running a copy: it needs no account, and each page is one subject. The **documents here** are the contracts and the
walkthroughs that outlive a screen: what a pack file is, what an API
answers, how an operator sets something up. When a page in the guide
runs out of room, it links here.

## Playing, watching, streaming

| Read | When |
| --- | --- |
| The guide's [A stream run by dice](https://runlog.scrthq.com/play/guide/stream-why) | You stream, and want the dice to decide the next thing on screen. What Runlog does for a stream, what it needs, and how it compares with a tabletop or a wheel. |
| The guide's [Streaming a run](https://runlog.scrthq.com/play/guide/streaming) | You want a widget on your stream. Start here; the pages after it take OBS, Streamlabs, StreamElements, Streamer.bot, TikTok Live and Kick one at a time, field by field. |
| [stream-api.md](stream-api.md) | You are writing a plugin, a chat command or a second screen: the numbers, the bell, the gestures. |
| The guide's [Runlog in Discord](https://runlog.scrthq.com/play/guide/discord) | Runlog in a Discord server: adding the bot, claiming a server, hosting and watching runs, one page each; `discord.md` points there. |

## Writing packs

| Read | When |
| --- | --- |
| [authoring.md](authoring.md) | You are writing a pack. The idea, a complete example, every part and when you need it. |
| [reference.md](reference.md) | You need one field's exact shape. Generated from the schema; never edited by hand. |
| [testing-pack.md](testing-pack.md) | You want to know what the engine-testing pack exercises, or to write fixtures for your own. |

## Publishing and selling

| Read | When |
| --- | --- |
| [authoring.md § Licensing](authoring.md#licensing-and-packs-you-should-not-publish), [§ Signing](authoring.md#signing-and-what-it-does-not-do), [§ Selling copies](authoring.md#selling-copies) | Before a pack leaves your hands. |
| [selling.md](selling.md) | Selling sealed copies from your own backend, outside the catalog. |
| The guide's [Selling your packs](https://runlog.scrthq.com/play/guide/selling) and [Plans](https://runlog.scrthq.com/play/guide/plans) | The catalog, the ledger, and what each plan has. |

## Running a copy

| Read | When |
| --- | --- |
| The guide's [Running your own copy](https://runlog.scrthq.com/play/guide/own-copy) | On your machine, on a static host, or on your own AWS, one page each; `self-hosting.md` points there. |
| The guide's [Setting the bot up](https://runlog.scrthq.com/play/guide/bot) | Making the Discord bot as the operator: the developer portal, the stage, the token, the commands; `discord-bot.md` points there. |
| [../hosted/infra/README.md](../hosted/infra/README.md) | How the hosting is built and why: the API, billing, selling, races, live push, Discord, monitoring. |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | The shape of the code, the rules the tests enforce, and how a change lands. |

## Conventions

A document here is a contract someone outside the repository builds
against (`stream-api.md`, `reference.md`, the pack format in
`authoring.md`, the sealed container in `selling.md`). A walkthrough,
even one that names real fields in someone else's software, belongs in
the guide, one page per subject; the files that used to hold one point
there. Anything else belongs in a README beside the code it describes. Titles say what the reader is doing, not what the
thing is called; American English throughout; the demo pack, The Long
Kiln, is the example everywhere.
