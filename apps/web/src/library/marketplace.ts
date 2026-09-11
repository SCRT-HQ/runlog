import YAML from "yaml";
import type { Doc } from "@runlog/rules-schema";

/**
 * The catalog: packs anyone may add to their library.
 *
 * Version one is the packs that ship in the repository, and they no longer
 * ship in the app's bundle. Each is a chunk of its own that the build emits
 * and the service worker precaches, loaded when the catalog is opened or a
 * pack is added, so a player who never opens the catalog never downloads
 * a pack they did not ask for, and a copy on disk or on the public page
 * still has every one of them.
 *
 * What a listing says about a pack comes from the pack: its category and
 * tags are fields the author wrote, and its features, solo, together,
 * moderated, seeded, timers, cards, are read off its modes and
 * capabilities, so a filter can never disagree with the rules. When
 * publishers arrive, the same shape comes from the API with their listings,
 * and the view does not change.
 */

import { FEATURES, featuresOf, priceDisplay, type Feature } from "@runlog/rules-schema";
export { FEATURES, featuresOf, priceDisplay, type Feature };
import { apiBase } from "../sync/config.ts";

export interface MarketplaceEntry {
  id: string;
  version: string;
  title: string;
  author?: string;
  description?: string;
  /** What kind of thing it is, in the author's word: everyday, games, craft… */
  category: string;
  /** The author's tags, as written. */
  tags: string[];
  /** How it plays, read from the pack. */
  features: Feature[];
  /** What a person needs before playing, as the pack lists it. */
  requires: Array<{ label: string; kind: string; optional: boolean }>;
  /** Most people a mode seats, moderator or contestants included. */
  players: number;
  /** A short line under the title, made from the above. */
  kind: string;
  /**
   * Set on a pack from `packs/testing/`: a test bench, never seeded to the
   * platform as a listing and never counted as "new in the catalog". A
   * hosted copy leaves it out of the bundle entirely where its `hosted.json`
   * says `features.testing` is off; see `loadMarketplace`.
   */
  bench?: boolean;
  /** Free, or a price in the smallest unit of its currency, with how to show it. */
  price: "free" | { amount: number; currency: string; display: string };
  /** Who listed it: a publisher, or the bundle that ships with the app. */
  publisher?: { id: string; name: string };
  source: "bundled" | "listing";
  /** The pack's text, when asked for. A priced listing has none to give: it is bought. */
  load: () => Promise<string>;
  /** The catalog summary, where the feed carries one already made. */
  about?: () => Promise<Doc | null>;
}

/**
 * The pack a fresh device gets, once, so Play works before anyone has read
 * anything. The most general one: a day of things to do, for anyone.
 */
export const STARTER_PACK = "com.scrthq.runlog.any-given-day";

/** In the order the catalog shows them: the starter first, then by title. */
const ORDER = [STARTER_PACK];

const files = import.meta.glob("../../../../packs/{demo,sketches}/*.yaml", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

/**
 * The test bench, kept apart from `files` rather than folded into one brace
 * group so every entry it produces can be marked `bench: true` below. It is
 * a separate PR's pack (`packs/testing/engine-testing.yaml`) and may not
 * exist on a given checkout; an empty glob here is fine, the same as an
 * empty `packs/testing/` would be.
 */
const benchFiles = import.meta.glob("../../../../packs/testing/*.yaml", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What a pack's declaration says about how it plays. Tolerant: this reads a file, not a validated pack. */
function kindOf(category: string, features: Feature[]): string {
  const how = features.includes("moderated") ? "moderated race" : features.includes("together") ? "solo or together" : "solo";
  return `${category} · ${how}`;
}

/** Read one bundled pack's header into a catalog entry. `bench` marks a `packs/testing/` pack. */
async function bundledEntry(load: () => Promise<string>, bench: boolean): Promise<MarketplaceEntry | null> {
  const text = await load();
  const head = YAML.parse(text) as Record<string, unknown>;
  const id = String(head["id"] ?? "");
  if (!id) return null;
  const category = typeof head["category"] === "string" && head["category"].trim() ? head["category"].trim().toLowerCase() : "other";
  const tags = Array.isArray(head["tags"]) ? head["tags"].map((t) => String(t).trim()).filter(Boolean) : [];
  const { features, players } = featuresOf(head);
  const requires = Array.isArray(head["requires"])
    ? head["requires"]
        .filter(isRecord)
        .map((r) => ({ label: String(r["label"] ?? ""), kind: String(r["kind"] ?? "other"), optional: r["optional"] === true }))
        .filter((r) => r.label)
    : [];
  return {
    id,
    version: String(head["version"] ?? ""),
    title: String(head["title"] ?? id),
    ...(typeof head["author"] === "string" ? { author: head["author"] } : {}),
    ...(typeof head["description"] === "string" ? { description: head["description"].trim() } : {}),
    category,
    tags,
    features,
    players,
    requires,
    kind: kindOf(category, features),
    price: "free",
    source: "bundled",
    load: async () => text,
    ...(bench ? { bench: true } : {}),
  };
}

let cached: Promise<MarketplaceEntry[]> | null = null;

/**
 * Every catalog entry, with its header read; the text itself stays lazy.
 *
 * `testing` says whether a `bench: true` entry (the pack under
 * `packs/testing/`) should be in what comes back. Left unset, nothing is
 * filtered: a caller that needs every pack it already knows about, such as
 * resolving a pack a run points at, should never lose it because a flag
 * changed after the fact. A view that lists the catalog for someone to
 * browse should pass the copy's own answer instead: `hosted === null` (no
 * `hosted.json` at all: static, local, self-hosted) or
 * `hosted.features.testing`.
 */
export function loadMarketplace(opts: { testing?: boolean } = {}): Promise<MarketplaceEntry[]> {
  if (!cached) {
    cached = (async () => {
      const entries: MarketplaceEntry[] = [];
      for (const load of Object.values(files)) {
        const entry = await bundledEntry(load, false);
        if (entry) entries.push(entry);
      }
      for (const load of Object.values(benchFiles)) {
        const entry = await bundledEntry(load, true);
        if (entry) entries.push(entry);
      }
      // The feed, where there is one: what publishers listed, the built-ins
      // seeded among them. A listing wins over the bundle's copy of the same
      // id, so a newer version published beats the one that shipped.
      const byId = new Map(entries.map((e) => [e.id, e]));
      for (const e of await loadFeed()) byId.set(e.id, e);
      const merged = [...byId.values()];
      merged.sort((a, b) => {
        const x = ORDER.indexOf(a.id);
        const y = ORDER.indexOf(b.id);
        if (x !== y) return (x === -1 ? 99 : x) - (y === -1 ? 99 : y);
        return a.title.localeCompare(b.title);
      });
      return merged;
    })();
  }
  return cached.then((entries) => withTesting(entries, opts.testing));
}

/**
 * Drop the bench entries where a copy is not meant to carry them. `testing`
 * left unset keeps everything, the same as `loadMarketplace()` with no options: 
 * see its doc comment for why. Exported so the rule is checked directly,
 * without needing a real `packs/testing/` pack on disk to exercise it.
 */
export function withTesting(entries: readonly MarketplaceEntry[], testing?: boolean): MarketplaceEntry[] {
  return testing === false ? entries.filter((e) => !e.bench) : [...entries];
}

/** A card as the feed carries it. */
interface FeedCard {
  packId: string;
  orgId: string;
  publisherName: string;
  head: {
    title: string;
    version: string;
    author?: string;
    description?: string;
    category: string;
    tags: string[];
    features: string[];
    requires: Array<{ label: string; kind: string; optional: boolean }>;
    players: number;
  };
  price: "free" | { amount: number; currency: string };
}

/**
 * The catalog's feed from the API, with no account: public, a minute's
 * cache. Nothing where there is no API, disk, Pages, or where it does
 * not answer; the bundle is the catalog then, as it always was.
 */
export async function loadFeed(fetchImpl: typeof fetch = fetch, base = apiBase()): Promise<MarketplaceEntry[]> {
  if (!base) return [];
  try {
    const response = await fetchImpl(`${base.replace(/\/$/, "")}/listings`);
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return [];
    const body = (await response.json()) as { listings?: FeedCard[] };
    return (body.listings ?? []).filter((c) => c && typeof c.packId === "string" && c.head).map((c) => feedEntry(c, base));
  } catch {
    return [];
  }
}

export function feedEntry(card: FeedCard, base: string): MarketplaceEntry {
  const root = base.replace(/\/$/, "");
  const features = card.head.features.filter((f): f is Feature => FEATURES.some((x) => x.id === f));
  const price = card.price === "free" ? ("free" as const) : { ...card.price, display: priceDisplay(card.price) };
  const url = `${root}/listings/${encodeURIComponent(card.packId)}`;
  return {
    id: card.packId,
    version: card.head.version,
    title: card.head.title,
    ...(card.head.author ? { author: card.head.author } : {}),
    ...(card.head.description ? { description: card.head.description } : {}),
    category: (card.head.category || "other").toLowerCase(),
    tags: card.head.tags ?? [],
    features,
    players: card.head.players || 1,
    requires: card.head.requires ?? [],
    kind: kindOf((card.head.category || "other").toLowerCase(), features),
    price,
    publisher: { id: card.orgId, name: card.publisherName },
    source: "listing",
    load: async () => {
      if (price !== "free") throw new Error("this pack is sold, not given; buy it from the catalog");
      const response = await fetch(`${url}/file`);
      if (!response.ok) throw new Error("the pack could not be fetched");
      return response.text();
    },
    about: async () => {
      const response = await fetch(url);
      if (!response.ok) return null;
      const body = (await response.json()) as { summary?: Doc | null };
      return body.summary ?? null;
    },
  };
}

/** One entry by pack id, or null. */
export async function marketplaceEntry(id: string): Promise<MarketplaceEntry | null> {
  return (await loadMarketplace()).find((e) => e.id === id) ?? null;
}

/**
 * Versions compared the way people write them: dotted numbers first, and
 * anything after that as text. "1.10.0" is newer than "1.9.0"; "2" is
 * newer than "1.9.9"; a pre-release tag sorts before the release it names.
 */
export function newerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const [core = "", tag] = v.trim().split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), tag: tag ?? "" };
  };
  const a = parse(candidate);
  const b = parse(current);
  const len = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < len; i++) {
    const x = a.nums[i] ?? 0;
    const y = b.nums[i] ?? 0;
    if (x !== y) return x > y;
  }
  if (a.tag === b.tag) return false;
  if (!a.tag) return true;
  if (!b.tag) return false;
  return a.tag > b.tag;
}

/**
 * The packs the catalog has a newer version of: those that came from it,
 * by the entry they came from, where the entry has moved on. A pack the
 * player loaded from a file is never offered an update, even if the
 * catalog has one with the same id, it is theirs, and may differ.
 */
export function updatesFor(
  packs: ReadonlyArray<{ id: string; origin?: string; catalog?: { id: string; version: string }; deletedAt?: string }>,
  entries: readonly MarketplaceEntry[],
): Map<string, MarketplaceEntry> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out = new Map<string, MarketplaceEntry>();
  for (const p of packs) {
    if (p.deletedAt || (p.origin !== "catalog" && p.origin !== "listing") || !p.catalog) continue;
    const entry = byId.get(RENAMED_IDS[p.catalog.id] ?? p.catalog.id);
    if (entry && newerVersion(entry.version, p.catalog.version)) out.set(p.id, entry);
  }
  return out;
}

/* ---- searching and filtering, pure so the sidebar can be tested ------------ */

export interface MarketplaceQuery {
  /** Free text, matched against title, description, author, category and tags. */
  q?: string;
  /** Any of these categories. */
  categories?: ReadonlySet<string>;
  /** All of these features. */
  features?: ReadonlySet<Feature>;
  /** All of these tags. */
  tags?: ReadonlySet<string>;
  /** Only packs already in the library, or only ones not. */
  mine?: boolean;
  /** One publisher's packs, by the publisher's id. */
  publisher?: string;
}

const norm = (s: string) => s.trim().toLowerCase();

export function filterMarketplace(entries: readonly MarketplaceEntry[], query: MarketplaceQuery, owned: ReadonlySet<string> = new Set()): MarketplaceEntry[] {
  const q = norm(query.q ?? "");
  const words = q ? q.split(/\s+/) : [];
  return entries.filter((e) => {
    if (query.mine !== undefined && owned.has(e.id) !== query.mine) return false;
    if (query.publisher && e.publisher?.id !== query.publisher) return false;
    if (query.categories?.size && !query.categories.has(e.category)) return false;
    if (query.features?.size && ![...query.features].every((f) => e.features.includes(f))) return false;
    if (query.tags?.size && ![...query.tags].every((t) => e.tags.some((x) => norm(x) === norm(t)))) return false;
    if (words.length) {
      const hay = norm([e.title, e.description ?? "", e.author ?? "", e.category, ...e.tags, ...e.requires.map((r) => r.label)].join(" "));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export interface Facet {
  value: string;
  count: number;
}

/** What the sidebar offers: every value present, with how many packs carry it, most common first. */
export interface PublisherFacet {
  id: string;
  name: string;
  count: number;
  free: number;
  /** The lowest price among the priced ones, as the feed shows it. */
  from: string | null;
}

/** Who publishes here, with what they have listed: most packs first. */
export function publishersOf(entries: readonly MarketplaceEntry[]): PublisherFacet[] {
  const m = new Map<string, PublisherFacet & { low: number }>();
  for (const e of entries) {
    // A test bench is never a publisher's listing (seed-listings.ts leaves
    // it out on purpose), but the check is explicit rather than relying on
    // that: a bench pack should never show up as something to publish by.
    if (!e.publisher || e.bench) continue;
    const p = m.get(e.publisher.id) ?? { id: e.publisher.id, name: e.publisher.name, count: 0, free: 0, from: null, low: Number.POSITIVE_INFINITY };
    p.count += 1;
    if (e.price === "free") p.free += 1;
    else if (e.price.amount < p.low) {
      p.low = e.price.amount;
      p.from = e.price.display;
    }
    m.set(e.publisher.id, p);
  }
  return [...m.values()].map(({ low: _low, ...p }) => p).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function facets(entries: readonly MarketplaceEntry[]): { categories: Facet[]; tags: Facet[]; features: Array<Facet & { id: Feature }>; authors: Facet[] } {
  const count = (values: string[]): Facet[] => {
    const m = new Map<string, number>();
    for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  const features = FEATURES.map((f) => ({ id: f.id, value: f.label, count: entries.filter((e) => e.features.includes(f.id)).length })).filter((f) => f.count > 0);
  return {
    categories: count(entries.map((e) => e.category)),
    tags: count(entries.flatMap((e) => e.tags)),
    features,
    authors: count(entries.map((e) => e.author ?? "").filter(Boolean)),
  };
}

/**
 * The ids the header shelf used for the built-ins before the catalog, so a
 * device that remembered one of those lands on the same pack.
 */
/**
 * The built-ins' ids before they moved under the operator's domain. A
 * library that holds one is moved to the new id, runs and all, the first
 * time it is read; the map is what says which is which.
 */
export const RENAMED_IDS: Record<string, string> = Object.fromEntries(
  ["any-given-day", "long-kiln", "salt-and-signal", "ladder-work", "elden-ring-expedition", "elden-ring-trial", "homefront", "practice-room", "pantry-roulette", "rocket-league-ladder", "rocket-league-showdown"].map(
    (name) => [`dev.runlog.${name}`, `com.scrthq.runlog.${name}`],
  ),
);

export const LEGACY_IDS: Record<string, string> = {
  kiln: "com.scrthq.runlog.long-kiln",
  signal: "com.scrthq.runlog.salt-and-signal",
  ladder: "com.scrthq.runlog.ladder-work",
  ...RENAMED_IDS,
};
