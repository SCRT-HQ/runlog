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

/**
 * The first segment of every page that has a path spelling. Anything else
 * in a hash stays a hash: a shared pack, a race code.
 *
 * `SECTIONS` in welcome/route.ts is the same list read at the door, before
 * the app is the page at all, and a head missing from it lands on the
 * welcome page instead. The two are pinned together by a test; exported
 * for it, not because anything else should read it.
 */
export const HEADS = new Set([
  "play",
  "packs",
  "guide",
  "profile",
  "marketplace",
  "run",
  "seat",
  "widget",
  "dock",
  "link",
  "create",
  "themes",
]);

/** Where the sections hang: the base itself, since each one is a section of its own now. */
const root = (base: string) => base.replace(/\/+$/, "");

/** Where the app is served from: the configured base where paths are on, the page's own directory otherwise. */
export function appBase(href: string): string {
  return PATHS_ON ? import.meta.env.BASE_URL : baseOf(href);
}

/**
 * Where a widget address keeps its pinned theme when pages are paths: in
 * the fragment, `/widget/clock/<run>?t=<token>#pin=<text>`, so the colors
 * and fonts never reach a server. The hash spelling carries it as the last
 * parameter instead, `#widget/clock/<run>?t=<token>&pin=<text>`, since that
 * whole address is a fragment already.
 */
export const WIDGET_PIN_FRAGMENT = "#pin=";

/**
 * Where a widget address keeps a theme link's read key when pages are
 * paths: `/widget/clock/<run>?t=<token>#ch=<key>`, the same way and for the
 * same reason as a pin. An address carries one or the other, never both.
 */
export const WIDGET_CHANNEL_FRAGMENT = "#ch=";

/** A query parameter's name as URLSearchParams would read it, so an escaped spelling is still the same name. */
function paramName(part: string): string {
  const name = part.split("=")[0]!.replace(/\+/g, " ");
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * The query a path-spelled address reads as, with a widget's `#pin=` or
 * `#ch=` fragment folded in as the last parameter, as the hash spelling
 * writes it. The fragment is the pin: a `pin` left in the query beside it
 * is dropped. A theme link's key is only ever read from the fragment: a
 * `ch` in the query reached the server, so it is dropped whatever the
 * fragment says. A fragment that is not plain text, such as `#pin=a&t=x`,
 * is a pin or key that cannot be read, carried empty so the widget shows
 * its fallback and nothing after the `&` becomes a parameter.
 */
function widgetQuery(head: string, search: string, hash: string): string {
  if (head !== "widget") return search;
  const name = hash.startsWith(WIDGET_PIN_FRAGMENT) ? "pin" : hash.startsWith(WIDGET_CHANNEL_FRAGMENT) ? "ch" : null;
  const kept = search
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => {
      if (part === "") return false;
      const named = paramName(part);
      return named !== "ch" && named !== name;
    })
    .join("&");
  if (name === null) return kept ? `?${kept}` : "";
  const text = hash.slice(name.length + 2);
  const value = /[&#]/.test(text) ? "" : text;
  return `${kept ? `?${kept}&` : "?"}${name}=${value}`;
}

/**
 * The hash-form address of a location: a path under `play/` turned back
 * into the hash the parsers read, with its query kept; otherwise the hash
 * as it is. `base` is where the app is served from; null means paths are off.
 */
export function addressOf(
  loc: { pathname: string; search: string; hash: string },
  base: string | null = PATHS_ON ? import.meta.env.BASE_URL : null,
): string {
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
        if (HEADS.has(after.split("/")[0] ?? "") || after.startsWith("marketplace")) rest = after;
      }
      // The marketplace was called the marketplace until the name settled.
      if (rest === "marketplace" || rest.startsWith("marketplace/")) rest = `marketplace${rest.slice("marketplace".length)}`;
      const head = rest.split("/")[0] ?? "";
      if (HEADS.has(head)) return `#${rest}${widgetQuery(head, loc.search, loc.hash)}`;
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
  const path = `${root(base)}/${m[1]}${m[2] ?? ""}`;
  if (m[1] === "widget" && m[3]) {
    // A widget's pinned theme or theme link key goes in the fragment, which no server receives.
    const query = new URLSearchParams(m[3].slice(1));
    const pin = query.get("pin");
    const ch = query.get("ch");
    if (pin !== null || ch !== null) {
      query.delete("pin");
      // A pin wins over a link (widget/look.ts): with both, the pin is kept and the key is never written.
      query.delete("ch");
      const rest = query.toString();
      const fragment =
        pin !== null ? `${WIDGET_PIN_FRAGMENT}${encodeURIComponent(pin)}` : `${WIDGET_CHANNEL_FRAGMENT}${encodeURIComponent(ch!)}`;
      return `${path}${rest ? `?${rest}` : ""}${fragment}`;
    }
  }
  return `${path}${m[3] ?? ""}`;
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

/**
 * The Designer's section, from `#create/<section>`.
 *
 * `#create` on its own is the Designer with nothing said about where in
 * it, which the editor reads as its first section. Null means the address
 * is not the Designer's at all.
 */
export function createSectionFromHash(address: string): string | null {
  const m = /^#create(?:\/([a-z]+))?$/.exec(address);
  return m ? (m[1] ?? "") : null;
}

/**
 * The pack a `#play/<id>` address names, or null for anything else.
 *
 * `#play` on its own is the run view on whatever pack is loaded. With a
 * pack id it is that pack, ready to start: the address a Stream Deck key
 * set to one pack opens, so "A new run" on an Elden Ring profile starts an
 * Elden Ring run rather than landing on the shelf.
 *
 * A pack id is a reverse-domain name, so the characters allowed are the
 * ones `PackId` allows, and nothing else reaches the shelf lookup.
 */
export function packToPlayFromHash(address: string): string | null {
  const m = /^#play\/([A-Za-z0-9._-]+)$/.exec(address);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** The hash-form address for a run of this device's own: `#run/<id>`, which a live link (`#run/<id>?t=…`) is not. */
export function runFromAddress(address: string): string | null {
  const m = /^#run\/([A-Za-z0-9_-]+)$/.exec(address);
  return m ? m[1]! : null;
}

/** The hash-form address of a run played from a seat: `#seat/<id>`. */
export function seatFromAddress(address: string): string | null {
  const m = /^#seat\/([A-Za-z0-9_-]+)$/.exec(address);
  return m ? m[1]! : null;
}

/** Put a page in the address bar, spelled for this build; an empty hash is the bare app, keeping any query. */
export function goTo(hash: string, how: "replace" | "push" = "replace"): void {
  const target = hash ? hrefFor(hash) : PATHS_ON ? `${hrefFor("")}${location.search}` : `${location.pathname}${location.search}`;
  const current = PATHS_ON
    ? `${location.pathname}${location.search}${location.hash}`
    : location.hash || `${location.pathname}${location.search}`;
  if (target === current) return;
  if (how === "push") history.pushState(null, "", target);
  else history.replaceState(null, "", target);
}

/**
 * The address the run should be wearing, or null to leave it alone.
 *
 * The run is reached from a dozen places that all say "show the run"
 * and none of which said where that was, so a run started from the
 * shelf left `/packs` in the bar and a reload went back to the shelf.
 * The other sections each write their own address on the way in; this
 * is the run's, applied wherever it lands rather than at each door.
 *
 * Only over another section's address. A run that has named itself
 * keeps its name, and an address that is not a section at all -- a
 * shared pack, a race code, a widget -- is left alone, because the run
 * view has nothing better to say than what is already there.
 */
export function addressForPlay(at: string, hasPack: boolean): string | null {
  if (!/^#(packs|guide|profile|marketplace|create|themes)(\/|$)/.test(at)) return null;
  // With no pack loaded the run view is the shelf, and says so.
  return hasPack ? "#play" : "#packs";
}
