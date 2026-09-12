import { useEffect, useMemo, useState } from "react";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { useDocDrawer } from "../docs/DocDrawer.tsx";
import { facets, FEATURES, filterMarketplace, loadMarketplace, publishersOf, type MarketplaceEntry, type Feature } from "./marketplace.ts";
import { useHosted } from "../hosted/HostedProvider.tsx";

/**
 * The marketplace, laid out as a market: cards in a grid, a sidebar to narrow
 * them. Everything here is free and comes with the app for now; the shape
 * is the one a marketplace with publishers and prices will fill in.
 *
 * What the sidebar filters on comes from the packs themselves: a category
 * and tags the author wrote, and features read off the modes, solo,
 * together, moderated, seeded, so "show me something we can all play"
 * is a checkbox and not a search for the right word.
 *
 * "Docs" opens the pack's paper in the side drawer, on the summary: the
 * shape of the game, its tables by name, its modes, what you need, and
 * never its rules. It is what a listing shows before anyone has the pack;
 * the other documents are the drawer's tabs, where the pack's text may be
 * read. A priced listing carries only its summary, so that is the one tab.
 */
export function MarketplaceView({
  focus = null,
  mine,
  bought = new Set(),
  onAdd,
  onBuy,
  onFetch,
  onOpen,
  onBack,
}: {
  /** A pack to open the About of on arrival, from a deep link. */
  focus?: string | null;
  /** Ids of the packs already in the library. */
  mine: ReadonlySet<string>;
  /** Ids of the packs the account has bought, on the shelf here or not. */
  bought?: ReadonlySet<string>;
  onAdd: (entry: MarketplaceEntry) => Promise<void>;
  /** Buy a priced listing; absent where nobody is signed in. */
  onBuy?: (entry: MarketplaceEntry) => Promise<void>;
  /** Bring a bought copy onto this device. */
  onFetch?: (entry: MarketplaceEntry) => Promise<void>;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const [entries, setEntries] = useState<MarketplaceEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const drawer = useDocDrawer();
  /** The pack whose paper is being read for the drawer, while it is. */
  const [reading, setReading] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [features, setFeatures] = useState<Set<Feature>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [owned, setOwned] = useState<"all" | "mine" | "new">("all");
  const [publisher, setPublisher] = useState<string | null>(null);
  /**
   * Whether the facets are showing. A wide screen keeps them in the side
   * column and ignores this; a phone has one column, and eleven ways to
   * narrow a list of nineteen packs put the packs two screens below the
   * fold. So they fold behind a word, and the search field, which is what
   * most people reach for first, stays where it is.
   */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hosted = useHosted();
  const testing = hosted === null || hosted.features.testing;

  useEffect(() => {
    let live = true;
    void loadMarketplace({ testing }).then((all) => live && setEntries(all));
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
  const who = publisher ? publishers.find((p) => p.id === publisher) ?? null : null;
  const shown = useMemo(
    () => filterMarketplace(all, { q, categories, features, tags, ...(owned === "all" ? {} : { mine: owned === "mine" }), ...(publisher ? { publisher } : {}) }, new Set([...mine, ...bought])),
    [all, q, categories, features, tags, owned, publisher, mine, bought],
  );
  const narrowed = q.trim() !== "" || categories.size > 0 || features.size > 0 || tags.size > 0 || owned !== "all" || publisher !== null;

  const toggle = <T,>(set: Set<T>, value: T, put: (next: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    put(next);
  };
  const clear = () => {
    setQ("");
    setCategories(new Set());
    setFeatures(new Set());
    setTags(new Set());
    setOwned("all");
    setPublisher(null);
  };

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

  return (
    <main className="main market">
      <header className="libraryHead marketHead">
        <div>
          <h2>Marketplace</h2>
          <p className="muted">Packs anyone may add: the ones that come with the app, and what people have published. Free ones go straight to your packs; a priced one is bought from its publisher.</p>
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
          <button
            type="button"
            className="filtersToggle"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {filtersOpen ? "Hide the filters" : "Filters"}
            {narrowed && <span className="chip ok">on</span>}
          </button>

          <div className="facet">
            <h4 className="facetTitle">Show</h4>
            <div className="options">
              {(["all", "mine", "new"] as const).map((o) => (
                <button key={o} className={`chip pick ${owned === o ? "on" : ""}`} onClick={() => setOwned(o)}>
                  {o === "all" ? "Everything" : o === "mine" ? "In your packs" : "Not yet yours"}
                </button>
              ))}
            </div>
          </div>

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

          {sides.categories.length > 0 && (
            <div className="facet">
              <h4 className="facetTitle">Category</h4>
              <ul className="facetList">
                {sides.categories.map((c) => (
                  <li key={c.value}>
                    <label>
                      <input type="checkbox" checked={categories.has(c.value)} onChange={() => toggle(categories, c.value, setCategories)} />
                      <span>{c.value}</span>
                      <span className="muted num">{c.count}</span>
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
                      <input type="radio" name="publisher" checked={publisher === p.id} onChange={() => setPublisher(p.id)} onClick={() => publisher === p.id && setPublisher(null)} />
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
                  <button key={t.value} className={`chip pick ${tags.has(t.value) ? "on" : ""}`} onClick={() => toggle(tags, t.value, setTags)}>
                    {t.value}
                  </button>
                ))}
              </div>
            </div>
          )}

          {narrowed && (
            <button className="ghost tiny" onClick={clear}>
              Clear filters
            </button>
          )}
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
          {entries === null && <p className="muted small">Reading the marketplace…</p>}
          {entries !== null && (
            <p className="muted small marketCount">
              {shown.length === all.length ? `${all.length} packs` : `${shown.length} of ${all.length} packs`}
            </p>
          )}
          {entries !== null && shown.length === 0 && (
            <p className="muted">Nothing matches. Loosen a filter, or clear them.</p>
          )}
          <div className="marketGrid">
            {shown.map((e) => {
              const have = mine.has(e.id);
              return (
                <article key={e.id} className="panel marketCard">
                  <header className="marketCardHead">
                    <span className="pill">{e.category}</span>
                    <span className={`muted small ${e.price !== "free" ? "priceTag" : ""}`}>{e.price === "free" ? "free" : e.price.display}</span>
                  </header>
                  <h3 className="marketTitle">
                    {e.title}
                    {e.bench && <span className="chip cap">test bench</span>}
                  </h3>
                  <p className="muted small">
                    {e.author && `by ${e.author} · `}v{e.version}
                    {e.players > 1 && ` · up to ${e.players} people`}
                    {e.publisher && e.publisher.name !== e.author && (
                      <>
                        {" · "}
                        <button className="publisherLink" onClick={() => setPublisher(e.publisher!.id)} title={`Everything ${e.publisher.name} has listed`}>
                          {e.publisher.name}
                        </button>
                      </>
                    )}
                  </p>
                  {e.description && <p className="marketBlurb clamp">{e.description}</p>}
                  {e.requires.length > 0 && (
                    <p className="muted small marketNeeds">
                      {e.requires.some((r) => !r.optional) && (
                        <>
                          <strong>Needs:</strong> {e.requires.filter((r) => !r.optional).map((r) => r.label).join("; ")}.{" "}
                        </>
                      )}
                      {e.requires.some((r) => r.optional) && (
                        <>
                          <strong>Better with:</strong> {e.requires.filter((r) => r.optional).map((r) => r.label).join("; ")}.
                        </>
                      )}
                    </p>
                  )}
                  <div className="entryTags">
                    {e.features.map((f) => (
                      <span key={f} className="chip cap" title={FEATURES.find((x) => x.id === f)?.what}>
                        {FEATURES.find((x) => x.id === f)?.label ?? f}
                      </span>
                    ))}
                  </div>
                  {e.tags.length > 0 && (
                    <div className="entryTags">
                      {e.tags.map((t) => (
                        <button key={t} className={`chip pick ${tags.has(t) ? "on" : ""}`} title="Filter by this tag" onClick={() => toggle(tags, t, setTags)}>
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                  <footer className="marketCardFoot">
                    <div className="marketCardFootLeft">
                      <button className="ghost tiny" disabled={reading === e.id} title="The summary, and the rest of the pack's paper, in the side drawer" onClick={() => void showDocs(e)}>
                        {reading === e.id ? "Reading…" : "Docs"}
                      </button>
                      {have && <span className="chip cap">In your packs</span>}
                    </div>
                    {have ? (
                      <button className="ghost tiny" onClick={() => onOpen(e.id)}>
                        Open
                      </button>
                    ) : bought.has(e.id) && onFetch ? (
                      <button
                        className="primary tiny"
                        disabled={busy === e.id}
                        title="You bought this; fetch your copy onto this device"
                        onClick={() => {
                          setBusy(e.id);
                          void onFetch(e).finally(() => setBusy(null));
                        }}
                      >
                        {busy === e.id ? "Fetching…" : "Yours · get your copy"}
                      </button>
                    ) : e.price !== "free" ? (
                      <button
                        className="primary tiny"
                        disabled={busy === e.id || !onBuy}
                        title={onBuy ? `Buy from ${e.publisher?.name ?? "its publisher"}` : "Sign in to buy"}
                        onClick={() => {
                          if (!onBuy) return;
                          setBusy(e.id);
                          void onBuy(e).finally(() => setBusy(null));
                        }}
                      >
                        {busy === e.id ? "Opening…" : `Buy · ${e.price.display}`}
                      </button>
                    ) : (
                      <button
                        className="primary tiny"
                        disabled={busy === e.id}
                        onClick={() => {
                          setBusy(e.id);
                          void onAdd(e).finally(() => setBusy(null));
                        }}
                      >
                        {busy === e.id ? "Adding…" : "Add to my packs"}
                      </button>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
