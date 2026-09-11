import { useEffect, useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import { useApi } from "../sync/useApi.ts";
import { usePlan } from "../sync/usePlan.ts";
import { PlanError, type AskPolicy, type StreamKeys } from "../sync/client.ts";
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
  const [copied, setCopied] = useState<"key" | "address" | "press" | null>(null);
  /** The account's keys, as the server has them: that they exist, never the keys. */
  const [keys, setKeys] = useState<StreamKeys>({});
  /** A press key just minted, held only while this panel is open: it is shown once. */
  const [streamKey, setStreamKey] = useState<string | null>(null);
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

  useEffect(() => {
    if (!api || !allowed) return;
    let live = true;
    void api.streamKeys().then((k) => live && setKeys(k), () => {});
    return () => {
      live = false;
    };
  }, [api, allowed]);

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
  const makePressKey = () =>
    run(async () => {
      const made = await api.mintStreamKey("press");
      setStreamKey(made.key);
      setKeys(made.keys);
    });
  /** The address a bot holds: the account's, not this run's, so it outlives the run. */
  const pressAddress = streamKey ? `${base}/public/stream/asks?k=${encodeURIComponent(streamKey)}` : "";
  /** A press sent the way chat would send one, so the wiring is proved off air. */
  const tryIt = () =>
    run(async () => {
      if (!pressAddress) return;
      const answer = await fetch(`${pressAddress}&kind=roll&name=you&via=a+test`).then((r) => r.json() as Promise<{ say?: string }>);
      setNote(answer.say ?? "That did not come back with anything to say.");
    });
  const copyText = async (what: "key" | "address" | "press", text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* no clipboard: the text is on screen to copy */
    }
  };
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

          <h4 className="stepLabel">One address for every run</h4>
          <p className="muted small">
            The address above belongs to this {pack.vocabulary.run.one.toLowerCase()} and dies with it. This one belongs to your account and does not: point a bot at it
            once and it finds whichever {pack.vocabulary.run.one.toLowerCase()} you have taking asks. Taking asks stays this {pack.vocabulary.run.one.toLowerCase()}
            &apos;s own switch, above.
          </p>
          {streamKey ? (
            <div className="askKey">
              <p className="muted small">The press key, shown this once. The whole address, key included:</p>
              <code className="askAddress">{pressAddress}</code>
              <div className="padRow">
                <button className="ghost tiny" onClick={() => void copyText("press", pressAddress)}>
                  {copied === "press" ? "Copied" : "Copy address"}
                </button>
                <button className="primary tiny" disabled={busy} onClick={() => void tryIt()}>
                  Try it
                </button>
                <span className="muted small">Sends a roll, the way chat would, so you can see it land before you are live.</span>
              </div>
            </div>
          ) : (
            <div className="padRow">
              <button className="ghost tiny" disabled={busy} onClick={() => void makePressKey()}>
                {keys.press ? "New press key" : "Make a press key"}
              </button>
              <span className="muted small">
                {keys.press ? `Made ${new Date(keys.press.madeAt).toLocaleDateString()}. A new one replaces it, and the old one stops working.` : "Shown once, for a bot's settings. It presses and reads nothing."}
              </span>
            </div>
          )}

          <h4 className="stepLabel">What to name a reward</h4>
          <p className="muted small">
            One action in Streamer.bot serves every reward: send <code>&amp;ask=%rewardName%</code> and name the reward after what it should do. These are the names this
            pack answers to.
          </p>
          <ul className="askMoves">
            <li>
              <strong>Roll</strong> <span className="muted small">rolls the table the {pack.vocabulary.run.one.toLowerCase()} is waiting on</span>
            </li>
            {moves.map(([id, m]) => (
              <li key={id}>
                <strong>{m.label}</strong> <span className="muted small">or its id, {id}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            One ask a name every twenty seconds, thirty a minute for the {pack.vocabulary.run.one.toLowerCase()}. A press that is refused says why in a sentence a bot can
            put straight into chat.
          </p>
        </>
      )}
    </div>
  );
}
