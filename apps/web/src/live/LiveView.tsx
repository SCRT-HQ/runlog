import { useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "@runlog/engine";
import { clockNow, type LiveSnapshot } from "./snapshot.ts";
import { motionBetween } from "./motion.ts";
import { RaceBoard } from "./RaceBoard.tsx";
import { LOG_LIMITS, logLimit, logLines, logOrder, setLogLimit, setLogOrder, type LogOrder } from "../run/logView.ts";

/**
 * A run, watched: the snapshot laid out for someone who is not at the
 * table. Nothing here is pressed; the clocks tick from the moment the
 * snapshot was taken, and everything else waits for the next one. When
 * the next one comes, what changed moves: the unit turning, a line
 * landing, a piece struck, a state put on, a number changing. The
 * classes for that are computed against the snapshot before, and worn
 * for one render.
 */
export function LiveView({ snapshot, stale, children, rooms: roomsAtFirst = "this" }: { snapshot: LiveSnapshot; stale?: boolean; children?: React.ReactNode; rooms?: "this" | "all" }) {
  const now = useNow(snapshot.clocks.some((c) => c.status === "running"));
  const s = snapshot;
  const before = useRef<LiveSnapshot | null>(null);
  const moved = useMemo(() => motionBetween(before.current, s), [s]);
  // Which end of the log first, and how much of it: the same choice the
  // run screen keeps on this device, read here too. The snapshot's log is
  // newest first; the helpers want it oldest first and order it themselves.
  const [order, setOrder] = useState<LogOrder>(() => logOrder());
  const [limit, setLimit] = useState(() => logLimit());
  const flip = () => {
    const next: LogOrder = order === "newest" ? "oldest" : "newest";
    setOrder(next);
    setLogOrder(next);
  };
  const cap = (n: number) => {
    setLimit(n);
    setLogLimit(n);
  };
  const lines = useMemo(() => logLines([...s.log].reverse(), order, limit).map((l) => l.outcome), [s.log, order, limit]);
  // A result that holds over the step in hand is lit where it sits, under
  // its phase, rather than said again in a block of its own.
  const constrains = useMemo(() => new Set(s.constraints ?? []), [s.constraints]);
  const nowPhase = (s.phases ?? []).find((p) => p.state === "current")?.label ?? null;
  // This room, as the flow with where each phase stands; or every room so
  // far as what its phases produced, newest first, which stands in for the
  // log below. The run's story told either way, kept on this device.
  const [rooms, setRooms] = useState<"this" | "all">(() => roomsAtFirst === "all" ? "all" : roomsKept());
  const past = useMemo(() => [...(s.units ?? [])].filter((u) => u.unit !== s.unit).reverse(), [s.units, s.unit]);
  const chooseRooms = (next: "this" | "all") => {
    setRooms(next);
    keepRooms(next);
  };
  useEffect(() => {
    before.current = s;
  }, [s]);
  return (
    <div className="live">
      <header className="liveHead">
        <div>
          <h1 className="liveTitle">{s.packTitle}</h1>
          <p className="muted">
            {s.runName ? `${s.runName} · ` : ""}
            {s.mode} · {s.status === "ended" ? `ended${s.ending ? `: ${s.ending}` : ""}` : `${s.words.unit} ${s.unit || "—"}`}
            {stale ? " · reconnecting…" : ""}
          </p>
        </div>
        {children}
      </header>

      {s.status === "active" && (
        <p key={s.unit} className={`liveWhere${moved.turned ? " turned" : ""}`}>
          <span className="muted small">Now</span>{" "}
          {s.where ? (
            // The phase carries the weight; its step, where it is a different thing, reads as the subline it is.
            nowPhase ? (
              <>
                <strong>{nowPhase}</strong>
                {s.step && s.step !== nowPhase && <span className="muted"> · {s.step}</span>}
              </>
            ) : (
              s.where
            )
          ) : s.unit === 0 ? (
            `Waiting to enter the first ${s.words.unit.toLowerCase()}`
          ) : (
            `${s.words.unit} ${s.unit} is closed; the next has not begun`
          )}
        </p>
      )}

      <div className="liveGrid">
        <div className="liveMain">
          {(s.phases ?? []).length > 0 && (
            <section className={`stageFlow liveFlow${moved.turned ? " turned" : ""}`}>
              <div className="logHead">
                <h3 className="sectionTitle">
                  {rooms === "all" ? `All ${s.words.units.toLowerCase()}` : `This ${s.words.unit.toLowerCase()}`} <span className="muted">{s.words.unit} {s.unit}</span>
                </h3>
                {(s.units ?? []).length > 0 && (
                  <div className="logTools" role="group" aria-label={`This ${s.words.unit.toLowerCase()}, or every ${s.words.unit.toLowerCase()} so far`}>
                    <button className={`ghost tiny${rooms === "this" ? " on" : ""}`} aria-pressed={rooms === "this"} onClick={() => chooseRooms("this")}>
                      This {s.words.unit.toLowerCase()}
                    </button>
                    <button className={`ghost tiny${rooms === "all" ? " on" : ""}`} aria-pressed={rooms === "all"} onClick={() => chooseRooms("all")}>
                      All {s.words.units.toLowerCase()}
                    </button>
                  </div>
                )}
              </div>
              <ol className="flow">
                {s.phases.map((phase, i) => (
                  <li key={phase.id} className={phase.state === "todo" ? "" : phase.state} aria-current={phase.state === "current" ? "step" : undefined}>
                    <span className="idx">{phase.state === "current" ? "▸" : phase.state === "skipped" ? "–" : i + 1}</span>
                    <span>
                      {phase.label}
                      {phase.state === "current" && s.step && s.step !== phase.label && <span className="muted"> · {s.step}</span>}
                      {phase.state === "skipped" && phase.why && <span className="why">{phase.why}</span>}
                      {(phase.results ?? []).map((r, k) => (
                        <span key={k} className={constrains.has(r) ? "result constrains" : "result"} title={constrains.has(r) ? "The game has already had its say: this holds over the step in hand" : undefined}>
                          {r}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
              {rooms === "all" &&
                past.map((u) => (
                  <div key={u.unit} className="pastRoom">
                    <h4 className="sectionTitle">
                      <span className="muted">{s.words.unit}</span> {u.unit}
                    </h4>
                    {u.phases.length === 0 ? (
                      <p className="muted small">Nothing rolled or declared.</p>
                    ) : (
                      <ol className="flow">
                        {u.phases.map((phase, i) => (
                          <li key={phase.id} className="done">
                            <span className="idx">{i + 1}</span>
                            <span>
                              {phase.label}
                              {phase.results.map((r, k) => (
                                <span key={k} className="result">
                                  {r}
                                </span>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
            </section>
          )}
          {rooms === "all" && (s.units ?? []).length > 0 ? null : s.log.length > 0 ? (
            <section className="log">
              <div className="logHead">
                <h3 className="sectionTitle">
                  The log
                  {lines.length < s.log.length && <span className="muted"> · the last {lines.length} of {s.log.length}</span>}
                </h3>
                <div className="logTools">
                  <button className="ghost tiny" onClick={flip} title="Read the log from the other end">
                    {order === "newest" ? "Newest first" : "Oldest first"}
                  </button>
                  <select className="tiny" value={limit} onChange={(e) => cap(Number(e.target.value))} aria-label="How much of the log to show">
                    {LOG_LIMITS.map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? "All" : "Last " + n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <ol className="timeline">
                {lines.map((line, i) => (
                  <li key={line.n} className={[line.hit !== null ? "heat" : "", line.n > moved.freshFrom ? "fresh" : ""].join(" ").trim()}>
                    <span className="idx">{line.n}</span>
                    <div>
                      {(i === 0 || lines[i - 1]!.unit !== line.unit) && (
                        <span className="muted small mono">
                          {s.words.unit} {line.unit}
                        </span>
                      )}
                      <span className="where">
                        {line.where}
                        {line.hit !== null && ` — hit #${line.hit}`}
                      </span>
                      <p>{line.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {!s.quoted && <p className="muted small">The pack's text is not for redistribution; the log shows what the dice drew, not the tables.</p>}
            </section>
          ) : (
            <p className="muted">Nothing rolled yet; the log fills in with the first roll.</p>
          )}
        </div>

        <aside className="liveSide">
          {s.clocks.length > 0 && (
            <section className="panel clocks">
              {s.clocks.map((c) => {
                const face = clockNow(c, s.at, now);
                const tone = c.status === "done" ? "done" : c.status === "paused" ? "paused" : face.fraction !== null && face.fraction <= 0.1 ? "warn" : "";
                return (
                  <div key={c.id} className={`clock ${c.status} ${tone}`}>
                    <div className="clockHead">
                      <span className="clockLabel">{c.label}</span>
                      <span className="chip state">{c.status === "done" ? (c.expired ? "time" : "stopped") : c.status === "paused" ? "paused" : c.kind === "timer" ? "left" : "elapsed"}</span>
                    </div>
                    <div className="clockDigits">{formatClock(face.shown)}</div>
                  </div>
                );
              })}
            </section>
          )}

          {s.race && (
            <section className="panel">
              <h3 className="sectionTitle">
                Race{s.race.name ? ` · ${s.race.name}` : ""} <span className="muted">{s.race.ended ? "ended" : `${s.race.racing} racing`}</span>
              </h3>
              <RaceBoard race={s.race} />
            </section>
          )}

          {s.standings.length > 0 && (
            <section className="panel">
              <h3 className="sectionTitle">
                Scoreboard <span className="muted">{s.contestants} racing</span>
              </h3>
              <ol className="widgetBoard">
                {s.standings.map((c) => (
                  <li key={c.name}>
                    <span className="place">#{c.place}</span>
                    <span className="who">
                      {c.name}
                      {c.states.map((st) => (
                        <span key={st} className="chip state">
                          {st}
                        </span>
                      ))}
                    </span>
                    <span className="num">{c.points}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {s.subjects.length > 0 && (
            <section className="panel">
              <h3 className="sectionTitle">The board</h3>
              {s.subjects.map((sub) => (
                <div key={sub.id} className={`row spread${moved.struck.has(sub.id) ? " struck" : ""}`}>
                  <span>
                    <span className="idx">#{sub.id}</span> {sub.name ?? `${s.words.unit} ${sub.id}`}
                    {sub.type && sub.type !== sub.name && <span className="muted"> · {sub.type}</span>}
                    {!sub.type && <span className="muted"> · undeclared</span>}
                    {(sub.hits ?? []).map((h, i) => (
                      <span key={`hit-${i}`} className="chip heat">
                        {h}
                      </span>
                    ))}
                    {sub.states.map((st) => (
                      <span key={st} className={`chip state${moved.states.has(`${sub.id}:${st}`) ? " fresh" : ""}`}>
                        {st}
                      </span>
                    ))}
                  </span>
                  <span className="muted small">{sub.finalized ? "done" : "open"}</span>
                </div>
              ))}
            </section>
          )}

          {(s.resources.length > 0 || s.counters.length > 0) && (
            <section className="panel">
              <h3 className="sectionTitle">Trackers</h3>
              {s.resources.map((r) => {
                const max = r.max ?? Math.max(r.value, 10);
                return (
                  <div key={r.id} className="tracker">
                    <div className="trackerHead">
                      <strong>{r.label}</strong>
                      <span className={`muted${moved.resources.has(r.id) ? " bump" : ""}`}>
                        {r.value}
                        {r.max !== undefined && ` / ${r.max}`}
                      </span>
                    </div>
                    {r.display === "boxes" ? (
                      <div className="boxes">
                        {Array.from({ length: max }, (_, i) => (
                          <span key={i} className={`box ${i < r.value ? "on" : ""}`} />
                        ))}
                      </div>
                    ) : r.display === "bar" ? (
                      <div className="bar">
                        <span style={{ width: `${Math.min(100, (r.value / max) * 100)}%` }} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {s.counters.map((c) => (
                <div key={c.id} className="tracker">
                  <div className="trackerHead">
                    <strong>{c.label}</strong>
                    <span className={`num${moved.counters.has(c.id) ? " bump" : ""}`}>{c.value}</span>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="panel">
            <h3 className="sectionTitle">So far</h3>
            <dl className="widgetStats">
              <div>
                <dt className="muted small">{s.words.units} done</dt>
                <dd>{s.progress.unitsDone}</dd>
              </div>
              <div>
                <dt className="muted small">Time</dt>
                <dd>{formatClock(s.progress.elapsedMs)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [ticking]);
  return now;
}

const ROOMS_KEY = "runlog:liveRooms";
/** Which way this device reads a watched run: this room, or all of them. */
function roomsKept(): "this" | "all" {
  try {
    return localStorage.getItem(ROOMS_KEY) === "all" ? "all" : "this";
  } catch {
    return "this";
  }
}
function keepRooms(rooms: "this" | "all"): void {
  try {
    if (rooms === "all") localStorage.setItem(ROOMS_KEY, "all");
    else localStorage.removeItem(ROOMS_KEY);
  } catch {
    /* the choice lasts the tab */
  }
}

