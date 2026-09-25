import { useCallback, useEffect, useState } from "react";
import type { LookChannelSummaryV1 } from "@runlog/themes";
import { useLookChannel } from "../theme/follow/LookChannelProvider.tsx";
import type { LookActionResult } from "../theme/follow/publisher.ts";

const PLAN_LINE = "Following this device from anywhere is part of Plus.";
const FAILED_LINE = "Could not change the theme link. Try again.";

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
  const act = async (run: () => Promise<LookActionResult | boolean>, done: string | null) => {
    setBusy(true);
    setSaid(null);
    try {
      const result = await run();
      setSaid(result === "ok" || result === true ? done : result === "plan" ? PLAN_LINE : FAILED_LINE);
    } catch {
      setSaid(FAILED_LINE);
    } finally {
      setBusy(false);
      setConfirming(null);
      await load();
    }
  };
  const here = follow.channel?.id ?? null;

  return (
    <div className="profile profileApplication">
      <h2>Streaming</h2>
      <section className="panel">
        <h3 className="sectionTitle">Theme links</h3>
        {!available ? (
          <p className="muted small">Theme links need the hosted copy of Runlog and a signed-in account.</p>
        ) : links === null ? (
          problem !== null ? (
            <p className="muted small">
              {problem}{" "}
              <button className="linkButton" onClick={() => void load()}>
                Try again
              </button>
            </p>
          ) : (
            <p className="muted small" role="status" aria-busy="true">
              Loading…
            </p>
          )
        ) : links.length === 0 ? (
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
                          () => follow.relink(),
                          "New link made. Copy the widget addresses again from a run's Stream settings; addresses copied before show the built-in look.",
                        )
                      }
                    >
                      New link
                    </button>
                  ) : (
                    <button className="ghost tiny" disabled={busy} onClick={() => void act(() => follow.takeOver(link.id), null)}>
                      Use this device
                    </button>
                  )}
                  {confirming === link.id ? (
                    <>
                      <button
                        className="ghost tiny danger"
                        disabled={busy}
                        onClick={() => void act(() => follow.revoke(link.id), "Revoked. Widgets on that link show the built-in look.")}
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
        {said !== null && (
          <p className="muted small" aria-live="polite">
            {said}
          </p>
        )}
      </section>
    </div>
  );
}
