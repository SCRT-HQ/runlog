import { apiBase } from "../sync/config.ts";

/**
 * A count, and nothing else.
 *
 * A hosted copy likes to know which of its screens are opened, how often,
 * from where in the world, on which version. That is a tally, not a
 * record: the app sends one small beacon naming the screen and its own
 * version, first-party, with no cookie and no identifier of any kind, and
 * the API keeps a count per day and drops the request on the floor. It
 * cannot be tied to a person, which is what keeps it outside every rule
 * about personal data, and it is not sent at all where the browser asks
 * not to be tracked, by Do Not Track or Global Privacy Control.
 *
 * Only a hosted copy sends it (there is nobody to count for on a disk or
 * on the public page), and only the screens named here: a family, never
 * an id, so a beacon never says which run or which pack.
 */
export type Screen = "welcome" | "library" | "play" | "rules" | "marketplace" | "catalog" | "guide" | "design" | "profile" | "live" | "widget" | "dock";

export const SCREENS: readonly Screen[] = ["welcome", "library", "play", "rules", "marketplace", "catalog", "guide", "design", "profile", "live", "widget", "dock"];

/** Whether the browser asked not to be counted. */
export function askedNotTo(nav: Partial<Navigator> & { globalPrivacyControl?: boolean } = navigator): boolean {
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

/** The beacon's body: what the screen was, and which app said so. */
export function beaconBody(screen: Screen, version: string): string {
  return JSON.stringify({ t: "view", screen, v: version });
}

let last: Screen | null = null;

/**
 * Count a screen, once per change: the same screen twice in a row is one
 * stay, not two visits. Returns whether anything was sent, for the tests.
 */
export function countView(screen: Screen, opts: { hosted: boolean; version: string; send?: (url: string, body: string) => boolean } = { hosted: false, version: "" }): boolean {
  if (!opts.hosted) return false;
  if (screen === last) return false;
  last = screen;
  if (typeof navigator !== "undefined" && askedNotTo()) return false;
  const base = apiBase();
  if (!base) return false;
  const send = opts.send ?? ((url, body) => (typeof navigator !== "undefined" && "sendBeacon" in navigator ? navigator.sendBeacon(url, new Blob([body], { type: "application/json" })) : false));
  try {
    return send(`${base}/beacon`, beaconBody(screen, opts.version));
  } catch {
    return false;
  }
}

/** For the tests: forget the last screen. */
export function resetCount(): void {
  last = null;
}
