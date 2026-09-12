import { useState } from "react";
import { DOC_KINDS, type Pack } from "@runlog/rules-schema";
import { useDocDrawer, type DocsAt } from "./DocDrawer.tsx";

/**
 * The paper for a pack, for a reader: a small menu naming each document,
 * each opening in the side drawer. The pack is handed in lazily because a
 * library row may not have parsed its text yet.
 */
export function DocMenu({ pack, compact = false, at }: { pack: Pack | (() => Pack | null); compact?: boolean; /** Where this pack is read, so the document it opens has an address. Absent on a watcher's page, where there is no library behind it. */ at?: DocsAt }) {
  const [open, setOpen] = useState(false);
  const drawer = useDocDrawer();
  const resolve = () => (typeof pack === "function" ? pack() : pack);

  return (
    <details className="docMenu" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={`ghost ${compact ? "tiny" : ""} summaryButton`}>
        Documents <span className="caret" aria-hidden="true">▾</span>
      </summary>
      <div className="docMenuPanel" role="menu">
        <p className="muted small">Written from the pack as it is.</p>
        <ul className="docMenuList">
          {DOC_KINDS.map((k) => (
            <li key={k.kind}>
              <button
                className="docMenuItem"
                role="menuitem"
                title={k.what}
                onClick={() => {
                  const p = resolve();
                  setOpen(false);
                  if (p) drawer.open(p, k.kind, at);
                }}
              >
                <span className="docMenuLabel">{k.label}</span>
                <span className="muted small">view</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
