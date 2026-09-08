import { useEffect, useState } from "react";
import { useHosted } from "../hosted/HostedProvider.tsx";
import type { Api } from "../sync/client.ts";
import { usePlan } from "../sync/usePlan.ts";

/**
 * The plan, and the two doors: Checkout to start one, the Portal to
 * manage it. Both are Stripe's pages; the app sends the person there and
 * reads what changed when they come back with `?billing=` on the address.
 * Shown where the hosted copy has billing on, or where plans gate
 * something; a copy with neither has nothing to sell.
 */
export function PlanSection({ api }: { api: Api | null }) {
  const hosted = useHosted();
  const plan = usePlan();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Back from Stripe: read what happened, say so, and clean the address.
  useEffect(() => {
    let outcome: string | null = null;
    try {
      const url = new URL(location.href);
      outcome = url.searchParams.get("billing");
      if (outcome) {
        url.searchParams.delete("billing");
        history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
      }
    } catch {
      /* nothing to read */
    }
    if (!outcome || !api) return;
    if (outcome === "done") {
      setNote("Thank you. Reading what Stripe says…");
      void api.refreshEntitlements().then(
        (features) => {
          setNote(features.includes("plus") ? "You are on Plus." : "The payment went through; the plan lands in a moment. Press Refresh if it does not.");
          void plan.refresh();
        },
        () => setNote("The payment went through, but the plan could not be read just now. Press Refresh."),
      );
    } else if (outcome === "cancelled") setNote("Nothing was charged.");
    else if (outcome === "managed") void plan.refresh();
    // The plan's refresh is stable enough; this runs once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const billing = Boolean(hosted?.features.billing) || plan.gates;
  if (!api || !billing) return null;
  const plus = plan.entitlements.includes("plus");

  const go = async (fn: () => Promise<{ url: string } | { available: false }>) => {
    setBusy(true);
    setNote(null);
    try {
      const out = await fn();
      if ("url" in out) location.href = out.url;
      else setNote("Billing is not switched on here yet.");
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "That could not be started.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Plan: <span className="muted">{plus ? "Plus" : "Free"}</span>
      </h3>
      <p className="muted small">
        {plus
          ? "Hosting a table — people in your runs on their own devices, races across devices — is yours. Manage the subscription, cards and invoices with Stripe."
          : plan.gates
            ? "Free plays everything on one device and syncs your own. Plus hosts a table: invitations and races across devices."
            : "Plans are not switched on here yet: everything is open while Runlog is in preview."}
      </p>
      <div className="padRow">
        {plus ? (
          <button className="ghost" disabled={busy} onClick={() => void go(() => api.portal())}>
            Manage subscription
          </button>
        ) : (
          <>
            <button className="primary tiny" disabled={busy} onClick={() => void go(() => api.checkout("plus-monthly"))}>
              Plus, $4 a month
            </button>
            <button className="ghost" disabled={busy} onClick={() => void go(() => api.checkout("plus-yearly"))}>
              $36 a year
            </button>
          </>
        )}
        <button className="ghost tiny" disabled={busy} onClick={() => void api.refreshEntitlements().then(() => plan.refresh())}>
          Refresh
        </button>
        {hosted?.links.pricing && (
          <a className="ghost tiny buttonLink" href={hosted.links.pricing}>
            What each plan has
          </a>
        )}
      </div>
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}
