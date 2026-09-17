import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { DOC_KINDS, loadPackText, type Block, type Doc, type DocKind, type Pack } from "@runlog/rules-schema";
import { useDocDrawer } from "../docs/DocDrawer.tsx";
import { linkTo } from "../route.ts";
import { DeckProfiles } from "./DeckProfiles.tsx";
import {
  facets,
  feedState,
  FEATURES,
  filterMarketplace,
  kindCounts,
  loadMarketplace,
  publishersOf,
  seatsLabel,
  type FeedState,
  type MarketplaceEntry,
  type Feature,
  type Seats,
} from "./marketplace.ts";
import type { ListingKind } from "@runlog/rules-schema";
import { useHosted } from "../hosted/HostedProvider.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { useTitle } from "../title.ts";

/** What to call the things on the shelf, for a count that may be one of them. */
const noun = (kind: ListingKind, n: number): string => (kind === "setup" ? (n === 1 ? "setup" : "setups") : n === 1 ? "pack" : "packs");

/** The address of one pack's page. The catalog is `#marketplace` with nothing after it. */
const packHash = (id: string): string => `#marketplace/${encodeURIComponent(id)}`;

/** What the drawer calls the one document a listing carries before it is bought. */
const SUMMARY_TAB = { label: "Summary", what: "The shape of the game, before you have it." };

/** What a listing will show of itself, with the pack in hand where it may be read. */
interface Read {
  /** Which listing this was read from, so a page never draws another pack's text. */
  id: string;
  /** The pack itself, where its text is free to read; null for a listing that is sold. */
  pack: Pack | null;
  /** The summary the feed carries ready-made, where it carries one. */
  summary: Doc | null;
}

/**
 * Read a listing the way the card already reads it, and no further.
 *
 * A listing that came from the feed carries its summary made for it, so
 * that is asked for first and is all a priced listing ever gives: a pack
 * that is sold has no text here until it is bought, and fetching one to
 * draw a richer page would be reaching past the license. A free pack's
 * text is the same `load` the summary button and the deck row already
 * call, which is why the page may have its modes and its documents.
 */
async function readListing(e: MarketplaceEntry): Promise<Omit<Read, "id">> {
  let summary: Doc | null = null;
  if (e.about) {
    try {
      summary = await e.about();
    } catch {
      summary = null;
    }
  }
  if (e.price !== "free") return { pack: null, summary };
  try {
    const loaded = loadPackText(await e.load(), "yaml");
    return { pack: loaded.ok ? loaded.pack : null, summary };
  } catch {
    return { pack: null, summary };
  }
}

/**
 * The ways to play, for the page's Modes section.
 *
 * From the pack where the pack is in hand. Where it is not, the summary
 * the feed made carries the same modes in a table, so a priced listing
 * still says how it is played without its rules being fetched. Nothing
 * is invented: a listing with neither gets no section.
 */
function modesOf(read: Read): Array<{ label: string; description?: string }> {
  if (read.pack) {
    return Object.values(read.pack.modes).map((m) => ({ label: m.label, ...(m.description ? { description: m.description } : {}) }));
  }
  const table = read.summary?.blocks.find((b): b is Extract<Block, { kind: "table" }> => b.kind === "table" && b.columns[0] === "Mode");
  if (!table) return [];
  const about = table.columns.indexOf("About");
  return table.rows
    .filter((row) => (row[0] ?? "").trim())
    .map((row) => {
      const description = about === -1 ? "" : (row[about] ?? "").trim();
      return { label: row[0]!.trim(), ...(description ? { description } : {}) };
    });
}

/**
 * The marketplace, laid out as a market: cards in a grid, a sidebar to narrow
 * them. Everything here is free and comes with the app for now; the shape
 * is the one a marketplace with publishers and prices will fill in.
 *
 * A card answers four questions and stops: what is it, why would I try it,
 * what do I need, and how do I get it. Everything a browser does not need
 * in order to choose, the whole tag cloud, the deck profile, the version
 * and the publisher's other listings, is either behind a fold or on the
 * detail surface. The same fields sit in the same order on every card, so
 * two of them can be read against each other without hunting.
 *
 * What the sidebar filters on comes from the packs themselves: a category
 * and tags the author wrote, features read off the modes, and the seats a
 * mode declares. Three filters lead, activity, solo or group, free or
 * owned, because those are the three questions a person browsing asks
 * first; the rest waits under "More filters".
 *
 * "Read the summary" opens the pack's paper in the side drawer, on the
 * summary: the shape of the game, its tables by name, its modes, what you
 * need, and never its rules. It is what a listing shows before anyone has
 * the pack; the other documents are the drawer's tabs, where the pack's
 * text may be read. A priced listing carries only its summary, so that is
 * the one tab.
 *
 * A pack named in the address has a page here rather than a view of its
 * own: `#marketplace/<packId>` puts the page where the grid was and
 * leaves the sidebar, the query, the filters and the scroll exactly as
 * they were, so going back to the catalog is going back to the catalog
 * you left rather than to a fresh one.
 */
export function MarketplaceView({
  focus = null,
  onPack,
  mine,
  bought = new Set(),
  updatable = new Set(),
  onAdd,
  onBuy,
  onFetch,
  onUpdate,
  onOpen,
  onBack,
}: {
  /** The pack whose page is showing, from the address. Null is the catalog. */
  focus?: string | null;
  /** Ask for a pack's page, or for the catalog with null. The address is written where it is read. */
  onPack: (id: string | null) => void;
  /** Ids of the packs already in the library. The one source for "Owned". */
  mine: ReadonlySet<string>;
  /** Ids of the packs the account has bought, on the shelf here or not. */
  bought?: ReadonlySet<string>;
  /** Ids of the owned packs the marketplace has a newer version of. */
  updatable?: ReadonlySet<string>;
  onAdd: (entry: MarketplaceEntry) => Promise<void>;
  /** Buy a priced listing; absent where nobody is signed in. */
  onBuy?: (entry: MarketplaceEntry) => Promise<void>;
  /** Bring a bought copy onto this device. */
  onFetch?: (entry: MarketplaceEntry) => Promise<void>;
  /** Take the newer version of a pack already on the shelf. */
  onUpdate?: (entry: MarketplaceEntry) => Promise<void>;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  useTitle("Marketplace");
  const [entries, setEntries] = useState<MarketplaceEntry[] | null>(null);
  /** How the feed went, read once the catalog has settled; see the states below. */
  const [feed, setFeed] = useState<FeedState>("none");
  /** Whether the browser said it was offline when the catalog settled. */
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** What went wrong adding a pack, by its id, until the next try. */
  const [failed, setFailed] = useState<Record<string, string>>({});
  const drawer = useDocDrawer();
  /** The pack whose paper is being read for the drawer, while it is. */
  const [reading, setReading] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [seats, setSeats] = useState<Set<Seats>>(new Set());
  const [free, setFree] = useState(false);
  const [features, setFeatures] = useState<Set<Feature>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [owned, setOwned] = useState<"all" | "mine" | "new">("all");
  const [publisher, setPublisher] = useState<string | null>(null);
  /**
   * Which kind of thing is being browsed.
   *
   * Packs first and packs by default, because that is what the
   * marketplace is for and what almost everybody opening it wants. The
   * chooser is not drawn at all until there is a second kind behind it.
   */
  const [kind, setKind] = useState<ListingKind>("pack");
  /**
   * Whether the facets are showing. A wide screen keeps them in the side
   * column and ignores this; a phone has one column, and eleven ways to
   * narrow a list of nineteen packs put the packs two screens below the
   * fold. So they fold behind a word, and the search field, the count and
   * the way to clear them all stay where they are.
   */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hosted = useHosted();
  const testing = hosted === null || hosted.features.testing;

  useEffect(() => {
    let live = true;
    void loadMarketplace({ testing }).then((all) => {
      if (!live) return;
      setEntries(all);
      setFeed(feedState());
      setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    });
    return () => {
      live = false;
    };
  }, [testing]);

  /** What the open page has read of its pack; see `readListing` for how far that goes. */
  const [read, setRead] = useState<Read | null>(null);
  /** The page's own title, so opening a page puts the reader at the top of it. */
  const title = useRef<HTMLHeadingElement>(null);
  /** The search field, where a page was opened from an address rather than from a card. */
  const search = useRef<HTMLInputElement>(null);
  /** Each card's title link, by pack id: what a return from its page gives the focus back to. */
  const cards = useRef(new Map<string, HTMLAnchorElement>());
  /** The card whose page this is, remembered across the page so going back lands on it. */
  const cameFrom = useRef<string | null>(null);
  /** Where the catalog was standing when the page took its place. */
  const scrollAt = useRef(0);
  /** Which page was showing on the last pass, so the move between the two is what is acted on. */
  const wasOn = useRef<string | null>(focus);

  // The page's pack, read once it is known which pack that is.
  useEffect(() => {
    if (!focus || !entries) return;
    if (read?.id === focus) return;
    const e = entries.find((x) => x.id === focus);
    if (!e) return;
    let live = true;
    void readListing(e).then((got) => {
      if (live) setRead({ id: e.id, ...got });
    });
    return () => {
      live = false;
    };
  }, [focus, entries, read]);

  /**
   * Where the reader is standing, across the move between catalog and page.
   *
   * Opening a page puts them at its title, because the page is what they
   * asked for and its first line is where it starts. Going back puts them
   * on the card they came from, at the height the catalog was at, because
   * a catalog that came back scrolled to the top and focused on nothing
   * has lost their place for them. A page reached from an address has no
   * card behind it, and the search field is the honest fallback.
   */
  useLayoutEffect(() => {
    if (focus && focus !== wasOn.current) {
      title.current?.focus();
    } else if (!focus && wasOn.current) {
      try {
        window.scrollTo(0, scrollAt.current);
      } catch {
        /* a window that will not be scrolled is still a window */
      }
      const card = cameFrom.current ? cards.current.get(cameFrom.current) : null;
      (card ?? search.current)?.focus();
      cameFrom.current = null;
    }
    wasOn.current = focus;
  }, [focus]);

  /** Open a pack's page, from the card that asked for it. */
  const openPage = (id: string) => {
    cameFrom.current = id;
    scrollAt.current = typeof window === "undefined" ? 0 : window.scrollY;
    onPack(id);
  };

  const all = entries ?? [];
  const sides = useMemo(() => facets(all), [all]);
  const publishers = useMemo(() => publishersOf(all), [all]);
  const who = publisher ? (publishers.find((p) => p.id === publisher) ?? null) : null;
  const shown = useMemo(
    () =>
      filterMarketplace(
        all,
        {
          q,
          categories,
          seats,
          features,
          tags,
          kind,
          ...(free ? { free: true } : {}),
          ...(owned === "all" ? {} : { mine: owned === "mine" }),
          ...(publisher ? { publisher } : {}),
        },
        new Set([...mine, ...bought]),
      ),
    [all, q, categories, seats, free, features, tags, kind, owned, publisher, mine, bought],
  );
  const counts = useMemo(() => kindCounts(all), [all]);
  /** Everything of the kind being browsed: what the count is out of. */
  const here = useMemo(() => all.filter((e) => e.kind === kind), [all, kind]);
  /** The listing whose page is showing. Null with an address naming a pack is the not-found state. */
  const page = focus === null ? null : (entries?.find((e) => e.id === focus) ?? null);
  /** Drawn only once there is something behind the second tab. */
  const kinds: ListingKind[] = counts.setup > 0 ? ["pack", "setup"] : [];
  const narrowed =
    q.trim() !== "" ||
    categories.size > 0 ||
    seats.size > 0 ||
    free ||
    features.size > 0 ||
    tags.size > 0 ||
    owned !== "all" ||
    publisher !== null;

  const toggle = <T,>(set: Set<T>, value: T, put: (next: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    put(next);
  };
  const clear = () => {
    setQ("");
    setCategories(new Set());
    setSeats(new Set());
    setFree(false);
    setFeatures(new Set());
    setTags(new Set());
    setOwned("all");
    setPublisher(null);
  };

  /**
   * Run one acquisition at a time, and keep what went wrong where it happened.
   *
   * One at a time across the page, not one per card: adding two packs at once
   * asks the library to write twice over the same shelf, and the second
   * press is nearly always the same press landing twice. So the work is
   * taken as something to call rather than something already running, a
   * press while another is in flight is refused before it starts, and only
   * the attempt that set `busy` clears it.
   */
  const attempt = useCallback(
    async (id: string, work: () => Promise<void>) => {
      if (busy) return;
      setBusy(id);
      setFailed((was) => {
        if (!(id in was)) return was;
        const next = { ...was };
        delete next[id];
        return next;
      });
      try {
        await work();
      } catch (error) {
        setFailed((was) => ({ ...was, [id]: error instanceof Error && error.message ? error.message : "The pack could not be added." }));
      } finally {
        setBusy((b) => (b === id ? null : b));
      }
    },
    [busy],
  );

  /** Put what a listing gives of itself in the drawer: the pack's paper, or the one summary. */
  const openDrawer = (e: MarketplaceEntry, got: Read, kind: DocKind = "summary") => {
    if (got.pack) drawer.open(got.pack, kind, { section: "marketplace", id: e.id });
    else if (got.summary) drawer.show(e.title, [{ ...SUMMARY_TAB, make: () => got.summary! }]);
  };

  const showDocs = async (e: MarketplaceEntry) => {
    if (reading) return;
    setReading(e.id);
    try {
      openDrawer(e, { id: e.id, ...(await readListing(e)) });
    } finally {
      setReading(null);
    }
  };

  /**
   * What the page says about itself above the cards.
   *
   * A feed that did not answer is not an empty catalog, and must never be
   * drawn as one: the bundled packs are still below the line. Offline is
   * the same catalog with a known reason, so it drops the first sentence.
   */
  const feedLine =
    feed !== "failed"
      ? null
      : offline
        ? "The packs that ship with the app are here."
        : "The marketplace did not answer. The packs that ship with the app are here.";

  /**
   * The one action a listing offers, wherever it is drawn.
   *
   * The card and the page show the same one, in the same words, and every
   * one of them goes through `attempt`: the whole marketplace goes quiet
   * while an acquisition is in flight, so a second press never reaches
   * the library twice.
   */
  const action = (e: MarketplaceEntry, have: boolean) =>
    have ? (
      <Button size="compact" onClick={() => onOpen(e.id)}>
        Open
      </Button>
    ) : bought.has(e.id) && onFetch ? (
      <Button
        variant="primary"
        size="compact"
        loading={busy === e.id}
        disabled={busy !== null}
        loadingLabel="Fetching…"
        title="You bought this; fetch your copy onto this device"
        onClick={() => void attempt(e.id, () => onFetch(e))}
      >
        Yours · get your copy
      </Button>
    ) : e.price !== "free" ? (
      onBuy ? (
        <Button
          variant="primary"
          size="compact"
          loading={busy === e.id}
          disabled={busy !== null}
          loadingLabel="Opening…"
          title={`Buy from ${e.publisher?.name ?? "its publisher"}`}
          onClick={() => void attempt(e.id, () => onBuy(e))}
        >
          Buy {e.price.display}
        </Button>
      ) : (
        <Button size="compact" disabled>
          Sign in to buy
        </Button>
      )
    ) : (
      <Button
        variant="primary"
        size="compact"
        loading={busy === e.id}
        disabled={busy !== null}
        loadingLabel="Adding…"
        onClick={() => void attempt(e.id, () => onAdd(e))}
      >
        Add
      </Button>
    );

  /**
   * One pack's page.
   *
   * The card's four answers first, at the length the card could not give
   * them: the premise whole, both lists of what it needs, and the same
   * one action. Then what a card had no room for and nobody browsing
   * needed: how it may be played, its paper, the deck it lays out, who
   * published it and which version this is. Nothing here is fetched that
   * the card would not have fetched; see `readListing`.
   */
  const packPage = (e: MarketplaceEntry) => {
    const have = mine.has(e.id);
    const seatsLine = seatsLabel(e);
    const required = e.requires.filter((r) => !r.optional);
    const optional = e.requires.filter((r) => r.optional);
    const got = read?.id === e.id ? read : null;
    const modes = got ? modesOf(got) : [];
    const error = failed[e.id];
    // A newer version is the page's action, and Open goes quiet beside it:
    // on a page about one pack, the thing to do is take the new one.
    const newer = have && updatable.has(e.id) ? onUpdate : undefined;
    return (
      <article className="panel packPage">
        <h3 className="marketTitle packPageTitle" tabIndex={-1} ref={title}>
          {e.title}
          {e.bench && <Badge tone="cap">test bench</Badge>}
        </h3>
        {e.description && <p className="marketBlurb">{e.description}</p>}
        <div className="marketWhy">
          <Badge>{e.category}</Badge>
          {seatsLine && <Badge>{seatsLine}</Badge>}
        </div>
        {required.length > 0 && (
          <p className="muted small marketNeeds">
            <strong>Needs:</strong> {required.map((r) => r.label).join(", ")}
          </p>
        )}
        {optional.length > 0 && (
          <p className="muted small marketNeeds">
            <strong>Optional:</strong> {optional.map((r) => r.label).join(", ")}
          </p>
        )}
        <div className="packPageGet">
          <Badge>{e.price === "free" ? "Free" : e.price.display}</Badge>
          {have && <Badge tone="cap">Owned</Badge>}
          {newer ? (
            <>
              <Button
                variant="primary"
                size="compact"
                loading={busy === e.id}
                disabled={busy !== null}
                loadingLabel="Updating…"
                onClick={() => void attempt(e.id, () => newer(e))}
              >
                Update to {e.version}
              </Button>
              <Button size="compact" onClick={() => onOpen(e.id)}>
                Open
              </Button>
            </>
          ) : (
            action(e, have)
          )}
        </div>
        {error && (
          <p className="notice marketCardError" role="status">
            {error}
          </p>
        )}
        {got === null && <p className="muted small marketLoading">Loading…</p>}
        {modes.length > 0 && (
          <section className="packPageBlock">
            <h4 className="sectionTitle">Modes</h4>
            <dl className="packPageModes">
              {modes.map((m) => (
                <div key={m.label}>
                  <dt>{m.label}</dt>
                  {m.description && <dd className="muted small">{m.description}</dd>}
                </div>
              ))}
            </dl>
          </section>
        )}
        {got && (got.pack || got.summary) && (
          <section className="packPageBlock">
            <h4 className="sectionTitle">Documents</h4>
            <div className="options packPageDocs">
              {got.pack ? (
                DOC_KINDS.map((k) => (
                  <Button key={k.kind} size="compact" title={k.what} onClick={() => openDrawer(e, got, k.kind)}>
                    {k.label}
                  </Button>
                ))
              ) : (
                <Button size="compact" title={SUMMARY_TAB.what} onClick={() => openDrawer(e, got)}>
                  {SUMMARY_TAB.label}
                </Button>
              )}
            </div>
          </section>
        )}
        {/* A deck is laid out from a pack, and from one whose text may be read. */}
        {e.kind === "pack" && e.price === "free" && (
          <section className="packPageBlock">
            <h4 className="sectionTitle">Stream Deck</h4>
            <DeckProfiles load={e.load} />
          </section>
        )}
        {(e.publisher?.name ?? e.author) && (
          <section className="packPageBlock">
            <h4 className="sectionTitle">Publisher</h4>
            <p className="muted small">{e.publisher?.name ?? e.author}</p>
          </section>
        )}
        {e.version && (
          <section className="packPageBlock">
            <h4 className="sectionTitle">Version</h4>
            <p className="muted small mono">{e.version}</p>
          </section>
        )}
      </article>
    );
  };

  return (
    <main className="main market">
      <header className="libraryHead marketHead">
        <div>
          <h2>Marketplace</h2>
          <p className="muted">
            Packs anyone may add: the ones that come with the app, and what people have published. Free ones go straight to your packs; a
            priced one is bought from its publisher.
          </p>
        </div>
        <button className="ghost tiny" onClick={onBack}>
          Back to your packs
        </button>
      </header>

      <div className="marketBody">
        <aside className={`marketSide${filtersOpen ? " open" : ""}`} aria-label="Search and filters">
          <label className="marketSearch">
            <span className="visuallyHidden">Search the marketplace</span>
            <input
              ref={search}
              className="textInput"
              type="search"
              value={q}
              placeholder="Search packs…"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>

          {/* The phone's way in and out of the facets; it draws nothing on a wide screen. */}
          <button type="button" className="filtersToggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
            {filtersOpen ? "Hide the filters" : "Filters"}
            {narrowed && <Badge tone="ok">on</Badge>}
          </button>

          {sides.categories.length > 0 && (
            <div className="facet">
              <h4 className="facetTitle">Activity</h4>
              <ul className="facetList">
                {sides.categories.map((c) => (
                  <li key={c.value}>
                    <label>
                      <input
                        type="checkbox"
                        checked={categories.has(c.value)}
                        onChange={() => toggle(categories, c.value, setCategories)}
                      />
                      <span>{c.value}</span>
                      <span className="muted num">{c.count}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sides.seats.length > 0 && (
            <div className="facet">
              <h4 className="facetTitle">Solo or group</h4>
              <div className="options">
                {sides.seats.map((s) => (
                  <button
                    key={s.id}
                    className={`chip pick ${seats.has(s.id) ? "on" : ""}`}
                    aria-pressed={seats.has(s.id)}
                    onClick={() => toggle(seats, s.id, setSeats)}
                  >
                    {s.value}
                    <span className="muted num">{s.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="facet">
            <h4 className="facetTitle">Free or owned</h4>
            <div className="options">
              {/* Offered only where there is something priced to tell it from. */}
              {sides.free > 0 && sides.free < all.length && (
                <button className={`chip pick ${free ? "on" : ""}`} aria-pressed={free} onClick={() => setFree(!free)}>
                  Free
                  <span className="muted num">{sides.free}</span>
                </button>
              )}
              {(["all", "mine", "new"] as const).map((o) => (
                <button key={o} className={`chip pick ${owned === o ? "on" : ""}`} aria-pressed={owned === o} onClick={() => setOwned(o)}>
                  {o === "all" ? "Everything" : o === "mine" ? "In your packs" : "Not yet yours"}
                </button>
              ))}
            </div>
          </div>

          {/* Not a filter but a choice of what is being browsed, and drawn
              only once there is a second kind behind it. */}
          {kinds.length > 0 && (
            <div className="facet marketKinds">
              <h4 className="facetTitle">Looking for</h4>
              <div className="options">
                {kinds.map((k) => (
                  <button key={k} className={`chip pick ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                    {k === "pack" ? "Packs" : "Setups"}
                    <span className="muted num">{counts[k]}</span>
                  </button>
                ))}
              </div>
              <p className="muted small">
                A pack is a game: what the dice can do. A setup is what a tool attached to the game is set to while a run lasts, and fits
                any pack for that game.
              </p>
            </div>
          )}

          <Disclosure className="marketMore" summary="More filters" defaultOpen={false} remember="marketMoreFilters">
            {sides.features.length > 0 && (
              <div className="facet">
                <h4 className="facetTitle">How it plays</h4>
                <ul className="facetList">
                  {sides.features.map((f) => (
                    <li key={f.id}>
                      <label title={FEATURES.find((x) => x.id === f.id)?.what}>
                        <input type="checkbox" checked={features.has(f.id)} onChange={() => toggle(features, f.id, setFeatures)} />
                        <span>{f.value}</span>
                        <span className="muted num">{f.count}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {publishers.length > 1 && (
              <div className="facet">
                <h4 className="facetTitle">Publishers</h4>
                <ul className="facetList">
                  {publishers.map((p) => (
                    <li key={p.id}>
                      <label>
                        <input
                          type="radio"
                          name="publisher"
                          checked={publisher === p.id}
                          onChange={() => setPublisher(p.id)}
                          onClick={() => publisher === p.id && setPublisher(null)}
                        />
                        <span>{p.name}</span>
                        <span className="muted num">{p.count}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sides.tags.length > 0 && (
              <div className="facet">
                <h4 className="facetTitle">Tags</h4>
                <div className="options">
                  {sides.tags.map((t) => (
                    <button
                      key={t.value}
                      className={`chip pick ${tags.has(t.value) ? "on" : ""}`}
                      aria-pressed={tags.has(t.value)}
                      onClick={() => toggle(tags, t.value, setTags)}
                    >
                      {t.value}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Disclosure>
        </aside>

        <section className="marketMain">
          {focus !== null ? (
            <>
              <div className="packPageTop">
                <Button size="compact" onClick={() => onPack(null)}>
                  Back to the catalog
                </Button>
              </div>
              {entries === null && <p className="muted small marketLoading">Loading…</p>}
              {feedLine && <p className="notice marketFeedLine">{feedLine}</p>}
              {/* A pack the feed never carried, or one the feed could not be asked for. */}
              {entries !== null && (page ? packPage(page) : <p className="muted marketEmpty">That pack is not in the marketplace.</p>)}
            </>
          ) : (
            <>
              {who && (
                <section className="panel publisherHead" aria-label="Publisher">
                  <div>
                    <span className="muted small mono">Publisher</span>
                    <h3 className="marketTitle">{who.name}</h3>
                    <p className="muted small">
                      {who.count} {who.count === 1 ? "pack" : "packs"}
                      {who.free > 0 && ` · ${who.free} free`}
                      {who.from && ` · from ${who.from}`}
                    </p>
                  </div>
                  <button className="ghost tiny" onClick={() => setPublisher(null)}>
                    All publishers
                  </button>
                </section>
              )}
              {entries === null && <p className="muted small marketLoading">Loading…</p>}
              {feedLine && <p className="notice marketFeedLine">{feedLine}</p>}
              {entries !== null && (
                <div className="marketCount">
                  {/* Nothing to count when nothing matched: the line below says so in words. */}
                  <p className="muted small">
                    {shown.length === 0
                      ? ""
                      : shown.length === here.length
                        ? `${here.length} ${noun(kind, here.length)}`
                        : `${shown.length} match`}
                  </p>
                  {narrowed && (
                    <button className="ghost tiny" onClick={clear}>
                      Clear filters
                    </button>
                  )}
                </div>
              )}
              {/* The control is the one in the count row above, so there is only ever one of it. */}
              {entries !== null && shown.length === 0 && (
                <p className="muted marketEmpty">Nothing matches. Clear the filters to see everything.</p>
              )}
              <div className="marketGrid">
                {shown.map((e) => {
                  const have = mine.has(e.id);
                  const seatsLine = seatsLabel(e);
                  const optional = e.requires.filter((r) => r.optional);
                  const required = e.requires.filter((r) => !r.optional);
                  const error = failed[e.id];
                  return (
                    <article key={e.id} className="panel marketCard">
                      {/* A real anchor, so the page opens in a new tab the way any
                      link does; the press the browser would have handled is
                      taken here instead, to remember which card it came from. */}
                      <h3 className="marketTitle">
                        <a
                          href={linkTo(packHash(e.id))}
                          ref={(node) => {
                            if (node) cards.current.set(e.id, node);
                            else cards.current.delete(e.id);
                          }}
                          onClick={(ev: MouseEvent<HTMLAnchorElement>) => {
                            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
                            ev.preventDefault();
                            openPage(e.id);
                          }}
                        >
                          {e.title}
                        </a>
                        {e.bench && <Badge tone="cap">test bench</Badge>}
                      </h3>
                      {e.description && <p className="marketBlurb clamp">{e.description}</p>}
                      <div className="marketWhy">
                        <Badge>{e.category}</Badge>
                        {seatsLine && <Badge>{seatsLine}</Badge>}
                      </div>
                      {required.length > 0 && (
                        <p className="muted small marketNeeds">
                          <strong>Needs:</strong> {required.map((r) => r.label).join(", ")}
                        </p>
                      )}
                      {optional.length > 0 && (
                        <Disclosure className="marketFold" summary="Optional" defaultOpen={false}>
                          <p className="muted small marketNeeds">{optional.map((r) => r.label).join(", ")}</p>
                        </Disclosure>
                      )}
                      <footer className="marketCardFoot">
                        <div className="marketCardFootLeft">
                          <Badge>{e.price === "free" ? "Free" : e.price.display}</Badge>
                          {have && <Badge tone="cap">Owned</Badge>}
                          <Button
                            size="compact"
                            disabled={reading === e.id}
                            title="The summary, and the rest of the pack's paper, in the side drawer"
                            onClick={() => void showDocs(e)}
                          >
                            {reading === e.id ? "Reading…" : "Read the summary"}
                          </Button>
                          {have && updatable.has(e.id) && onUpdate && (
                            <Button
                              size="compact"
                              loading={busy === e.id}
                              disabled={busy !== null}
                              loadingLabel="Updating…"
                              onClick={() => void attempt(e.id, () => onUpdate(e))}
                            >
                              Update
                            </Button>
                          )}
                        </div>
                        {action(e, have)}
                      </footer>
                      {error && (
                        <p className="notice marketCardError" role="status">
                          {error}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
