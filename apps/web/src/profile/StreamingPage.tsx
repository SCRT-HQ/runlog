import { useCallback, useEffect, useState } from "react";
import type { LookChannelSummaryV1 } from "@runlog/themes";
import { useLookChannel } from "../theme/follow/LookChannelProvider.tsx";
import type { LookActionResult } from "../theme/follow/publisher.ts";
import { lookActionProblem, type LookAction } from "../theme/follow/actionWords.ts";

/** The account's theme links: which device publishes each, a new address for one, or an end to it. */
export function StreamingPage() {
  const follow = useLookChannel();
  const { available, list } = follow;
  const [links, setLinks] = useState<readonly LookChannelSummaryV1[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    setProblem(null);
    try {
      setLinks(await list());
    } catch {
      setLinks(null);
      setProblem("Theme links could not be read just now.");
    }
  }, [list]);

  useEffect(() => {
    if (available) void load();
  }, [available, load]);

  // Says what happened only when it did: a refusal or a failure gets its own plain line.
  const act = async (action: LookAction, run: () => Promise<LookActionResult | boolean>, done: string) => {
    setBusy(true);
    setSaid(null);
    try {
      const result = await run();
      setSaid(result === "ok" || result === true ? done : lookActionProblem(action, result === false ? "error" : result));
    } catch {
      setSaid(lookActionProblem(action, "error"));
    } finally {
      setBusy(false);
      setConfirming(null);
      await load();
    }
  };
  // The link this device publishes; one it holds while another device publishes is that device's.
  const here = follow.state.kind === "elsewhere" ? null : (follow.channel?.id ?? null);
  const loading = available && links === null && problem === null;

  return (
    <div className="profile profileApplication">
      <h2>Streaming</h2>
      <section className="panel">
        <h3 className="sectionTitle">Theme links</h3>
        {/* One status line from the first paint, so a change of its words is announced. */}
        <div className="muted small">
          <span role="status" aria-live="polite" aria-busy={loading}>
            {loading ? "Loading…" : (problem ?? "")}
          </span>
          {problem !== null && (
            <>
              {" "}
              <button className="linkButton" onClick={() => void load()}>
                Try again
              </button>
            </>
          )}
        </div>
        {!available ? (
          <p className="muted small">Theme links need the hosted copy of Runlog and a signed-in account.</p>
        ) : links === null ? null : links.length === 0 ? (
          <p className="muted small">No theme links yet. In a run's Stream settings, choose Follow this device from anywhere.</p>
        ) : (
          <div role="list" aria-label="Theme links">
            {links.map((link) => (
              <div role="listitem" key={link.id} className="row spread memberRow">
                <span>
                  <strong>{link.id === here ? "This device" : "Another device"}</strong>
                  <span className="muted small">
                    {" "}
                    · {link.publishedAt ? `Last published ${new Date(link.publishedAt).toLocaleDateString()}` : "Not published yet"}
                  </span>
                </span>
                <span className="padRow">
                  {link.id === here ? (
                    <button
                      className="ghost tiny"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          "create",
                          () => follow.relink(),
                          "New link made. Copy the widget addresses again from a run's Stream settings; addresses copied before show the built-in look.",
                        )
                      }
                    >
                      New link
                    </button>
                  ) : (
                    <button
                      className="ghost tiny"
                      disabled={busy}
                      onClick={() => void act("takeOver", () => follow.takeOver(link.id), "This device now publishes the theme link.")}
                    >
                      Use this device
                    </button>
                  )}
                  {confirming === link.id ? (
                    <>
                      <button
                        className="ghost tiny danger"
                        disabled={busy}
                        onClick={() =>
                          void act("revoke", () => follow.revoke(link.id), "Revoked. Widgets on that link show the built-in look.")
                        }
                      >
                        Revoke this link
                      </button>
                      <button className="ghost tiny" disabled={busy} onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="ghost tiny" disabled={busy} onClick={() => setConfirming(link.id)}>
                      Revoke
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Mounted from the first paint and empty until an action has something to say. */}
        <div className="muted small" aria-live="polite">
          {said ?? ""}
        </div>
      </section>
    </div>
  );
}
