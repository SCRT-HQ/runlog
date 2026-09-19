import { docsFromHash, type DocsAt } from "./docs/DocDrawer.tsx";
import type { DocKind } from "@runlog/rules-schema";
import { dockFromHash, type DockRoute } from "./dock/route.ts";
import { guideSectionFromHash, guideSlugFromHash } from "./guide/pages.ts";
import { linkFromHash, type LinkRoute } from "./connections/route.ts";
import { liveFromHash, type LiveRoute } from "./live/route.ts";
import { profilePageFromHash, type ProfilePage } from "./profile/route.ts";
import { addressOf, createSectionFromHash, runFromAddress, seatFromAddress } from "./route.ts";
import { widgetFromHash, type WidgetRoute } from "./widget/route.ts";

/** The app's sections: which one is on screen at any moment. */
export type View = "play" | "design" | "profile" | "library" | "marketplace" | "guide" | "themes";

/**
 * What an address says the app is showing.
 *
 * The app used to answer this in an effect, which meant the first commit
 * always believed it was the run and the address was corrected afterwards.
 * The run view writes its own address (`addressForPlay`), so that one
 * commit was enough to lose a deep link: the right view drew and the bar
 * said `#packs`, and the next reload really did land on the shelf. Reading
 * the address is a pure function of the address, so the answer is taken
 * before the first render and the effect applies the same answer again on
 * every later change.
 *
 * The four routes that are read off every address are always present. The
 * rest are what this address decided; absent means it said nothing about
 * that, and whatever the app is already showing stands.
 */
export type Landing = {
  /** One panel of a run, alone, for a stream to capture. */
  widget: WidgetRoute | null;
  /** One run's remote, alone on the page, for a streaming app's dock. */
  dock: DockRoute | null;
  /** One run, watched by anyone, alone on the page. */
  live: LiveRoute | null;
  /** A run this account plays without holding its pack. */
  seat: string | null;
  /** The section this address names. */
  view?: View;
  /** The guide's page, and a section within it to scroll to. */
  guide?: { slug: string; section: string | null };
  /** Which of the profile's pages. */
  profilePage?: ProfilePage;
  /** A code from somewhere else of the person's, to be stashed and taken off the bar. */
  link?: LinkRoute;
  /** A pack's paper, named: the pack and which document. */
  docs?: { at: DocsAt; kind: DocKind };
  /** The pack whose page the marketplace is showing, or null for the catalog. */
  marketplaceFocus?: string | null;
  /** A run named in the address, waiting on packs and storage. */
  run?: string;
};

/**
 * Read an address, in the hash spelling the parsers know.
 *
 * The order of the questions is the order they have always been asked in,
 * and each answer is the one the effect used to set by hand.
 */
export function landingOf(address: string): Landing {
  const at: Landing = {
    widget: widgetFromHash(address),
    dock: dockFromHash(address),
    live: liveFromHash(address),
    seat: seatFromAddress(address),
  };
  const slug = guideSlugFromHash(address);
  const run = runFromAddress(address);
  const link = linkFromHash(address);
  const docs = docsFromHash(address);
  if (slug) {
    at.guide = { slug, section: guideSectionFromHash(address) };
    at.view = "guide";
  } else if (createSectionFromHash(address) !== null) {
    // The Designer names its section in the address too; which one is the
    // editor's own business, and it reads the same hash.
    at.view = "design";
  } else if (/^#profile(\/|$)/.test(address)) {
    at.profilePage = profilePageFromHash(address) ?? "profile";
    at.view = "profile";
  } else if (link) {
    // The bot's `/link`, or `/setup claim` for a server: the profile page
    // that asks before binding it, on the page the kind belongs to.
    at.link = link;
    at.profilePage = link.kind === "guild" ? "servers" : "social";
    at.view = "profile";
  } else if (docs) {
    // Opened once the pack is in hand, which for a marketplace pack means
    // after it has been fetched.
    at.docs = docs;
    at.view = docs.at.section === "marketplace" ? "marketplace" : "library";
    if (docs.at.section === "marketplace") at.marketplaceFocus = docs.at.id;
  } else if (/^#marketplace(\/|$)/.test(address)) {
    const id = address.slice("#marketplace/".length);
    at.marketplaceFocus = id ? decodeURIComponent(id) : null;
    at.view = "marketplace";
  } else if (address === "#packs") {
    at.view = "library";
  } else if (address === "#themes" || address === "#themes/recovery") {
    at.view = "themes";
  } else if (address === "#play") {
    at.view = "play";
  } else if (run) {
    at.run = run;
  }
  return at;
}

/** The address this page was opened at, read the same way, or nothing where there is no page. */
export function landingNow(): Landing {
  return landingOf(typeof location !== "undefined" ? addressOf(location) : "");
}
