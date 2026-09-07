import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DOC_KINDS, generateDoc, toHtml, type DocKind, type Pack } from "@runlog/rules-schema";
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
 */

interface Opened {
  pack: Pack;
  kind: DocKind;
}

const DocDrawerContext = createContext<{ open: (pack: Pack, kind: DocKind) => void }>({ open: () => {} });

export function useDocDrawer() {
  return useContext(DocDrawerContext);
}

export function DocDrawerProvider({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const open = useCallback((pack: Pack, kind: DocKind) => setOpened({ pack, kind }), []);
  const value = useMemo(() => ({ open }), [open]);

  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpened(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opened]);

  const doc = useMemo(() => (opened ? generateDoc(opened.pack, opened.kind) : null), [opened]);

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
      {opened && doc && (
        <div className="drawerVeil" onClick={() => setOpened(null)} role="presentation">
          <aside className="docDrawer" role="dialog" aria-modal="true" aria-label={`${doc.title}: ${DOC_KINDS.find((k) => k.kind === opened.kind)?.label ?? opened.kind}`} onClick={(e) => e.stopPropagation()}>
            <header className="docDrawerHead">
              <div>
                <strong>{opened.pack.title}</strong>
                <div className="docDrawerKinds" role="tablist">
                  {DOC_KINDS.map((k) => (
                    <button
                      key={k.kind}
                      role="tab"
                      aria-selected={k.kind === opened.kind}
                      className={`chip pick ${k.kind === opened.kind ? "on" : ""}`}
                      title={k.what}
                      onClick={() => setOpened({ pack: opened.pack, kind: k.kind })}
                    >
                      {k.label}
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
