import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DOC_KINDS, generateDoc, toHtml, type Doc, type DocKind, type Pack } from "@runlog/rules-schema";
import { goTo } from "../route.ts";
import { DocView } from "./DocView.tsx";

/**
 * A pack's paper, read in place.
 *
 * A reader who wants the quick start wants to read it, not to be handed a
 * file: the drawer slides in from the side with the document rendered,
 * the other kinds a press away, and stays over whatever they were doing.
 * Printing opens the same document as its own page, which the browser
 * prints to paper or PDF with the columns and page breaks already right.
 * Files as such, HTML and Markdown to keep, are the Designer's, where
 * an author is producing them.
 *
 * Two ways in: a pack and a kind, which lays out every kind as a tab; or
 * a set of documents already made: a watcher's summary and the mode's,
 * say, which may have been written by the server from a pack this device
 * does not hold.
 *
 * Opened the first way it has an address, `#packs/<id>/docs/<kind>` or
 * the same under `marketplace`, so a rulebook is a thing you can send
 * someone and a reload leaves it open at the page it was on. Opened the
 * second way it has none: those documents were made for the screen they
 * are on and there is no pack behind them to name.
 */

export interface DocTab {
  label: string;
  what?: string;
  make: () => Doc;
}

/** Where a pack's paper was opened from, which is what its address says. */
export interface DocsAt {
  section: "packs" | "marketplace";
  id: string;
}

interface Opened {
  title: string;
  tabs: DocTab[];
  index: number;
  /** Absent for documents handed in ready-made: nothing to name them by. */
  at?: DocsAt;
}

/**
 * A pack's paper named in an address: which section it is read in, which
 * pack, and which document. `#packs/<id>/docs` is the summary, and a kind
 * after it is that document; anything else is not this.
 */
export function docsFromHash(hash: string): { at: DocsAt; kind: DocKind } | null {
  const m = /^#(packs|marketplace)\/([^/?#]+)\/docs(?:\/([a-z]+))?$/.exec(hash);
  if (!m) return null;
  const kind = m[3] ?? "summary";
  if (!DOC_KINDS.some((k) => k.kind === kind)) return null;
  return { at: { section: m[1] as DocsAt["section"], id: decodeURIComponent(m[2]!) }, kind: kind as DocKind };
}

/** The address of one document, and of the place to go back to when it closes. */
const docsHash = (at: DocsAt, kind: DocKind): string => `#${at.section}/${encodeURIComponent(at.id)}/docs${kind === "summary" ? "" : `/${kind}`}`;
const backHash = (at: DocsAt): string => (at.section === "marketplace" ? `#marketplace/${encodeURIComponent(at.id)}` : "#packs");

const DocDrawerContext = createContext<{ open: (pack: Pack, kind: DocKind, at?: DocsAt) => void; show: (title: string, tabs: DocTab[]) => void }>({
  open: () => {},
  show: () => {},
});

export function useDocDrawer() {
  return useContext(DocDrawerContext);
}

export function DocDrawerProvider({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const open = useCallback((pack: Pack, kind: DocKind, at?: DocsAt) => {
    const tabs = DOC_KINDS.map((k) => ({ label: k.label, what: k.what, make: () => generateDoc(pack, k.kind) }));
    const index = Math.max(0, DOC_KINDS.findIndex((k) => k.kind === kind));
    setOpened({ title: pack.title, tabs, index, ...(at ? { at } : {}) });
    // Pushed rather than replaced: closing the drawer is a Back away.
    if (at) goTo(docsHash(at, DOC_KINDS[index]?.kind ?? "summary"), "push");
  }, []);
  const show = useCallback((title: string, tabs: DocTab[]) => {
    if (tabs.length > 0) setOpened({ title, tabs, index: 0 });
  }, []);
  const close = useCallback(() => {
    setOpened((was) => {
      if (was?.at) goTo(backHash(was.at));
      return null;
    });
  }, []);

  const value = useMemo(() => ({ open, show }), [open, show]);

  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opened, close]);

  const tab = opened ? opened.tabs[opened.index] : undefined;
  const doc = useMemo(() => (tab ? tab.make() : null), [tab]);

  const print = () => {
    if (!doc) return;
    const url = URL.createObjectURL(new Blob([toHtml(doc)], { type: "text/html" }));
    const w = window.open(url, "_blank");
    // The object URL must outlive the navigation; a minute is plenty.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (!w) location.href = url;
  };

  return (
    <DocDrawerContext.Provider value={value}>
      {children}
      {opened && tab && doc && (
        <div className="drawerVeil" onClick={close} role="presentation">
          <aside className="docDrawer" role="dialog" aria-modal="true" aria-label={`${doc.title}: ${tab.label}`} onClick={(e) => e.stopPropagation()}>
            <header className="docDrawerHead">
              <div>
                <strong>{opened.title}</strong>
                <div className="docDrawerKinds" role="tablist">
                  {opened.tabs.map((t, i) => (
                    <button
                      key={t.label}
                      role="tab"
                      aria-selected={i === opened.index}
                      className={`chip pick ${i === opened.index ? "on" : ""}`}
                      title={t.what}
                      onClick={() => {
                        setOpened({ ...opened, index: i });
                        if (opened.at) goTo(docsHash(opened.at, DOC_KINDS[i]?.kind ?? "summary"));
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="padRow">
                <button className="ghost tiny" onClick={print} title="Open it as its own page and print it, to paper or a PDF">
                  Print
                </button>
                <button className="ghost tiny" onClick={close} aria-label="Close">
                  Close
                </button>
              </div>
            </header>
            <div className="docDrawerBody">
              <DocView doc={doc} heading />
            </div>
          </aside>
        </div>
      )}
    </DocDrawerContext.Provider>
  );
}
