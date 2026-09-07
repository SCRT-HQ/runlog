# Releasing a pack from GitHub Actions

Three workflows to copy into your pack repository's `.github/workflows/`.
Each assumes one pack file at the root, named in the `PACK` variable at the
top of the workflow; change that line and nothing else.

| Workflow | Runs when | Does |
| --- | --- | --- |
| `check.yml` | every push and pull request | `validate --strict` and `test`: the pack loads, its warnings are fixed, its fixtures pass |
| `self-publish.yml` | a GitHub release is published | signs the pack, writes its documents, attaches the signed pack, the bundle and the paper to the release |
| `catalog-release.yml` | a GitHub release is published | signs the pack and uploads it to the Runlog catalog as your publisher, listed at the price you set |

`self-publish` is for selling or giving away from your own hands: what it
attaches to the release is what you send people, or upload to your shop.
`catalog-release` is for the hosted catalog, where Runlog keeps the ledger
and seals a copy for each buyer. A repository can run both.

## The secrets

Set these under **Settings → Secrets and variables → Actions → Repository
secrets**. They are read as `${{ secrets.NAME }}` in the workflows and never
appear in your files or your logs.

| Secret | Value | How to get it |
| --- | --- | --- |
| `RUNLOG_API_KEY` | a command-line key for your Runlog account | In the app, open your profile, the **Command line** section, choose **Releases only**, then **Make a key**. Copy it when it is shown; it is not shown again. A key that only releases can check, sign, publish and release packs and nothing else, so a leaked build secret cannot reach your runs, sales or people. It stands in for signing in, since nobody is at the runner to confirm a code. |
| `RUNLOG_SIGNING_KEY` | the whole contents of your signing key file | `npx @scrthq/runlog keygen -o runlog-key.json` once, then `npx @scrthq/runlog claim runlog-key.json` signed in, so the app names you beside what the key signs. Paste the file's JSON as the secret's value, then keep the file somewhere safe and out of the repository. |

`catalog-release` also reads one **variable** (Settings → Secrets and
variables → Actions → Variables), `RUNLOG_PRICE`, in dollars, such as
`3.00`. Leave it unset to keep whatever the listing already has, or set it
to `free`.

To release to the dev catalog instead of production, add a variable
`RUNLOG_API` with `https://runlog.dev.scrthq.com/api` and a key made on
that address.

## The release itself

Tag the commit with the pack's version, `v1.2.0` for `version: 1.2.0`, and
publish a GitHub release from that tag. The workflows check that the tag and
the version agree, so a pack whose `version` was not bumped is refused
rather than released twice under one number.

Signing rewrites the pack file with its signature on the runner only; your
repository keeps the unsigned source, and every release signs it afresh.
