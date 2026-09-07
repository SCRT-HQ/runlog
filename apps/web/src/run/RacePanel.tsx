import { useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import { formatClock } from "@runlog/engine";
import type { RaceView } from "./useRace.ts";

/**
 * The leaderboard, the code, and the two things the one who started the
 * race can do. Everyone's progress is what their own device reported; a
 * racer who has not started yet is listed at the bottom, waiting.
 */
export function RacePanel({ pack, race }: { pack: Pack; race: RaceView }) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!race.race) return null;
  const { meta } = race.race;
  const v = pack.vocabulary;
  const ended = Boolean(meta.endedAt);

  return (
    <section className="panel racePanel">
      <h3 className="sectionTitle">
        Race{meta.name ? ` · ${meta.name}` : ""} <span className="muted">{ended ? "ended" : `${race.race.entries.length} racing`}</span>
      </h3>
      <ol className="raceBoard">
        {race.standings.map(({ entry, place, me }) => {
          const p = entry.progress;
          return (
            <li key={entry.sub} className={me ? "me" : ""}>
              <span className="place">#{place}</span>
              <span className="who">{entry.name ?? (me ? "You" : "Someone")}</span>
              <span className="where muted small">
                {!p
                  ? "not started"
                  : p.status === "ended"
                    ? `finished · ${p.unitsDone} ${p.unitsDone === 1 ? v.unit.one.toLowerCase() : v.unit.many.toLowerCase()}${p.ending ? ` · ${p.ending}` : ""}`
                    : `${v.unit.one} ${p.unit} · ${p.unitsDone} done`}
              </span>
              <span className="time mono">{p ? formatClock(p.elapsedMs) : ""}</span>
            </li>
          );
        })}
      </ol>
      {!ended && (
        <div className="raceCode">
          <span className="muted small">Code</span>
          <code>{meta.code}</code>
          <button
            className="ghost tiny"
            onClick={() => {
              void navigator.clipboard?.writeText(meta.code).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <span className="muted small">Anyone with the pack can join with it.</span>
        </div>
      )}
      {race.owner && !ended && (
        <>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const to = email.trim();
              if (!to) return;
              void race.invite(to).then(
                () => {
                  setEmail("");
                  setNote(`Sent the code to ${to}.`);
                },
                (error: unknown) => setNote(error instanceof Error && error.message ? error.message : "That could not be sent."),
              );
            }}
          >
            <input className="textInput" type="email" value={email} placeholder="send the code to an address" onChange={(e) => setEmail(e.target.value)} />
            <button className="ghost" type="submit" disabled={race.busy || !email.trim()}>
              Send
            </button>
          </form>
          <div className="padRow">
            <button className="ghost tiny" disabled={race.busy} onClick={() => void race.end()}>
              End the race
            </button>
            <button className="ghost tiny" onClick={race.refresh}>
              Refresh
            </button>
          </div>
        </>
      )}
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}
