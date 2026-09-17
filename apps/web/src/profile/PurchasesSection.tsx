import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Api, Purchase } from "../sync/client.ts";
import { Button } from "../ui/Button.tsx";

type Owner = { api: Api; generation: number };
type PurchaseListState = Owner & ({ kind: "loading" } | { kind: "loaded"; purchases: Purchase[] } | { kind: "error"; retrying: boolean });

type DownloadAction = { kind: "downloading" } | { kind: "error"; message: string };
type DownloadState = Owner & { rows: Record<string, DownloadAction> };

/**
 * What this account has bought: each with its key, since the key is the
 * receipt, and a download of the sealed copy for a device that has not
 * got it. The copy opens like any sealed file, from the library's
 * "Load a pack from a file", with the key kept in the account.
 */
export function PurchasesSection({ api }: { api: Api | null }) {
  const [list, setList] = useState<PurchaseListState | null>(null);
  const [downloads, setDownloads] = useState<DownloadState | null>(null);
  const listRequest = useRef(0);
  const pendingDownloads = useRef(new Map<string, Owner & { token: object }>());
  const committedApi = useRef(api);
  const committedGeneration = useRef(0);
  const mounted = useRef(true);
  const renderGeneration = committedApi.current === api ? committedGeneration.current : committedGeneration.current + 1;

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listRequest.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    if (committedApi.current !== api) {
      committedApi.current = api;
      committedGeneration.current += 1;
      pendingDownloads.current.clear();
    }
  }, [api]);

  const requestPurchases = (source: Api, generation: number, retrying: boolean) => {
    const request = ++listRequest.current;
    setList((present) =>
      retrying && present?.api === source && present.generation === generation && present.kind === "error"
        ? { ...present, retrying: true }
        : { api: source, generation, kind: "loading" },
    );
    void source.myPurchases().then(
      (purchases) => {
        if (
          mounted.current &&
          committedApi.current === source &&
          committedGeneration.current === generation &&
          listRequest.current === request
        ) {
          setList({ api: source, generation, kind: "loaded", purchases });
        }
      },
      () => {
        if (
          mounted.current &&
          committedApi.current === source &&
          committedGeneration.current === generation &&
          listRequest.current === request
        ) {
          setList({ api: source, generation, kind: "error", retrying: false });
        }
      },
    );
  };

  useEffect(() => {
    if (!api) {
      listRequest.current += 1;
      return;
    }
    requestPurchases(api, committedGeneration.current, false);
    return () => {
      listRequest.current += 1;
    };
  }, [api]);

  const setDownload = (source: Api, generation: number, ref: string, action: DownloadAction | null) => {
    setDownloads((present) => {
      const rows = present?.api === source && present.generation === generation ? { ...present.rows } : {};
      if (action) rows[ref] = action;
      else delete rows[ref];
      return { api: source, generation, rows };
    });
  };

  const download = async (source: Api, generation: number, purchase: Purchase) => {
    const pending = pendingDownloads.current.get(purchase.ref);
    if (pending?.api === source && pending.generation === generation) return;
    const token = {};
    pendingDownloads.current.set(purchase.ref, { api: source, generation, token });
    setDownload(source, generation, purchase.ref, { kind: "downloading" });
    try {
      const bytes = await source.purchaseFile(purchase.ref);
      const active = pendingDownloads.current.get(purchase.ref);
      if (!mounted.current || committedApi.current !== source || committedGeneration.current !== generation || active?.token !== token)
        return;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${purchase.packId}.rlpack`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDownload(source, generation, purchase.ref, null);
    } catch (error) {
      const active = pendingDownloads.current.get(purchase.ref);
      if (!mounted.current || committedApi.current !== source || committedGeneration.current !== generation || active?.token !== token)
        return;
      const detail = error instanceof Error && error.message ? error.message : "The copy could not be fetched.";
      setDownload(source, generation, purchase.ref, { kind: "error", message: `${purchase.title}: ${detail}` });
    } finally {
      if (pendingDownloads.current.get(purchase.ref)?.token === token) pendingDownloads.current.delete(purchase.ref);
    }
  };

  if (!api || list?.api !== api || list.generation !== renderGeneration || list.kind === "loading") return null;

  const rows = downloads?.api === api && downloads.generation === renderGeneration ? downloads.rows : {};
  if (list.kind === "error") {
    return (
      <section className="panel purchasePanel">
        <h3 className="sectionTitle">
          Purchases <span className="muted">sealed copies you bought</span>
        </h3>
        <div className="purchaseListError">
          <p role="status">Purchases could not be loaded.</p>
          <Button size="compact" loading={list.retrying} onClick={() => requestPurchases(api, renderGeneration, true)}>
            Try again
          </Button>
        </div>
      </section>
    );
  }

  if (list.purchases.length === 0) return null;

  return (
    <section className="panel purchasePanel">
      <h3 className="sectionTitle">
        Purchases <span className="muted">sealed copies you bought</span>
      </h3>
      {list.purchases.map((purchase) => {
        const action = rows[purchase.ref];
        return (
          <div key={purchase.ref} className="purchaseItem">
            <div className="row spread purchaseRow">
              <div className="purchaseDetails">
                <strong>{purchase.title}</strong>
                <span className="muted purchaseMeta">
                  {" "}
                  ·{" "}
                  {purchase.status === "fulfilled"
                    ? "ready"
                    : purchase.status === "revoked"
                      ? "revoked by the publisher"
                      : "being prepared"}
                  {purchase.createdAt ? ` · ${purchase.createdAt.slice(0, 10)}` : ""}
                </span>
                {purchase.key && <div className="muted purchaseKey">{purchase.key}</div>}
              </div>
              {purchase.status === "fulfilled" && (
                <Button
                  size="compact"
                  loading={action?.kind === "downloading"}
                  loadingLabel="Downloading…"
                  onClick={() => void download(api, renderGeneration, purchase)}
                >
                  Download the copy
                </Button>
              )}
            </div>
            {action?.kind === "error" && (
              <p className="purchaseError" role="status">
                {action.message}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
