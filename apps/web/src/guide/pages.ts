import type { ComponentType } from "react";
import Start from "./pages/start.mdx";
import Playing from "./pages/playing.mdx";
import Library from "./pages/library.mdx";
import Clocks from "./pages/clocks.mdx";
import Together from "./pages/together.mdx";
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
  { slug: "together", part: "With others", title: "Playing together", blurb: "Sync, invitations, watchers, moderated races.", Page: Together as GuidePage["Page"] },
  { slug: "streaming", part: "With others", title: "Streaming a run", blurb: "Widgets as browser sources and docks in OBS and Streamlabs, and the numbers for a chat bot.", Page: Streaming as GuidePage["Page"] },
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

/** The slug in the address bar, if the page is the guide. */
export function guideSlugFromHash(hash: string): string | null {
  const m = /^#guide(?:\/([a-z-]+))?$/.exec(hash);
  if (!m) return null;
  return m[1] ?? GUIDE_PAGES[0]!.slug;
}
