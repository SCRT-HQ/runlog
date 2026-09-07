import { formatClock } from "@runlog/engine";
import type { RaceSnapshot } from "./snapshot.ts";

/** The leaderboard from a snapshot: the same list on the live page, in a widget, or in the run's side column. */
export function RaceBoard({ race, className = "widgetBoard" }: { race: RaceSnapshot; className?: string }) {
  return (
    <ol className={className}>
      {race.standings.map((s) => (
        <li key={`${s.place}-${s.name}`} className={s.owner ? "me" : ""}>
          <span className="place">#{s.place}</span>
          <span className="who">{s.name}</span>
          <span className="where muted small">{s.line}</span>
          <span className="num">{s.line !== "not started" ? formatClock(s.elapsedMs) : ""}</span>
        </li>
      ))}
    </ol>
  );
}

export function raceHeading(race: RaceSnapshot): string {
  return `Race${race.name ? ` · ${race.name}` : ""} · ${race.ended ? "ended" : `${race.racing} racing`}`;
}
