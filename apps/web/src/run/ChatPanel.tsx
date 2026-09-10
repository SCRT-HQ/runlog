import { useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import { useApi } from "../sync/useApi.ts";
import { usePlan } from "../sync/usePlan.ts";
import { PlanError, type AskPolicy } from "../sync/client.ts";
import { apiBase } from "../sync/config.ts";
import type { StoredRun } from "../storage/db.ts";

/**
 * Chat as input: the run's ask key, and what the table does with an ask.
 *
 * The key is not the live link's token. The token is on every widget
 * address and in a streaming scene; a leaked address must let strangers
 * watch, never press. So a key of its own, shown once when minted, revoked
 * on its own, and the address a bot posts to is spelled out here with the
 * key in it, ready to paste into Streamer.bot or whatever holds the
 * channel-point redeem. Lives under Stream in the run's Settings.
 */
export function ChatSettings({ pack, record, onAsks }: { pack: Pack; record: StoredRun | null; onAsks?: (asks: StoredRun["asks"]) => void | Promise<void> }) {
  const api = useApi();
  const plan = usePlan();
  const allowed = !plan.gates || plan.can("plus");
  const [key, setKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<"key" | "address" | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Whether the run takes asks, as this panel knows it: the record on the
   * way in, this panel's own presses after that. Minting a key changes
   * nothing in the log, so no pull will tell the record about it; the panel
   * hands what the server said back to the run, and takes it as read here.
   */
  const [taking, setTaking] = useState<{ policy: AskPolicy; since?: string } | null>(record?.asks ?? null);
  const policy: AskPolicy = taking?.policy ?? "ask";
  const moves = Object.entries(pack.moves ?? {}).filter(([, m]) => m.when === "anytime" || m.when === undefined);

  if (!api || !record) return null;
  if (record.role !== "owner") return null;

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await work();
    } catch (error) {
      setNote(error instanceof PlanError ? error.message : error instanceof Error && error.message ? error.message : "That did not take. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };
  /** What the server just said, kept where the run and the Asks tray read it. */
  const remember = async (asks: StoredRun["asks"]) => {
    setTaking(asks ?? null);
    await onAsks?.(asks);
  };
  const mint = () =>
    run(async () => {
      const made = await api.mintAskKey(record.runId, policy);
      setKey(made.key);
      await remember({ policy: made.policy, since: new Date().toISOString() });
    });
  const setPolicy = (next: AskPolicy) =>
    run(async () => {
      await api.setAskPolicy(record.runId, next);
      await remember({ policy: next, ...(taking?.since ? { since: taking.since } : {}) });
    });
  const revoke = () =>
    run(async () => {
      await api.revokeAskKey(record.runId);
      setKey(null);
      await remember(null);
    });
  // The address a bot posts to is absolute: the bot is on another machine.
  const base = (() => {
    const b = (apiBase() ?? "/api").replace(/\/$/, "");
    return /^https?:/.test(b) ? b : `${typeof location !== "undefined" ? location.origin : ""}${b}`;
  })();
  const address = key ? `${base}/public/runs/${encodeURIComponent(record.runId)}/asks?k=${encodeURIComponent(key)}` : null;
  const copy = async (what: "key" | "address") => {
    const text = what === "key" ? key : address;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* no clipboard: the text is on screen to copy */
    }
  };

  return (
    <div className="chatSettings">
      <h3 className="sectionTitle">
        Chat <span className="muted">asks from outside</span>
      </h3>
      {!allowed ? (
        <p className="muted small">Taking asks from chat, a channel-point redeem that rolls or a command that takes a move, is part of Plus, like hosting a table.</p>
      ) : (
        <>
          <p className="muted small">
            Anything that can make a web request, a channel-point redeem in Streamer.bot, a chat command, a button on a stream deck, can ask this run to take a move or
            roll the table that is waiting. It asks with a key of its own, not the live link, so a widget address that gets out lets people watch and never press.
          </p>
          {!taking ? (
            <div className="padRow">
              <button className="primary tiny" disabled={busy} onClick={() => void mint()}>
                Take asks
              </button>
              <span className="muted small">Makes the key, shown once. Asks wait for you to accept them until you say otherwise below.</span>
            </div>
          ) : (
            <>
              {key && (
                <div className="askKey">
                  <p className="muted small">The key, shown this once. The address a bot posts to, with the key in it:</p>
                  <code className="askAddress">{address}</code>
                  <div className="padRow">
                    <button className="ghost tiny" onClick={() => void copy("address")}>
                      {copied === "address" ? "Copied" : "Copy address"}
                    </button>
                    <button className="ghost tiny" onClick={() => void copy("key")}>
                      {copied === "key" ? "Copied" : "Copy the key alone"}
                    </button>
                  </div>
                </div>
              )}
              {!key && <p className="muted small">Taking asks{taking.since ? ` since ${new Date(taking.since).toLocaleString()}` : ""}. The key was shown when it was made; make a new one if it is lost.</p>}
              <label className="toggle" title="Under Ask, each one waits in the Asks panel for Accept. Under Auto, the table takes it the moment it lands, if it can.">
                <span>What the table does</span>
                <select className="chipAdd" value={policy} disabled={busy} onChange={(e) => void setPolicy(e.target.value as AskPolicy)} aria-label="What the table does with an ask">
                  <option value="ask">Wait for me to accept</option>
                  <option value="auto">Act on it as it lands</option>
                </select>
              </label>
              <div className="padRow">
                <button className="ghost tiny" disabled={busy} onClick={() => void mint()}>
                  New key
                </button>
                <button className="ghost tiny" disabled={busy} onClick={() => void revoke()}>
                  Stop taking asks
                </button>
              </div>
            </>
          )}
          {note && <p className="muted small">{note}</p>}
          <p className="muted small">
            A request is a POST to the address with a JSON body: <code>{`{"kind":"roll"}`}</code> rolls the table that is waiting;{" "}
            <code>{`{"kind":"move","move":"<id>"}`}</code> takes a move. Add <code>name</code> and <code>via</code> so the log says who asked and how. One ask a name every
            twenty seconds, thirty a minute for the run.
          </p>
          {moves.length > 0 ? (
            <>
              <p className="muted small">The moves this pack offers at any time, by id:</p>
              <ul className="askMoves">
                {moves.map(([id, m]) => (
                  <li key={id}>
                    <code>{id}</code> <span className="muted small">{m.label}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted small">This pack offers no move at any time, so only a roll can be asked for.</p>
          )}
        </>
      )}
    </div>
  );
}
