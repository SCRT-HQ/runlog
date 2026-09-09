import { useEffect, useState } from "react";

/**
 * Back from Checkout, or in from a receipt's link.
 *
 * `?purchase=<ref>` is what Stripe sends the buyer back with; the mail
 * adds `&t=<token>` so the link works with no account. Both are read once,
 * taken off the address bar, and kept in sessionStorage until the copy
 * has been fetched or the banner dismissed: a sign-in in between is a
 * round trip. What happens next is the app's: a fetch of the sealed file
 * and the same opening a file from disk gets.
 */

const KEY = "runlog:purchase";

export interface IncomingPurchase {
  ref: string;
  token?: string;
}

function read(): IncomingPurchase | "cancelled" | null {
  try {
    const url = new URL(location.href);
    const ref = url.searchParams.get("purchase");
    if (ref) {
      const token = url.searchParams.get("t") ?? undefined;
      url.searchParams.delete("purchase");
      url.searchParams.delete("t");
      history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
      if (ref === "cancelled") return "cancelled";
      const incoming: IncomingPurchase = { ref, ...(token ? { token } : {}) };
      sessionStorage.setItem(KEY, JSON.stringify(incoming));
      return incoming;
    }
    const kept = sessionStorage.getItem(KEY);
    return kept ? (JSON.parse(kept) as IncomingPurchase) : null;
  } catch {
    return null;
  }
}

export function useIncomingPurchase(): { purchase: IncomingPurchase | null; cancelled: boolean; clear: () => void } {
  const [purchase, setPurchase] = useState<IncomingPurchase | null>(null);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    const found = read();
    if (found === "cancelled") setCancelled(true);
    else setPurchase(found);
  }, []);
  return {
    purchase,
    cancelled,
    clear: () => {
      setPurchase(null);
      setCancelled(false);
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* nothing to do */
      }
    },
  };
}

export type PurchaseState = { kind: "waiting" } | { kind: "signin" } | { kind: "opening" } | { kind: "error"; message: string };

export function PurchaseBanner({ state, onDismiss }: { state: PurchaseState; onDismiss: () => void }) {
  return (
    <div className={`incoming ${state.kind === "error" ? "bad" : ""}`}>
      <div className="incomingWhat">
        {state.kind === "waiting" && (
          <>
            <strong>Thank you.</strong>
            <span> Your copy is being prepared; it opens here the moment it is ready.</span>
          </>
        )}
        {state.kind === "signin" && (
          <>
            <strong>Your copy is ready.</strong>
            <span> Sign in as the account that bought it, or open the link in the receipt mail; either fetches it.</span>
          </>
        )}
        {state.kind === "opening" && <span>Fetching your copy…</span>}
        {state.kind === "error" && <span>{state.message}</span>}
      </div>
      <div className="incomingActions">
        <button className="ghost" onClick={onDismiss}>
          {state.kind === "waiting" ? "Later" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
