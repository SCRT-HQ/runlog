import { useState } from "react";
import { DOC_KINDS, generateDoc, toHtml, toMarkdown, type DocKind, type Pack } from "@runlog/rules-schema";
import { DocView } from "../docs/DocView.tsx";
import { docToPdf } from "../docs/pdfEngine.ts";

/**
 * The paper that goes with the pack, from the Designer.
 *
 * Every document is written from the draft as it stands, so it is never
 * behind the rules. The PDF is the one to hand to people; HTML is the same
 * document for a browser; Markdown is for editing or pasting. The
 * summary is what the catalog will show — worth a look before publishing,
 * since it is the first thing a stranger reads.
 */
export function DocsPanel({ pack }: { pack: Pack | null }) {
  const [preview, setPreview] = useState<DocKind | null>(null);
  const [making, setMaking] = useState<DocKind | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = async (kind: DocKind, format: "pdf" | "html" | "md") => {
    if (!pack) return;
    const doc = generateDoc(pack, kind);
    let body: BlobPart;
    let type: string;
    if (format === "pdf") {
      setMaking(kind);
      setNote(null);
      try {
        body = (await docToPdf(doc)) as BlobPart;
        type = "application/pdf";
      } catch (error) {
        setNote(error instanceof Error && error.message ? `The PDF did not come out: ${error.message}` : "The PDF did not come out.");
        return;
      } finally {
        setMaking(null);
      }
    } else {
      body = format === "html" ? toHtml(doc) : toMarkdown(doc);
      type = format === "html" ? "text/html" : "text/markdown";
    }
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pack.id}-${kind}.${format}`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Documents <span className="muted">written from the pack</span>
      </h3>
      {!pack && <p className="muted small">Once the pack loads, its rulebook, quick start, reference card, run log sheet and catalog summary can be made here.</p>}
      {pack && (
        <>
          <ul className="docKinds">
            {DOC_KINDS.map((k) => (
              <li key={k.kind}>
                <div>
                  <strong>{k.label}</strong>
                  <p className="muted small">{k.what}</p>
                </div>
                <div className="padRow">
                  <button className="ghost tiny" onClick={() => setPreview(preview === k.kind ? null : k.kind)}>
                    {preview === k.kind ? "Hide" : "Preview"}
                  </button>
                  <button className="ghost tiny" disabled={making !== null} onClick={() => void save(k.kind, "pdf")}>
                    {making === k.kind ? "Making…" : "PDF"}
                  </button>
                  <button className="ghost tiny" onClick={() => void save(k.kind, "html")}>
                    HTML
                  </button>
                  <button className="ghost tiny" onClick={() => void save(k.kind, "md")}>
                    Markdown
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {preview && (
            <div className="docPreview">
              <DocView doc={generateDoc(pack, preview)} heading />
            </div>
          )}
          {!pack.license.redistributable && <p className="muted small">This pack is private. The summary is safe to show anyone; the other four carry the whole game.</p>}
          {note && <p className="muted small">{note}</p>}
          <p className="muted small">The PDF is made here, in the browser; nothing is sent anywhere. To ship them all with the pack, bundle the documents under Sign.</p>
        </>
      )}
    </section>
  );
}
