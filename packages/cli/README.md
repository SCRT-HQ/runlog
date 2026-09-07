# @scrthq/runlog

The command line for [Runlog](https://runlog.scrthq.com) rule packs, and the
app itself.

Runlog plays *rule packs*: a game's tables, flow, modes and rules in one
YAML file, which the app turns into a run you can play, share, time and
document. This package gives a designer the tools around that file:

- **check** a pack and replay its own fixtures, in CI or by hand;
- **write its paper**: rulebook, quick start, reference card, run log sheet
  and catalog summary, as HTML and Markdown;
- **sign** releases and **seal** copies for buyers, so a pack carries its
  author's name and a sold copy opens with a license key;
- **publish** to your own library or **release** to the catalog, from a
  terminal or a build server;
- **serve** the app from your own machine, offline, with nothing else
  installed.

The same package is a small library for a seller's own backend: `seal`,
`open`, `readHeader`, `isSealed` and `generateLicenseKey`. The command
depends on `yaml` and `zod`, declared as such; the library entry point
pulls in nothing.

```bash
npx @scrthq/runlog help
```

Node 20 or later. Every command takes a `.yaml` or `.json` pack.

## Checking a pack

```bash
npx @scrthq/runlog validate my-game.yaml            # shape and coherence
npx @scrthq/runlog validate my-game.yaml --strict   # warnings fail too: what CI wants
npx @scrthq/runlog test my-game.yaml                # replay the pack's fixtures
npx @scrthq/runlog validate packs/*.yaml --strict   # several at once
```

`validate` reads the pack, checks it against the format, and lints what a
schema cannot see: a d100 table whose ranges leave a gap, a state nothing
applies, a trigger on a moment the run never reaches. Errors exit 1;
with `--strict`, so do warnings. `test` runs the fixtures a pack declares
for its own tables, so a change that breaks a promised outcome fails
before anyone plays it.

## Starting one

```bash
npx @scrthq/runlog init my-game        # a small pack to grow from, in my-game.yaml
```

The authoring guide in the repository walks through the format; the file
carries a `$schema` line so an editor that reads JSON Schema completes
and checks it as you type.

## Writing the paper

```bash
npx @scrthq/runlog docs my-game.yaml -o dist/docs
npx @scrthq/runlog docs my-game.yaml -o dist/docs --only rulebook,reference
npx @scrthq/runlog docs my-game.yaml -o dist/docs --md      # Markdown only; --html for HTML only
```

Five documents come out of the pack as it is, so they are never behind
the rules: the **rulebook** (everything, in reading order), the **quick
start**, the **reference card** (dense columns for the table), the **run
log sheet** (a form to write a run on by hand), and the **summary** a
catalog shows. Each as HTML, which a browser prints to a PDF with the
page breaks and columns already right, and as Markdown for editing or
pasting. The app's Designer makes PDFs directly.

## Bundling

```bash
npx @scrthq/runlog bundle my-game.yaml -o dist/my-game.pack.json
```

One normalized JSON file, the convenient thing to attach to a release.
YAML stays the better thing to author and keep under version control.

## Signing, and sealing copies for buyers

Signing puts your name on a release: an altered copy can no longer claim
to be yours, and the app says so when it opens one. Sealing wraps a
signed copy for one buyer behind a license key.

```bash
npx @scrthq/runlog keygen -o my-key.json                  # once, ever; keep it private and backed up
npx @scrthq/runlog login                                  # a code to confirm in your browser
npx @scrthq/runlog claim my-key.json                      # ties the key to your account; the app names you
npx @scrthq/runlog sign my-game.yaml --key my-key.json --as "Your Name"
```

`sign` rewrites the pack file with its signature (comments are dropped;
sign a copy if you keep them). `keygen` prints a fingerprint: publish it
wherever you publish, since it is the only thing that ties a signature
to *you*. `sign` and `issue` refuse a key nobody has claimed.

For each buyer, from your own shop or by hand:

```bash
npx @scrthq/runlog issue my-game.yaml --to "Buyer Name" --ref order-8f3a --key my-key.json --seal
```

That writes `my-game-buyer-name.rlpack` and prints a license key, once.
Send both. The buyer loads the file with **Load a pack from a file** and
types the key; signed in, the key is kept in their account, so the same
file opens on their other devices. `--license` supplies a key of your
own instead; `-o` names the file. Without `--seal` the copy is a plain
signed pack stamped with the buyer's name.

Signing does not stop copying, and nothing can: the app has to read
every word to play. What it protects is your name on the thing.

## Publishing

Two destinations, one account.

```bash
npx @scrthq/runlog publish my-game.yaml                   # into your own library, on every device you sign in on
npx @scrthq/runlog release my-game.yaml --price 3.00      # to the catalog, as your publisher, listed at $3
npx @scrthq/runlog release my-game.yaml --free            # listed free
npx @scrthq/runlog release my-game.yaml                   # a new version; the listing keeps its price
npx @scrthq/runlog release my-game.yaml --draft           # uploaded, not listed
```

`release` refuses an unsigned pack, or one whose signature no longer
matches its text, since the catalog seals a copy for each buyer under
what you signed. Becoming a publisher, and setting up payouts, happens on
your profile in the app; a priced listing needs payouts finished.

### From a build server

Nobody is at a build server to confirm a sign-in code, so two things go
in the environment instead:

| Variable | What it is |
| --- | --- |
| `RUNLOG_API_KEY` | a command-line key from your profile page in the app; stands in for `login`. Make it a key that *only releases*: it can check, sign, publish and release packs and nothing else, so a leaked build secret cannot reach your runs, sales or people |
| `RUNLOG_SIGNING_KEY` | the whole contents of the `my-key.json` that `keygen` wrote; stands in for `--key` |
| `RUNLOG_API` | optional: the dev address, `https://runlog.dev.scrthq.com/api`, with a key made there |

```yaml
# .github/workflows/release.yml — a GitHub release is published: check, sign, release
on:
  release:
    types: [published]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx @scrthq/runlog validate my-game.yaml --strict
      - run: npx @scrthq/runlog test my-game.yaml
      - run: npx @scrthq/runlog sign my-game.yaml
        env:
          RUNLOG_API_KEY: ${{ secrets.RUNLOG_API_KEY }}
          RUNLOG_SIGNING_KEY: ${{ secrets.RUNLOG_SIGNING_KEY }}
      - run: npx @scrthq/runlog release my-game.yaml --price 3.00
        env:
          RUNLOG_API_KEY: ${{ secrets.RUNLOG_API_KEY }}
```

The repository's `examples/github-actions` has this and two more
workflows to copy, with a README on setting the secrets: one that checks
every push, and one that signs a release and attaches the pack and its
paper to it for selling from your own hands.

## Running the app from your machine

```bash
npx @scrthq/runlog serve                     # http://127.0.0.1:3535/
npx @scrthq/runlog serve --port 8080 --open  # another port; open the browser
npx @scrthq/runlog serve --host 0.0.0.0      # the rest of the network too
```

The package carries the app, so this puts Runlog on a local port with
nothing else installed: for a table with no internet, a designer's own
copy, or a machine where the hosted address is not wanted. Packs and runs
live in that browser, as they do anywhere. Sign-in and sync belong to the
hosted address; the served copy has neither. `--dir` points at another
build of the app; `RUNLOG_APP_DIR` does the same from the environment.

## Your account from the terminal

```bash
npx @scrthq/runlog login              # a short code, confirmed in the browser it opens
npx @scrthq/runlog login --api https://runlog.dev.scrthq.com/api
npx @scrthq/runlog login --key        # paste a key from your profile page: a machine with no browser
npx @scrthq/runlog whoami
npx @scrthq/runlog logout
```

The sign-in renews itself while it is used and lapses after a month
idle. It lives in your user configuration directory, readable by you
alone. `NO_COLOR` in the environment turns the color off.

## The library

```bash
npm install @scrthq/runlog
```

```js
import { seal, open, readHeader, isSealed, generateLicenseKey } from "@scrthq/runlog";

// `pack` is your signed pack, parsed from YAML or JSON into an object.
const key = generateLicenseKey();
const bytes = await seal(pack, key, { ref: order.id, title: pack.title });
await email(buyer, {
  attachment: { name: `${pack.id}.rlpack`, bytes },
  text: `Your license key is ${key}. Open the file in Runlog and type it once.`,
});

// Later, or elsewhere:
readHeader(bytes);            // { v: 1, ref, title, ... } without a key
const result = await open(bytes, key);
if (result.ok) result.document; // the pack, as sealed
```

Runs on Node 20 and later and in browsers; this entry point uses none of
the package's dependencies. A sealed
file made here opens in the app on any address with the key you issued,
and nothing is checked online. The container's byte layout is documented
in the repository's `docs/selling.md`.

## More

The authoring guide, the format reference, the selling notes and the
example workflows live in the repository:
[github.com/SCRT-HQ/runlog](https://github.com/SCRT-HQ/runlog). The app
is at [runlog.scrthq.com](https://runlog.scrthq.com), with its own guide
under Docs.
