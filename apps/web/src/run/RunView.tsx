import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { an } from "@runlog/rules-schema";
import { ClockPanel } from "./ClockPanel.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { ControlPanel, openControlsWindow } from "./ControlPanel.tsx";
import { useAlerts, useAlertSettings } from "../alerts/useAlerts.ts";
import { useAccount } from "../auth/Account.tsx";
import { clockOfUnit, formatClock, liveClocks, nextUnit } from "@runlog/engine";
import type { Pack } from "@runlog/rules-schema";
import { describeSkip, describeSkipReason, phaseSkipped, subjectLabel, type RunEvent, type RunState } from "@runlog/engine";
import { useRun, type ActiveStep } from "./useRun.ts";
import type { RunStore } from "./store.ts";
import type { StoredRun } from "../storage/db.ts";
import { RequestPanel } from "./RequestPanel.tsx";
import { Checklist, checklistDone } from "./Checklist.tsx";
import { Receipt, type RollReceipt } from "./Receipt.tsx";
import type { RolledDie } from "../rolling.ts";
import { useSync } from "../sync/SyncProvider.tsx";
import { syncBus } from "../sync/bus.ts";
import { DiceCurtain, rolledOf, type RolledGesture } from "../dice/DiceCurtain.tsx";
import { preloadDice3d } from "../dice/settings.ts";
import { CARRY_ON_HOLD_MS, carriesOnByItself } from "./pace.ts";
import { flowStrip } from "./flowStrip.ts";
import { ExportPanel } from "./ExportPanel.tsx";
import { EnvironmentPanel } from "../environment/EnvironmentPanel.tsx";
import { Members } from "./Members.tsx";
import { RunRow } from "./RunRow.tsx";
import { RacePanel } from "./RacePanel.tsx";
import { useApi } from "../sync/useApi.ts";
import { ulid } from "../storage/ids.ts";
import { clearPendingRaceCode, pendingRaceCode } from "../share/IncomingRace.tsx";
import { PlanError } from "../sync/client.ts";
import { liveLinkOf } from "../live/route.ts";
import { paperOf, raceOf, snapshotOf } from "../live/snapshot.ts";
import { useRace } from "./useRace.ts";

/**
 * Playing a run.
 *
 * Every noun on screen comes from the pack's vocabulary, and every step comes
 * from its declared flow. Nothing here knows what kind of game it is hosting —
 * which is the same claim the format makes, held to to the last label.
 */
export function RunView({
  pack,
  store,
  bench,
}: {
  pack: Pack;
  /** Where the log lives; the device unless a bench says otherwise. */
  store?: RunStore;
  /**
   * A test run: the pack is being tried, not played. Nothing is saved
   * or shared, so the people, race and export panels have nothing to
   * hold, and the screen says so with a way back to where the trial began.
   */
  bench?: { from: string; onLeave: () => void };
}) {
  const run = useRun(pack, store);

  // Sounds for what happens while nobody is looking at the screen. Hooked
  // here, before any early return, as hooks must be.
  const account = useAccount();
  const me = account.status === "signed-in" ? account.user.id : null;
  const [alerts, setAlerts] = useAlertSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  // The controls in a window of their own, for a streamer; see ControlPanel.
  // The window is asked for in the press, and closed with this screen.
  const [controlsWindow, setControlsWindow] = useState<Window | null>(null);
  const closeControls = useCallback(() => setControlsWindow(null), []);
  useEffect(() => () => controlsWindow?.close(), [controlsWindow]);
  const api = useApi();
  const [raceNote, setRaceNote] = useState<string | null>(null);

  /**
   * A run shared by link keeps a snapshot on the server for anyone whose
   * device may not hold the pack: written from here after each move,
   * redacted here, where the pack and its license are.
   */
  const shared = Boolean(run.record && run.record.role !== "viewer" && (run.record.shared || liveLinkOf(run.record.runId)));
  // The race this run is in, if any: the side column's panel and the snapshot both read it.
  const raceView = useRace(run.record, run.state, run.events);
  useEffect(() => {
    if (!api || !shared || !run.record || !run.state) return;
    const record = run.record;
    const state = run.state;
    const events = run.events;
    const race = raceOf(raceView.race, raceView.standings, pack.vocabulary.unit);
    const timer = window.setTimeout(() => {
      void api.putSnapshot(record.runId, { ...snapshotOf(pack, state, events, undefined, { race }), paper: paperOf(pack, state.mode) }).catch(() => {});
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, shared, run.events, pack, raceView.race]);

  /**
   * Starting a race, or joining one: an ordinary run of this pack with the
   * race's seed and mode, and the race told which run this is. Joining a
   * race that is for another pack says so rather than guessing.
   */
  const startRace = async (mode: string, seed: string, runName: string) => {
    if (!api) return;
    setRaceNote(null);
    const raceId = ulid();
    const runId = run.startRun(mode, seed, 1, runName, [], [], { raceId });
    try {
      const race = await api.createRace({ id: raceId, packId: pack.id, packVersion: pack.version, packTitle: pack.title, ...(runName.trim() ? { name: runName.trim() } : {}), mode, seed, sessionId: runId });
      setRaceNote(`Racing. The code is ${race.meta.code}; it is in the side column too.`);
    } catch (error) {
      if (error instanceof PlanError) setRaceNote(`${error.message}. This is an ordinary run for now; subscribe from your profile, under Plan, and start a race again.`);
      else setRaceNote(error instanceof Error && error.message ? error.message : "The race could not be started; this is an ordinary run.");
    }
  };
  const joinRace = async (code: string) => {
    if (!api) return;
    setRaceNote(null);
    try {
      const race = await api.joinRace(code);
      if (race.meta.packId !== pack.id) {
        setRaceNote(`That race is for ${race.meta.packTitle ?? race.meta.packId}. Open that pack and join from there; the code is kept.`);
        return;
      }
      if (!pack.modes[race.meta.mode]) {
        setRaceNote(`That race plays a mode this version of the pack does not have (${race.meta.mode}).`);
        return;
      }
      clearPendingRaceCode();
      const runId = run.startRun(race.meta.mode, race.meta.seed, 1, race.meta.name ?? "", [], [], { raceId: race.meta.id });
      await api.putRaceEntry(race.meta.id, { sessionId: runId });
    } catch (error) {
      setRaceNote(error instanceof Error && error.message ? error.message : "That code did not open a race.");
    }
  };
  useAlerts(run.events, run.runId, me, alerts);

  /**
   * The receipts: what each throw of the step did, kept until the step has
   * been read.
   *
   * The engine moves on the instant a roll is answered, so the dice and the
   * result would otherwise vanish together. The answer is still committed
   * as the engine sees fit — a receipt is a record, not a hold on the game —
   * but the step's rolls stay on screen, in order, with the next roll's
   * keypad beneath them, until "Carry on" closes the step.
   *
   * Outcomes are the signal: whatever the run had not resolved before an
   * answer, and has now, is what that answer did. Measured from the count
   * rather than the request, so a machine roll with auto-roll on, or a move
   * that resolves a table, gets a receipt too — just one without dice.
   */
  const [receipts, setReceipts] = useState<RollReceipt[]>([]);
  const sync = useSync();
  // The roller is fetched while the run opens, not when the first die is thrown.
  useEffect(() => preloadDice3d(), []);
  // Someone else's throw at this table, played here for whoever is not throwing.
  const [othersRoll, setOthersRoll] = useState<RolledGesture | null>(null);
  useEffect(() => {
    const runId = run.record?.runId;
    if (!runId) return;
    return syncBus.subscribe((news) => {
      if (news.t !== "gesture" || news.id !== runId) return;
      const rolled = rolledOf(news);
      if (rolled) setOthersRoll(rolled);
    });
  }, [run.record?.runId]);
  const seen = useRef<number | null>(null);
  const awaiting = useRef<Omit<RollReceipt, "outcomes"> | null>(null);
  // How many answers this view has given, and how many it had given when
  // the last receipt was issued: what a step that came back with the run
  // had already resolved is shown as such, not as a throw just made.
  const committedSeen = useRef(0);
  const answered = useRef(0);
  const receipted = useRef(0);
  // What the run has resolved, counting what the block in flight has
  // resolved ahead of the log: a d100 lands on its line before the d6 it
  // leads to is asked for, and that line is the receipt for the d100.
  const committed = run.state?.outcomes;
  const ahead = run.pendingOutcomes;
  useEffect(() => {
    if (!committed) return;
    const outcomes = ahead.length > 0 ? [...committed, ...ahead] : committed;
    const count = outcomes.length;
    const landed = committed.length !== committedSeen.current;
    committedSeen.current = committed.length;
    if (seen.current === null) {
      // First sight of a saved run: everything in it is old news.
      seen.current = count;
      return;
    }
    if (count < seen.current) {
      // Undo, or the step cancelled. Whatever the receipts were about has been unmade.
      seen.current = count;
      awaiting.current = null;
      setReceipts([]);
      return;
    }
    const fresh = outcomes.slice(seen.current);
    seen.current = count;
    const throwing = awaiting.current;
    if (fresh.length === 0 && !throwing) return;
    // A step that came back with the run brings the lines it had resolved
    // with it: shown as what stands so far, not as a throw just made.
    const restored = !throwing && !landed && answered.current === receipted.current;
    awaiting.current = null;
    receipted.current = answered.current;
    setReceipts((prev) => [
      ...prev,
      {
        dice: throwing?.dice ?? null,
        total: throwing?.total ?? null,
        label: throwing?.label ?? (restored ? "So far this step" : null),
        notation: throwing?.notation ?? null,
        machineRolled: throwing?.machineRolled ?? !restored,
        ...(throwing?.seed !== undefined ? { seed: throwing.seed } : {}),
        outcomes: fresh,
      },
    ]);
    // Everyone watching sees the same dice land: the value is already
    // decided, so what travels is the throw as it is shown here.
    if (throwing?.dice && throwing.dice.length > 0 && run.record && !run.readOnly && !bench) {
      sync.gesture(run.record.runId, "rolled", {
        dice: throwing.dice,
        total: throwing.total,
        ...(throwing.seed !== undefined ? { seed: throwing.seed } : {}),
        ...(throwing.label ? { label: throwing.label } : {}),
        ...(throwing.notation ? { notation: throwing.notation } : {}),
      });
    }
  }, [committed, ahead, run.events.length]);

  // The step is done once nothing more is asked; its receipts wait to be
  // read, unless this device asked them not to.
  const settled = receipts.length > 0 && !run.pending?.request;
  useEffect(() => {
    if (!settled || !carriesOnByItself()) return;
    const timer = setTimeout(() => setReceipts([]), CARRY_ON_HOLD_MS);
    return () => clearTimeout(timer);
  }, [settled]);
  const lastReceipt = receipts[receipts.length - 1] ?? null;

  const answer = useCallback(
    (key: string, value: string | number | boolean, machineRolled?: boolean, dice?: RolledDie[], seed?: number) => {
      const request = run.pending?.request;
      answered.current += 1;
      if (request?.kind === "roll" && typeof value === "number") {
        awaiting.current = {
          dice: dice ?? null,
          total: value,
          label: request.label ?? null,
          notation: request.dice,
          machineRolled: machineRolled === true,
          ...(seed !== undefined ? { seed } : {}),
        };
      }
      run.answer(key, value, machineRolled);
    },
    [run],
  );

  // Reading the saved run is asynchronous. Offering to start a new one before
  // it arrives would invite the player to overwrite a run already in progress.
  if (!run.hydrated) {
    return (
      <main className="main">
        <section className="panel muted">Loading your {pack.vocabulary.run.one.toLowerCase()}…</section>
      </main>
    );
  }

  if (!run.started || !run.state) {
    return (
      <>
        {bench && (
          <div className="main benchOnly">
            <BenchBar pack={pack} bench={bench} />
          </div>
        )}
        <Setup
          pack={pack}
          onStart={run.startRun}
          others={run.runList}
          onContinue={run.switchRun}
          onBack={run.runList.length > 0 ? run.cancelAnother : undefined}
          {...(api && !bench ? { race: { start: (mode, seed, name) => void startRace(mode, seed, name), join: (code) => void joinRace(code), note: raceNote } } : {})}
        />
      </>
    );
  }

  const { state } = run;

  return (
    <main className="main run">
      {bench && <BenchBar pack={pack} bench={bench} onRestart={run.discard} />}
      <RunHeader pack={pack} run={run} state={state} onSettings={() => setSettingsOpen(true)} />

      {/*
        Three columns that are not three cards. The margin holds where the
        unit is up to, numbered because it is a sequence. The middle holds the
        one thing to do, which is the only raised object on the screen. The
        side holds the board and the trackers as ruled rows.
      */}
      <div className="columns run">
        <aside className="margin">
          <div className="stageNo">
            <small>{pack.modes[state.mode]?.label ?? state.mode}</small>
            {pack.vocabulary.unit.one} {state.unit || "—"}
          </div>
          {state.unit > 0 && <ClockPanel pack={pack} run={run} state={state} />}
          <Flow pack={pack} run={run} state={state} />
        </aside>

        <div className={`col wide ${run.readOnly ? "watching" : ""}`}>
          {run.readOnly && (
            <p className="notice">
              You are watching this {pack.vocabulary.run.one.toLowerCase()}. Every move shows here as it is made; none can be made from here.
            </p>
          )}
          <DiceCurtain roll={othersRoll} />
          {receipts.length > 0 && (
            <Receipt
              receipts={receipts}
              pack={pack}
              settled={settled}
              onDismiss={() => setReceipts([])}
              {...(settled && run.canDrawAgain && !run.readOnly ? { onDrawAgain: (why?: string) => run.drawAgain(why) } : {})}
              {...(settled && lastReceipt?.machineRolled && !run.autoRoll && !run.seededRun && !run.readOnly
                ? { onKeepRolling: () => run.setAutoRoll(true) }
                : {})}
            />
          )}
          {run.pending?.request ? (
            // The next thing the game is waiting on comes beneath the
            // receipts of the rolls before it, which stay where they are.
            <RequestPanel
              request={run.pending.request}
              pack={pack}
              state={state}
              onAnswer={answer}
              onCancel={run.abandonPending}
            />
          ) : receipts.length > 0 ? null : state.status === "ended" ? (
            <Ended pack={pack} state={state} />
          ) : state.unit === 0 ? (
            <StartFirstUnit pack={pack} onEnter={run.enterUnit} />
          ) : run.activeStep ? (
            <StepPanel pack={pack} run={run} state={state} active={run.activeStep} />
          ) : (
            <BetweenUnits pack={pack} run={run} state={state} />
          )}

          {(run.thresholds.length > 0 || run.globals.length > 0) && <Thresholds run={run} />}

          {(run.due.length > 0 || run.notes.length > 0) && (
            <Obligations pack={pack} run={run} />
          )}

          {run.moderated && run.challenges.length > 0 && <Winners run={run} state={state} />}
          {run.moves.length > 0 && <Moves run={run} pack={pack} />}

          <Timeline pack={pack} state={state} />

          {/*
            Taking the run out, and the link to the world outside. Neither is
            the point of the screen, and both were sitting at the same weight
            as the step. Folded away until wanted, under a label that says
            what is inside.
          */}
          {!bench && (
            <details className="more">
              <summary>Export and share</summary>
              <ExportPanel
                pack={pack}
                state={state}
                events={run.events}
                onLoad={run.loadEvents}
              />
              <EnvironmentPanel pack={pack} state={state} />
            </details>
          )}
        </div>

        <div className="col side">
          {run.moderated && <Scoreboard run={run} state={state} pack={pack} />}
          {run.roles.length > 0 && <Roles pack={pack} run={run} state={state} />}
          <Board pack={pack} state={state} onRename={run.renameSubject} onCorrect={run.readOnly ? undefined : run.correctState} />
          <Trackers pack={pack} state={state} onNudge={run.readOnly ? undefined : run.nudgeCounter} />
          {run.record && api && !bench && <RacePanel pack={pack} race={raceView} />}
          {run.record && !bench && <Members pack={pack} run={run.record} />}
        </div>
      </div>
      {settingsOpen && (
        <SettingsDialog
          runId={run.record?.runId ?? null}
          race={Boolean(run.record?.raceId)}
          alerts={alerts}
          onAlerts={setAlerts}
          rolling={{ auto: run.autoRoll, seeded: run.seededRun, onAuto: run.setAutoRoll }}
          onControls={() => {
            setSettingsOpen(false);
            void openControlsWindow().then(setControlsWindow, () => {});
          }}
          onClose={closeSettings}
        />
      )}
      {controlsWindow && (
        <ControlPanel
          win={controlsWindow}
          pack={pack}
          run={run}
          state={state}
          receipt={settled ? lastReceipt : null}
          onCarryOn={() => setReceipts([])}
          onRoll={(key, total, dice, seed) => answer(key, total, true, dice, seed)}
          onClose={closeControls}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The strip over a test run. It says what this is — a trial that keeps
 * nothing — and holds the two things a tester wants: to start the same
 * pack over, and to go back to where they were testing from.
 */
function BenchBar({ pack, bench, onRestart }: { pack: Pack; bench: { from: string; onLeave: () => void }; onRestart?: () => void }) {
  return (
    <div className="benchBar" role="status">
      <span className="benchLabel">Test run</span>
      <span className="muted">
        Nothing is saved. Roll for me is a choice here as anywhere; with it off, the Table button beside the pad lands any roll on the line you pick.
      </span>
      <span className="benchActions">
        {onRestart && (
          <button className="ghost tiny" onClick={onRestart} title={`Start ${pack.title} over from setup`}>
            Start over
          </button>
        )}
        <button className="ghost tiny" onClick={bench.onLeave}>
          Back to {bench.from}
        </button>
      </span>
    </div>
  );
}

export function Setup({
  pack,
  onStart,
  others = [],
  onContinue,
  onBack,
  race,
}: {
  pack: Pack;
  onStart: (mode: string, seed: string, players: number, name?: string, contestants?: string[], lacks?: string[]) => void;
  /** Races across devices, where there is an account to hold one. */
  race?: { start: (mode: string, seed: string, name: string) => void; join: (code: string) => void; note: string | null };
  /** Runs of this pack already here, offered before a new one. */
  others?: StoredRun[];
  onContinue?: (runId: string) => void;
  /** Back to the run that was open, where "another" was asked for. */
  onBack?: () => void;
}) {
  const [mode, setMode] = useState(pack.defaultMode);
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

  return (
    <main className="main">
      <section className="panel setup">
        <h2>{others.length > 0 ? `Another ${v.run.one.toLowerCase()}` : `Begin ${an(v.run.one)}`}</h2>
        <p className="muted">{pack.title}</p>

        {others.length > 0 && onContinue && (
          <>
            <h3 className="sectionTitle">
              Or continue one <span className="muted">they stay in your list either way</span>
            </h3>
            <div className="runList">
              {others.map((r) => (
                <RunRow key={r.runId} run={r} vocabulary={pack.vocabulary} onPick={() => onContinue(r.runId)} />
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
            <button
              key={id}
              className={`choice ${id === mode ? "on" : ""}`}
              onClick={() => setMode(id)}
            >
              <strong>{m.label}</strong>
              <span className="muted small">{m.description}</span>
            </button>
          ))}
        </div>

        {/*
          The seed lives where a run starts. A shared mode needs one; any
          other mode may take one, and the rolls the app makes for it then
          repeat. It used to sit above the rules page, feeding rolls nobody
          logged.
        */}
        {chosen?.seeded ? (
          <>
            <h3 className="sectionTitle">Seed</h3>
            <p className="muted small">
              This mode is meant to be shared. Everyone entering the same seed meets the same
              {" "}
              {v.run.one.toLowerCase()}.
            </p>
            <div className="row seedRow">
              <input
                className="textInput"
                value={seed}
                placeholder="e.g. long-kiln-42"
                onChange={(e) => setSeed(e.target.value)}
              />
              <button className="ghost" onClick={() => setSeed(coinSeed())}>
                Make one
              </button>
            </div>
            <p className="muted small">
              A seeded {v.run.one.toLowerCase()} rolls its own dice, so everyone meets the same
              results in the same order. Keep your own dice for the modes that ask for them.
            </p>
          </>
        ) : (
          <>
            <h3 className="sectionTitle">
              Seed <span className="muted">optional</span>
            </h3>
            <div className="row seedRow">
              <input
                className="textInput"
                value={seed}
                placeholder="unseeded, dice are unrepeatable"
                onChange={(e) => setSeed(e.target.value)}
              />
              <button className="ghost" onClick={() => setSeed(coinSeed())}>
                Make one
              </button>
            </div>
            <p className="muted small">
              With a seed, the rolls the app makes for you come out the same every time it is entered. Your own dice are yours regardless.
            </p>
          </>
        )}

        {race && (chosen?.seeded || raceCode) && (
          <>
            <h3 className="sectionTitle">
              Race <span className="muted">across devices</span>
            </h3>
            <p className="muted small">
              {chosen?.seeded
                ? `Start a race and share its code. Each racer plays this seed on their own device, and the leaderboard follows along in the side column.`
                : `You have a race code. Join, and the race's own mode and seed are used.`}
            </p>
            <div className="row raceRow">
              {chosen?.seeded && (
                <button className="ghost" onClick={() => race.start(mode, seed.trim() || coinSeed(), runName)}>
                  Start a race
                </button>
              )}
              <input className="textInput code" value={raceCode} placeholder="code" maxLength={8} onChange={(e) => setRaceCode(e.target.value.toUpperCase())} />
              <button className="ghost" disabled={raceCode.trim().length < 6} onClick={() => race.join(raceCode.trim())}>
                Join
              </button>
            </div>
            {race.note && <p className="notice">{race.note}</p>}
          </>
        )}

        {moderated && (
          <>
            <h3 className="sectionTitle">
              Contestants <span className="muted">{moderated.contestants.min}–{moderated.contestants.max}</span>
            </h3>
            <p className="muted small">
              You run the {v.run.one.toLowerCase()} from this device; they race it. Names, not accounts: anyone who can hear you can play.
              {moderated.award === "everyone" ? " Everyone who finishes a challenge scores it" : " The first to finish a challenge scores it"}
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
                <button
                  key={n}
                  className={`chip pick ${n === seated ? "on" : ""}`}
                  onClick={() => setPlayers(n)}
                >
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
            {requirements.some((r) => r.optional) && <p className="muted small">Untick what you do not have. Results that need it are drawn again.</p>}
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
        <p className="muted small">
          For telling this {v.run.one.toLowerCase()} from the next one. You can change it later.
        </p>
        <input
          className="textInput runNameField"
          value={runName}
          placeholder={`e.g. the winter ${v.run.one.toLowerCase()}`}
          onChange={(e) => setRunName(e.target.value)}
        />

        <div className="padRow">
          <button
            className="primary big"
            disabled={!rosterOk}
            title={rosterOk ? undefined : `Add ${moderated?.contestants.min ?? 2} or more contestants first`}
            onClick={() => onStart(mode, seed, seated, runName, roster, [...lacking])}
          >
            Enter the {v.run.one.toLowerCase()}
          </button>
        </div>
      </section>
    </main>
  );
}

function RunHeader({
  pack,
  run,
  state,
  onSettings,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
  onSettings: () => void;
}) {
  const v = pack.vocabulary;
  const mode = pack.modes[state.mode];
  return (
    <section className="runBar">
      <div className="runMeta">
        <strong>{pack.title}</strong>
        <span className="muted">{mode?.label ?? state.mode}</span>
        <RunName name={state.name} onRename={run.renameRun} noun={v.run.one.toLowerCase()} />
        {state.seed && <span className="chip">seed {state.seed}</span>}
        {state.status === "ended" && <span className="chip ok">ended</span>}
        {state.forcedUnits > 0 && <span className="chip warn">{state.forcedUnits} forced</span>}
        {state.rewindNext > 0 && (
          <span className="chip warn" title={`When this ${v.unit.one.toLowerCase()} closes, the ${v.run.one.toLowerCase()} goes back to ${v.unit.one.toLowerCase()} ${nextUnit(state)}`}>
            back to {v.unit.one.toLowerCase()} {nextUnit(state)}
          </span>
        )}
      </div>
      <div className="headerActions">
        {run.seededRun && (
          // Handing this run a physical die would break the one promise a
          // shared seed makes, so the choice is not offered.
          <span className="chip" title="A shared run rolls its own dice, or it would not be shared">
            rolling from the seed
          </span>
        )}
        <button className="ghost" onClick={run.undo} disabled={!run.canUndo || run.readOnly}>
          Undo
        </button>
        <button className="ghost" onClick={onSettings} title="Sounds, dice, rolls, and pop-outs for a stream">
          Settings
        </button>
        {/* Apart from Undo, and in the tone the profile uses for deletion: it ends the run. */}
        <button
          className="ghost danger"
          title={`End this ${v.run.one.toLowerCase()} and delete its log`}
          onClick={() => {
            const named = state.name ? `${state.name}` : `this ${v.run.one.toLowerCase()}`;
            if (confirm(`Discard ${named}? Its log is deleted.`)) run.discard();
          }}
        >
          Discard
        </button>
      </div>
    </section>
  );
}

function StartFirstUnit({ pack, onEnter }: { pack: Pack; onEnter: () => void }) {
  const v = pack.vocabulary;
  return (
    <section className="panel runStep">
      <h3 className="sectionTitle">Ready</h3>
      <p>
        Entering the first {v.unit.one.toLowerCase()} begins the {v.run.one.toLowerCase()}.
      </p>
      <button className="primary big" onClick={onEnter}>
        Enter {v.unit.one} 1
      </button>
    </section>
  );
}

function StepPanel({
  pack,
  run,
  state,
  active,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
  active: ActiveStep;
}) {
  const { phase, step, index } = active;
  const v = pack.vocabulary;
  const [declared, setDeclared] = useState("");

  const key = `${phase.id}#${index}`;
  // What is ticked on this step, read back from the log rather than held
  // here: a reload lands on the same boxes, and a box can count.
  const ticked = useMemo(
    () => new Set(state.checks.filter((k) => k.startsWith(`${key}|`)).map((k) => k.slice(key.length + 1))),
    [state.checks, key],
  );
  const tick = (keys: string[], on: boolean, tally?: string) => run.check(key, keys, on, tally);

  switch (step.kind) {
    case "rollTable": {
      const table = pack.tables[step.table];
      const owed = state.extraRolls[step.table] ?? 0;
      return (
        <section className="panel runStep" key={key}>
          <StepHead phase={phase} label={step.label ?? table?.title ?? step.table} />
          <p className="muted">{table?.description}</p>
          {owed > 0 && (
            <p className="notice">
              This {pack.vocabulary.unit.one.toLowerCase()} rolls {table?.title ?? step.table} {owed + 1} times: {owed === 1 ? "one more is owed" : `${owed} more are owed`} after this one.
            </p>
          )}
          <button
            className="primary big"
            onClick={() =>
              run.begin({
                kind: "table",
                tableId: step.table,
                keyPrefix: `u${state.unit}:${key}`,
                label: table?.title ?? step.table,
                completes: { phase, index },
              })
            }
          >
            {table?.title ?? "Roll"}
          </button>
        </section>
      );
    }

    case "declareSubject": {
      const constraint = constraintFor(pack, state, step.constrainedBy);
      return (
        <section className="panel runStep" key={key}>
          <StepHead phase={phase} label={step.label ?? `Declare the ${v.subject.one}`} />
          {constraint && (
            <p className="notice">
              The game has already had its say: <strong>{constraint}</strong>
            </p>
          )}
          {state.bannedTypes.length > 0 && (
            <p className="muted small">
              No longer allowed: {state.bannedTypes.join(", ")}
            </p>
          )}
          <div className="padRow">
            <input
              className="textInput"
              autoFocus
              placeholder={`What is this ${v.subject.one.toLowerCase()}?`}
              value={declared}
              onChange={(e) => setDeclared(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && declared && run.declareSubject(phase, index, declared)
              }
            />
            <button
              className="primary"
              disabled={!declared}
              onClick={() => run.declareSubject(phase, index, declared)}
            >
              Declare
            </button>
          </div>
        </section>
      );
    }

    case "manual": {
      const list = step.checklist ?? [];
      const allTicked = checklistDone(list, pack, state, ticked);
      return (
        <section className="panel runStep" key={key}>
          <StepHead phase={phase} label={step.label} />
          {step.description && <p className="muted">{step.description}</p>}
          <p className="muted small">
            {liveClocks(state).length > 0
              ? "The app keeps the clock. The work itself it cannot see; it only records that you did it."
              : "This is the part the app cannot see. It only records that you did it."}
          </p>
          {list.length > 0 && <Checklist items={list} pack={pack} state={state} ticked={ticked} onToggle={tick} />}
          {/*
            Never dim. A dimmed Done beside an unticked list read as broken;
            the button says what it is waiting for and points at the box.
          */}
          <button
            className="primary big"
            onClick={(e) => (allTicked ? run.completeStep(phase, index) : nudgeFirstUnticked(e.currentTarget))}
          >
            {allTicked ? "Done" : "Tick what you honored"}
          </button>
        </section>
      );
    }

    case "actions":
      return (
        <section className="panel runStep" key={key}>
          <StepHead phase={phase} label={phase.label} />
          <button
            className="primary big"
            onClick={() =>
              run.begin({
                kind: "actions",
                actions: step.do,
                keyPrefix: `u${state.unit}:${key}`,
                label: phase.label,
                completes: { phase, index },
              })
            }
          >
            Continue
          </button>
        </section>
      );

    case "finalizeUnit": {
      const blocked = run.blockingObligations;
      const confirmations = step.confirm ?? [];
      const allTicked = checklistDone(confirmations, pack, state, ticked);
      return (
        <section className="panel runStep finalize" key={key}>
          <StepHead phase={phase} label={step.label ?? v.finalize} />
          {blocked.length > 0 && (
            <p className="notice">
              {blocked.length} thing{blocked.length === 1 ? "" : "s"} still owed. Settle{" "}
              {blocked.length === 1 ? "it" : "them"} before closing this{" "}
              {v.unit.one.toLowerCase()}.
            </p>
          )}
          {confirmations.length > 0 && (
            <>
              <p className="muted small">
                The app cannot tell whether you honored these. It can only make you look.
              </p>
              <Checklist items={confirmations} pack={pack} state={state} ticked={ticked} onToggle={tick} />
            </>
          )}
          <button
            className="primary big"
            disabled={blocked.length > 0}
            onClick={(e) => (allTicked ? run.finalizeUnit(phase, index) : nudgeFirstUnticked(e.currentTarget))}
          >
            {blocked.length > 0 ? "Settle what is owed first" : allTicked ? v.finalize : "Tick what you honored"}
          </button>
        </section>
      );
    }
  }
}

/** The first box in this step still unticked, brought into view and given focus. */
function nudgeFirstUnticked(from: HTMLElement): void {
  const box = from.closest(".runStep")?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:checked)');
  if (!box) return;
  box.scrollIntoView({ block: "nearest" });
  box.focus();
}

/**
 * "1 Piece" rather than "1 Pieces".
 *
 * The singular and plural both come from the pack, because no rule about
 * English suffixes would survive a pack written in another language.
 */
function countMade(pack: Pack, state: RunState): string {
  const n = state.subjects.filter((s) => !s.removed).length;
  const noun = n === 1 ? pack.vocabulary.subject.one : pack.vocabulary.subject.many;
  return `${n} ${noun.toLowerCase()}`;
}

function StepHead({ phase, label }: { phase: { label: string }; label: string }) {
  return (
    <>
      <h3 className="sectionTitle">{phase.label}</h3>
      <h4 className="stepLabel">{label}</h4>
    </>
  );
}

/** The most recent class-style result, shown when declaring. */
function constraintFor(pack: Pack, state: RunState, tableId?: string): string | null {
  if (!tableId) return null;
  const hit = [...state.outcomes].reverse().find((o) => o.unit === state.unit && o.table === tableId);
  if (!hit) return null;
  const entry = pack.tables[tableId]?.entries.find((e) => e.id === hit.entryId);
  return entry?.title ?? entry?.text ?? null;
}

function BetweenUnits({
  pack,
  run,
  state,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
}) {
  const v = pack.vocabulary;
  const [note, setNote] = useState(state.journal[state.unit] ?? "");
  const [ending, setEnding] = useState<string | null>(null);

  return (
    <section className="panel runStep">
      <h3 className="sectionTitle">
        {v.unit.one} {state.unit} closed
      </h3>

      {pack.journal?.enabled && (
        <>
          <p className="askLabel">{pack.journal.prompt ?? "Anything worth remembering?"}</p>
          <div className="padRow">
            <input
              className="textInput"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note && run.writeJournal(state.unit, note)}
            />
            <button
              className="ghost"
              disabled={!note}
              onClick={() => run.writeJournal(state.unit, note)}
            >
              Save
            </button>
          </div>
        </>
      )}

      {/* The onward move and its alternative sit together, so the hint reads
          as a caption to the choice rather than a stray note at the margin. */}
      <div className="primaryAction">
        <button className="primary big" onClick={run.enterUnit}>
          Enter {v.unit.one} {state.unit + 1}
        </button>
        <span className="muted small">
          {state.unit >= pack.unit.min
            ? `${countMade(pack, state)} made so far`
            : `at least ${pack.unit.min} needed before you can stop`}
        </span>
      </div>

      {!run.canEnd.ok && <p className="muted small">Cannot end yet: {run.canEnd.reason}.</p>}

      {run.canEnd.ok && (
        <div className="orEnd">
          <h3 className="sectionTitle">Or end here</h3>
          <div className="choices">
            {(pack.endings ?? [{ id: "done", label: "End", text: "" }]).map((e) => (
              <button
                key={e.id}
                className={`choice ${ending === e.id ? "on" : ""}`}
                onClick={() => setEnding(e.id)}
              >
                <strong>{e.label}</strong>
                <span className="muted small">{e.text}</span>
              </button>
            ))}
          </div>
          {ending && (
            <button className="primary" onClick={() => run.endRun(ending)}>
              End the {v.run.one.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Ended({ pack, state }: { pack: Pack; state: RunState }) {
  const ending = pack.endings?.find((e) => e.id === state.ending);
  const v = pack.vocabulary;
  return (
    <section className="panel runStep">
      <h3 className="sectionTitle">{v.run.one} over</h3>
      <h4 className="stepLabel">{ending?.label ?? state.ending}</h4>
      <p>{ending?.text}</p>
      <p className="muted small">
        {state.unit} {v.unit.many.toLowerCase()} ·{" "}
        {state.subjects.filter((s) => !s.removed).length} {v.subject.many.toLowerCase()} surviving
      </p>
    </section>
  );
}

function Obligations({ pack, run }: { pack: Pack; run: ReturnType<typeof useRun> }) {
  return (
    <section className="panel owed">
      <h3 className="sectionTitle">Owed</h3>
      <p className="muted small">
        Results that reach forward in time. These are the ones that get forgotten on paper.
      </p>
      {run.due.map((o) => (
        <div key={o.id} className="row owedRow">
          <div>
            <strong>{o.text}</strong>
            <span className="muted small"> · due {o.on}</span>
          </div>
          <button className="primary" onClick={() => run.resolveObligation(o.id, o.text)}>
            Resolve
          </button>
        </div>
      ))}
      {run.notes.map((o) => (
        <div key={o.id} className="row owedRow">
          <div>
            <strong>{o.text}</strong>
            {o.persistent && <span className="chip warn"> standing</span>}
          </div>
          <button className="ghost" onClick={() => run.resolveObligation(o.id, o.text)}>
            Done
          </button>
        </div>
      ))}
    </section>
  );
}

/**
 * Thresholds the game has crossed.
 *
 * Presented separately from the player's own moves, and above them: this is
 * the game acting, not an option being offered.
 */
function Thresholds({ run }: { run: ReturnType<typeof useRun> }) {
  return (
    <section className="panel threshold">
      <h3 className="sectionTitle">The game has your number</h3>
      {run.globals.map((g) => (
        <div key={g.key} className="row spread owedRow">
          <div>
            <strong>{g.label}</strong>
            <span className="muted small"> · {g.on === "onRunEnd" ? "the reckoning" : "this turn"}</span>
          </div>
          <button className="primary" onClick={() => run.fireGlobal(g)}>
            Resolve
          </button>
        </div>
      ))}
      {run.thresholds.map((t) => (
        <div key={t.key} className="row spread owedRow">
          <div>
            <strong>{t.label}</strong>
            <span className="muted small"> · reached {t.value}</span>
          </div>
          <button className="primary" onClick={() => run.fireThreshold(t)}>
            Resolve
          </button>
        </div>
      ))}
    </section>
  );
}

/**
 * Moves the player may choose to take.
 *
 * Everything they initiate rather than have done to them: spending a one-shot
 * card, re-entering an earlier unit to repair it, stopping.
 */
/**
 * The moderator's panel, as a grid: a row per drawn result that can be won
 * this unit, a column per contestant, a cell to press. Under "first" a row
 * holds one winner and pressing another cell moves it, the old award taken
 * back as a correction; under "everyone" each cell is its own award, the
 * first in a row worth the bonus. Watchers see the grid and press nothing.
 */
function Winners({ run, state }: { run: ReturnType<typeof useRun>; state: RunState }) {
  const editable = !run.readOnly;
  const rule = run.moderated;
  const everyone = rule?.award === "everyone";
  return (
    <section className="panel winners">
      <h3 className="sectionTitle">
        Winners <span className="muted">{everyone ? "everyone who finishes scores" : "first to finish scores"}</span>
      </h3>
      <div className="docTableWrap">
        <table className="matrix">
          <thead>
            <tr>
              <th className="rowHead">Mechanic</th>
              {state.contestants.map((c) => (
                <th key={c.id}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.challenges.map((ch) => (
              <tr key={ch.outcome}>
                <th className="rowHead">
                  {ch.details.length > 0 ? (
                    <>
                      <span>{ch.details.join(" · ")}</span>
                      <span className="muted small">{ch.text}</span>
                    </>
                  ) : (
                    <span>{ch.text}</span>
                  )}
                  <span className="muted small">
                    {ch.tableTitle} · {ch.points} pt{ch.points === 1 ? "" : "s"}
                  </span>
                </th>
                {state.contestants.map((c) => {
                  const mine = ch.awards.find((a) => a.contestant === c.id);
                  const first = ch.awards[0]?.contestant === c.id;
                  const canTake = editable && !mine && (everyone ? ch.open : true);
                  const press = () => {
                    if (!editable) return;
                    if (mine) {
                      run.revokeAward(c.id, ch.outcome);
                      return;
                    }
                    if (!everyone && ch.awards.length > 0) run.reassignAward(ch.outcome, c.id);
                    else if (canTake) run.award(c.id, ch.outcome);
                  };
                  return (
                    <td key={c.id}>
                      <button
                        className={`cell ${mine ? "won" : ""}`}
                        disabled={!editable || (!mine && !canTake)}
                        aria-pressed={Boolean(mine)}
                        title={mine ? `${c.name} +${mine.points} — press to take it back` : `${c.name} finished it`}
                        onClick={press}
                      >
                        {mine ? `+${mine.points}${first && ch.awards.length > 1 ? " ★" : ""}` : "·"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {everyone && rule?.firstBonus ? <p className="muted small">★ first to finish, +{rule.firstBonus}.</p> : null}
    </section>
  );
}

/** Standings, most points first. The moderator can add a late arrival or drop someone. */
function Scoreboard({ run, state, pack }: { run: ReturnType<typeof useRun>; state: RunState; pack: Pack }) {
  const editable = !run.readOnly;
  const [name, setName] = useState("");
  const add = () => {
    run.addContestant(name);
    setName("");
  };
  /** The marks a contestant can be given: contestant-scoped states they do not carry. */
  const marks = (held: string[]) => Object.entries(pack.states ?? {}).filter(([id, def]) => def.scope === "contestant" && !held.includes(id));
  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Scoreboard <span className="muted">{state.contestants.length} racing</span>
      </h3>
      {run.standings.length === 0 && <p className="muted small">Nobody on the roster yet.</p>}
      {run.standings.map((s) => (
        <div key={s.contestant.id} className="row spread">
          <span className="contestant">
            <span className="idx">#{s.place}</span> {s.contestant.name}
            {s.contestant.states.map((id) => (
              <span key={id} className="chip state" title={pack.states?.[id]?.description}>
                {pack.states?.[id]?.short ?? pack.states?.[id]?.label ?? id}
                {editable && (
                  <button className="chipX" title="Unmark" onClick={() => run.markContestant(s.contestant.id, id, false)}>
                    ×
                  </button>
                )}
              </span>
            ))}
            {editable && marks(s.contestant.states).length > 0 && (
              <select className="chipAdd" value="" aria-label={`Mark ${s.contestant.name}`} onChange={(e) => e.target.value && run.markContestant(s.contestant.id, e.target.value, true)}>
                <option value="">mark…</option>
                {marks(s.contestant.states).map(([id, def]) => (
                  <option key={id} value={id}>
                    {def.label}
                  </option>
                ))}
              </select>
            )}
          </span>
          <span className="nudge">
            <span className="muted num">{s.points}</span>
            {editable && (
              <button className="ghost tiny" title="Take them off the roster" onClick={() => run.removeContestant(s.contestant.id)}>
                ×
              </button>
            )}
          </span>
        </div>
      ))}
      {editable && (
        <div className="padRow">
          <input className="textInput" value={name} placeholder="add a contestant" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="ghost tiny" onClick={add} disabled={!name.trim()}>
            Add
          </button>
        </div>
      )}
    </section>
  );
}

function Moves({ run, pack }: { run: ReturnType<typeof useRun>; pack: Pack }) {
  const owed = run.blockingObligations.length;
  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Your move <span className="muted">optional</span>
      </h3>
      <div className="choices">
        {run.moves.map(({ id, move }) => (
          <button
            key={id}
            className="choice"
            disabled={Boolean(move.finalizes) && owed > 0}
            title={move.finalizes && owed > 0 ? "Settle what is owed first; this move closes the unit." : undefined}
            onClick={() => run.takeMove(id, move.label)}
          >
            <strong>{move.label}</strong>
            <span className="muted small">{move.description}</span>
            {move.finalizes && <span className="muted small">Closes the {pack.vocabulary.unit.one.toLowerCase()}.</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Who is holding what, this unit.
 *
 * Co-op here is the same-room kind, so nobody is named — people are numbered
 * round the table and the roles walk with them. Shown as a panel rather than a
 * line of text because whoever has just been handed the device needs to find
 * it at a glance.
 */
function Roles({
  pack,
  run,
  state,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
}) {
  const v = pack.vocabulary;
  return (
    <section className="panel">
      <h3 className="sectionTitle">
        At the table <span className="muted">{state.players} players</span>
      </h3>
      <div className="roleList">
        {run.roles.map((r) => (
          <div key={r.id} className="row spread roleRow">
            <div>
              <strong>{r.label}</strong>
              {r.description && <span className="muted small"> · {r.description}</span>}
            </div>
            <span className="chip ok">Player {r.player}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Board({
  pack,
  state,
  onRename,
  onCorrect,
}: {
  pack: Pack;
  state: RunState;
  onRename: (subject: number, name: string) => void;
  /** Put a state on a subject or take one off, by hand. Absent for a watcher. */
  onCorrect?: (subject: number, state: string, on: boolean) => void;
}) {
  /** The subject-scoped states a subject does not carry, for the correction menu. */
  const missing = (held: string[]) =>
    Object.entries(pack.states ?? {}).filter(([id, def]) => def.scope === "subject" && !held.includes(id));
  const v = pack.vocabulary;
  const [copied, setCopied] = useState<number | null>(null);
  /**
   * Which subject is being renamed, and what it says so far.
   *
   * An edit in progress is deliberately not committed anywhere until it is
   * saved: a name half-typed is not a correction, and the log should not fill
   * up with keystrokes.
   */
  const [editing, setEditing] = useState<{ id: number; draft: string } | null>(null);
  const stopEditing = () => setEditing(null);

  const save = () => {
    if (!editing) return;
    const name = editing.draft.trim();
    const subject = state.subjects.find((s) => s.id === editing.id);
    // An empty box or an unchanged name is not a rename; treat both as backing
    // out, so nothing lands in the log that a reader would have to explain.
    if (name && name !== subject?.type) onRename(editing.id, name);
    stopEditing();
  };

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        {v.subject.many} <span className="muted">the board</span>
      </h3>
      {state.subjects.length === 0 && <p className="muted small">Nothing made yet.</p>}
      {state.subjects.map((s) => (
        <div key={s.id} className={`row subjectRow ${s.removed ? "gone" : ""}`}>
          <span className="idx">#{s.id}</span>
          <div className="subjectMain">
            {editing?.id === s.id ? (
              <input
                className="renameInput"
                autoFocus
                value={editing.draft}
                aria-label={`Rename ${v.subject.one} ${s.id}`}
                onChange={(e) => setEditing({ id: s.id, draft: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") stopEditing();
                }}
                onBlur={(e) => {
                  // Clicking Save moves focus inside this row, and that must
                  // not be read as clicking away — otherwise the edit is
                  // discarded a moment before the button it landed on fires.
                  if (!e.currentTarget.closest(".subjectRow")?.contains(e.relatedTarget)) {
                    stopEditing();
                  }
                }}
              />
            ) : s.type && !s.removed ? (
              <button
                className="renameTrigger"
                title="Click to rename"
                onClick={() => setEditing({ id: s.id, draft: s.type ?? "" })}
              >
                {s.type}
              </button>
            ) : (
              <strong>{s.type ?? "undeclared"}</strong>
            )}
            {/*
              What the player wrote when this subject's unit closed. The
              journal is kept by unit and a subject is made in one, so the
              note belongs here: without it the answer to "what did you
              make?" was saved and then shown nowhere.
            */}
            {state.journal[s.unit] && <p className="subjectNote">{state.journal[s.unit]}</p>}
            <div className="entryTags">
              {!s.finalized && <span className="chip">open</span>}
              {s.removed && <span className="chip warn">removed</span>}
              {(() => {
                const c = clockOfUnit(state, s.unit);
                return c && c.elapsedMs !== null ? (
                  <span className="chip time" title={c.expired ? "The timer ran out" : "The clock's time"}>
                    {formatClock(c.elapsedMs)}
                    {c.expired ? " ⏰" : ""}
                  </span>
                ) : null;
              })()}
              {s.states.map((id) => (
                <span key={id} className="chip state" title={pack.states?.[id]?.description}>
                  {pack.states?.[id]?.label ?? id}
                  {onCorrect && !s.removed && (
                    <button className="chipX" title="Take this state off — a correction, written to the log" onClick={() => onCorrect(s.id, id, false)}>
                      ×
                    </button>
                  )}
                </span>
              ))}
              {onCorrect && !s.removed && missing(s.states).length > 0 && (
                <select
                  className="chipAdd"
                  value=""
                  aria-label={`Mark ${v.subject.one} ${s.id}`}
                  title="Put a state on it by hand — a correction, written to the log"
                  onChange={(e) => e.target.value && onCorrect(s.id, e.target.value, true)}
                >
                  <option value="">mark…</option>
                  {missing(s.states).map(([id, def]) => (
                    <option key={id} value={id}>
                      {def.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <button
            className="ghost tiny"
            title={
              editing?.id === s.id
                ? "Save the new name"
                : "Copy the name with its states, to paste onto the thing itself"
            }
            onClick={() => {
              if (editing?.id === s.id) {
                save();
                return;
              }
              void navigator.clipboard?.writeText(subjectLabel(pack, s));
              setCopied(s.id);
              setTimeout(() => setCopied(null), 1200);
            }}
          >
            {editing?.id === s.id ? "save" : copied === s.id ? "copied" : "name"}
          </button>
        </div>
      ))}
      {state.runStates.length > 0 && (
        <div className="row">
          <span className="muted small">Run-wide:</span>
          {state.runStates.map((id) => (
            <span key={id} className="chip state">
              {pack.states?.[id]?.label ?? id}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Trackers({ pack, state, onNudge }: { pack: Pack; state: RunState; onNudge?: (counter: string, by: number) => void }) {
  const resources = Object.entries(pack.resources ?? {});
  const counters = Object.entries(pack.counters ?? {}).filter(([, c]) => !c.hidden);
  const cards = state.hand;
  if (resources.length + counters.length + cards.length === 0) return null;

  return (
    <section className="panel">
      <h3 className="sectionTitle">Trackers</h3>
      {resources.map(([id, def]) => {
        const value = state.resources[id] ?? def.initial;
        const max = def.max ?? Math.max(value, 10);
        return (
          <div key={id} className="tracker">
            <div className="trackerHead">
              <strong>{def.label}</strong>
              <span className="muted">
                {value}
                {def.max !== undefined && ` / ${def.max}`}
              </span>
            </div>
            {def.display === "boxes" ? (
              <div className="boxes">
                {Array.from({ length: max }, (_, i) => (
                  <span key={i} className={`box ${i < value ? "on" : ""}`} />
                ))}
              </div>
            ) : def.display === "bar" ? (
              <div className="bar">
                <span style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
              </div>
            ) : null}
          </div>
        );
      })}
      {counters.map(([id, def]) => (
        <div key={id} className="row spread">
          <strong>{def.label}</strong>
          <span className="nudge">
            {onNudge && (
              <button className="ghost tiny" title="One fewer — a correction, written to the log" onClick={() => onNudge(id, -1)}>
                −
              </button>
            )}
            <span className="muted num">{state.counters[id] ?? def.initial}</span>
            {onNudge && (
              <button className="ghost tiny" title="One more — a correction, written to the log" onClick={() => onNudge(id, 1)}>
                +
              </button>
            )}
          </span>
        </div>
      ))}
      {cards.length > 0 && (
        <>
          <h3 className="sectionTitle">Hand</h3>
          {cards.map((c, i) => {
            const deck = pack.decks?.[c.deck];
            const card = deck?.kind === "cards" ? deck.cards.find((x) => x.id === c.cardId) : null;
            return (
              <div key={i} className="row stack">
                <strong>{card?.title ?? c.cardId}</strong>
                <span className="muted small">{card?.text}</span>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

function Flow({
  pack,
  run,
  state,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
}) {
  // On a phone the list folds to one line, opened by a tap; see flowStrip.
  const [open, setOpen] = useState(false);
  const strip = flowStrip(run.activePhases, run.activeStep, (p) => phaseSkipped(pack, state, p));
  return (
    <section className={`stageFlow${open ? " open" : ""}`}>
      {strip && (
        <button type="button" className="flowNow" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="idx">
            {strip.index} of {strip.total}
          </span>
          <strong>{strip.label}</strong>
          {strip.next && <span className="muted">then {strip.next}</span>}
        </button>
      )}
      <h3 className="sectionTitle">
        This {pack.vocabulary.unit.one.toLowerCase()}
      </h3>
      <ol className="flow">
        {run.activePhases.map((phase, i) => {
          const done = state.phasesDone.includes(phase.id);
          const current = run.activeStep?.phase.id === phase.id;
          // Out of play this unit: grayed, with the reason under the name,
          // so a phase that only happens in the first room reads as skipped
          // for a reason rather than as broken. A dash on its own was read
          // as broken.
          const skipped = !done && !current && phaseSkipped(pack, state, phase);
          const why = skipped ? describeSkipReason(pack, phase) : null;
          return (
            <li
              key={phase.id}
              className={done ? "done" : current ? "current" : skipped ? "skipped" : ""}
              aria-current={current ? "step" : undefined}
              title={skipped ? (describeSkip(pack, phase) ?? undefined) : undefined}
            >
              <span className="idx">{current ? "▸" : skipped ? "–" : i + 1}</span>
              <span>
                {phase.label}
                {why && <span className="why">{why}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Timeline({ pack, state }: { pack: Pack; state: RunState }) {
  const total = state.outcomes.length;
  // Always on the page, empty or not: the column under the step used to end
  // at the card until the first roll, and the screen read as unfinished.
  if (total === 0) {
    return (
      <section className="log">
        <h3 className="sectionTitle">The log</h3>
        <p className="empty">Nothing yet. What the dice do lands here.</p>
      </section>
    );
  }
  return (
    <section className="log">
      <h3 className="sectionTitle">The log</h3>
      <ol className="timeline">
        {/* Newest first, numbered from the start: a long run is read from the
            top, but the numbers still say how far in each line was. */}
        {[...state.outcomes].reverse().map((o, i) => {
          const table = pack.tables[o.table];
          const entry = table?.entries.find((e) => e.id === o.entryId);
          const hit = o.targetSubject !== null;
          return (
            <li key={i} className={hit ? "heat" : ""}>
              <span className="idx">{total - i}</span>
              <div>
                <span className="where">
                  {pack.vocabulary.unit.one} {o.unit}, {table?.title ?? o.table}
                  {hit && ` — hit #${o.targetSubject}`}
                </span>
                <p>{entry?.title ?? entry?.text ?? o.entryId}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * A seed someone can read down the phone to a friend.
 *
 * Two words and a number, because the seed has to survive being spoken aloud
 * and typed in by somebody else — which a hex string does not.
 */
function coinSeed(): string {
  const first = ["long", "cold", "slow", "half", "deep", "low", "dry", "loud"];
  const second = ["kiln", "tape", "room", "hymn", "drum", "wire", "salt", "moth"];
  const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)]!;
  return `${pick(first)}-${pick(second)}-${Math.floor(Math.random() * 90) + 10}`;
}

/**
 * The run's own name, in the bar. Click to change it; empty clears it. A run
 * without one is offered the chance rather than shown a blank.
 */
function RunName({
  name,
  noun,
  onRename,
}: {
  name: string | null;
  noun: string;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    const done = () => {
      if (draft.trim() !== (name ?? "")) onRename(draft.trim());
      setDraft(null);
    };
    return (
      <input
        className="runNameInput"
        autoFocus
        value={draft}
        placeholder={`Name this ${noun}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") done();
          if (e.key === "Escape") setDraft(null);
        }}
      />
    );
  }
  return (
    <button
      className={`renameTrigger runName ${name ? "" : "unnamed"}`}
      title={name ? "Click to rename" : `Give this ${noun} a name`}
      onClick={() => setDraft(name ?? "")}
    >
      {name ?? `Name this ${noun}…`}
    </button>
  );
}
