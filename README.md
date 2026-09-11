<p align="center"><img src="apps/web/public/icon.svg" alt="" width="88"></p>
<h1 align="center">Runlog</h1>
<p align="center"><img src="apps/web/public/SCRTHQ-LOGOMARK-CIRCLE-COLOR.png" alt="" height="20"> by <a href="https://scrthq.com">Secret Headquarters</a></p>
<p align="center"><a href="https://www.npmjs.com/package/@scrthq/runlog"><img src="https://img.shields.io/npm/v/@scrthq/runlog?style=flat-square&logo=npm&label=%40scrthq%2Frunlog" alt="@scrthq/runlog on npm"></a> <a href="https://www.npmjs.com/package/@scrthq/runlog"><img src="https://img.shields.io/npm/dm/@scrthq/runlog?style=flat-square&label=downloads" alt="npm downloads a month"></a> <a href="https://socket.dev/npm/package/@scrthq/runlog"><img src="https://socket.dev/api/badge/npm/package/@scrthq/runlog" alt="Socket score"></a> <a href="https://github.com/SCRT-HQ/runlog/actions/workflows/CI-CD.yml"><img src="https://img.shields.io/github/actions/workflow/status/SCRT-HQ/runlog/CI-CD.yml?branch=main&style=flat-square&label=CI" alt="CI"></a> <a href="https://github.com/SCRT-HQ/runlog/releases/latest"><img src="https://img.shields.io/github/v/release/SCRT-HQ/runlog?style=flat-square&label=release" alt="Latest release"></a></p>
<p align="center"><a href="https://www.reddit.com/r/runlog_scrthq/"><img src="https://img.shields.io/reddit/subreddit-subscribers/runlog_scrthq?style=flat-square&logo=reddit&label=r%2Frunlog_scrthq" alt="r/runlog_scrthq"></a> <a href="https://discord.gg/ZwWeRCaV5J"><img src="https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord"></a></p>

An engine for dice-driven creative-practice games: the kind where you roll on
a table, take whatever constraint comes up, make something under it, and
occasionally suffer a result that reaches backwards and damages what you made
an hour ago. Games like that are usually played on paper, and the bookkeeping
is what breaks: backwards targeting, states that pile up, counters, deferred
rolls. None of that is the interesting part of the game, and all of it is
what a computer is for.

**Runlog is a referee and a run log, not a rulebook.** It does not know what
game you are playing. It reads a *pack* (a YAML or JSON file describing your
tables, states, counters, flow and modes) and becomes that game: every noun on
screen comes from your vocabulary, every step from your flow. Everything runs
in the browser, and nothing leaves your machine unless you sign in. It also
runs a stream: the next twist drawn where chat can see it, a scoreboard for a
roster taken from chat, and widgets on a scene as plain browser sources.

---

## Try it

```bash
npm install
npm run dev
```

The packs that ship with it are free, in the catalog; a few of them:

| Pack | Shape | What it exercises |
| --- | --- | --- |
| Any Given Day | a day of things to do; the pack a new device gets | weather that reaches back, a streak, energy, favors, a two-to-four-player mode |
| Homefront | housework as a dungeon crawl | the subject drawn from a table, patience as a resource, timed rooms |
| Practice Room | deliberate practice for any skill | timers as the spine, a required journal line, a run-end `bands` roll |
| Pantry Roulette | cooking under constraint | two draws per course, a cook-and-critic pair, forced extra courses |
| The Long Kiln | ceramics, dungeon-shaped | backwards targeting, decks, counters, co-op, seeded runs |
| Salt & Signal | solo journaling | `bands` resolution, progress tracks, free-text journal |
| Ladder Work | training log | no targeting at all, runs spanning days, timers |
| Rocket League: Mechanics Ladder | a challenge pack for a game | ladder, quick, endless and shared modes |
| Elden Ring: Expedition | a challenge pack for a game | draws that draw again, vows, up to ten players |
| Rocket League: Showdown | a moderated race | one person moderates, a roster races the drawn mechanics, points by rank |
| Elden Ring: Trial | a moderated race | curses that land on everyone with a cure drawn beside them, targets worth points |
| Forfeits | a penalty wheel for any stream | a counter with a threshold trigger, a move from outside the flow, states that lift when the round is left, moderated and seeded modes |

## Not a tabletop, not a wheel

Runlog has no map, no tokens and no character sheets. A virtual tabletop
is where a group of role-players meets, and it is good at that; a wheel is
a spin with no memory. Runlog carries the piece neither does: a game of
rounds and consequences that runs beside whatever you are already doing,
and remembers. The guide's [A stream run by dice](https://runlog.scrthq.com/guide/stream-why)
compares the three and puts a first stream in order.

## Write your own

```bash
npx @scrthq/runlog init my-game.yaml
npx @scrthq/runlog validate my-game.yaml --strict
npx @scrthq/runlog test my-game.yaml          # replays the fixtures your pack ships
```

- **[The authoring guide](docs/authoring.md)**: why you would reach for any of
  it, with a complete pack you can copy.
- **[The reference](docs/reference.md)**: every field, generated from the
  schema, so it cannot be wrong about what loads.

## Where it runs

| | |
| --- | --- |
| Hosted | https://runlog.scrthq.com, the copy Secret Headquarters runs, with accounts, sync, tables with company and the catalog |
| Anyone, no account | https://scrt-hq.github.io/runlog/, GitHub Pages, tracks `main`, no sign-in and no sync |
| Your own | The guide's [Running your own copy](https://runlog.scrthq.com/guide/own-copy): on your machine, on a static host, or on your own AWS |

## Where the rest is written

- **[docs/README.md](docs/README.md)**: the documents, indexed by who you are.
- **[The guide](https://runlog.scrthq.com/guide)**: playing, streaming,
  Discord and running a copy. It is in the app under Menu and needs no account.
- **[CONTRIBUTING.md](CONTRIBUTING.md)**: the shape of the code, and how a
  change lands.
- **[hosted/README.md](hosted/README.md)**: running a copy as a service.

## License

MIT, for everything in this repository: the engine, the schema, the app, the
command line and the docs. See [LICENSE](LICENSE). The packs you write with
it are yours, under whatever license their own `license` field says, and the
app honors that field; [the authoring guide](docs/authoring.md#licensing-and-packs-you-should-not-publish)
says how. The repository contains no particular game, by design;
[CONTRIBUTING.md](CONTRIBUTING.md#licensing-and-what-is-deliberately-absent)
says why.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Runs, packs and questions that
are not bugs go to [r/runlog_scrthq](https://www.reddit.com/r/runlog_scrthq/) or
[the Discord server](https://discord.gg/ZwWeRCaV5J).
