/**
 * Which page an address opens: the welcome page, or the app.
 *
 * The bare address is the welcome page, the page that says what Runlog
 * is, for anyone who has not chosen to skip it. The app lives under
 * `play`. Anyone who arrived with somewhere to go — a live link, a guide
 * page, a catalog link, an invitation, a purchase, a race code, a sign-in
 * on its way back — is in the app already, whatever the path says, and
 * the address is then made to read `play` so it is honest. A copy opened
 * from disk has no paths to speak of and is always the app.
 *
 * Every rule here is pure, so the tests pin it without a browser.
 */
export const APP_SEGMENT = "play";
const SKIP_KEY = "runlog:welcome";

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

/** Whether the path is the app's own, `<base>play`, with or without a trailing slash. */
export function isAppPath(pathname: string, base: string): boolean {
  return trimSlash(pathname) === trimSlash(base + APP_SEGMENT);
}

export function whereTo(w: Where): "welcome" | "app" {
  if (!w.protocol.startsWith("http")) return "app";
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
