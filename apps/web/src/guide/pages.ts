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

/** A guide page: where it lives in the address bar, what it is called, and the MDX that is it. */
export interface GuidePage {
  slug: string;
  title: string;
  blurb: string;
  Page: ComponentType<{ components?: Record<string, ComponentType<never>> }>;
}

/** In reading order. The first is the landing page. */
export const GUIDE_PAGES: readonly GuidePage[] = [
  { slug: "start", title: "Getting started", blurb: "What Runlog is, and the first five minutes.", Page: Start as GuidePage["Page"] },
  { slug: "playing", title: "Playing a run", blurb: "Modes, units, rolls, the board, undo.", Page: Playing as GuidePage["Page"] },
  { slug: "library", title: "Your packs and the catalog", blurb: "Finding, adding and keeping packs.", Page: Library as GuidePage["Page"] },
  { slug: "clocks", title: "Clocks and alerts", blurb: "Stopwatches, timers, and what rings.", Page: Clocks as GuidePage["Page"] },
  { slug: "together", title: "Playing together", blurb: "Sync, invitations, watchers, moderated races.", Page: Together as GuidePage["Page"] },
  { slug: "streaming", title: "Streaming a run", blurb: "Pop-out widgets: the scoreboard, the clock, the race, on pages of their own.", Page: Streaming as GuidePage["Page"] },
  { slug: "design", title: "Designing a pack", blurb: "Your own game for the engine.", Page: Design as GuidePage["Page"] },
  { slug: "documents", title: "Documents and the command line", blurb: "Rulebooks, cards, sheets; npx @scrthq/runlog.", Page: Documents as GuidePage["Page"] },
  { slug: "plans", title: "Plans and pricing", blurb: "What is free, what a server adds, what running it yourself costs.", Page: Plans as GuidePage["Page"] },
  { slug: "selling", title: "Selling your packs", blurb: "From your own hands, or through the catalog; where the line is.", Page: Selling as GuidePage["Page"] },
  { slug: "account", title: "Your account and what is stored", blurb: "What leaves your device, when, and how to take it back.", Page: Account as GuidePage["Page"] },
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
