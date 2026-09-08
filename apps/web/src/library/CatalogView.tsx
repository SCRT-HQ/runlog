import { useEffect, useMemo, useState } from "react";
import { generateDoc, loadPackText, type Doc, type Pack } from "@runlog/rules-schema";
import { DocView } from "../docs/DocView.tsx";
import { DocMenu } from "../docs/DocMenu.tsx";
import { facets, FEATURES, filterCatalog, loadCatalog, publishersOf, type CatalogEntry, type Feature } from "./catalog.ts";

/**
 * The catalog, laid out as a market: cards in a grid, a sidebar to narrow
 * them. Everything here is free and comes with the app for now; the shape
 * is the one a marketplace with publishers and prices will fill in.
 *
 * What the sidebar filters on comes from the packs themselves: a category
 * and tags the author wrote, and features read off the modes — solo,
 * together, moderated, seeded — so "show me something we can all play"
 * is a checkbox and not a search for the right word.
 *
 * "About" opens the pack's summary, written from the pack: the shape of the
 * game — its tables by name, its modes, what you need — and never its
 * rules. It is what a listing shows before anyone has the pack.
 */
export function CatalogView({
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
  onAdd: (entry: CatalogEntry) => Promise<void>;
  /** Buy a priced listing; absent where nobody is signed in. */
  onBuy?: (entry: CatalogEntry) => Promise<void>;
  /** Bring a bought copy onto this device. */
  onFetch?: (entry: CatalogEntry) => Promise<void>;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [about, setAbout] = useState<{ id: string; doc: Doc | null; pack: Pack | null } | null>(null);
  const [q, setQ] = useState("");
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [features, setFeatures] = useState<Set<Feature>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [owned, setOwned] = useState<"all" | "mine" | "new">("all");
  const [publisher, setPublisher] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadCatalog().then((all) => live && setEntries(all));
    return () => {
      live = false;
    };
  }, []);

  // Arriving on a pack: its About opens once the feed is here, and the search finds it.
  useEffect(() => {
    if (!focus || !entries) return;
    const e = entries.find((x) => x.id === focus);
    if (!e) return;
    setQ(e.title);
    void showAbout(e);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, entries]);

  const all = entries ?? [];
  const sides = useMemo(() => facets(all), [all]);
  const publishers = useMemo(() => publishersOf(all), [all]);
  const who = publisher ? publishers.find((p) => p.id === publisher) ?? null : null;
  const shown = useMemo(
    () => filterCatalog(all, { q, categories, features, tags, ...(owned === "all" ? {} : { mine: owned === "mine" }), ...(publisher ? { publisher } : {}) }, new Set([...mine, ...bought])),
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

  const showAbout = async (e: CatalogEntry) => {
    if (about?.id === e.id) {
      setAbout(null);
      return;
    }
    setAbout({ id: e.id, doc: null, pack: null });
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
      setAbout({ id: e.id, doc, pack });
      return;
    }
    const loaded = loadPackText(await e.load(), "yaml");
    setAbout({ id: e.id, doc: loaded.ok ? generateDoc(loaded.pack, "summary") : null, pack: loaded.ok ? loaded.pack : null });
  };

  return (
    <main className="main market">
      <header className="libraryHead marketHead">
        <div>
          <h2>Catalog</h2>
          <p className="muted">Packs anyone may add: the ones that come with the app, and what people have published. Free ones go straight to your packs; a priced one is bought from its publisher.</p>
        </div>
        <button className="ghost tiny" onClick={onBack}>
          Back to your packs
        </button>
      </header>

      <div className="marketBody">
        <aside className="marketSide" aria-label="Search and filters">
          <label className="marketSearch">
            <span className="visuallyHidden">Search the catalog</span>
            <input className="textInput" type="search" value={q} placeholder="Search packs…" onChange={(e) => setQ(e.target.value)} />
          </label>

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
          {entries === null && <p className="muted small">Reading the catalog…</p>}
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
              const open = about?.id === e.id;
              return (
                <article key={e.id} className={`panel marketCard ${open ? "about" : ""}`}>
                  <header className="marketCardHead">
                    <span className="pill">{e.category}</span>
                    <span className={`muted small ${e.price !== "free" ? "priceTag" : ""}`}>{e.price === "free" ? "free" : e.price.display}</span>
                  </header>
                  <h3 className="marketTitle">{e.title}</h3>
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
                  {e.description && <p className={`marketBlurb ${open ? "" : "clamp"}`}>{e.description}</p>}
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
                      <button className="ghost tiny" onClick={() => void showAbout(e)}>
                        {open ? "Less" : "About"}
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
                  {open && (about.doc ? <DocView doc={about.doc} /> : <p className="muted small">Reading the pack…</p>)}
                  {open && about.pack && <DocMenu compact pack={about.pack} />}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
