import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DOC_KINDS, generateDoc, toHtml, type Doc, type DocKind, type Pack } from "@runlog/rules-schema";
import { DocView } from "./DocView.tsx";

/**
 * A pack's paper, read in place.
 *
 * A reader who wants the quick start wants to read it, not to be handed a
 * file: the drawer slides in from the side with the document rendered,
 * the other kinds a press away, and stays over whatever they were doing.
 * Printing opens the same document as its own page, which the browser
 * prints to paper or PDF with the columns and page breaks already right.
 * Files as such — HTML and Markdown to keep — are the Designer's, where
 * an author is producing them.
 *
 * Two ways in: a pack and a kind, which lays out every kind as a tab; or
 * a set of documents already made — a watcher's summary and the mode's,
 * say, which may have been written by the server from a pack this device
 * does not hold.
 */

export interface DocTab {
  label: string;
  what?: string;
  make: () => Doc;
}

interface Opened {
  title: string;
  tabs: DocTab[];
  index: number;
}

const DocDrawerContext = createContext<{ open: (pack: Pack, kind: DocKind) => void; show: (title: string, tabs: DocTab[]) => void }>({
  open: () => {},
  show: () => {},
});

export function useDocDrawer() {
  return useContext(DocDrawerContext);
}

export function DocDrawerProvider({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const open = useCallback((pack: Pack, kind: DocKind) => {
    const tabs = DOC_KINDS.map((k) => ({ label: k.label, what: k.what, make: () => generateDoc(pack, k.kind) }));
    setOpened({ title: pack.title, tabs, index: Math.max(0, DOC_KINDS.findIndex((k) => k.kind === kind)) });
  }, []);
  const show = useCallback((title: string, tabs: DocTab[]) => {
    if (tabs.length > 0) setOpened({ title, tabs, index: 0 });
  }, []);
  const value = useMemo(() => ({ open, show }), [open, show]);

  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpened(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opened]);

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
        <div className="drawerVeil" onClick={() => setOpened(null)} role="presentation">
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
                      onClick={() => setOpened({ ...opened, index: i })}
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
                <button className="ghost tiny" onClick={() => setOpened(null)} aria-label="Close">
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
