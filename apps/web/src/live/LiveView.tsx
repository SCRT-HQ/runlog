import { useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "@runlog/engine";
import { clockNow, type LiveSnapshot } from "./snapshot.ts";
import { motionBetween } from "./motion.ts";
import { RaceBoard } from "./RaceBoard.tsx";

/**
 * A run, watched: the snapshot laid out for someone who is not at the
 * table. Nothing here is pressed; the clocks tick from the moment the
 * snapshot was taken, and everything else waits for the next one. When
 * the next one comes, what changed moves: the unit turning, a line
 * landing, a piece struck, a state put on, a number changing. The
 * classes for that are computed against the snapshot before, and worn
 * for one render.
 */
export function LiveView({ snapshot, stale, children }: { snapshot: LiveSnapshot; stale?: boolean; children?: React.ReactNode }) {
  const now = useNow(snapshot.clocks.some((c) => c.status === "running"));
  const s = snapshot;
  const before = useRef<LiveSnapshot | null>(null);
  const moved = useMemo(() => motionBetween(before.current, s), [s]);
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
          {s.where ?? (s.unit === 0 ? `Waiting to enter the first ${s.words.unit.toLowerCase()}` : `${s.words.unit} ${s.unit} is closed; the next has not begun`)}
        </p>
      )}

      {(s.constraints ?? []).length > 0 && (
        <div className="notice constraints">
          <span className="muted small">The game has already had its say</span>
          <ul>
            {(s.constraints ?? []).map((line, i) => (
              <li key={i}>
                <strong>{line}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="liveGrid">
        <div className="liveMain">
          {(s.unitResults ?? []).length > 0 && (
            <section className="log">
              <h3 className="sectionTitle">This {s.words.unit.toLowerCase()} so far</h3>
              <ol className="timeline">
                {(s.unitResults ?? []).map((r, i) => (
                  <li key={i}>
                    <span className="idx">{i + 1}</span>
                    <div>
                      <span className="where">
                        {r.table}
                        {r.hit !== null && ` — hit #${r.hit}`}
                      </span>
                      <p>{r.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {(s.phases ?? []).length > 0 && (
            <section className={`stageFlow liveFlow${moved.turned ? " turned" : ""}`}>
              <h3 className="sectionTitle">
                This {s.words.unit.toLowerCase()} <span className="muted">{s.words.unit} {s.unit}</span>
              </h3>
              <ol className="flow">
                {s.phases.map((phase, i) => (
                  <li key={phase.id} className={phase.state === "todo" ? "" : phase.state} aria-current={phase.state === "current" ? "step" : undefined}>
                    <span className="idx">{phase.state === "current" ? "▸" : phase.state === "skipped" ? "–" : i + 1}</span>
                    <span>
                      {phase.label}
                      {phase.state === "current" && s.step && s.step !== phase.label && <span className="muted"> · {s.step}</span>}
                      {phase.state === "skipped" && phase.why && <span className="why">{phase.why}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {s.log.length > 0 ? (
            <section className="log">
              <h3 className="sectionTitle">The log</h3>
              <ol className="timeline">
                {s.log.map((line, i) => (
                  <li key={line.n} className={[line.hit !== null ? "heat" : "", line.n > moved.freshFrom ? "fresh" : ""].join(" ").trim()}>
                    <span className="idx">{line.n}</span>
                    <div>
                      {(i === 0 || s.log[i - 1]!.unit !== line.unit) && (
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
