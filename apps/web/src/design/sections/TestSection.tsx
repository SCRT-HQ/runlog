import type { Diagnostic } from "@runlog/rules-schema";

/* ------------------------------------------------------------------ */

/**
 * Everything the linter has to say, in one place.
 *
 * Duplicated deliberately: each problem also appears against its own field,
 * which is where it gets fixed, but a list is how you find out there is one at
 * all in a section you have not scrolled to.
 */
export function Problems({ diagnostics }: { diagnostics: Diagnostic[] }) {
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
              <code>{d.path || "pack"}</code>
              <span>{d.message}</span>
              <span className="muted small">{d.code}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
