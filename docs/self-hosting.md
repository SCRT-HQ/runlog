# Running your own copy

Runlog is a static app. Every part of it that plays a game runs in the
browser, from a file on disk if need be, and nothing leaves the device
unless someone signs in. So there are three sizes of "your own copy", and
the first two need nothing built and nothing from AWS.

| You want | Take |
| --- | --- |
| The app on your machine, offline | `npx @scrthq/runlog serve` |
| The app at an address you control, no accounts | the `app/` directory of the npm package, on any static host |
| Accounts, sync, tables with company, the catalog, at your address | the `hosted/` directory of this repository, deployed to your AWS account over the npm package |

None of them asks you to fork the repository. The published package
`@scrthq/runlog` carries the built app beside the command line, and the
hosting is written to lay its pages over a build it did not make.

## On your machine

```bash
npx @scrthq/runlog serve --open
```

That is the whole of it: the package's built app on a local port, with
the packs that ship, the Designer, the paper, everything. Nothing is
installed beyond the package, and a newer package is a newer app on the
next reload. `--port 3535` picks the port.

## On a static host

The npm package ships the built app as a directory. Get it:

```bash
npm pack @scrthq/runlog
tar -xzf scrthq-runlog-*.tgz
ls package/app
```

`package/app` is what you serve: `index.html`, the worker, the manifest,
and `assets/` with content-hashed names. Every path in it is relative, so
it serves from a domain's root or from a sub-path alike. Three things a
host needs to know:

1. **The app's page answers for paths that are not files.** The bare
   address is the welcome page, the app is at `/play`, and a deep link (a
   live link, a guide page) is a path under it. Serve `index.html` for any
   path that is not a file:
   - nginx: `try_files $uri $uri/ /index.html;`
   - Netlify, Cloudflare Pages: a `_redirects` file with `/* /index.html 200`
   - S3 behind CloudFront: a custom error response turning 403 and 404 into `/index.html` with status 200
   - GitHub Pages: copy `index.html` to `404.html`
2. **Cache `assets/` forever and nothing else.** A name under `assets/`
   means one file, so `Cache-Control: public, max-age=31536000, immutable`
   there; `no-cache, must-revalidate` for `index.html`, `sw.js` and
   `manifest.webmanifest`, or a new release reaches nobody.
3. **Serve over HTTPS** if you want the service worker and offline use;
   browsers allow both on `localhost` only otherwise.

A copy served this way is the plain app: no footer, no sign-in, no sync,
no catalog beyond the packs that ship. Everything else works, including
sealed copies and license keys, which are opened on the device.

To build the app yourself instead, from a clone: `npm ci && npm run build`,
and `apps/web/dist` is the same directory.

## On AWS, with accounts

This is the copy at runlog.scrthq.com, run by you. The hosting lives in
[`hosted/`](../hosted/README.md): a CDK app for the API (a Lambda, a
DynamoDB table, an S3 bucket, a WebSocket) and the site (S3, CloudFront, a
certificate, DNS), the pages that make an address a service, and the
scripts that lay them over a build. It takes the published package as the
build, so you deploy a release of the app, not a fork of it.

### What you need first

- An AWS account, with a Route 53 hosted zone for the domain the copy will
  answer on. The stacks deploy to `us-east-1`; CloudFront accepts a
  certificate from nowhere else.
- A [WorkOS](https://workos.com) project with AuthKit enabled: one client,
  with `https://<your domain>/` as a redirect URI and as the sign-out URI.
  Its client id is public and goes in the configuration. The command line
  signs in through a second client of the same project; use the same id
  for both if you do not need that.
- An identity verified in SES, for invitation mail. A new account's SES is
  sandboxed, which means mail reaches verified addresses only; sending to
  anyone is a request to AWS.
- Node 22, and the AWS CLI signed in to the account.

Stripe is optional. Without it, plans are off, nothing is charged, and
selling priced copies through the catalog is not offered; free listings
and sealed copies sold from a publisher's own hands work regardless.

### Take the hosting

Only the `hosted/` directory and one script beside it:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/SCRT-HQ/runlog runlog-hosting
cd runlog-hosting
git sparse-checkout set hosted scripts
cd hosted/infra && npm install && cd ../..
```

### Say what your copy is

A stage is described by one JSON file, which git ignores: copy
`hosted/infra/env/example.json` to `hosted/infra/env/prd.json` and make
it yours (`prd` is the stage name the commands below use; any short
lowercase word works, and it names the stacks):

| Field | Yours |
| --- | --- |
| `domain`, `zone`, `zoneId` | The address, its hosted zone, and the zone's id |
| `workosClientId`, `workosCliClientId` | The AuthKit client ids |
| `email.from`, `email.identity`, `email.region` | The SES identity mail goes out as, and where it is verified |
| `hosted.operator`, `hosted.operatorShort`, `hosted.support` | Your name as it appears on the pages, and your support address |
| `hosted.operatorUrl` | Your own site, where your name in every footer links; leave it out and the name goes to the about page |
| `hosted.termsVersion`, `hosted.termsDate` | The day your terms take effect |
| `gates`, `hosted.billing`, `stripe.prices` | `false`, `false`, and empty strings, until you set Stripe up |
| `retain` | `true` keeps the table and the buckets if the stack is ever deleted |

The account id is not in the file. It comes from `RUNLOG_TARGET_ACCOUNT`
at deploy time, so the file never ties the copy to one account. The same
document, as one line of JSON, is what a pipeline hands the stack in the
`RUNLOG_ENV_CONFIG` variable.

The pages in `hosted/pages/` are the terms, the privacy policy, the
publisher agreement, pricing and about, written for one operator with the
name and the dates left as placeholders. They are a starting point, not
counsel: read them as yours before they go out, and change what does not
describe your copy. The terms name Texas law and Texas courts, and the
privacy policy says data lives in the United States; both are ours to
say, not yours.

### Deploy

Once per account, CDK's bootstrap:

```bash
cd hosted/infra
AWS_ENVIRONMENT=prd RUNLOG_TARGET_ACCOUNT=123456789012 npx cdk bootstrap aws://123456789012/us-east-1
```

Then a release. Fetch the package, lay the pages over its app, and deploy
the stacks with the result:

```bash
npm pack @scrthq/runlog --pack-destination /tmp && tar -xzf /tmp/scrthq-runlog-*.tgz -C /tmp
npx tsx ../scripts/overlay.ts --dist /tmp/package/app --app /tmp/package --env prd --sha "$(node -p "require('/tmp/package/package.json').version")"
AWS_ENVIRONMENT=prd RUNLOG_TARGET_ACCOUNT=123456789012 RUNLOG_APP_DIST=/tmp/package/app npx cdk deploy --all
```

The overlay writes `hosted.json`, the pages, the third-party notice from
the package's `licenses.json`, and stamps the shell with your sign-in
client, which is how a build that was built with none signs in at your
address. The site stack publishes the directory: the hashed assets with a
year's cache, the shell and the pages with none, and an invalidation.
`cdk diff --all` with the same variables shows what a deploy would do.

A new release is the same three commands with the new package.

### Monitoring

On by default, and entirely inside your AWS account. Both functions run
with active X-Ray tracing, so a slow or failing request can be opened as a
trace and read as time spent in DynamoDB, S3, Secrets Manager, Stripe or
WorkOS, and the Lambda Insights layer reports memory, CPU and cold starts
for every invocation. An alarm on the stage's own SNS topic fires when the
handler errors repeatedly; subscribe an address to it by hand, since the
address is not this repository's to commit. None of it is a service to
sign up for or a secret to fill — it costs only what CloudWatch and X-Ray
charge for what you actually run.

### New Relic, optionally

If you would rather have a cross-service trace and an error inbox outside
AWS, add `"apm": { "newRelic": { "accountId": "<your account>", "layerVersion": 52 } }`
to the stage's file, deploy, and fill `newrelic/license-key` with the
script (it wraps the key the way New Relic's extension reads it). Both
functions then report traces, errors and their logs to that account as
well, with bodies, tokens and addresses kept out. Leave the block out and
nothing is sent there.

### After the first deploy

The API's secrets are created as placeholders, and a feature whose secret
is a placeholder stays off. Fill the ones you use, signed in to the
account:

```bash
aws secretsmanager put-secret-value --secret-id runlog/workos/api-key --secret-string "$(cat)"
```

`workos/api-key` is needed for publisher organizations and their members.
Sign-in and sync need no secret at all: the API verifies tokens against
the client ids in the configuration. `stripe/secret-key`,
`stripe/webhook-secret` and `stripe/connect-webhook-secret` are for plans
and selling; `hosted/infra/README.md` walks through Stripe when you get
there.

The catalog is empty until the packs that ship are listed in it. Make a
publisher for your platform from the app's profile, make a command-line key
on it, and from a clone of this repository run `RUNLOG_API=https://<your
domain>/api RUNLOG_API_KEY=<the key> npm run seed:listings`. Without it the
app shows the bundled packs from the build, which is the same list.

### A pipeline, if you want one

`.github/workflows/CI-CD.yml` and `deploy-production.yml` are the pipeline
this repository runs: tests and diffs on a pull request, a staging copy on
a merge, the hosted copy from a release. They build the app from the repository rather
than taking the package, and they expect the environments and secrets that
`hosted/infra/README.md` lists, and a `GitHubActionRole` in each account
that trusts the repository through OIDC. Copy them if that is the shape
you want; the three commands above are the whole of what they do.
