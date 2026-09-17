import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { an } from "@runlog/rules-schema";
import type { Pack } from "@runlog/rules-schema";
import type { StoredRun } from "../storage/db.ts";
import { RunRow, onDay } from "./RunRow.tsx";
import { bestOf, scoresOf } from "./scores.ts";
import { pendingRaceCode } from "../share/IncomingRace.tsx";
import type { ChosenSetup } from "../control/setups.ts";
import { SetupPicker } from "./SetupPicker.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Field } from "../ui/Field.tsx";

/**
 * What a run is started from, asked in the order somebody needs it.
 *
 * What this is, then what kind of run, then what it takes to play one,
 * then who is playing, then the seed where the mode cannot go without
 * one. Everything that is a preference rather than a requirement waits
 * under Advanced, and nothing that blocks the start button is ever in
 * there: a fold that hides a requirement makes the screen shorter and
 * the person stuck.
 *
 * The lifecycle underneath is the one that was here before. The same
 * `onStart` with the same arguments, no clock started early, no event
 * that a replay has not seen.
 */
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
  /**
   * Whether the picker has anything to pick from, which only it can say.
   * Advanced is not offered as an empty fold on a device with no setups.
   */
  const [setupsOffered, setSetupsOffered] = useState(false);
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
  const runOne = v.run.one.toLowerCase();
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

  const modes = Object.entries(pack.modes);
  const modeLabelId = useId();
  const modeGroup = useRef<HTMLDivElement>(null);
  /**
   * A radio group answers to the arrow keys, and only the chosen card is
   * in the tab order: one stop for the question, not one per answer.
   */
  const steer = (e: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = steps[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const to = (at + step + modes.length) % modes.length;
    const next = modes[to];
    if (!next) return;
    setMode(next[0]);
    modeGroup.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
  };

  /**
   * The seed, in the one place this mode wants it.
   *
   * The same field either way, so nothing about it changes when the mode
   * does. A mode that cannot run without one asks for it in the open; a
   * mode that only offers one asks under Advanced.
   */
  const seedField = (
    <Field
      label="Seed"
      requirement={chosen?.seeded ? "required" : "optional"}
      help={
        chosen?.seeded
          ? "The same seed meets the same results in the same order."
          : "The same seed meets the same results in the same order. Leave it empty to roll your own."
      }
    >
      {(control) => (
        <div className="row seedRow">
          <input
            {...control}
            className="textInput"
            value={seed}
            placeholder={chosen?.seeded ? "e.g. long-kiln-42" : "unseeded, dice are unrepeatable"}
            onChange={(e) => setSeed(e.target.value)}
          />
          <Button onClick={() => setSeed(coinSeed())}>Make one</Button>
        </div>
      )}
    </Field>
  );

  /**
   * Nothing is folded away that is not there. A mode that asks for its seed
   * in the open leaves Advanced holding the picker alone, and the picker is
   * nothing at all on a device with no setups for this pack's tool. The
   * panel stays mounted either way, because only it can say which it is.
   */
  const advanced = !chosen?.seeded || setupsOffered;

  return (
    <main className="main">
      <section className="panel setup">
        <header className="setupHead">
          <p className="setupPack">{pack.title}</p>
          {pack.description && <p className="setupPremise">{pack.description}</p>}
          <h2>{others.length > 0 ? `Another ${runOne}` : `Begin ${an(v.run.one)}`}</h2>
          {best && (
            <p className="muted small">
              Your best: {bestLabel}, on {onDay(best.endedAt)}
              {best.name && ` · ${best.name}`}
            </p>
          )}

          {others.length > 0 && onContinue && (
            <div className="setupOthers">
              <p className="muted small">Or continue one; they stay in your list either way.</p>
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
                <Button size="compact" onClick={onBack}>
                  Back to the open {runOne}
                </Button>
              )}
            </div>
          )}
        </header>

        <section className="setupSection">
          <h3 className="sectionTitle" id={modeLabelId}>
            Mode
          </h3>
          {/* One mode is not a question. It is shown, chosen, and left alone. */}
          {modes.length === 1 ? (
            <div className="choices">
              <div className="choice on">
                <strong>{modes[0]![1].label}</strong>
                {modes[0]![1].description && <span className="muted small">{modes[0]![1].description}</span>}
              </div>
            </div>
          ) : (
            <div className="choices" role="radiogroup" aria-labelledby={modeLabelId} ref={modeGroup}>
              {modes.map(([id, m], i) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={id === mode}
                  tabIndex={id === mode ? 0 : -1}
                  className={`choice ${id === mode ? "on" : ""}`}
                  onClick={() => setMode(id)}
                  onKeyDown={(e) => steer(e, i)}
                >
                  <strong>{m.label}</strong>
                  {m.description && <span className="muted small">{m.description}</span>}
                </button>
              ))}
            </div>
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
        </section>

        {requirements.length > 0 && (
          <section className="setupSection">
            <h3 className="sectionTitle">What it needs</h3>
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
                      <Badge tone="cap">{r.kind}</Badge>
                      <Badge className="skip">optional</Badge>
                    </label>
                  ) : (
                    <span className="needRow">
                      <span>{r.label}</span>
                      <Badge tone="cap">{r.kind}</Badge>
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
          </section>
        )}

        {(moderated || maxPlayers > 1) && (
          <section className="setupSection">
            <h3 className="sectionTitle">Who plays</h3>
            {moderated ? (
              <>
                <p className="muted small">
                  You run the {runOne} from this device; they race it. Names, not accounts: anyone who can hear you can play.
                  {moderated.award === "everyone"
                    ? " Everyone who finishes a challenge scores it"
                    : " The first to finish a challenge scores it"}
                  {moderated.firstBonus ? `, and the first gets ${moderated.firstBonus} more.` : "."}
                </p>
                {roster.length > 0 && (
                  <ul className="roster">
                    {roster.map((n) => (
                      <li key={n}>
                        <span>{n}</span>
                        <Button size="compact" onClick={() => setRoster(roster.filter((x) => x !== n))}>
                          remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {/* The count that blocks the start button is said here, at the box that fixes it. */}
                <Field
                  label={
                    <>
                      Contestants{" "}
                      <span className="muted">
                        {moderated.contestants.min}-{moderated.contestants.max}
                      </span>
                    </>
                  }
                  error={rosterOk ? undefined : `Add ${moderated.contestants.min} or more contestants first`}
                >
                  {(control) => (
                    <div className="padRow">
                      <input
                        {...control}
                        className="textInput"
                        value={newName}
                        placeholder="a contestant's name"
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addName()}
                      />
                      <Button onClick={addName} disabled={!newName.trim()}>
                        Add
                      </Button>
                    </div>
                  )}
                </Field>
              </>
            ) : (
              <>
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
          </section>
        )}

        {/*
          The seed is the only thing that decides whether a run is seeded. A
          mode that calls itself seeded cannot start without one, so it is
          asked for here, in the open, beside everything else the start
          button waits on.
        */}
        {chosen?.seeded && <section className="setupSection">{seedField}</section>}

        {/*
          A race is a way of playing, not a preference, so it stays with the
          mode rather than folding away. Any mode may race, now that a seed
          is what makes a run seeded; this asked for a mode declaring itself
          seeded, which left a pack whose author had not written one unable
          to race at all.
        */}
        {race && (
          <section className="setupSection">
            <h3 className="sectionTitle">
              Race <span className="muted">across devices</span>
            </h3>
            <p className="muted small">
              Start a race and share its code, or join one with a code you were given. Each racer plays the same seed on their own device,
              and the leaderboard follows along in the side column. Starting one with the seed box empty makes a seed.
            </p>
            <div className="row raceRow">
              <Button onClick={() => race.start(mode, seed.trim() || coinSeed(), runName, setup)}>Start a race</Button>
              <input
                className="textInput code"
                value={raceCode}
                placeholder="code"
                maxLength={8}
                aria-label="Race code"
                onChange={(e) => setRaceCode(e.target.value.toUpperCase())}
              />
              <Button disabled={raceCode.trim().length < 6} onClick={() => race.join(raceCode.trim(), setup)}>
                Join
              </Button>
            </div>
            {race.note && <p className="notice">{race.note}</p>}
          </section>
        )}

        {/* Folded by default, and folded or open as this device left it. */}
        <Disclosure
          className={advanced ? "setupAdvanced" : "setupAdvanced setupEmpty"}
          summary="Advanced"
          defaultOpen={false}
          remember="setupAdvanced"
        >
          {!chosen?.seeded && <div className="setupSection">{seedField}</div>}
          <div className="setupSection setupPicker">
            <SetupPicker pack={pack} chosen={setup} onChoose={setSetup} onOffer={setSetupsOffered} />
          </div>
        </Disclosure>

        <section className="setupSection">
          <Field label="Name it" requirement="optional" help={`For telling this ${runOne} from the next one. You can change it later.`}>
            {(control) => (
              <input
                {...control}
                className="textInput runNameField"
                value={runName}
                placeholder={`e.g. the winter ${runOne}`}
                onChange={(e) => setRunName(e.target.value)}
              />
            )}
          </Field>
        </section>

        <div className="padRow stepAction setupStart">
          <Button
            variant="primary"
            size="big"
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
            Enter the {runOne}
          </Button>
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
