import { useEffect, useMemo, useState } from "react";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { formatClock, reduce, type RunEvent, type RunState } from "@runlog/engine";
import { loadPack, loadRun, type StoredRun } from "../storage/db.ts";
import { syncBus } from "../sync/bus.ts";
import { usePlan } from "../sync/usePlan.ts";
import { setLastActive } from "../run/active.ts";
import { useRace } from "../run/useRace.ts";
import { clockNow, raceOf, snapshotOf, type LiveSnapshot, type RaceSnapshot } from "../live/snapshot.ts";
import { RaceBoard, raceHeading } from "../live/RaceBoard.tsx";
import { usePublicRun } from "../live/usePublic.ts";
import { applyTheme, savedTheme } from "../theme/theme.ts";
import { WIDGET_KINDS, type WidgetRoute } from "./route.ts";

/**
 * One panel of a run, on a page of its own, for a stream to capture.
 *
 * A widget draws a snapshot of the run: on the streamer's own machine
 * the snapshot is taken from this device's storage — the log reduced
 * by the engine, re-read every couple of seconds and at once on a sync
 * pull — and on any other machine it is read by the run's live link,
 * with the link's token in the widget's address. Either way the same
 * shape is drawn, so a scoreboard looks the same wherever it is captured.
 * With `bg=clear` the page paints no ground, so the capture shows
 * through.
 *
 * Part of Plus where plans are on, like hosting a table: a stream is a
 * table with an audience. By token the sharing was the gated act.
 */
export function WidgetView({ route }: { route: WidgetRoute }) {
  // The page's look: the theme's ground, or none; and the theme the
  // address pins, if it pins one, over whatever this machine chose. The
  // boot in main.tsx applies the pinned theme before the first paint;
  // this keeps it applied should the address change under a running page,
  // and hands the machine its own choice back on the way out.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset["widget"] = route.bg;
    root.style.fontSize = `${16 * route.scale}px`;
    if (route.theme) applyTheme(route.theme);
    return () => {
      delete root.dataset["widget"];
      root.style.fontSize = "";
      if (route.theme) applyTheme(savedTheme());
    };
  }, [route.bg, route.scale, route.theme]);

  return route.token ? <ByLink route={route} token={route.token} /> : <FromHere route={route} />;
}

const label = (route: WidgetRoute) => WIDGET_KINDS.find((k) => k.kind === route.kind)?.label ?? route.kind;

function ByLink({ route, token }: { route: WidgetRoute; token: string }) {
  const { got, snapshot, offline } = usePublicRun(route.runId, token);
  if (offline) return <Frame title={label(route)}><p className="widgetNote">A widget by link needs the hosted copy of Runlog.</p></Frame>;
  if (got === undefined) return <Frame title={label(route)} />;
  if (got === null) return <Frame title={label(route)}><p className="widgetNote">This link is not open any more.</p></Frame>;
  if (!snapshot) return <Frame title={label(route)}><p className="widgetNote">Nothing written to the run yet.</p></Frame>;
  if (route.kind === "race" && !snapshot.race) return <Frame title={label(route)}><p className="widgetNote">This run is not in a race.</p></Frame>;
  return <Page kind={route.kind} snapshot={snapshot} />;
}

function FromHere({ route }: { route: WidgetRoute }) {
  const plan = usePlan();
  const [record, setRecord] = useState<StoredRun | null | undefined>(undefined);
  const [pack, setPack] = useState<Pack | null>(null);

  // The run, and its pack, from storage; again whenever it may have moved.
  useEffect(() => {
    let live = true;
    const read = async () => {
      const found = await loadRun(route.runId);
      if (!live) return;
      setRecord(found ?? null);
      if (found && !pack) {
        const stored = await loadPack(found.packId);
        if (!live) return;
        const parsed = stored ? loadPackText(stored.source, stored.format) : null;
        setPack(parsed?.ok ? parsed.pack : null);
      }
    };
    void read();
    const every = window.setInterval(() => void read(), 2000);
    const off = syncBus.subscribe((news) => {
      if (news.t === "pulled" && news.kind === "run" && news.ids.includes(route.runId)) void read();
    });
    return () => {
      live = false;
      window.clearInterval(every);
      off();
    };
    // The pack is read once; the run as often as it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.runId]);

  // The live socket in this window watches the run the app calls current.
  useEffect(() => {
    if (record) setLastActive({ packId: record.packId, runId: record.runId });
  }, [record?.runId, record?.packId]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = useMemo(() => (record?.events ?? []) as RunEvent[], [record]);
  const state = useMemo(() => (pack && events.length > 0 ? reduce(pack, events) : null), [pack, events]);
  const snapshot = useMemo(() => (pack && state ? snapshotOf(pack, state, events) : null), [pack, state, events]);

  if (plan.gates && plan.loaded && !plan.can("plus")) {
    return (
      <Frame title={label(route)}>
        <p className="widgetNote">Stream widgets are part of Plus. Subscribe from your profile, under Plan, and open this again.</p>
      </Frame>
    );
  }
  if (record === undefined) return <Frame title={label(route)} />;
  if (record === null || !pack) {
    return (
      <Frame title={label(route)}>
        <p className="widgetNote">{record === null ? "This run is not on this device. Open it in the app first." : "The run's pack is not on this device."}</p>
      </Frame>
    );
  }
  if (!state || !snapshot) return <Frame title={label(route)}><p className="widgetNote">Not started yet.</p></Frame>;
  if (route.kind === "race") return <div className="widget"><RaceWidget pack={pack} record={record} state={state} events={events} /></div>;
  return <Page kind={route.kind} snapshot={snapshot} race={<RaceWidget pack={pack} record={record} state={state} events={events} inColumn />} />;
}

function Frame({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="widget">
      {children ? (
        <div className="widgetBody">
          <div className="widgetTitle muted small">{title}</div>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The page: one panel, or every panel stacked in a column. The column
 * leaves out what the run has nothing for — a scoreboard with nobody on
 * it, trackers in a pack that has none — and takes the race leaderboard
 * where the page can draw one, which is the streamer's own machine.
 */
function Page({ kind, snapshot, race }: { kind: WidgetRoute["kind"]; snapshot: LiveSnapshot; race?: React.ReactNode }) {
  if (kind === "column") {
    return (
      <div className="widget column">
        <ClockWidget s={snapshot} />
        <StepWidget s={snapshot} />
        <StatsWidget s={snapshot} />
        {(snapshot.contestants > 0 || snapshot.standings.length > 0) && <ScoreboardWidget s={snapshot} />}
        {race ?? (snapshot.race ? <RaceSnapshotWidget race={snapshot.race} /> : null)}
        {snapshot.resources.length + snapshot.counters.length > 0 && <TrackersWidget s={snapshot} />}
      </div>
    );
  }
  return <div className="widget"><Widget kind={kind} snapshot={snapshot} /></div>;
}

function Widget({ kind, snapshot }: { kind: WidgetRoute["kind"]; snapshot: LiveSnapshot }) {
  switch (kind) {
    case "scoreboard":
      return <ScoreboardWidget s={snapshot} />;
    case "clock":
      return <ClockWidget s={snapshot} />;
    case "step":
      return <StepWidget s={snapshot} />;
    case "stats":
      return <StatsWidget s={snapshot} />;
    case "trackers":
      return <TrackersWidget s={snapshot} />;
    case "race":
      return snapshot.race ? <RaceSnapshotWidget race={snapshot.race} /> : null;
    case "column":
      return null;
  }
}

function RaceSnapshotWidget({ race }: { race: RaceSnapshot }) {
  return (
    <div className="widgetBody">
      <div className="widgetTitle muted small">{raceHeading(race)}</div>
      <RaceBoard race={race} />
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

function ScoreboardWidget({ s }: { s: LiveSnapshot }) {
  return (
    <div className="widgetBody">
      <div className="widgetTitle muted small">Scoreboard · {s.contestants} racing</div>
      {s.standings.length === 0 && <p className="widgetNote">Nobody on the roster yet.</p>}
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
    </div>
  );
}

/** The race leaderboard from this device; in a column, a run outside any race draws nothing rather than saying so. */
function RaceWidget({ pack, record, state, events, inColumn }: { pack: Pack; record: StoredRun; state: RunState; events: readonly RunEvent[]; inColumn?: boolean }) {
  const race = useRace(record, state, events);
  const snap = raceOf(race.race, race.standings, pack.vocabulary.unit);
  if (!snap) {
    if (inColumn) return null;
    return (
      <div className="widgetBody">
        <div className="widgetTitle muted small">Race</div>
        <p className="widgetNote">This run is not in a race.</p>
      </div>
    );
  }
  return <RaceSnapshotWidget race={snap} />;
}

function ClockWidget({ s }: { s: LiveSnapshot }) {
  const now = useNow(s.clocks.some((c) => c.status === "running"));
  const shown = s.clocks[0];
  const heading = shown?.label ?? `${s.words.unit} ${s.unit || "—"}`;
  let digits = "0:00";
  let tone = "";
  if (shown) {
    const face = clockNow(shown, s.at, now);
    digits = formatClock(face.shown, shown.kind === "stopwatch" && face.shown < 60_000 && shown.status === "running");
    tone = shown.status === "done" ? "done" : shown.status === "paused" ? "paused" : face.fraction !== null && face.fraction <= 0.1 ? "warn" : "";
  }
  return (
    <div className={`widgetBody clock ${tone}`}>
      <div className="widgetTitle muted small">{heading}</div>
      <div className="clockDigits widgetDigits">{digits}</div>
    </div>
  );
}

/** The current step, the constraints in play, and the latest result: a small panel to follow along by. */
export function StepWidget({ s }: { s: LiveSnapshot }) {
  const constraints = s.constraints ?? [];
  return (
    <div className="widgetBody">
      <div className="widgetTitle muted small">{s.words.unit} {s.unit || "—"}</div>
      <div className="widgetStep">{s.step ?? (s.status === "ended" ? `Ended${s.ending ? ` · ${s.ending}` : ""}` : "Waiting")}</div>
      {constraints.length > 0 && (
        <div className="notice constraints">
          <span className="muted small">The game has already had its say</span>
          <ul>
            {constraints.map((line, i) => (
              <li key={i}>
                <strong>{line}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.latest && <p className="widgetNote">{s.latest.text}</p>}
    </div>
  );
}

export function StatsWidget({ s }: { s: LiveSnapshot }) {
  const top = s.standings[0];
  const constraints = s.constraints ?? [];
  return (
    <div className="widgetBody">
      <div className="widgetTitle muted small">{s.packTitle}</div>
      <dl className="widgetStats">
        <div>
          <dt className="muted small">{s.words.unit}</dt>
          <dd>{s.unit ? String(s.unit) : "—"}</dd>
        </div>
        <div>
          <dt className="muted small">{s.words.units} done</dt>
          <dd>{s.progress.unitsDone}</dd>
        </div>
        <div>
          <dt className="muted small">Time</dt>
          <dd>{formatClock(s.progress.elapsedMs)}</dd>
        </div>
        <div>
          <dt className="muted small">Step</dt>
          <dd>{s.step ?? "—"}</dd>
        </div>
        {constraints.length > 0 && (
          <div className="wide">
            <dt className="muted small">Constraints</dt>
            <dd className="wideText">
              {constraints.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </dd>
          </div>
        )}
        {s.latest && (
          <div className="wide">
            <dt className="muted small">Latest</dt>
            <dd className="wideText">{s.latest.text}</dd>
          </div>
        )}
        <div>
          <dt className="muted small">{s.score.label}</dt>
          <dd>{s.score.text}</dd>
        </div>
        <div>
          <dt className="muted small">Subjects declared</dt>
          <dd>{s.subjects.length}</dd>
        </div>
        {top && (
          <div>
            <dt className="muted small">Leading</dt>
            <dd>{top.name} · {top.points}</dd>
          </div>
        )}
        {s.status === "ended" && (
          <div>
            <dt className="muted small">Ended</dt>
            <dd>{s.ending ?? "finished"}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function TrackersWidget({ s }: { s: LiveSnapshot }) {
  return (
    <div className="widgetBody">
      <div className="widgetTitle muted small">Trackers</div>
      {s.resources.length + s.counters.length === 0 && <p className="widgetNote">Nothing to track in this pack.</p>}
      {s.resources.map((r) => {
        const max = r.max ?? Math.max(r.value, 10);
        return (
          <div key={r.id} className="tracker">
            <div className="trackerHead">
              <strong>{r.label}</strong>
              <span className="muted">
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
            ) : (
              <div className="bar">
                <span style={{ width: `${Math.min(100, (r.value / max) * 100)}%` }} />
              </div>
            )}
          </div>
        );
      })}
      {s.counters.map((c) => (
        <div key={c.id} className="tracker">
          <div className="trackerHead">
            <strong>{c.label}</strong>
            <span className="num">{c.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
