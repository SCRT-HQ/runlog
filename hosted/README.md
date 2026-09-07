# hosted

Everything that exists only because one copy of Runlog is run as a
service. Nothing in here is needed to build, run, or ship the app: a
clone with this directory deleted still builds the web app, the packages
and the command line, and everything they do works from a file on disk,
from `npx @scrthq/runlog serve`, or from any static host.

| Path | What it is |
| --- | --- |
| `infra/` | The AWS hosting as a CDK app: the API (Lambda, DynamoDB, S3, a WebSocket), the site (S3, CloudFront, a certificate, DNS), and the handlers behind `/api`. A workspace of its own, `@runlog/infra`, with its own tests. |
| `pages/` | The pages laid over the built app at the hosted address: terms, privacy, the publisher agreement, pricing, about, `hosted.json`, robots and the sitemap. Templates with `{{WORDS}}` filled in per environment. |
| `scripts/` | The operator's tools: `overlay.ts` lays the pages over a build; `stripe-setup.ts` makes the products and prices; `Set-RunlogSecret.ps1` fills a secret without the value ever passing through a shell history. |

## The line

The app is written to run without any of this. It finds `hosted.json` at
its own root and, when the file is there, shows a footer, asks people
signed in to accept the terms, and offers accounts, sync, tables with
company and the catalog through `/api` on the same origin. Where the file
is not there, none of that is offered. The code in the app that reads the
file lives in `apps/web/src/hosted/`; the code that talks to `/api` lives
where the feature does (`sync/`, `auth/`, `live/`, `profile/`) and stays
quiet without an API to talk to.

So: a change under `hosted/` is a change to the service. A change under
`apps/`, `packages/` or `packs/` is a change to Runlog, which everyone
gets.

## Running it yourself

[`docs/self-hosting.md`](../docs/self-hosting.md) takes this directory to
your own AWS account over the published package, so you deploy a release
of the app rather than a fork of it: the overlay lays the pages over the
package's `app/`, stamps the shell with your sign-in client, and the site
stack publishes the result.

## Deploying

The pipeline in `.github/workflows/CI-CD.yml` builds the app, lays the
pages over it, and runs `cdk deploy` from `hosted/infra` with the build
handed to the site stack, which publishes it and invalidates the edge.
A staging copy on every merge; the hosted copy from a published release.
`infra/README.md` has the accounts, the roles and what the stacks create.
