# @runlog/container

This package handles sealed copies: `seal`, `open`, `readHeader`, `isSealed`, `generateLicenseKey`. It is a workspace package with no dependencies, so it runs wherever Web Crypto does.

It is published as part of `@scrthq/runlog`, whose library entry point is this package: `import { seal } from "@scrthq/runlog"`. The format is written up in [docs/selling.md](../../docs/selling.md).
