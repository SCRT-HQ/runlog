import { useCallback, useEffect, useRef, useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import { useApi } from "../sync/useApi.ts";
import { syncBus } from "../sync/bus.ts";
import type { Ask } from "../sync/client.ts";
import type { StoredRun } from "../storage/db.ts";
import type { useRun } from "./useRun.ts";

/**
 * What the outside asked of this run, and the host's answer.
 *
 * An ask is a chat command, a channel-point redeem, a button on a stream
 * deck, reaching the server with the run's ask key: take a move the pack
 * offers, or roll the table that is waiting. The server keeps it and rings;
 * this is where it lands. Only the host's device can act on it, since only
 * that device appends to the run, so the tray is the host's: Accept takes
 * the move or rolls, the same code path the buttons use, stamped with who
 * asked; Decline says no, with a reason where there is one. Under the
 * `auto` policy the tray answers by itself, oldest first, one at a time,
 * and only when nothing else is in flight: an ask never interrupts a roll
 * the host is in the middle of.
 */
export function Asks({ pack, run, record }: { pack: Pack; run: ReturnType<typeof useRun>; record: StoredRun }) {
  const api = useApi();
  const [asks, setAsks] = useState<Ask[]>([]);
  const taking = Boolean(record.asks) && record.role === "owner";
  const policy = record.asks?.policy ?? "ask";

  // Read when the run takes asks, on every ask the socket announces, on
  // every pull of this run, and every so often in case the socket is down.
  useEffect(() => {
    if (!api || !taking) return;
    let live = true;
    const read = () => void api.asks(record.runId).then((a) => live && setAsks(a), () => {});
    read();
    const every = window.setInterval(read, 15_000);
    const off = syncBus.subscribe((news) => {
      if (news.t === "gesture" && news.id === record.runId && (news.kind === "ask" || news.kind === "asked")) read();
      if (news.t === "pulled" && news.kind === "run" && news.ids.includes(record.runId)) read();
    });
    return () => {
      live = false;
      window.clearInterval(every);
      off();
    };
  }, [api, taking, record.runId]);

  const answering = useRef(new Set<string>());
  const answer = useCallback(
    async (ask: Ask, verdict: "accepted" | "declined", reason?: string) => {
      if (!api || answering.current.has(ask.id)) return;
      answering.current.add(ask.id);
      try {
        setAsks(await api.answerAsk(record.runId, ask.id, verdict, reason));
      } catch {
        // The list is read again on the next ring; the answer is what matters and it was tried.
      } finally {
        answering.current.delete(ask.id);
      }
    },
    [api, record.runId],
  );

  /** Take what was asked, or say why not. Returns what it decided, for the auto policy's log. */
  const act = useCallback(
    (ask: Ask): { verdict: "accepted" } | { verdict: "declined"; reason: string } => {
      if (run.readOnly) return { verdict: "declined", reason: "this device cannot move the run" };
      if (run.pending) return { verdict: "declined", reason: "something else was in flight" };
      const askedBy = { ...(ask.name ? { name: ask.name } : {}), ...(ask.via ? { via: ask.via } : {}) };
      if (ask.kind === "move") {
        const offered = run.moves.find((m) => m.id === ask.move);
        if (!offered) return { verdict: "declined", reason: "no such move right now" };
        run.takeMove(offered.id, offered.move.label, askedBy);
        return { verdict: "accepted" };
      }
      const active = run.activeStep;
      const state = run.state;
      if (!active || !state || active.step.kind !== "rollTable") return { verdict: "declined", reason: "nothing to roll right now" };
      const table = pack.tables[active.step.table];
      run.begin({
        kind: "table",
        tableId: active.step.table,
        keyPrefix: `u${state.unit}:${active.phase.id}#${active.index}`,
        label: table?.title ?? active.step.table,
        completes: { phase: active.phase, index: active.index },
        askedBy,
      });
      return { verdict: "accepted" };
    },
    [pack, run],
  );

  const accept = (ask: Ask) => {
    const did = act(ask);
    void answer(ask, did.verdict, did.verdict === "declined" ? did.reason : undefined);
  };
  const decline = (ask: Ask) => void answer(ask, "declined");

  // The auto policy: the oldest open ask is taken as soon as the table is free.
  const open = asks.filter((a) => !a.answer);
  const first = open[0];
  useEffect(() => {
    if (policy !== "auto" || !first || run.pending || answering.current.has(first.id)) return;
    const did = act(first);
    void answer(first, did.verdict, did.verdict === "declined" ? did.reason : undefined);
  }, [policy, first, run.pending, act, answer]);

  if (!api || !taking) return null;
  const move = (a: Ask) => (a.kind === "roll" ? "a roll" : (pack.moves?.[a.move ?? ""]?.label ?? a.move ?? "a move"));
  const recent = asks.filter((a) => a.answer).slice(-4).reverse();

  return (
    <details className="panel asks" open={open.length > 0}>
      <summary>
        <h3 className="sectionTitle">
          Asks <span className="muted">from chat{open.length > 0 ? ` · ${open.length} waiting` : ""}</span>
        </h3>
      </summary>
      <div className="asksBody">
        {open.length === 0 && recent.length === 0 && (
          <p className="muted small">Taking asks{policy === "auto" ? ", and acting on them as they land" : ""}. None yet.</p>
        )}
        {open.map((a) => (
          <div key={a.id} className="row spread askRow">
            <span>
              <strong>{a.name ?? "Someone"}</strong> asks for <em>{move(a)}</em>
              {a.via ? <span className="muted small"> · {a.via}</span> : null}
            </span>
            {policy === "ask" && (
              <span className="padRow">
                <button className="primary tiny" onClick={() => accept(a)}>
                  Accept
                </button>
                <button className="ghost tiny" onClick={() => decline(a)}>
                  Decline
                </button>
              </span>
            )}
          </div>
        ))}
        {recent.length > 0 && (
          <div className="reactRecent" aria-live="polite">
            {recent.map((a) => (
              <span key={a.id} className="chip reactChip" title={a.reason ?? new Date(a.answeredAt ?? a.at).toLocaleTimeString()}>
                {a.answer === "accepted" ? "✓" : "✗"} {a.name ?? "Someone"}: {move(a)}
              </span>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
