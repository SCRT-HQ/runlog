import { useEffect, useState } from "react";
import type { Api, Purchase } from "../sync/client.ts";

/**
 * What this account has bought: each with its key, since the key is the
 * receipt, and a download of the sealed copy for a device that has not
 * got it. The copy opens like any sealed file — from the library's
 * "Load a pack from a file" — with the key kept in the account.
 */
export function PurchasesSection({ api }: { api: Api | null }) {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.myPurchases().then((p) => live && setPurchases(p), () => live && setPurchases([]));
    return () => {
      live = false;
    };
  }, [api]);
  if (!api || !purchases || purchases.length === 0) return null;

  const download = async (p: Purchase) => {
    try {
      const bytes = await api.purchaseFile(p.ref);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${p.packId}.rlpack`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "The copy could not be fetched.");
    }
  };

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Purchases <span className="muted">sealed copies you bought</span>
      </h3>
      {purchases.map((p) => (
        <div key={p.ref} className="row spread memberRow">
          <span>
            <strong>{p.title}</strong>
            <span className="muted small">
              {" "}
              · {p.status === "fulfilled" ? "ready" : p.status === "revoked" ? "revoked by the publisher" : "being prepared"}
              {p.createdAt ? ` · ${p.createdAt.slice(0, 10)}` : ""}
            </span>
            {p.key && <div className="mono small muted">{p.key}</div>}
          </span>
          {p.status === "fulfilled" && (
            <button className="ghost tiny" onClick={() => void download(p)}>
              Download the copy
            </button>
          )}
        </div>
      ))}
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}
