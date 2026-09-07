import type { Block, Doc } from "@runlog/rules-schema";

/**
 * A generated document, drawn in the app.
 *
 * The same blocks the Markdown and HTML renderers get, as elements in the
 * app's own type and color, so a pack's summary in the catalog reads like
 * the rest of the page and not like a pasted file.
 */
export function DocView({ doc, heading = false }: { doc: Doc; heading?: boolean }) {
  return (
    <div className={`doc doc-${doc.layout}`}>
      {heading && (
        <header className="docHead">
          <h3>{doc.title}</h3>
          {doc.subtitle && <p className="muted small">{doc.subtitle}</p>}
        </header>
      )}
      {doc.blocks.map((b, i) => (
        <DocBlock key={i} block={b} />
      ))}
    </div>
  );
}

function DocBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      const level = Math.min(4, block.level + 2);
      const Tag = `h${level}` as "h3" | "h4";
      return <Tag className="docH">{block.text}</Tag>;
    }
    case "paragraph":
      return <p className={block.tone === "muted" ? "muted small" : block.tone === "note" ? "docNote" : ""}>{block.text}</p>;
    case "list":
      return block.ordered ? (
        <ol className="docList">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="docList">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="docTableWrap">
          <table className={`docTable${block.compact ? " compact" : ""}`}>
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "terms":
      return (
        <dl className="docTerms">
          {block.items.map((t, i) => (
            <div key={i}>
              <dt>{t.term}</dt>
              <dd>{t.text}</dd>
            </div>
          ))}
        </dl>
      );
    case "form":
      return (
        <div className="docForm">
          {block.fields.map((f, i) => (
            <span key={i} className={`docField ${f.width ?? "short"}`}>
              <span className="docLabel">{f.label}</span>
              {f.box ? <span className="docBox" /> : <span className="docLine" />}
            </span>
          ))}
        </div>
      );
    case "rule":
      return <hr />;
    case "pagebreak":
      return null;
  }
}
