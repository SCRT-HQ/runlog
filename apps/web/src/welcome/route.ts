/**
 * Which page an address opens: the welcome page, or the app.
 *
 * The bare address is the welcome page, the page that says what Runlog
 * is, for anyone who has not chosen to skip it. The app lives under
 * `play`. Anyone who arrived with somewhere to go, a live link, a guide
 * page, a marketplace link, an invitation, a purchase, a race code, a sign-in
 * on its way back, is in the app already, whatever the path says, and
 * the address is then made to read `play` so it is honest. One query is
 * the exception: `?welcome` asks for the welcome page by name, which is
 * how the mark in the app's bar and the footer's "What Runlog is" reach
 * it for somebody who chose to skip it. A copy opened from disk has no
 * paths to speak of and is always the app.
 *
 * Every rule here is pure, so the tests pin it without a browser.
 */
export const APP_SEGMENT = "play";
/**
 * Every first segment the app answers to. They hung under `play/` until
 * each one wanted an address a person could read and type; `play` is one
 * of them now, meaning the run in hand, and it is still the front door.
 */
const SECTIONS = new Set(["play", "packs", "guide", "profile", "marketplace", "marketplace", "run", "widget", "dock", "link", "create"]);
const SKIP_KEY = "runlog:welcome";
/** The query that asks for the welcome page by name. */
export const WELCOME_QUERY = "?welcome";

export interface Where {
  protocol: string;
  pathname: string;
  /** The directory the app is served from: `/`, or `/runlog/` on Pages. */
  base: string;
  hash: string;
  search: string;
  /** The person chose to skip the welcome page on this device. */
  skip: boolean;
}

const trimSlash = (p: string) => p.replace(/\/+$/, "");

/** Whether the path is one of the app's sections: `<base>packs`, `<base>guide/streaming`, and the rest, including what they were once spelled as under `play/`. */
export function isAppPath(pathname: string, base: string): boolean {
  const rest = trimSlash(pathname).slice(trimSlash(base).length).replace(/^\/+/, "");
  if (rest === "") return false;
  const head = rest.split("/")[0] ?? "";
  if (!SECTIONS.has(head)) return false;
  // The old spelling, `play/<section>`, is the app's too: it is read as
  // what it meant and written back in the spelling it has now.
  return true;
}

export function whereTo(w: Where): "welcome" | "app" {
  if (!w.protocol.startsWith("http")) return "app";
  if (w.search === WELCOME_QUERY && w.hash === "") return "welcome";
  if (isAppPath(w.pathname, w.base)) return "app";
  if (w.hash !== "" || w.search !== "") return "app";
  if (w.skip) return "app";
  return "welcome";
}

/** The app's address under this base: `/play`, or `/runlog/play`. */
export function appPath(base: string): string {
  return `${base}${APP_SEGMENT}`;
}

/**
 * The welcome page's address under this base, asked for by name so it
 * opens even where the person chose to skip it; the page then tidies the
 * query away. Null from a file, where there is no welcome page to reach.
 */
export function welcomePath(protocol: string, base: string): string | null {
  if (!protocol.startsWith("http")) return null;
  return `${base}${WELCOME_QUERY}`;
}

/**
 * What the address should be replaced with once the app is the page and
 * the path does not say so; null when it already does, when there are no
 * paths (a file), or when a sign-in is on its way back and the SDK still
 * has to read the query.
 */
export function honestAddress(w: Pick<Where, "protocol" | "pathname" | "base" | "hash" | "search">): string | null {
  if (!w.protocol.startsWith("http")) return null;
  if (isAppPath(w.pathname, w.base)) return null;
  if (/[?&]code=/.test(w.search)) return null;
  const search = w.search === "?open" ? "" : w.search;
  return `${appPath(w.base)}${search}${w.hash}`;
}

/** The directory the page is served from, as a path with a trailing slash. */
export function baseOf(href: string): string {
  return new URL("./", href).pathname;
}

export function skipWelcome(storage: Storage | null): boolean {
  try {
    return storage?.getItem(SKIP_KEY) === "skip";
  } catch {
    return false;
  }
}

export function setSkipWelcome(storage: Storage | null, skip: boolean): void {
  try {
    if (skip) storage?.setItem(SKIP_KEY, "skip");
    else storage?.removeItem(SKIP_KEY);
  } catch {
    /* a private window: the choice lasts the tab */
  }
}
