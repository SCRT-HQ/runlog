import type { ComponentType } from "react";
import Start from "./pages/start.mdx";
import Header from "./pages/header.mdx";
import Where from "./pages/where.mdx";
import Playing from "./pages/playing.mdx";
import Round from "./pages/round.mdx";
import Board from "./pages/board.mdx";
import Undo from "./pages/undo.mdx";
import Ending from "./pages/ending.mdx";
import Library from "./pages/library.mdx";
import Catalog from "./pages/catalog.mdx";
import PackFiles from "./pages/pack-files.mdx";
import Clocks from "./pages/clocks.mdx";
import Alerts from "./pages/alerts.mdx";
import Together from "./pages/together.mdx";
import Inviting from "./pages/inviting.mdx";
import Moderated from "./pages/moderated.mdx";
import LiveLink from "./pages/live-link.mdx";
import Races from "./pages/races.mdx";
import Streaming from "./pages/streaming.mdx";
import StreamAddress from "./pages/stream-address.mdx";
import Obs from "./pages/obs.mdx";
import Dock from "./pages/dock.mdx";
import StreamElements from "./pages/streamelements.mdx";
import StreamerBot from "./pages/streamer-bot.mdx";
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
import SellingCatalog from "./pages/selling-catalog.mdx";
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
  P("start", "Playing", "Getting started", "Getting started", "What Runlog is, and the first five minutes.", Start),
  P("header", "Playing", "Getting started", "The header", "The pack switcher, Rules, the Designer, the menu.", Header),
  P("where", "Playing", "Getting started", "Where the app runs", "Hosted, from a file, from GitHub Pages; what each has.", Where),
  P("playing", "Playing", "Playing a run", "Playing a run", "What a run is, and the setup screen.", Playing),
  P("round", "Playing", "Playing a run", "The round", "The margin, the step in hand, the kinds of step.", Round),
  P("board", "Playing", "Playing a run", "The board", "What you have made, the tallies, and correcting them.", Board),
  P("undo", "Playing", "Playing a run", "Undo and the log", "Nothing is erased; the run as it happened.", Undo),
  P("ending", "Playing", "Playing a run", "Ending a run", "The pack's own endings, and when they open.", Ending),
  P("library", "Playing", "Your packs", "Your library", "Every pack you have, with its runs beneath.", Library),
  P("catalog", "Playing", "Your packs", "The catalog", "Packs that ship, packs people published; what each needs.", Catalog),
  P("pack-files", "Playing", "Your packs", "Packs from a file", "Loading a pack, sealed or not, and keeping it in sync.", PackFiles),
  P("clocks", "Playing", "Clocks and alerts", "Clocks", "Stopwatches and timers, and what the log keeps of them.", Clocks),
  P("alerts", "Playing", "Clocks and alerts", "Alerts and sounds", "What rings, and with which sound.", Alerts),
  // With others
  P("together", "With others", "Playing together", "Playing together", "What signing in adds, and your runs on every device.", Together),
  P("inviting", "With others", "Playing together", "Inviting someone", "Players and watchers in your run; a friend to Runlog.", Inviting),
  P("moderated", "With others", "Playing together", "Moderated play", "One person at the app, a roster of names, points on a grid.", Moderated),
  P("live-link", "With others", "Playing together", "A live link", "An address anyone opens to watch, no account needed.", LiveLink),
  P("races", "With others", "Playing together", "Races across devices", "The same seeded mode, each on their own device, one leaderboard.", Races),
  P("streaming", "With others", "Streaming", "Streaming a run", "The widgets: one panel of the run each, on a page of its own.", Streaming),
  P("stream-address", "With others", "Streaming", "The address that works on a stream", "Why a browser source needs the live link's token, and how to copy it.", StreamAddress),
  P("obs", "With others", "Streaming", "OBS Studio and Streamlabs", "A browser source, field by field, with sizes and a line of CSS.", Obs),
  P("dock", "With others", "Streaming", "A dock for the controls", "The run's remote beside the preview in OBS.", Dock),
  P("streamelements", "With others", "Streaming", "StreamElements", "A custom widget that reads the run's numbers.", StreamElements),
  P("streamer-bot", "With others", "Streaming", "Streamer.bot, Aitum and Lumia", "A dice alert and a !score command.", StreamerBot),
  P("stream-tools", "With others", "Streaming", "For a chat bot or your own tool", "The numbers as JSON, and a socket that rings.", StreamTools),
  P("stream-troubles", "With others", "Streaming", "When a widget does not follow the run", "What each message means, and what to do.", StreamTroubles),
  P("discord", "With others", "Discord", "Runlog in Discord", "A bot that hosts runs in your server: claim it, fill its vault, press the card.", Discord),
  P("discord-setup", "With others", "Discord", "Setting a server up", "The install link, claiming, the vault, who hosts and where.", DiscordSetup),
  P("discord-linking", "With others", "Discord", "Linking your account", "/link, /unlink, and roles a server gives only to linked members.", DiscordLinking),
  P("discord-hosting", "With others", "Discord", "Hosting a run", "The thread, public or private, and the card's presses.", DiscordHosting),
  P("discord-together", "With others", "Discord", "Rosters, seats and the app", "Moderated runs, modes played by several, the same run from the app.", DiscordTogether),
  P("discord-watching", "With others", "Discord", "Watching", "The thread, the live link, and a stream.", DiscordWatching),
  P("discord-stored", "With others", "Discord", "What the bot stores", "The run, the server, the vault, and what of Discord's.", DiscordStored),
  // Making a pack
  P("design", "Making a pack", "The Designer", "Designing a pack", "Your own game for the engine, written in the browser.", Design),
  P("sections", "Making a pack", "The Designer", "The sections", "Words, tables, phases, modes, and what Problems catches.", Sections),
  P("signing", "Making a pack", "The Designer", "Signing and sealing", "Your name on a release; a copy sealed for one buyer.", Signing),
  P("documents", "Making a pack", null, "Documents", "Rulebook, quick start, reference card, run log sheet, summary.", Documents),
  P("cli", "Making a pack", "The command line", "The command line", "npx @scrthq/runlog: what it does, in one place.", Cli),
  P("cli-check", "Making a pack", "The command line", "Checking a pack", "validate, test, and a pack to start from.", CliCheck),
  P("cli-docs", "Making a pack", "The command line", "Writing the paper", "The documents from the terminal, and one bundled file.", CliDocs),
  P("cli-sign", "Making a pack", "The command line", "Signing and sealing copies", "keygen, claim, sign, and issue.", CliSign),
  P("cli-publish", "Making a pack", "The command line", "Publishing and releasing", "Into your library, or to the catalog at a price.", CliPublish),
  P("cli-ci", "Making a pack", "The command line", "From a build server", "The two variables, and a workflow to copy.", CliCi),
  P("cli-account", "Making a pack", "The command line", "Your account from the terminal", "login, whoami, logout, and a key for a machine with no browser.", CliAccount),
  P("cli-library", "Making a pack", "The command line", "Sealing from your own backend", "The package as a library: seal, open, a license key.", CliLibrary),
  P("selling", "Making a pack", "Selling", "Selling your packs", "Two ways, and who keeps the receipts.", Selling),
  P("selling-yourself", "Making a pack", "Selling", "From your own hands", "Sign, seal a copy, send it; nothing else involved.", SellingYourself),
  P("selling-catalog", "Making a pack", "Selling", "Through the catalog", "A card, a sale on your Stripe account, a ledger.", SellingCatalog),
  // Your account
  P("plans", "Your account", null, "Plans and pricing", "What is free, what a server adds, what running it yourself costs.", Plans),
  P("account", "Your account", "What is stored", "Your account and what is stored", "Everything on your device first; what leaves it, and when.", Account),
  P("stored", "Your account", "What is stored", "What the server holds", "With an account: runs, packs, keys, purchases, people, your name.", Stored),
  P("taking-back", "Your account", "What is stored", "Taking it back", "Export anything; delete the account.", TakingBack),
  // Running your own copy
  P("own-copy", "Running your own copy", null, "Running your own copy", "Three sizes of your own copy, and what each needs.", OwnCopy),
  P("serve", "Running your own copy", null, "On your machine", "The app on a local port, with nothing else installed.", Serve),
  P("static-host", "Running your own copy", null, "On a static host", "Any host that serves files, GitHub Pages step by step.", StaticHost),
  P("aws", "Running your own copy", "On AWS, with accounts", "On AWS, with accounts", "The hosted copy, run by you: what you need first.", Aws),
  P("aws-config", "Running your own copy", "On AWS, with accounts", "Saying what your copy is", "One JSON file per stage, and the pages that carry your name.", AwsConfig),
  P("aws-deploy", "Running your own copy", "On AWS, with accounts", "Deploying", "Bootstrap once, then three commands per release.", AwsDeploy),
  P("aws-after", "Running your own copy", "On AWS, with accounts", "After the first deploy", "The secrets to fill, and the catalog to seed.", AwsAfter),
  P("monitoring", "Running your own copy", "On AWS, with accounts", "Monitoring", "Traces, insights and an alarm inside your account; New Relic if you want it.", Monitoring),
  P("bot", "Running your own copy", "The Discord bot", "Setting the bot up", "One bot per copy, made by the operator: what you need.", Bot),
  P("bot-application", "Running your own copy", "The Discord bot", "The application and the stage", "The developer portal, the stage's file, the token.", BotApplication),
  P("bot-endpoint", "Running your own copy", "The Discord bot", "The endpoint, installation and the commands", "Point Discord at the API, set the install link, register, try it.", BotEndpoint),
  P("bot-store", "Running your own copy", "The Discord bot", "Selling the plan through Discord", "A guild subscription on the bot's store page.", BotStore),
  P("bot-linked-roles", "Running your own copy", "The Discord bot", "Linked roles", "The client secret, the verification URL, and the metadata.", BotLinkedRoles),
  P("bot-troubles", "Running your own copy", "The Discord bot", "When something is off", "What each message means, and where everything lives.", BotTroubles),
  // Reference
  P("reference", "Reference", null, "Reference", "The contracts, kept beside the code: the pack format, the stream API, selling from a backend.", Reference),
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
