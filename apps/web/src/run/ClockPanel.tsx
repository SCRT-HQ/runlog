import { useEffect, useRef, useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import { elapsedMs, formatClock, liveClocks, remainingMs, unitClockFor, type Clock, type RunState } from "@runlog/engine";
import type { useRun } from "./useRun.ts";

/**
 * The clocks, ticking, in the margin under the unit's name.
 *
 * A clock belongs to the unit the way its number does, so it sits with it:
 * the same face and weight as the number, one size down, with its controls
 * as small as the board's. It used to be the biggest thing on the screen,
 * above the step, which made a stopwatch nobody was watching look more
 * important than the roll the game was waiting on. The face that can be
 * read from across a room is the stream widget's.
 *
 * Steady enough not to jitter: the digits are tabular and the column's
 * width does not change as they do. The view ticks four times a second
 * from the log's timestamps and the present; nothing here is the source of
 * truth. A timer that reaches zero is stopped in the log once — with
 * `expired`, which is what rings the alert — and stays on screen saying so
 * until the unit closes.
 *
 * Pause, resume and stop are moves like any other, undoable, and visible to
 * everyone in a shared run. A watcher sees the clocks and presses nothing.
 */
export function ClockPanel({ pack, run, state }: { pack: Pack; run: ReturnType<typeof useRun>; state: RunState }) {
  const live = liveClocks(state);
  const config = unitClockFor(pack, state);
  const unitClock = state.clocks.find((c) => c.unit === state.unit && c.id === `u${state.unit}:unit`);
  const canStartUnit = Boolean(config && config.auto === false && !unitClock && state.unit > 0 && state.status === "active" && !run.readOnly);
  const now = useNow(live.some((c) => c.status === "running"));
  const expired = useRef<Set<string>>(new Set());

  // A timer at zero stops itself, once. The ref keeps a re-render from
  // stopping it twice before the log catches up.
  useEffect(() => {
    if (run.readOnly) return;
    for (const c of live) {
      if (c.status !== "running" || c.seconds === null) continue;
      const left = remainingMs(c, now);
      if (left !== null && left <= 0 && !expired.current.has(c.id)) {
        expired.current.add(c.id);
        run.stopClock(c.id, true);
      }
    }
  }, [live, now, run]);

  const doneThisUnit = state.clocks.filter((c) => c.status === "done" && c.unit === state.unit);
  // The unit's own clock is labeled with the unit's name, which is the
  // heading right above it; saying it twice is noise, so that label is
  // left off and only a clock with a name of its own shows one.
  const unitName = `${pack.vocabulary.unit.one} ${state.unit}`;
  if (live.length === 0 && doneThisUnit.length === 0 && !canStartUnit) return null;

  return (
    <div className="clocks" aria-live="off">
      {live.map((c) => (
        <ClockFace key={c.id} clock={c} now={now} run={run} label={c.label === unitName ? null : c.label} />
      ))}
      {doneThisUnit.map((c) => (
        <div key={c.id} className={`clock done ${c.expired ? "expired" : ""}`}>
          <div className="clockHead">
            <span className="clockLabel">{c.label === unitName ? "" : c.label}</span>
            <span className="chip state">{c.expired ? "time" : "stopped"}</span>
          </div>
          <div className="clockDigits">{formatClock(c.elapsedMs ?? 0)}</div>
        </div>
      ))}
      {canStartUnit && config && (
        <div className="clock idle">
          <div className="clockHead">
            <span className="clockLabel">{config.label ?? `${pack.vocabulary.unit.one} ${state.unit}`}</span>
            <span className="chip">{config.kind === "timer" ? `${config.minutes} min` : "stopwatch"}</span>
          </div>
          <div className="clockDigits muted">{config.kind === "timer" ? formatClock((config.minutes ?? 0) * 60_000) : "0:00"}</div>
          <div className="clockButtons">
            <button className="primary tiny" onClick={() => run.startUnitClock()}>
              Start
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClockFace({ clock, now, run, label }: { clock: Clock; now: number; run: ReturnType<typeof useRun>; label: string | null }) {
  const elapsed = elapsedMs(clock, now);
  const left = remainingMs(clock, now);
  const timer = clock.seconds !== null;
  const shown = timer ? Math.max(0, left ?? 0) : elapsed;
  const fraction = timer && clock.seconds ? Math.max(0, Math.min(1, (left ?? 0) / (clock.seconds * 1000))) : null;
  const tone = fraction !== null && fraction <= 0.1 ? "warn" : "";
  const tenths = !timer && elapsed < 60_000 && clock.status === "running";
  return (
    <div className={`clock ${clock.status} ${tone}`}>
      <div className="clockHead">
        <span className="clockLabel">{label ?? ""}</span>
        <span className="chip state">{clock.status === "paused" ? "paused" : timer ? "left" : "elapsed"}</span>
      </div>
      <div className="clockDigits" aria-label={`${clock.label}: ${formatClock(shown)}`}>
        {formatClock(shown, tenths)}
      </div>
      {fraction !== null && (
        <div className="clockBar" aria-hidden="true">
          <span style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
      {!run.readOnly && (
        <div className="clockButtons">
          {clock.status === "running" ? (
            <button className="ghost tiny" onClick={() => run.pauseClock(clock.id)}>
              Pause
            </button>
          ) : (
            <button className="primary tiny" onClick={() => run.resumeClock(clock.id)}>
              Resume
            </button>
          )}
          <button className="ghost tiny" onClick={() => run.stopClock(clock.id)}>
            Stop
          </button>
        </div>
      )}
    </div>
  );
}

/** The present, refreshed while something is running; still while nothing is. */
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
