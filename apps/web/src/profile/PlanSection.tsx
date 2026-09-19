import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHosted } from "../hosted/HostedProvider.tsx";
import type { Api } from "../sync/client.ts";
import { usePlan } from "../sync/usePlan.ts";
import { Button, ButtonLink } from "../ui/Button.tsx";

type Action = "monthly" | "yearly" | "portal" | "refresh";
type Owner = { api: Api; generation: number };
type ActionState = Owner & { action: Action };
type NoteState = Owner & { message: string };

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
  const [working, setWorking] = useState<ActionState | null>(null);
  const [note, setNote] = useState<NoteState | null>(null);
  const active = useRef<(Owner & { token: object }) | null>(null);
  const committedApi = useRef(api);
  const committedGeneration = useRef(0);
  const mounted = useRef(true);
  const renderGeneration = committedApi.current === api ? committedGeneration.current : committedGeneration.current + 1;

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (committedApi.current !== api) {
      committedApi.current = api;
      committedGeneration.current += 1;
      active.current = null;
    }
  }, [api]);

  const owns = (owner: Owner) => mounted.current && committedApi.current === owner.api && committedGeneration.current === owner.generation;

  const say = (owner: Owner, message: string) => {
    if (owns(owner)) setNote({ ...owner, message });
  };

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
    const owner = { api, generation: committedGeneration.current };
    if (outcome === "done") {
      say(owner, "Thank you. Reading what Stripe says…");
      void api.refreshEntitlements().then(
        (features) => {
          if (!owns(owner)) return;
          say(
            owner,
            features.includes("plus")
              ? "You are on Plus."
              : "The payment went through; the plan lands in a moment. Press Refresh if it does not.",
          );
          void plan.refresh();
        },
        () => say(owner, "The payment went through, but the plan could not be read just now. Press Refresh."),
      );
    } else if (outcome === "canceled") say(owner, "Nothing was charged.");
    else if (outcome === "managed" && owns(owner)) void plan.refresh();
    // The plan's refresh is stable enough; this runs once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (!api) return null;
  if (plan.state.kind === "checking" || plan.state.kind === "loading") {
    return (
      <section className="panel planPanel">
        <h3 className="sectionTitle">Plan</h3>
        <p className="muted small">Checking your plan…</p>
      </section>
    );
  }
  if (plan.state.kind === "error") {
    return (
      <section className="panel planPanel">
        <h3 className="sectionTitle">Plan</h3>
        <p className="muted small">
          The plan could not be checked.{" "}
          <button className="linkButton" onClick={() => void plan.refresh()}>
            Try again
          </button>
        </p>
      </section>
    );
  }
  if (plan.state.kind !== "ready") return null;
  const billing = Boolean(hosted?.features.billing) || plan.state.gates;
  if (!billing) return null;
  const plus = plan.state.capabilities.hostTables;
  const planAccess = plan.access("hostTables");
  const owner = { api, generation: renderGeneration };
  const action = working?.api === api && working.generation === renderGeneration ? working.action : null;
  const message = note?.api === api && note.generation === renderGeneration ? note.message : "";

  const run = async (
    kind: Action,
    fn: (stillCurrent: () => boolean) => Promise<{ url: string } | { available: false } | string[] | void>,
  ) => {
    const present = active.current;
    if (present?.api === api && present.generation === renderGeneration) return;
    const request = { ...owner, token: {} };
    active.current = request;
    setWorking({ ...owner, action: kind });
    setNote(null);
    try {
      const out = await fn(() => owns(owner) && active.current?.token === request.token);
      if (!owns(owner) || active.current?.token !== request.token) return;
      if (Array.isArray(out) || out === undefined) return;
      if ("url" in out) location.href = out.url;
      else say(owner, "Billing is not switched on here yet.");
    } catch (error) {
      if (!owns(owner) || active.current?.token !== request.token) return;
      say(
        owner,
        kind === "refresh"
          ? "The plan could not be refreshed just now. Try again."
          : error instanceof Error && error.message
            ? error.message
            : "That could not be started.",
      );
    } finally {
      if (owns(owner) && active.current?.token === request.token) {
        active.current = null;
        setWorking(null);
      }
    }
  };

  const refresh = () =>
    run("refresh", async (stillCurrent) => {
      await api.refreshEntitlements();
      if (!stillCurrent()) return;
      await plan.refresh();
    });

  return (
    <section className="panel planPanel">
      <h3 className="sectionTitle">
        Plan: <span className="muted">{plus ? "Plus" : "Free"}</span>
      </h3>
      <p className="muted planSummary">
        {plus
          ? "Hosting a table, people in your runs on their own devices, races across devices, is yours. Manage the subscription, cards and invoices with Stripe."
          : planAccess === "upgrade"
            ? "Free plays everything on one device and syncs your own. Plus hosts a table: invitations and races across devices."
            : "Plans are not switched on here yet: everything is open while Runlog is in preview."}
      </p>
      <div className="padRow">
        {plus ? (
          <Button
            disabled={action !== null}
            loading={action === "portal"}
            loadingLabel="Opening billing…"
            onClick={() => void run("portal", () => api.portal())}
          >
            Manage subscription
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              size="compact"
              disabled={action !== null}
              loading={action === "monthly"}
              loadingLabel="Opening checkout…"
              onClick={() => void run("monthly", () => api.checkout("plus-monthly"))}
            >
              Plus, $4 a month
            </Button>
            <Button
              disabled={action !== null}
              loading={action === "yearly"}
              loadingLabel="Opening checkout…"
              onClick={() => void run("yearly", () => api.checkout("plus-yearly"))}
            >
              $36 a year
            </Button>
          </>
        )}
        <Button
          size="compact"
          disabled={action !== null}
          loading={action === "refresh"}
          loadingLabel="Refreshing…"
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
        {hosted?.links.pricing && (
          <ButtonLink size="compact" className="buttonLink" href={hosted.links.pricing}>
            What each plan has
          </ButtonLink>
        )}
      </div>
      <p className="muted planStatus" role="status">
        {message}
      </p>
    </section>
  );
}
