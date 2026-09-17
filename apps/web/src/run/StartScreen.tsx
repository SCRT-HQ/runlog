import { useMemo, useState } from "react";
import { an } from "@runlog/rules-schema";
import type { Pack } from "@runlog/rules-schema";
import type { StoredRun } from "../storage/db.ts";
import { RunRow, onDay } from "./RunRow.tsx";
import { bestOf, scoresOf } from "./scores.ts";
import { pendingRaceCode } from "../share/IncomingRace.tsx";
import type { ChosenSetup } from "../control/setups.ts";
import { SetupPicker } from "./SetupPicker.tsx";

export function StartScreen({
  pack,
  onStart,
  others = [],
  onContinue,
  onBack,
  race,
}: {
  pack: Pack;
  onStart: (
    mode: string,
    seed: string,
    players: number,
    name?: string,
    contestants?: string[],
    lacks?: string[],
    extras?: { setup?: ChosenSetup },
  ) => void;
  /** Races across devices, where there is an account to hold one. */
  race?: {
    start: (mode: string, seed: string, name: string, setup: ChosenSetup | null) => void;
    join: (code: string, setup: ChosenSetup | null) => void;
    note: string | null;
  };
  /** Runs of this pack already here, offered before a new one. */
  others?: StoredRun[];
  onContinue?: (runId: string) => void;
  /** Back to the run that was open, where "another" was asked for. */
  onBack?: () => void;
}) {
  const [mode, setMode] = useState(pack.defaultMode);
  /** What this run starts under, where the pack's game has a tool and somebody wrote one. */
  const [setup, setSetup] = useState<ChosenSetup | null>(null);
  const [seed, setSeed] = useState("");
  const [runName, setRunName] = useState("");
  const [raceCode, setRaceCode] = useState(() => pendingRaceCode() ?? "");
  const [players, setPlayers] = useState(1);
  const [roster, setRoster] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  /** Optional requirements the player has said they do not have. */
  const [lacking, setLacking] = useState<Set<string>>(new Set());
  const requirements = pack.requires ?? [];
  const chosen = pack.modes[mode];
  const moderated = chosen?.moderated;
  const addName = () => {
    const n = newName.trim();
    if (!n || roster.includes(n)) return;
    setRoster([...roster, n]);
    setNewName("");
  };
  const rosterOk = !moderated || (roster.length >= moderated.contestants.min && roster.length <= moderated.contestants.max);
  /**
   * The one thing a mode calling itself seeded still decides.
   *
   * Not how the dice are drawn -- that is the seed's, everywhere. Only
   * that this mode is pointless without one: starting a shared mode
   * unseeded gives you a private run and no sign that nobody else will
   * ever match it.
   */
  const seedOk = !chosen?.seeded || seed.trim() !== "";
  const v = pack.vocabulary;
  const seats = chosen?.players;
  const minPlayers = seats?.min ?? 1;
  const maxPlayers = seats?.max ?? 1;
  /**
   * Held loosely rather than reset when the mode changes: a two-player mode
   * has no seating for one, so the count is clamped into whatever the chosen
   * mode allows instead of leaving nothing selected.
   */
  const seated = Math.min(Math.max(players, minPlayers), maxPlayers);
  /**
   * The best of what is already here, so far. A first run is not told it
   * has no best: the line only appears once there is one to beat.
   */
  const scored = useMemo(() => scoresOf(pack, others, Date.now()), [pack, others]);
  const best = bestOf(scored);
  const bestLabel = best && (best.score.key === "counter" ? `${best.text} ${best.score.label}` : best.text);

  return (
    <main className="main">
      <section className="panel setup">
        <h2>{others.length > 0 ? `Another ${v.run.one.toLowerCase()}` : `Begin ${an(v.run.one)}`}</h2>
        <p className="muted">{pack.title}</p>
        {best && (
          <p className="muted small">
            Your best: {bestLabel}, on {onDay(best.endedAt)}
            {best.name && ` · ${best.name}`}
          </p>
        )}

        {others.length > 0 && onContinue && (
          <>
            <h3 className="sectionTitle">
              Or continue one <span className="muted">they stay in your list either way</span>
            </h3>
            <div className="runList">
              {others.map((r) => (
                <RunRow
                  key={r.runId}
                  run={r}
                  vocabulary={pack.vocabulary}
                  score={scored.find((s) => s.runId === r.runId)?.text}
                  onPick={() => onContinue(r.runId)}
                />
              ))}
            </div>
            {onBack && (
              <button className="ghost tiny" onClick={onBack}>
                Back to the open {v.run.one.toLowerCase()}
              </button>
            )}
          </>
        )}

        <h3 className="sectionTitle">Mode</h3>
        <div className="choices">
          {Object.entries(pack.modes).map(([id, m]) => (
            <button key={id} className={`choice ${id === mode ? "on" : ""}`} onClick={() => setMode(id)}>
              <strong>{m.label}</strong>
              <span className="muted small">{m.description}</span>
            </button>
          ))}
        </div>

        <SetupPicker pack={pack} chosen={setup} onChoose={setSetup} />

        {/*
          The seed lives where a run starts, and it is the only thing that
          decides whether a run is seeded. A shared mode insists on one;
          every other mode offers one, and does exactly the same thing with
          it. It used to sit above the rules page, feeding rolls nobody
          logged.
        */}
        <h3 className="sectionTitle">Seed {!chosen?.seeded && <span className="muted">optional</span>}</h3>
        {chosen?.seeded && (
          <p className="muted small">
            This mode is meant to be shared. Everyone entering the same seed meets the same {v.run.one.toLowerCase()}.
          </p>
        )}
        <div className="row seedRow">
          <input
            className="textInput"
            value={seed}
            placeholder={chosen?.seeded ? "e.g. long-kiln-42" : "unseeded, dice are unrepeatable"}
            onChange={(e) => setSeed(e.target.value)}
          />
          <button className="ghost" onClick={() => setSeed(coinSeed())}>
            Make one
          </button>
        </div>
        <p className="muted small">
          A seeded {v.run.one.toLowerCase()} rolls its own dice, so the same seed meets the same results in the same order.
          {!chosen?.seeded && " Leave it empty to roll your own."}
        </p>

        {/*
          Any mode, now that a seed is what makes a run seeded. This asked
          for a mode declaring itself seeded, which left a pack whose author
          had not written one unable to race at all.
        */}
        {race && (
          <>
            <h3 className="sectionTitle">
              Race <span className="muted">across devices</span>
            </h3>
            <p className="muted small">
              Start a race and share its code, or join one with a code you were given. Each racer plays the same seed on their own device,
              and the leaderboard follows along in the side column. Starting one with the seed box empty makes a seed.
            </p>
            <div className="row raceRow">
              <button className="ghost" onClick={() => race.start(mode, seed.trim() || coinSeed(), runName, setup)}>
                Start a race
              </button>
              <input
                className="textInput code"
                value={raceCode}
                placeholder="code"
                maxLength={8}
                onChange={(e) => setRaceCode(e.target.value.toUpperCase())}
              />
              <button className="ghost" disabled={raceCode.trim().length < 6} onClick={() => race.join(raceCode.trim(), setup)}>
                Join
              </button>
            </div>
            {race.note && <p className="notice">{race.note}</p>}
          </>
        )}

        {moderated && (
          <>
            <h3 className="sectionTitle">
              Contestants{" "}
              <span className="muted">
                {moderated.contestants.min}-{moderated.contestants.max}
              </span>
            </h3>
            <p className="muted small">
              You run the {v.run.one.toLowerCase()} from this device; they race it. Names, not accounts: anyone who can hear you can play.
              {moderated.award === "everyone"
                ? " Everyone who finishes a challenge scores it"
                : " The first to finish a challenge scores it"}
              {moderated.firstBonus ? `, and the first gets ${moderated.firstBonus} more.` : "."}
            </p>
            <ul className="roster">
              {roster.map((n) => (
                <li key={n}>
                  <span>{n}</span>
                  <button className="ghost tiny" onClick={() => setRoster(roster.filter((x) => x !== n))}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="padRow">
              <input
                className="textInput"
                value={newName}
                placeholder="a contestant's name"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addName()}
              />
              <button className="ghost" onClick={addName} disabled={!newName.trim()}>
                Add
              </button>
            </div>
          </>
        )}

        {maxPlayers > 1 && !moderated && (
          <>
            <h3 className="sectionTitle">Players</h3>
            <p className="muted small">
              Same room, one device, passed around.
              {seats?.rotate === "clockwise" && " Roles move on one seat each " + v.unit.one.toLowerCase() + "."}
            </p>
            <div className="options">
              {Array.from({ length: maxPlayers - minPlayers + 1 }, (_, i) => minPlayers + i).map((n) => (
                <button key={n} className={`chip pick ${n === seated ? "on" : ""}`} onClick={() => setPlayers(n)}>
                  {n}
                </button>
              ))}
            </div>
          </>
        )}

        {requirements.length > 0 && (
          <>
            <h3 className="sectionTitle">
              What you need <span className="muted">before you start</span>
            </h3>
            <ul className="needs">
              {requirements.map((r) => (
                <li key={r.id} className={lacking.has(r.id) ? "lacking" : ""}>
                  {r.optional ? (
                    <label title="Untick it and the dice will not ask for it">
                      <input
                        type="checkbox"
                        checked={!lacking.has(r.id)}
                        onChange={(e) => {
                          const next = new Set(lacking);
                          if (e.target.checked) next.delete(r.id);
                          else next.add(r.id);
                          setLacking(next);
                        }}
                      />
                      <span>{r.label}</span>
                      <span className="chip cap">{r.kind}</span>
                      <span className="chip skip">optional</span>
                    </label>
                  ) : (
                    <span className="needRow">
                      <span>{r.label}</span>
                      <span className="chip cap">{r.kind}</span>
                    </span>
                  )}
                  {r.note && <span className="muted small needNote">{r.note}</span>}
                  {r.url && (
                    <a className="small" href={r.url} target="_blank" rel="noreferrer">
                      where to find it
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {requirements.some((r) => r.optional) && (
              <p className="muted small">Untick what you do not have. Results that need it are drawn again.</p>
            )}
          </>
        )}

        {chosen?.notes && chosen.notes.length > 0 && (
          <div className="notice">
            <ul className="noteList">
              {chosen.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        <h3 className="sectionTitle">
          Name it <span className="muted">optional</span>
        </h3>
        <p className="muted small">For telling this {v.run.one.toLowerCase()} from the next one. You can change it later.</p>
        <input
          className="textInput runNameField"
          value={runName}
          placeholder={`e.g. the winter ${v.run.one.toLowerCase()}`}
          onChange={(e) => setRunName(e.target.value)}
        />

        <div className="padRow stepAction">
          <button
            className="primary big"
            disabled={!rosterOk || !seedOk}
            title={
              !rosterOk
                ? `Add ${moderated?.contestants.min ?? 2} or more contestants first`
                : !seedOk
                  ? "This mode needs a seed"
                  : undefined
            }
            onClick={() => onStart(mode, seed, seated, runName, roster, [...lacking], setup ? { setup } : {})}
          >
            Enter the {v.run.one.toLowerCase()}
          </button>
        </div>
      </section>
    </main>
  );
}

/**
 * A seed someone can read down the phone to a friend.
 *
 * Two words and a number, because the seed has to survive being spoken aloud
 * and typed in by somebody else, which a hex string does not.
 */
function coinSeed(): string {
  const first = ["long", "cold", "slow", "half", "deep", "low", "dry", "loud"];
  const second = ["kiln", "tape", "room", "hymn", "drum", "wire", "salt", "moth"];
  const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)]!;
  return `${pick(first)}-${pick(second)}-${Math.floor(Math.random() * 90) + 10}`;
}
