import { useCallback, useEffect, useMemo, useState } from "react";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { useDocDrawer } from "../docs/DocDrawer.tsx";
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
 */
export function MarketplaceView({
  focus = null,
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
  /** A pack to open the About of on arrival, from a deep link. */
  focus?: string | null;
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

  // Arriving on a pack: its docs open once the feed is here, and the search finds it.
  useEffect(() => {
    if (!focus || !entries) return;
    const e = entries.find((x) => x.id === focus);
    if (!e) return;
    setQ(e.title);
    void showDocs(e);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, entries]);

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

  const showDocs = async (e: MarketplaceEntry) => {
    if (reading) return;
    setReading(e.id);
    try {
      // A listing carries its summary ready-made; a priced one has no text to read.
      if (e.about) {
        const doc = await e.about();
        let pack: Pack | null = null;
        if (e.price === "free") {
          try {
            const loaded = loadPackText(await e.load(), "yaml");
            pack = loaded.ok ? loaded.pack : null;
          } catch {
            pack = null;
          }
        }
        if (pack) drawer.open(pack, "summary", { section: "marketplace", id: e.id });
        else if (doc) drawer.show(e.title, [{ label: "Summary", what: "The shape of the game, before you have it.", make: () => doc }]);
        return;
      }
      const loaded = loadPackText(await e.load(), "yaml");
      if (loaded.ok) drawer.open(loaded.pack, "summary", { section: "marketplace", id: e.id });
    } catch {
      // Nothing to read: the button simply comes back.
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
            <input className="textInput" type="search" value={q} placeholder="Search packs…" onChange={(e) => setQ(e.target.value)} />
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
              // Until the detail surface has it: a deck is laid out from a
              // pack, and from a free one. A setup is not laid out on a deck,
              // and a priced listing has no text to read until it is bought.
              const deck = e.kind === "pack" && e.price === "free";
              const error = failed[e.id];
              return (
                <article key={e.id} className="panel marketCard">
                  <h3 className="marketTitle">
                    {e.title}
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
                  {(optional.length > 0 || deck) && (
                    <Disclosure className="marketFold" summary="Optional" defaultOpen={false}>
                      {optional.length > 0 && <p className="muted small marketNeeds">{optional.map((r) => r.label).join(", ")}</p>}
                      {deck && <DeckProfiles load={e.load} />}
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
                    {have ? (
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
                    )}
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
        </section>
      </div>
    </main>
  );
}
