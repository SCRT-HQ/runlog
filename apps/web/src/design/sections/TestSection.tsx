import { useState } from "react";
import { generateDoc, type Diagnostic, type Pack, type ParseResult } from "@runlog/rules-schema";
import { DocView } from "../../docs/DocView.tsx";
import { RowActions } from "../fields.tsx";
import { StructurePanel } from "../StructurePanel.tsx";
import { sectionOfPath, type Section } from "./model.ts";
import { Severity } from "../../ui/Severity.tsx";

/* ------------------------------------------------------------------ */

/** What the checks say about the draft, and the pack they describe once it loads. */
export function TestSection({ result, onGo }: { result: ParseResult | null; onGo: (section: Section, path: string) => void }) {
  return (
    <>
      <Problems diagnostics={result?.diagnostics ?? []} onGo={onGo} />
      {result?.ok && <Rulebook pack={result.pack} />}
      {result?.ok && <StructurePanel pack={result.pack} warnings={result.diagnostics} random={() => Math.random} />}
    </>
  );
}

/**
 * The rulebook, where the rules are being tried.
 *
 * Checking your own words is reading them, and the document that has them
 * all lives in Publish, three sections away from the place an author is
 * when they want it. The same generated document and the same view as the
 * Documents panel; the panel keeps the other four kinds and every way of
 * saving one.
 */
function Rulebook({ pack }: { pack: Pack }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel">
      <RowActions>
        <button className="ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Read the rulebook"}
        </button>
      </RowActions>
      {open && (
        <div className="docPreview">
          <DocView doc={generateDoc(pack, "rulebook")} heading />
        </div>
      )}
    </section>
  );
}

/**
 * Everything the linter has to say, in one place.
 *
 * Duplicated deliberately: each problem also appears against its own field,
 * which is where it gets fixed, but a list is how you find out there is one at
 * all in a section you have not scrolled to.
 *
 * Each row is a button, because the list is now the way across the editor:
 * it knows which section owns the path and which field carries it, and a
 * person reading a problem is already on their way to the field.
 */
function Problems({ diagnostics, onGo }: { diagnostics: Diagnostic[]; onGo: (section: Section, path: string) => void }) {
  return (
    <section className="panel">
      <h3 className="sectionTitle">
        What it says <span className="muted">the same checks the CLI runs</span>
      </h3>
      {diagnostics.length === 0 ? (
        <p className="agreeing">Nothing to report. This pack loads.</p>
      ) : (
        <ul className="problemList">
          {diagnostics.map((d, i) => (
            <li key={i} className={d.level}>
              <button type="button" className="problemRow" onClick={() => onGo(sectionOfPath(d.path), d.path)}>
                <code>{d.path || "pack"}</code>
                <span>
                  <Severity level={d.level} show="word" />
                  {d.message}
                </span>
                <span className="muted small">{d.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
