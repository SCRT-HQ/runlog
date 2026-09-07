import { appUrl, configuredClientId } from "../auth/config.ts";

/**
 * Where the API is, and whether this device is allowed to use it.
 *
 * Same origin, under /api — the edge forwards that path to the server, so
 * there is no second hostname, no CORS, and nothing new for the Content
 * Security Policy to allow. And only where there is something to sign into:
 * a file on disk and the public page have neither an account nor an API,
 * and must not try.
 */
export function apiBase(): string | undefined {
  if (typeof location === "undefined" || !location.protocol.startsWith("http")) return undefined;
  // A dev server proxying a hosted API has one to ask even with nothing to
  // sign into: the live page and the widgets by link need no account.
  // (Not under test: a developer's .env.local must not change what the suite sees.)
  const proxied = import.meta.env.MODE !== "test" && Boolean(import.meta.env.VITE_RUNLOG_API_ORIGIN);
  if (!configuredClientId() && !proxied) return undefined;
  return new URL("./api", appUrl()).href;
}

/**
 * The device switch. On unless the player turned it off here, on this
 * machine: an account is for having your runs everywhere, so signing in is
 * the opt-in and the switch is the way out. Only "off" is remembered — an
 * absent value is on, which is also what a device from before the switch
 * defaulted this way reads as, unless it had said "on" already.
 */
const KEY = "runlog:sync";

export function syncEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSyncEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "off");
  } catch {
    /* a private window: the switch lasts the tab */
  }
}
