import { APP_SEGMENT, baseOf } from "./welcome/route.ts";

/**
 * One address, two spellings.
 *
 * Inside the app every page is named the way it always was, as a hash:
 * `#guide/streaming`, `#profile/servers`, `#run/<id>` for a run, and so
 * on; the parsers beside each screen read that form. On the hosted copy,
 * which is built to live at one root, the same page is spelled as a path:
 * `/guide/streaming`, `/packs`, `/play`. A reload lands on it, a link to
 * it says where it goes, and the old hash spelling still opens it, because
 * the hash is read first and rewritten on the way in. A copy opened from
 * disk, or served from a subpath on a static host, cannot resolve a path
 * to its files and keeps the hash spelling throughout.
 *
 * The sections hung under one `play/` segment until every one of them
 * wanted an address a person could read and type. They sit at the root
 * now, `play` among them, meaning the run in hand. The old spelling is
 * still read, so a bookmark keeps working and corrects itself.
 */

/** Whether this build lives at a fixed root and so may spell pages as paths: the hosted build is made with an absolute base; a file or a static host is not. */
export const PATHS_ON = import.meta.env.BASE_URL.startsWith("/") && import.meta.env.MODE !== "test";

/** The first segment of every page that has a path spelling. Anything else in a hash stays a hash: a shared pack, a race code. */
const HEADS = new Set(["play", "packs", "guide", "profile", "catalog", "run", "widget", "dock", "link", "create"]);

/** Where the sections hang: the base itself, since each one is a section of its own now. */
const root = (base: string) => base.replace(/\/+$/, "");

/** Where the app is served from: the configured base where paths are on, the page's own directory otherwise. */
export function appBase(href: string): string {
  return PATHS_ON ? import.meta.env.BASE_URL : baseOf(href);
}

/**
 * The hash-form address of a location: a path under `play/` turned back
 * into the hash the parsers read, with its query kept; otherwise the hash
 * as it is. `base` is where the app is served from; null means paths are off.
 */
export function addressOf(loc: { pathname: string; search: string; hash: string }, base: string | null = PATHS_ON ? import.meta.env.BASE_URL : null): string {
  if (base) {
    // A hash naming a page wins over the path. It is the more specific
    // thing the address carries, and it is what an old link and the
    // welcome page's own hand-off both put there.
    const named = /^#([a-z]+)(?:\/|$)/.exec(loc.hash);
    if (named && HEADS.has(named[1]!)) return loc.hash;
    const under = `${root(base)}/`;
    if (loc.pathname.startsWith(under)) {
      let rest = loc.pathname.slice(under.length).replace(/\/+$/, "");
      // Every section used to hang under `play/`. Those addresses are read
      // as what they meant, and whoever lands on one writes the address
      // back in the spelling it has now.
      if (rest.startsWith(`${APP_SEGMENT}/`)) {
        const after = rest.slice(APP_SEGMENT.length + 1);
        if (HEADS.has(after.split("/")[0] ?? "")) rest = after;
      }
      const head = rest.split("/")[0] ?? "";
      if (HEADS.has(head)) return `#${rest}${loc.search}`;
    }
  }
  return loc.hash;
}

/**
 * The address to write for a hash-form page: a path under `play/` where
 * paths are on, the hash itself elsewhere. An empty hash is the app's bare
 * address. A hash with no path spelling is returned as it is.
 */
export function hrefFor(hash: string, base: string | null = PATHS_ON ? import.meta.env.BASE_URL : null): string {
  // Nothing said is the run: the app's front door, and a section like the rest.
  if (!hash) return base ? `${root(base)}/${APP_SEGMENT}` : "";
  if (!base) return hash;
  const m = /^#([a-z]+)((?:\/[^?#]*)?)(\?.*)?$/.exec(hash);
  if (!m || !HEADS.has(m[1]!)) return hash;
  return `${root(base)}/${m[1]}${m[2] ?? ""}${m[3] ?? ""}`;
}

/**
 * A link the app writes for itself: the page's path where paths are on,
 * else the hash after `from`, which is where the hash belongs (the app's
 * own address from the welcome page, `./` from a page beside it, nothing
 * from inside the app).
 */
export function linkTo(hash: string, from = ""): string {
  return PATHS_ON ? hrefFor(hash) : `${from}${hash}`;
}

/** The hash-form address for a run of this device's own: `#run/<id>`, which a live link (`#run/<id>?t=…`) is not. */
export function runFromAddress(address: string): string | null {
  const m = /^#run\/([A-Za-z0-9_-]+)$/.exec(address);
  return m ? m[1]! : null;
}

/** Put a page in the address bar, spelled for this build; an empty hash is the bare app, keeping any query. */
export function goTo(hash: string, how: "replace" | "push" = "replace"): void {
  const target = hash ? hrefFor(hash) : PATHS_ON ? `${hrefFor("")}${location.search}` : `${location.pathname}${location.search}`;
  const current = PATHS_ON ? `${location.pathname}${location.search}${location.hash}` : location.hash || `${location.pathname}${location.search}`;
  if (target === current) return;
  if (how === "push") history.pushState(null, "", target);
  else history.replaceState(null, "", target);
}
