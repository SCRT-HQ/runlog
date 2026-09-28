import type { ComponentType } from "react";
import Start from "./pages/start.mdx";
import Header from "./pages/header.mdx";
import Themes from "./pages/themes.mdx";
import Where from "./pages/where.mdx";
import Playing from "./pages/playing.mdx";
import Round from "./pages/round.mdx";
import Board from "./pages/board.mdx";
import Undo from "./pages/undo.mdx";
import Ending from "./pages/ending.mdx";
import Library from "./pages/library.mdx";
import Marketplace from "./pages/marketplace.mdx";
import PackFiles from "./pages/pack-files.mdx";
import Clocks from "./pages/clocks.mdx";
import Alerts from "./pages/alerts.mdx";
import Together from "./pages/together.mdx";
import Inviting from "./pages/inviting.mdx";
import Seat from "./pages/seat.mdx";
import Moderated from "./pages/moderated.mdx";
import LiveLink from "./pages/live-link.mdx";
import Races from "./pages/races.mdx";
import StreamWhy from "./pages/stream-why.mdx";
import Streaming from "./pages/streaming.mdx";
import StreamAddress from "./pages/stream-address.mdx";
import Obs from "./pages/obs.mdx";
import Dock from "./pages/dock.mdx";
import StreamDeck from "./pages/stream-deck.mdx";
import StreamElements from "./pages/streamelements.mdx";
import StreamerBot from "./pages/streamer-bot.mdx";
import Control from "./pages/control.mdx";
import TikTok from "./pages/tiktok.mdx";
import Kick from "./pages/kick.mdx";
import StreamTools from "./pages/stream-tools.mdx";
import StreamTroubles from "./pages/stream-troubles.mdx";
import Discord from "./pages/discord.mdx";
import DiscordSetup from "./pages/discord-setup.mdx";
import DiscordLinking from "./pages/discord-linking.mdx";
import DiscordHosting from "./pages/discord-hosting.mdx";
import DiscordTogether from "./pages/discord-together.mdx";
import DiscordWatching from "./pages/discord-watching.mdx";
import DiscordStored from "./pages/discord-stored.mdx";
import Design from "./pages/design.mdx";
import Sections from "./pages/sections.mdx";
import Signing from "./pages/signing.mdx";
import Documents from "./pages/documents.mdx";
import Cli from "./pages/cli.mdx";
import CliCheck from "./pages/cli-check.mdx";
import CliDocs from "./pages/cli-docs.mdx";
import CliSign from "./pages/cli-sign.mdx";
import CliPublish from "./pages/cli-publish.mdx";
import CliCi from "./pages/cli-ci.mdx";
import CliAccount from "./pages/cli-account.mdx";
import CliLibrary from "./pages/cli-library.mdx";
import Selling from "./pages/selling.mdx";
import SellingYourself from "./pages/selling-yourself.mdx";
import SellingMarketplace from "./pages/selling-marketplace.mdx";
import Plans from "./pages/plans.mdx";
import Account from "./pages/account.mdx";
import Stored from "./pages/stored.mdx";
import TakingBack from "./pages/taking-back.mdx";
import OwnCopy from "./pages/own-copy.mdx";
import Serve from "./pages/serve.mdx";
import StaticHost from "./pages/static-host.mdx";
import Aws from "./pages/aws.mdx";
import AwsConfig from "./pages/aws-config.mdx";
import AwsDeploy from "./pages/aws-deploy.mdx";
import AwsAfter from "./pages/aws-after.mdx";
import Monitoring from "./pages/monitoring.mdx";
import Bot from "./pages/bot.mdx";
import BotApplication from "./pages/bot-application.mdx";
import BotEndpoint from "./pages/bot-endpoint.mdx";
import BotStore from "./pages/bot-store.mdx";
import BotLinkedRoles from "./pages/bot-linked-roles.mdx";
import BotTroubles from "./pages/bot-troubles.mdx";
import Reference from "./pages/reference.mdx";

/** A guide page: where it lives in the address bar, what it is called, and the MDX that is it. */
export interface GuidePage {
  slug: string;
  title: string;
  blurb: string;
  /** The part of the guide it sits in; the contents list groups by it. */
  part: GuidePart;
  /** A run of pages on one subject within the part, named in the contents; a page without one stands on its own in the part. */
  group?: string;
  Page: ComponentType<{ components?: Record<string, ComponentType<never>> }>;
}

/** The guide's parts, in reading order: what a player needs first, then what others see, then making, the account, a copy of your own, and the contracts. */
export const GUIDE_PARTS = ["Playing", "With others", "Making a pack", "Your account", "Running your own copy", "Reference"] as const;
export type GuidePart = (typeof GUIDE_PARTS)[number];

const P = (slug: string, part: GuidePart, group: string | null, title: string, blurb: string, Page: unknown): GuidePage => ({
  slug,
  part,
  ...(group ? { group } : {}),
  title,
  blurb,
  Page: Page as GuidePage["Page"],
});

/** In reading order, part by part, and within a part group by group. The first is the landing page. Each page is one subject, short enough to read at a sitting. */
export const GUIDE_PAGES: readonly GuidePage[] = [
  // Playing
  P("start", "Playing", "Getting started", "Getting started", "What Runlog does and how to start a run.", Start),
  P("header", "Playing", "Getting started", "The header", "Where to find packs, rules, the Designer, and the menu.", Header),
  P("themes", "Playing", "Getting started", "Themes", "Choose a theme and review its color vision support.", Themes),
  P("where", "Playing", "Getting started", "Where the app runs", "Compare the hosted, local, and GitHub Pages copies.", Where),
  P("playing", "Playing", "Playing a run", "Playing a run", "Define a run and choose its setup.", Playing),
  P("round", "Playing", "Playing a run", "The round", "Find your place in the round and complete each step.", Round),
  P("board", "Playing", "Playing a run", "The board", "View items and tallies, and correct their values.", Board),
  P("undo", "Playing", "Playing a run", "Undo and the log", "Undo a move and review the complete log.", Undo),
  P("ending", "Playing", "Playing a run", "Ending a run", "Choose an ending when its conditions are met.", Ending),
  P("library", "Playing", "Your packs", "Your library", "View your packs and their runs.", Library),
  P(
    "marketplace",
    "Playing",
    "Your packs",
    "The marketplace",
    "Find built-in and published packs and review their requirements.",
    Marketplace,
  ),
  P("pack-files", "Playing", "Your packs", "Packs from a file", "Load and sync pack files, including sealed copies.", PackFiles),
  P("clocks", "Playing", "Clocks and alerts", "Clocks", "Use stopwatches and timers and review clock events in the log.", Clocks),
  P("alerts", "Playing", "Clocks and alerts", "Alerts and sounds", "Choose which events play sounds.", Alerts),
  // With others
  P("together", "With others", "Playing together", "Playing together", "Sync runs and play with others after signing in.", Together),
  P("inviting", "With others", "Playing together", "Inviting someone", "Invite players, watchers, and new Runlog users.", Inviting),
  P("seat", "With others", "Playing together", "A seat at another table", "Play a pack you do not own through the owner's run.", Seat),
  P("moderated", "With others", "Playing together", "Moderated play", "Moderate a roster and award points.", Moderated),
  P("live-link", "With others", "Playing together", "A live link", "Share a run for anyone to watch without an account.", LiveLink),
  P(
    "races",
    "With others",
    "Playing together",
    "Races across devices",
    "Race on separate devices with the same seed and a shared leaderboard.",
    Races,
  ),
  P("stream-why", "With others", "Streaming", "A stream run by dice", "Add a run to a stream and compare its features.", StreamWhy),
  P("streaming", "With others", "Streaming", "Streaming a run", "Show run data through individual stream widgets.", Streaming),
  P(
    "stream-address",
    "With others",
    "Streaming",
    "The address that works on a stream",
    "Copy a live link token for a streaming browser source.",
    StreamAddress,
  ),
  P("obs", "With others", "Streaming", "OBS Studio and Streamlabs", "Set up a browser source with sizes and optional CSS.", Obs),
  P("dock", "With others", "Streaming", "A dock for the controls", "Control a run from an OBS dock.", Dock),
  P(
    "stream-deck",
    "With others",
    "Streaming",
    "A Stream Deck at the table",
    "Connect Stream Deck actions to runs, moves, undo, and metrics.",
    StreamDeck,
  ),
  P("streamelements", "With others", "Streaming", "StreamElements", "Build a custom widget from run metrics.", StreamElements),
  P("streamer-bot", "With others", "Streaming", "Streamer.bot, Aitum and Lumia", "Set up dice alerts and a !score command.", StreamerBot),
  P("tiktok", "With others", "Streaming", "TikTok Live", "Use a LIVE Studio or OBS widget and trigger a run from gifts.", TikTok),
  P("kick", "With others", "Streaming", "Kick", "Use OBS with a stream key and trigger a run from channel points.", Kick),
  P(
    "stream-tools",
    "With others",
    "Streaming",
    "For a chat bot or your own tool",
    "Read run metrics as JSON and receive WebSocket events.",
    StreamTools,
  ),
  P(
    "control",
    "With others",
    "Streaming",
    "Making a result happen in the game",
    "Use a game tool to apply and later reverse run results.",
    Control,
  ),
  P(
    "stream-troubles",
    "With others",
    "Streaming",
    "When a widget does not follow the run",
    "Troubleshoot widget messages.",
    StreamTroubles,
  ),
  P("discord", "With others", "Discord", "Runlog in Discord", "Claim a Discord server, add packs, and play runs through the bot.", Discord),
  P(
    "discord-setup",
    "With others",
    "Discord",
    "Setting a server up",
    "Install the bot, claim a server, and configure its packs and hosts.",
    DiscordSetup,
  ),
  P(
    "discord-linking",
    "With others",
    "Discord",
    "Linking your account",
    "/link, /unlink, and roles a server gives only to linked members.",
    DiscordLinking,
  ),
  P(
    "discord-hosting",
    "With others",
    "Discord",
    "Hosting a run",
    "Host runs in public or private threads and start watch parties.",
    DiscordHosting,
  ),
  P(
    "discord-together",
    "With others",
    "Discord",
    "Rosters, seats and the app",
    "Play moderated and group modes in Discord and the app.",
    DiscordTogether,
  ),
  P("discord-watching", "With others", "Discord", "Watching", "The thread, the live link, and a stream.", DiscordWatching),
  P(
    "discord-stored",
    "With others",
    "Discord",
    "What the bot stores",
    "Review the run, server, vault, and Discord data the bot stores.",
    DiscordStored,
  ),
  // Making a pack
  P("design", "Making a pack", "The Designer", "Designing a pack", "Create a pack in the browser.", Design),
  P("sections", "Making a pack", "The Designer", "The sections", "Overview, Tables, Flow, Modes, Test, and Publish.", Sections),
  P("signing", "Making a pack", "The Designer", "Signing and sealing", "Your name on a release; a copy sealed for one buyer.", Signing),
  P(
    "documents",
    "Making a pack",
    null,
    "Documents",
    "Generate a rulebook, quick start, reference card, run log sheet, and summary.",
    Documents,
  ),
  P("cli", "Making a pack", "The command line", "The command line", "Use the @scrthq/runlog CLI to check, publish, and serve packs.", Cli),
  P("cli-check", "Making a pack", "The command line", "Checking a pack", "validate, test, and a pack to start from.", CliCheck),
  P(
    "cli-docs",
    "Making a pack",
    "The command line",
    "Writing the paper",
    "Generate documents and a bundled pack from the terminal.",
    CliDocs,
  ),
  P("cli-sign", "Making a pack", "The command line", "Signing and sealing copies", "keygen, claim, sign, and issue.", CliSign),
  P(
    "cli-publish",
    "Making a pack",
    "The command line",
    "Publishing and releasing",
    "Into your library, or to the marketplace at a price.",
    CliPublish,
  ),
  P("cli-ci", "Making a pack", "The command line", "From a build server", "The two variables, and a workflow to copy.", CliCi),
  P(
    "cli-account",
    "Making a pack",
    "The command line",
    "Your account from the terminal",
    "login, whoami, logout, and a key for a machine with no browser.",
    CliAccount,
  ),
  P(
    "cli-library",
    "Making a pack",
    "The command line",
    "Sealing from your own backend",
    "The package as a library: seal, open, a license key.",
    CliLibrary,
  ),
  P("selling", "Making a pack", "Selling", "Selling your packs", "Compare direct sales with marketplace sales and their records.", Selling),
  P("selling-yourself", "Making a pack", "Selling", "From your own hands", "Sign and seal copies for direct sale.", SellingYourself),
  P(
    "selling-marketplace",
    "Making a pack",
    "Selling",
    "Through the marketplace",
    "List a pack, collect payments through Stripe, and review sales.",
    SellingMarketplace,
  ),
  // Your account
  P("plans", "Your account", null, "Plans and pricing", "Compare free features, paid services, and hosting costs.", Plans),
  P(
    "account",
    "Your account",
    "What is stored",
    "Your account and what is stored",
    "Review local storage and when data is sent to a server.",
    Account,
  ),
  P(
    "stored",
    "Your account",
    "What is stored",
    "What the server holds",
    "With an account: runs, packs, keys, purchases, people, your name.",
    Stored,
  ),
  P("taking-back", "Your account", "What is stored", "Taking it back", "Export your data or delete your account.", TakingBack),
  // Running your own copy
  P("own-copy", "Running your own copy", null, "Running your own copy", "Compare local, static, and AWS hosting options.", OwnCopy),
  P("serve", "Running your own copy", null, "On your machine", "The app on a local port, with nothing else installed.", Serve),
  P("static-host", "Running your own copy", null, "On a static host", "Any host that serves files, GitHub Pages step by step.", StaticHost),
  P(
    "aws",
    "Running your own copy",
    "On AWS, with accounts",
    "On AWS, with accounts",
    "Prepare to run a hosted copy in your AWS account.",
    Aws,
  ),
  P(
    "aws-config",
    "Running your own copy",
    "On AWS, with accounts",
    "Saying what your copy is",
    "Configure each stage and its hosted pages.",
    AwsConfig,
  ),
  P(
    "aws-deploy",
    "Running your own copy",
    "On AWS, with accounts",
    "Deploying",
    "Bootstrap once, then three commands per release.",
    AwsDeploy,
  ),
  P(
    "aws-after",
    "Running your own copy",
    "On AWS, with accounts",
    "After the first deploy",
    "Set secrets and seed marketplace listings after deployment.",
    AwsAfter,
  ),
  P(
    "monitoring",
    "Running your own copy",
    "On AWS, with accounts",
    "Monitoring",
    "Traces, insights and an alarm inside your account; New Relic if you want it.",
    Monitoring,
  ),
  P(
    "bot",
    "Running your own copy",
    "The Discord bot",
    "Setting the bot up",
    "Create and configure a Discord bot for your hosted copy.",
    Bot,
  ),
  P(
    "bot-application",
    "Running your own copy",
    "The Discord bot",
    "The application and the stage",
    "The developer portal, the stage's file, the token.",
    BotApplication,
  ),
  P(
    "bot-endpoint",
    "Running your own copy",
    "The Discord bot",
    "The endpoint, installation and the commands",
    "Point Discord at the API, set the install link, register, try it.",
    BotEndpoint,
  ),
  P(
    "bot-store",
    "Running your own copy",
    "The Discord bot",
    "Selling the plan through Discord",
    "A guild subscription on the bot's store page.",
    BotStore,
  ),
  P(
    "bot-linked-roles",
    "Running your own copy",
    "The Discord bot",
    "Linked roles",
    "The client secret, the verification URL, and the metadata.",
    BotLinkedRoles,
  ),
  P(
    "bot-troubles",
    "Running your own copy",
    "The Discord bot",
    "When something is off",
    "Troubleshoot bot messages and configuration.",
    BotTroubles,
  ),
  // Reference
  P("reference", "Reference", null, "Reference", "Read the pack format, stream API, and backend selling references.", Reference),
];

export function guidePage(slug: string): GuidePage | undefined {
  return GUIDE_PAGES.find((p) => p.slug === slug);
}

/** The slug in the address bar, if the page is the guide: `#guide`, `#guide/<slug>`, or `#guide/<slug>/<section>`. */
export function guideSlugFromHash(hash: string): string | null {
  const m = /^#guide(?:\/([a-z-]+)(?:\/([a-z0-9-]+))?)?$/.exec(hash);
  if (!m) return null;
  return m[1] ?? GUIDE_PAGES[0]!.slug;
}

/** The section the address names within a guide page, from `#guide/<slug>/<section>`; null when it names none. */
export function guideSectionFromHash(hash: string): string | null {
  const m = /^#guide\/[a-z-]+\/([a-z0-9-]+)$/.exec(hash);
  return m ? m[1]! : null;
}

/** The id a heading gets from its words, and the section part of its address: lowercase, letters and digits, hyphens between. */
export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}
