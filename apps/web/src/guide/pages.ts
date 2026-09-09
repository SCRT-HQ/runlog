import type { ComponentType } from "react";
import Start from "./pages/start.mdx";
import Playing from "./pages/playing.mdx";
import Library from "./pages/library.mdx";
import Clocks from "./pages/clocks.mdx";
import Together from "./pages/together.mdx";
import Inviting from "./pages/inviting.mdx";
import Moderated from "./pages/moderated.mdx";
import LiveLink from "./pages/live-link.mdx";
import Races from "./pages/races.mdx";
import StreamAddress from "./pages/stream-address.mdx";
import Obs from "./pages/obs.mdx";
import Dock from "./pages/dock.mdx";
import StreamElements from "./pages/streamelements.mdx";
import StreamerBot from "./pages/streamer-bot.mdx";
import StreamTools from "./pages/stream-tools.mdx";
import StreamTroubles from "./pages/stream-troubles.mdx";
import Design from "./pages/design.mdx";
import Documents from "./pages/documents.mdx";
import Plans from "./pages/plans.mdx";
import Account from "./pages/account.mdx";
import Selling from "./pages/selling.mdx";
import Streaming from "./pages/streaming.mdx";
import Discord from "./pages/discord.mdx";

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

/** The guide's parts, in reading order: what a player needs first, then what others see, then making, then the account. */
export const GUIDE_PARTS = ["Playing", "With others", "Making a pack", "Your account"] as const;
export type GuidePart = (typeof GUIDE_PARTS)[number];

/** In reading order, part by part. The first is the landing page. */
export const GUIDE_PAGES: readonly GuidePage[] = [
  { slug: "start", part: "Playing", title: "Getting started", blurb: "What Runlog is, and the first five minutes.", Page: Start as GuidePage["Page"] },
  { slug: "playing", part: "Playing", title: "Playing a run", blurb: "Modes, units, rolls, the board, undo.", Page: Playing as GuidePage["Page"] },
  { slug: "library", part: "Playing", title: "Your packs and the catalog", blurb: "Finding, adding and keeping packs.", Page: Library as GuidePage["Page"] },
  { slug: "clocks", part: "Playing", title: "Clocks and alerts", blurb: "Stopwatches, timers, and what rings.", Page: Clocks as GuidePage["Page"] },
  { slug: "together", part: "With others", group: "Playing together", title: "Playing together", blurb: "What signing in adds, and your runs on every device.", Page: Together as GuidePage["Page"] },
  { slug: "inviting", part: "With others", group: "Playing together", title: "Inviting someone", blurb: "Players and watchers in your run; a friend to Runlog.", Page: Inviting as GuidePage["Page"] },
  { slug: "moderated", part: "With others", group: "Playing together", title: "Moderated play", blurb: "One person at the app, a roster of names, points on a grid.", Page: Moderated as GuidePage["Page"] },
  { slug: "live-link", part: "With others", group: "Playing together", title: "A live link", blurb: "An address anyone opens to watch, no account needed.", Page: LiveLink as GuidePage["Page"] },
  { slug: "races", part: "With others", group: "Playing together", title: "Races across devices", blurb: "The same seeded mode, each on their own device, one leaderboard.", Page: Races as GuidePage["Page"] },
  { slug: "streaming", part: "With others", group: "Streaming", title: "Streaming a run", blurb: "The widgets: one panel of the run each, on a page of its own.", Page: Streaming as GuidePage["Page"] },
  { slug: "stream-address", part: "With others", group: "Streaming", title: "The address that works on a stream", blurb: "Why a browser source needs the live link's token, and how to copy it.", Page: StreamAddress as GuidePage["Page"] },
  { slug: "obs", part: "With others", group: "Streaming", title: "OBS Studio and Streamlabs", blurb: "A browser source, field by field, with sizes and a line of CSS.", Page: Obs as GuidePage["Page"] },
  { slug: "dock", part: "With others", group: "Streaming", title: "A dock for the controls", blurb: "The run's remote beside the preview in OBS.", Page: Dock as GuidePage["Page"] },
  { slug: "streamelements", part: "With others", group: "Streaming", title: "StreamElements", blurb: "A custom widget that reads the run's numbers.", Page: StreamElements as GuidePage["Page"] },
  { slug: "streamer-bot", part: "With others", group: "Streaming", title: "Streamer.bot, Aitum and Lumia", blurb: "A dice alert and a !score command.", Page: StreamerBot as GuidePage["Page"] },
  { slug: "stream-tools", part: "With others", group: "Streaming", title: "For a chat bot or your own tool", blurb: "The numbers as JSON, and a socket that rings.", Page: StreamTools as GuidePage["Page"] },
  { slug: "stream-troubles", part: "With others", group: "Streaming", title: "When a widget does not follow the run", blurb: "What each message means, and what to do.", Page: StreamTroubles as GuidePage["Page"] },
  { slug: "discord", part: "With others", title: "Runlog in Discord", blurb: "A bot that hosts runs in your server: claim it, fill its vault, press the card.", Page: Discord as GuidePage["Page"] },
  { slug: "design", part: "Making a pack", title: "Designing a pack", blurb: "Your own game for the engine.", Page: Design as GuidePage["Page"] },
  { slug: "documents", part: "Making a pack", title: "Documents and the command line", blurb: "Rulebooks, cards, sheets; npx @scrthq/runlog.", Page: Documents as GuidePage["Page"] },
  { slug: "selling", part: "Making a pack", title: "Selling your packs", blurb: "From your own hands, or through the catalog; where the line is.", Page: Selling as GuidePage["Page"] },
  { slug: "plans", part: "Your account", title: "Plans and pricing", blurb: "What is free, what a server adds, what running it yourself costs.", Page: Plans as GuidePage["Page"] },
  { slug: "account", part: "Your account", title: "Your account and what is stored", blurb: "What leaves your device, when, and how to take it back.", Page: Account as GuidePage["Page"] },
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
