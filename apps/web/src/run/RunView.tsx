import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { an } from "@runlog/rules-schema";
import { ClockPanel } from "./ClockPanel.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { ControlPanel, openControlsWindow, RemoteControls } from "./ControlPanel.tsx";
import { useAlerts, useAlertSettings } from "../alerts/useAlerts.ts";
import { useAccount } from "../auth/Account.tsx";
import {
  clockOfUnit,
  compareScores,
  formatClock,
  formatScore,
  handsFree as handsFreeIn,
  liveClocks,
  nextUnit,
  scoreOf,
  unitPhases,
} from "@runlog/engine";
import type { Pack, Setup } from "@runlog/rules-schema";
import {
  checklistOf,
  closesUnit,
  constrainedByOf,
  constraintLines,
  constraintsFor,
  describeSkip,
  describeSkipReason,
  entryWords,
  phaseSkipped,
  resultText,
  subjectLabel,
  subjectName,
  subjectSuggestions,
  type PhaseResult,
  type RunEvent,
  type RunState,
} from "@runlog/engine";
import { useDocDrawer } from "../docs/DocDrawer.tsx";
import { useRun, type ActiveStep } from "./useRun.ts";
import type { RunStore } from "./store.ts";
import { runTitle, useTitle } from "../title.ts";
import { RequestPanel } from "./RequestPanel.tsx";
import { Checklist, checklistDone, ticksToFinish } from "./Checklist.tsx";
import { evidenceFor, pointOf } from "./evidence.ts";
import { Receipt, type RollReceipt } from "./Receipt.tsx";
import { closesTheUnit, startsItself } from "./handsFree.ts";
import { type RolledDie } from "../rolling.ts";
import { useSync } from "../sync/SyncProvider.tsx";
import { syncBus } from "../sync/bus.ts";
import { DiceCurtain, rolledOf, type RolledGesture } from "../dice/DiceCurtain.tsx";
import { preloadDice3d } from "../dice/settings.ts";
import { CARRY_ON_HOLD_MS, carriesOnByItself } from "./pace.ts";
import { flowStrip } from "./flowStrip.ts";
import { LOG_LIMITS, logLimit, logLines, logOrder, setLogLimit, setLogOrder, type LogOrder } from "./logView.ts";
import { hitLabel, hitsOn } from "./hits.ts";
import { ticksFor } from "./stepChecks.ts";
import { nudgeFirstUnticked, nudgeOwed } from "./nudge.ts";
import { Constraints } from "./Constraints.tsx";
import { receiptFollowUps } from "./receiptFollowUps.ts";
import { globalWords, owedOn, settleWords, settlingFor, stillOwed, thresholdWords } from "./owed.ts";
import { ExportPanel } from "./ExportPanel.tsx";
import { EnvironmentPanel } from "../environment/EnvironmentPanel.tsx";
import { Members } from "./Members.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { Asks } from "./Asks.tsx";
import { onDay } from "./RunRow.tsx";
import { bestOf, placeOf, scoresOf, type ScoredRun } from "./scores.ts";
import { RacePanel } from "./RacePanel.tsx";
import { useApi } from "../sync/useApi.ts";
import { useReachable } from "./useReachable.ts";
import { useAttachedDeckSubs, useAttachedDecks, useAttachedTools, toolFor, type AttachedTool } from "./useAttachedTools.ts";
import { ulid } from "../storage/ids.ts";
import { clearPendingRaceCode } from "../share/IncomingRace.tsx";
import { PlanError } from "../sync/client.ts";
import { liveLinkOf } from "../live/route.ts";
import { entryTextOf, paperOf, raceOf, snapshotOf } from "../live/snapshot.ts";
import { offerOf, type OfferInput } from "./offer.ts";
import { takePress, type Verdict } from "./takePress.ts";
import { seatingOf } from "./seats.ts";
import { isEmpty, tidy, type ControlProfile } from "../control/profile.ts";
import { chose, chosenFrom, forTool, setupsHere, withChosen, type ChosenSetup } from "../control/setups.ts";
import { builtins } from "../control/builtin.ts";
import { StartScreen } from "./StartScreen.tsx";
import { lifecycleGestures, marksOf, type LifecycleMarks } from "./gestures.ts";
import { handoutLine, handoutOf } from "./handout.ts";
import { useRace } from "./useRace.ts";
import { RunRail, type Pane } from "./RunRail.tsx";
import { useEnterMoves } from "../ui/useEnterMoves.ts";
import { useConfirm } from "../ui/useConfirm.tsx";
import { useToast } from "../ui/Toast.tsx";
import { accountOf, nameOf } from "./names.ts";

/**
 * The active step's own heading, the same word the page shows above it.
 *
 * Each step kind picks its own fallback where the pack left the label
 * blank -- a table's title, the phase's own label, the finalize verb --
 * and this is the one place that mirrors all of them, for the offer that
 * rides beside the snapshot.
 */
function activeStepLabel(pack: Pack, active: ActiveStep | null): string | null {
  if (!active) return null;
  const { phase, step } = active;
  switch (step.kind) {
    case "rollTable":
      return step.label ?? pack.tables[step.table]?.title ?? step.table;
    case "declareSubject":
      return step.label ?? `Declare the ${pack.vocabulary.subject.one}`;
    case "actions":
      return phase.label;
    case "manual":
      return step.closesUnit ? (step.label ?? pack.vocabulary.finalize) : step.label;
    case "finalizeUnit":
      return step.label ?? pack.vocabulary.finalize;
  }
}

/**
 * One press for a whole list: every box the step waits on, then the button
 * the card's own finish sits on.
 *
 * The same rules as a click, read from the same place: `ticksToFinish`
 * says which keys, `check` writes them, and `closesUnit` picks which of
 * the two finish functions the card would have called.
 *
 * Whether the list is done is decided over the boxes this is about to
 * write rather than over the log, because `commit` has not re-rendered
 * this effect yet and reading the state back here would read the state
 * before the ticks. A box a deck cannot reach -- a row the game still owes
 * -- leaves the list short, and then nothing is written at all: the press
 * says so and the page finishes the step.
 */
function tickEverythingAndFinish(pack: Pack, run: ReturnType<typeof useRun>, active: ActiveStep) {
  const state = run.state;
  if (!state) return;
  const { phase, step, index } = active;
  const key = `${phase.id}#${index}`;
  const list = checklistOf(step);
  const ticked = ticksFor(state, key);
  // A closing card settles some of its rows by the game rather than by
  // the player, and its own boxes know it; the deck's press is held to
  // the same reading of the list the card in front of them shows.
  const settling = closesUnit(step)
    ? settlingFor(pack, state, step.kind === "manual" ? constraintLines(pack, state, step.constrainedBy) : [], list)
    : undefined;
  const groups = ticksToFinish(list, pack, state, ticked, settling);
  const predicted = new Set([...ticked, ...groups.flatMap((g) => g.items)]);
  if (!checklistDone(list, pack, state, predicted, settling)) throw new Error("Something on the list needs the page.");
  for (const group of groups) run.check(key, group.items, true, group.tally);
  if (closesUnit(step)) run.closeAndEnter(phase, index);
  else run.completeStep(phase, index);
}

/**
 * What a step's own finish button says once every box on it is ticked.
 *
 * The closing card goes on to the next unit, the manual card is simply
 * done. One place, because a deck is offered these words and then presses
 * the button they are on: if they drifted apart the key would promise one
 * thing and do another.
 */
function finishWords(pack: Pack, step: ActiveStep["step"]): string {
  return closesUnit(step) ? `Next ${pack.vocabulary.unit.one.toLowerCase()}` : "Done";
}

/**
 * A list of names read as one phrase: one alone, two joined by "and",
 * more with commas and "and" before the last. What the deck toast reads
 * when more than one account's deck arrives in the same beat.
 */
function joinWords(words: string[]): string {
  if (words.length <= 2) return words.join(" and ");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Whether a move may not be pressed: it closes the unit, and something is
 * still owed. The one rule behind `Moves`' own disabled button and the
 * offer a deck reads, so a deck can never press what the page would not.
 */
export function heldMove(move: { finalizes?: boolean }, owed: number): boolean {
  return Boolean(move.finalizes) && owed > 0;
}

/**
 * How long an accepted verdict waits for this device's log to grow before
 * it is sent with whatever the run reads at anyway.
 */
const HELD_VERDICT_MS = 1500;

/**
 * The same wait, for a press whose whole effect was to start the dice.
 *
 * Nothing is appended until they land and the total has been read, which
 * is the tray's flight and a beat after it -- longer than the wait above,
 * so the ordinary one would report "done" over dice still in the air.
 */
const DICE_VERDICT_MS = 6000;

/**
 * Whether a move is asked of each racer rather than of the table: the pack
 * marks it `per: contestant` and there is a roster to ask. The one rule
 * behind `Moves`' split into a button per name, read by the offer as well,
 * because a press with no name on it would record against the table what
 * the page can only record against somebody.
 */
export function perRacer(move: { per?: string }, racing: { length: number }): boolean {
  return move.per === "contestant" && racing.length > 0;
}

/**
 * Whether a setup would survive the wire as a command.
 *
 * A command's operations travel in the gesture rather than being built
 * from the run, so the server reads them the way it reads anything that
 * arrives from outside: one field past its bound makes the whole frame
 * nothing. It drops that frame with a bare 200, which this page cannot
 * tell from a command delivered, so a file the server would refuse is
 * kept off the offer instead. A key that cannot work is better missing
 * than pressed to no effect.
 *
 * The bounds are the server's own, not this format's, and they are the
 * tighter of the two: a setup may run to 200 operations and a 120
 * character title where a command may not. `args` is not checked, because
 * anything parsed as a setup has it as an object already.
 */
export function fitsTheWire(setup: Setup): boolean {
  if (setup.id.length === 0 || setup.id.length > 200) return false;
  if (setup.title.length > 80) return false;
  if (setup.ops.length === 0 || setup.ops.length > 64) return false;
  return setup.ops.every((o) => o.op.length > 0 && o.op.length <= 64);
}

/**
 * Playing a run.
 *
 * Every noun on screen comes from the pack's vocabulary, and every step comes
 * from its declared flow. Nothing here knows what kind of game it is hosting:
 * which is the same claim the format makes, held to to the last label.
 */
export function RunView({
  pack,
  store,
  bench,
  remote,
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
  /**
   * The remote alone, the next move, the last result, undo, as a page
   * of its own, for a streaming app's dock. The same controls the floating
   * window draws, on a page rather than in a window the browser floats;
   * it plays the run like any device, but announces nothing, since the
   * page it stands beside does that.
   */
  remote?: boolean;
}) {
  const run = useRun(pack, store);
  // The dock borrows the floating window's look, which is keyed on the document.
  useEffect(() => {
    if (!remote) return;
    document.documentElement.dataset["pip"] = "controls";
    return () => {
      delete document.documentElement.dataset["pip"];
    };
  }, [remote]);

  // The tab: the run in hand over the pack's own title, Play or Dock with
  // none open. Hooked here, before any early return, as hooks must be.
  useTitle(remote ? (run.state ? `${pack.title} dock` : "Dock") : run.state ? runTitle(run.state.name, pack.title) : "Play");

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
   * device may not hold the pack. A run with a deck on it keeps one for a
   * different reason: the deck has no engine and reads the offer from
   * here. A run with somebody else playing it keeps one for a third: a
   * seat has neither the pack nor an engine and plays off the snapshot.
   * None of the three is the others' business, so any of them is enough.
   */
  const decks = useAttachedDecks(run.record?.runId ?? null);
  // Whose decks, not just how many: the toast below names them, and the
  // people panel's rows want the same list. Read here, ahead of the
  // toast, rather than down with the rest of the attached-tool state.
  const deckSubs = useAttachedDeckSubs(run.record?.runId ?? null);
  const shared = Boolean(!remote && run.record && run.record.role !== "viewer" && (run.record.shared || liveLinkOf(run.record.runId)));
  const seated = (run.record?.members ?? []).some((m) => m.role === "player" && m.sub !== me);
  const publishing = shared || decks > 0 || seated;

  /**
   * Who is at this table, for a press that came from one of them. Rebuilt
   * with the run's members and its state, because who may act this unit
   * moves with the rotation.
   */
  const seating = useMemo(
    () => seatingOf(pack, run.state ?? null, run.record?.members ?? [], run.record?.members?.find((m) => m.role === "owner")?.sub ?? ""),
    [pack, run.state, run.record?.members],
  );

  /**
   * The table is told when a deck arrives, since nothing else on screen
   * says so, and told who: the same lookup the people panel uses turns
   * the account into a name, "You" for the viewer's own, "Someone" for
   * an account the member list does not show.
   *
   * Diffed by account rather than by count, so two devices signed into
   * the same account attaching one after another are still one arrival
   * each: `hadDeckSubs` keeps the set of accounts already named. A deck
   * leaving is not worth interrupting for, and the people panel already
   * says whose are on at rest.
   *
   * A server older than #318 never sends `deckSubs`, which `deckSubs`
   * being null (rather than empty) says: the count is all there is then,
   * and `hadDecks` fires the old toast the way it always did.
   */
  const toast = useToast();
  const hadDecks = useRef(0);
  const hadDeckSubs = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (deckSubs === null) {
      if (decks > hadDecks.current) toast.show(decks === 1 ? "A Stream Deck is on this run." : `${decks} Stream Decks are on this run.`);
      hadDecks.current = decks;
      return;
    }
    const seen = hadDeckSubs.current;
    const arrived = deckSubs.filter((s) => !seen.has(s));
    hadDeckSubs.current = new Set(deckSubs);
    hadDecks.current = decks;
    if (arrived.length === 0) return;
    const members = run.record?.members ?? [];
    const words = arrived.map((s) => (accountOf(s) === me ? "You" : (nameOf(s, members) ?? "Someone")));
    // One arrival names itself; more than one is said together, since the
    // toast shows one line at a time and a second `show` would only push
    // the first name off before anyone read it.
    if (words.length === 1) {
      const who = words[0]!;
      // An unnamed arrival owns nothing to point a possessive at, so it
      // gets the plain article instead: "Someone connected a Stream
      // Deck.", not "their Stream Deck."
      const deck = who === "You" ? "your Stream Deck" : who === "Someone" ? "a Stream Deck" : "their Stream Deck";
      toast.show(`${who} connected ${deck}.`);
    } else {
      toast.show(`${joinWords(words)} connected their Stream Decks.`);
    }
  }, [decks, deckSubs, toast.show, run.record?.members, me]);
  // The race this run is in, if any: the side column's panel and the snapshot both read it.
  const raceView = useRace(run.record, run.state, run.events);

  /**
   * The receipts: what each throw of the step did, kept until the step has
   * been read.
   *
   * The engine moves on the instant a roll is answered, so the dice and the
   * result would otherwise vanish together. The answer is still committed
   * as the engine sees fit, a receipt is a record, not a hold on the game,
   * but the step's rolls stay on screen, in order, with the next roll's
   * keypad beneath them, until "Carry on" closes the step.
   *
   * Outcomes are the signal: whatever the run had not resolved before an
   * answer, and has now, is what that answer did. Measured from the count
   * rather than the request, so a machine roll with auto-roll on, or a move
   * that resolves a table, gets a receipt too, just one without dice.
   */
  const [receipts, setReceipts] = useState<RollReceipt[]>([]);

  // The step is done once nothing more is asked; its receipts wait to be
  // read, unless this device asked them not to. Declared here, ahead of
  // `currentOffer` below, because the offer a deck sees has to show the
  // same receipts the page does.
  const settled = receipts.length > 0 && !run.pending?.request;

  // Who is on the board, read here as `Moves` reads it: the offer has to
  // split a move the same way the panel does. Held by a memo because the
  // offer is, and an empty roster built afresh on every render would
  // rebuild the offer with it and keep restarting the publish timer.
  const racing = useMemo(() => (run.moderated ? (run.state?.contestants ?? []) : []), [run.moderated, run.state]);

  /**
   * The setups this run could be played under, found the way `HandOut`
   * finds them: the pack's shipped profile names the tool, and every
   * setup written for that tool is on offer. Empty until they are read,
   * and empty for good where the pack names no tool, which is the same
   * answer the picker in Settings gives.
   */
  const [offeredSetups, setOfferedSetups] = useState<Setup[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const tool = (await builtins()).find((b) => b.pack === pack.id)?.profile.tool;
      const all = await setupsHere();
      if (alive) setOfferedSetups(forTool(all, tool));
    })();
    return () => {
      alive = false;
    };
  }, [pack.id]);

  /**
   * `handsFree`, `live` and the closing step, ahead of the two things that
   * read them. The offer below says whether the run may end here, in the
   * words of the page's own Finish button; the drive effect further down
   * presses that button, and the page's own carry-on, when a deck asks for
   * either. The full account of hands-free is further down still, where
   * `begun` and the carry-on timer read these.
   */
  const handsFree = run.state ? handsFreeIn(pack, run.state) : false;
  const live = run.state?.status === "active" && !run.readOnly;
  const closingStep = run.activeStep && closesUnit(run.activeStep.step) ? run.activeStep : null;
  const closing = closesTheUnit({
    handsFree,
    live: Boolean(live),
    settled,
    step: closingStep?.step ?? null,
    owed: run.blockingObligations.length,
    thresholds: run.thresholds.length,
    globals: run.globals.length,
  });

  /**
   * What the game is owed, in the words the panel below puts on its own
   * buttons. Held here rather than in the offer because the offer is given
   * what is on offer and not the pack to read it from, and held apart from
   * `currentOffer` because a press has to find the trigger again by key.
   *
   * The same order the panel draws them in, so the key face and the screen
   * agree on which one is next.
   */
  const due = useMemo(
    () => [
      ...run.thresholds.map((t) => ({
        id: t.key,
        label: `${t.label}: ${thresholdWords(pack, t.counter, t.index)}`,
        kind: "threshold" as const,
      })),
      ...run.globals.map((g) => ({ id: g.key, label: `${g.label}: ${globalWords(pack, g.index)}`, kind: "global" as const })),
    ],
    [run.thresholds, run.globals, pack],
  );

  /**
   * What a deck may press, right now: one value for the snapshot this
   * device publishes and for the drive this device takes, so a press is
   * always checked against the same offer it was shown.
   */
  const currentOffer = useMemo(() => {
    const stepLabel = run.state ? activeStepLabel(pack, run.activeStep) : null;
    return offerOf({
      seq: run.events.length,
      live: Boolean(run.started) && !run.readOnly && run.state?.status !== "ended",
      settled: run.pending === null,
      // The receipts of the step's own throws, waiting on the page's own
      // Carry on: a deck sees the same thing the page shows, not a fresh
      // read of the engine underneath it.
      receipts: settled,
      step: run.activeStep?.step ?? null,
      stepLabel,
      // What the engine itself is waiting on, not what the step is: a
      // pending roll is nobody being asked to judge anything, so a deck
      // may throw the dice the same way the page's own button does.
      request: run.pending?.request
        ? run.pending.request.kind === "roll"
          ? { kind: "roll", label: run.pending.request.label ?? stepLabel ?? "" }
          : { kind: "other" }
        : null,
      // A held move -- finalizing, with something still owed -- is the
      // page's own button disabled; a deck sees the same offer the page
      // would show, so it is left off rather than pressed and refused.
      // A move the page splits into a button per racer is left off for
      // the same reason: it is not one press on the page either.
      moves: run.moves
        .filter((m) => !heldMove(m.move, run.blockingObligations.length) && !perRacer(m.move, racing))
        .map((m) => ({ id: m.id, label: m.move.label })),
      canUndo: run.canUndo,
      lastResult: run.state?.outcomes.at(-1) ? entryTextOf(pack, run.state.outcomes.at(-1)!) : null,
      owed: run.blockingObligations.length,
      due,
      // Held to the step's own table, the way the card holds them: a
      // step that constrains what may be named suggests only from there.
      suggestions: run.state
        ? subjectSuggestions(pack, run.state, run.activeStep ? constrainedByOf(run.activeStep.step) : undefined).slice(0, 8)
        : [],
      // The same button the page itself would show between units: nothing
      // else is waiting to be read or answered first, and there is
      // nowhere left to go but the unit ahead. Ended, unstarted, watching,
      // still asked something, or a receipt still on screen -- none of
      // those has a between-units button on the page, so none of them has
      // one here.
      between:
        run.state &&
        Boolean(run.started) &&
        !run.readOnly &&
        run.state.status !== "ended" &&
        run.pending === null &&
        receipts.length === 0 &&
        !run.activeStep
          ? run.state.unit === 0
            ? `Enter ${pack.vocabulary.unit.one} 1`
            : `Enter ${pack.vocabulary.unit.one} ${run.state.unit + 1}`
          : null,
      // What the step's own button says with every box ticked, in the
      // card's words: the closing card's Next, or the manual card's
      // Done. Nothing where the step has no list, because there is then
      // no list to tick and the primary is the press.
      finishLabel: run.activeStep && checklistOf(run.activeStep.step).length > 0 ? finishWords(pack, run.activeStep.step) : null,
      // Id and title only: a key face shows the title, and a press names
      // the id. What the setup actually does stays here, where the run is.
      setups: offeredSetups.map((s) => ({ id: s.id, title: s.title })),
      // The same list, offered the other way round: handed to the tool
      // once instead of taken on by the run. One list, because a setup
      // file is one document either way; which of the two a key does is
      // the key's own business. Less whatever the server would drop on
      // the way, which `fitsTheWire` is the one account of.
      commands: offeredSetups.filter(fitsTheWire).map((s) => ({ id: s.id, title: s.title })),
      trackers: trackersOf(pack, run.state ?? null),
      // The one clock the page's own Pause and Stop act on. A unit runs
      // one at a time in practice, and where it somehow runs two, the one
      // ticking is the one anybody means; a paused clock is offered so the
      // key that paused it can start it again.
      clock: clockOf(run.state ?? null),
      autoRoll: run.autoRoll,
      // The page's own Finish button, on the same condition it appears
      // under: the closing step, its receipts read, and a run the engine
      // says may end. Offered in that button's words, not a key's own.
      ending: closing && closingStep && run.canEnd.ok ? { label: `Finish the ${pack.vocabulary.run.one.toLowerCase()}` } : null,
    });
  }, [
    run.events.length,
    run.started,
    run.readOnly,
    run.state,
    run.pending,
    run.activeStep,
    run.moves,
    racing,
    run.canUndo,
    run.blockingObligations.length,
    due,
    receipts.length,
    settled,
    offeredSetups,
    run.autoRoll,
    run.canEnd.ok,
    closing,
    closingStep,
    pack,
  ]);
  /**
   * The run whose first snapshot has landed. The server reads `first` as
   * the run's opening word, which is where a server set to open a watch
   * party on its own gets its chance.
   */
  const publishedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!api || !publishing || !run.record || !run.state) return;
    const record = run.record;
    const state = run.state;
    const events = run.events;
    const race = raceOf(raceView.race, raceView.standings, pack.vocabulary.unit);
    const timer = window.setTimeout(() => {
      /*
       * The control profile rides along: the server reads it there to
       * decide what a tool attached to somebody's game should be told.
       *
       * With the run's setup folded into its terms, because that is what
       * a setup is for: one field on the wire, applied on attach, its
       * gifts held back on a reconnect by the record the server already
       * keeps. A run with a setup and no profile still has something to
       * send, which is why the emptiness check comes after the fold.
       */
      const profile = withChosen((record.control as ControlProfile) ?? {}, chosenFrom(record.setup));
      const control = isEmpty(profile) ? {} : { control: tidy(profile) };
      // The live link this device remembers, for a watch party's card, and
      // whether this is the run's first word.
      const link = liveLinkOf(record.runId);
      const first = publishedFor.current !== record.runId;
      void api
        .putSnapshot(
          record.runId,
          {
            ...snapshotOf(pack, state, events, undefined, { race }),
            paper: paperOf(pack, state.mode),
            offer: currentOffer,
            ...control,
          },
          { ...(link ? { link } : {}), ...(first ? { first: true } : {}) },
        )
        .then(() => {
          publishedFor.current = record.runId;
        })
        .catch(() => {});
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, publishing, decks, seated, run.events, pack, raceView.race, run.record?.control, run.record?.setup, currentOffer]);

  /**
   * Starting a race, or joining one: an ordinary run of this pack with the
   * race's seed and mode, and the race told which run this is. Joining a
   * race that is for another pack says so rather than guessing.
   */
  const startRace = async (mode: string, seed: string, runName: string, setup: ChosenSetup | null) => {
    if (!api) return;
    setRaceNote(null);
    const raceId = ulid();
    const runId = run.startRun(mode, seed, 1, runName, [], [], { raceId, ...(setup ? { setup } : {}) });
    try {
      const race = await api.createRace({
        id: raceId,
        packId: pack.id,
        packVersion: pack.version,
        packTitle: pack.title,
        ...(runName.trim() ? { name: runName.trim() } : {}),
        mode,
        seed,
        sessionId: runId,
      });
      setRaceNote(`Racing. The code is ${race.meta.code}; it is in the side column too.`);
    } catch (error) {
      if (error instanceof PlanError)
        setRaceNote(`${error.message}. This is an ordinary run for now; subscribe from your profile, under Plan, and start a race again.`);
      else setRaceNote(error instanceof Error && error.message ? error.message : "The race could not be started; this is an ordinary run.");
    }
  };
  const joinRace = async (code: string, setup: ChosenSetup | null) => {
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
      const runId = run.startRun(race.meta.mode, race.meta.seed, 1, race.meta.name ?? "", [], [], {
        raceId: race.meta.id,
        ...(setup ? { setup } : {}),
      });
      await api.putRaceEntry(race.meta.id, { sessionId: runId });
    } catch (error) {
      setRaceNote(error instanceof Error && error.message ? error.message : "That code did not open a race.");
    }
  };
  useAlerts(run.events, run.runId, me, alerts);

  const sync = useSync();
  // A hosted run opens itself to watchers and sees to a watch key, so an
  // address copied from this run works when it is pasted somewhere.
  const reachable = useReachable(api, run.record ?? null);
  // Whose games this run is holding the other end of, for the badge below.
  const tools = useAttachedTools(run.record?.runId ?? null);
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

  /**
   * The host handing a setup out, on everybody else's copy of the run.
   *
   * The press says so where it was made and nowhere else: a player whose
   * game was just re-equipped had no way of knowing it, which is the
   * whole of this.
   *
   * Whose press it was is asked of the run rather than of the line. Only
   * the owner may hand a setup out, so the host's own copies have nothing
   * to be told: the device that pressed is not sent the line at all, and
   * another device on the same account would otherwise announce the press
   * to the person who made it. Held against the account rather than the
   * name on the line, because a shown name is only unique where somebody
   * claimed a handle, and two players called Nate would have left one of
   * them hearing nothing all run.
   */
  const hostSub = accountOf(run.record?.members?.find((m) => m.role === "owner")?.sub ?? "");
  const hostName = nameOf(hostSub, run.record?.members ?? []);
  useEffect(() => {
    const runId = run.record?.runId;
    if (!runId || (me !== null && hostSub === me)) return;
    return syncBus.subscribe((news) => {
      if (news.t !== "gesture" || news.id !== runId) return;
      // The server stamps the sender's name on the line where the member
      // row has one; the run's own roster is the fallback, and "The host"
      // is what a table with no name for them says.
      const who = news.from ?? hostName;
      const said = handoutLine({ kind: news.kind, data: news.data, ...(who ? { from: who } : {}) });
      if (said) toast.show(said);
    });
  }, [run.record?.runId, hostSub, hostName, me, toast.show]);

  /**
   * A deck's own presses, kept only long enough to answer a retry with
   * the same verdict; a run underneath it changing makes a ref from
   * before mean nothing, so it is emptied along with the run id.
   */
  const driveSeen = useRef(new Map<string, Verdict>());
  useEffect(() => {
    driveSeen.current = new Map();
  }, [run.record?.runId]);

  /**
   * A verdict waiting on the run to catch up.
   *
   * A deck presses against a `seq`, and the next `seq` it knows about
   * arrives with the doorbell, a sync settle away. Pressed twice inside
   * that window, the second press named the old one and was refused
   * "That moved on." for no reason anybody at the table could see. So an
   * accepted verdict waits here until this device's own log has grown,
   * and goes out naming what it grew to. A refusal changed nothing and
   * goes at once.
   *
   * The timer is the promise that nothing hangs: a press that somehow
   * appended no event is answered anyway, with whatever the run reads at
   * by then.
   */
  const heldVerdict = useRef<{ to: string; ref: string; was: number; timer: number } | null>(null);
  const eventCount = useRef(run.events.length);
  const settleVerdict = useCallback(
    (seq: number) => {
      const held = heldVerdict.current;
      if (!held) return;
      heldVerdict.current = null;
      window.clearTimeout(held.timer);
      sync.drove(held.to, held.ref, true, undefined, seq);
    },
    [sync],
  );
  useEffect(() => {
    eventCount.current = run.events.length;
    if (heldVerdict.current && heldVerdict.current.was !== run.events.length) settleVerdict(run.events.length);
  }, [run.events.length, settleVerdict]);
  // Nothing outlives the screen: a timer left running would answer a deck
  // from a run this device no longer has open.
  useEffect(
    () => () => {
      if (heldVerdict.current) window.clearTimeout(heldVerdict.current.timer);
      heldVerdict.current = null;
    },
    [],
  );

  const awaiting = useRef<Omit<RollReceipt, "outcomes"> | null>(null);
  const answered = useRef(0);

  /**
   * A roll asked for by a deck, counted rather than carried out here.
   *
   * The request panel is the only place dice are thrown, so a press goes
   * to it as a number that has gone up. Anything this side did instead
   * would put a total on screen with no throw in front of it, which is
   * the one thing the panel is written not to do.
   */
  const [machineRoll, setMachineRoll] = useState(0);

  /**
   * Answering whatever the engine is waiting on: the page's own request
   * panel calls this, and so does a deck's roll press, because a machine
   * roll is the same answer either way.
   */
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
          table: pack.tables[request.purpose] ? request.purpose : null,
          machineRolled: machineRolled === true,
          ...(seed !== undefined ? { seed } : {}),
        };
      }
      run.answer(key, value, machineRolled);
    },
    [run],
  );

  /**
   * Carry on: clear the receipt, and where that is also the end of the
   * unit, close it and enter the next in the same press. Hoisted ahead of
   * the drive effect below, which presses the same function the page's own
   * button does rather than a second path through `run.completeStep`.
   */
  const carryOn = useCallback(() => {
    setReceipts([]);
    if (closing && closingStep) run.closeAndEnter(closingStep.phase, closingStep.index);
  }, [closing, closingStep, run]);

  /**
   * A press from a deck, taken here because this is the device holding the
   * run. What the deck may press is the offer this device published; what
   * happens when it does is the same function the page's own button calls.
   */
  useEffect(() => {
    // Not gated on publishing. A press only ever reaches a device the
    // server picked as the one holding the run, and `currentOffer` is
    // computed whether or not this device is publishing, so the answer to
    // one is always at hand -- `needsPage` included. Gated, a page that
    // opened the run before it heard about the deck, or came back from a
    // reload with `decks` at nought, left every press hanging.
    if (!run.record || !run.state) return;
    const runId = run.record.runId;
    const active = run.activeStep;
    return syncBus.subscribe((news) => {
      if (news.t !== "drive" || news.run !== runId) return;
      // Whether all this press did was put dice in the air. The verdict
      // for one of those has longer to wait; see `DICE_VERDICT_MS`.
      let threw = false;
      const verdict = takePress(
        news,
        { seq: run.events.length, offer: currentOffer, seen: driveSeen.current, seating },
        {
          primary: () => {
            const id = currentOffer.primary?.id;
            if (id === "enter") {
              run.enterUnit();
              return;
            }
            if (id === "owed") {
              // The button the "The game has your number" panel would show
              // first, pressed the way that panel presses it. The offer
              // named it from `due`, so the same first entry names it here.
              const first = due[0];
              if (!first) return;
              if (first.kind === "threshold") {
                const t = run.thresholds.find((x) => x.key === first.id);
                if (t) run.fireThreshold(t);
              } else {
                const g = run.globals.find((x) => x.key === first.id);
                if (g) run.fireGlobal(g);
              }
              return;
            }
            if (!active) return;
            const request = run.pending?.request;
            if (id === "roll" && request?.kind === "roll") {
              // The step already began -- hands-free, or a press before
              // this one -- and is only waiting on dice. The panel's own
              // "Roll for me" is pressed, so the dice fly on screen and
              // the engine hears the total once they have landed.
              setMachineRoll((n) => n + 1);
              threw = true;
            } else if (id === "roll" && active.step.kind === "rollTable") {
              const table = pack.tables[active.step.table];
              run.begin({
                kind: "table",
                tableId: active.step.table,
                keyPrefix: `u${run.state?.unit ?? 0}:${active.phase.id}#${active.index}`,
                label: table?.title ?? active.step.table,
                completes: { phase: active.phase, index: active.index },
              });
            } else if (id === "carry-on" && currentOffer.primary?.kind === "receipt") {
              // The receipts of the step's own throws are waiting on the
              // page's own Carry on, not the engine's completeStep: where
              // the step also closes the unit, the page's callback closes
              // and enters the next one in the same press.
              carryOn();
            } else if (id === "carry-on") {
              run.completeStep(active.phase, active.index);
            } else if (id === "close") {
              run.closeAndEnter(active.phase, active.index);
            }
          },
          move: (id) => {
            const m = currentOffer.moves.find((mv) => mv.id === id);
            if (m) run.takeMove(m.id, m.label);
          },
          undo: () => run.undo(),
          answer: (a) => {
            if (!active) return;
            if (a["ticks"] === "all") {
              tickEverythingAndFinish(pack, run, active);
              return;
            }
            run.declareSubject(active.phase, active.index, String(a["subject"] ?? ""));
          },
          tracker: (id, move) => {
            const it = currentOffer.trackers.find((t) => t.id === id);
            if (!it) return;
            // A number to land on becomes the distance to it, because that
            // is what both of the run's own functions take. Nothing to
            // move is nothing to write: a dial already at four, set to
            // four, would otherwise put a correction in the log saying the
            // tally was wrong when it was not.
            const by = "by" in move ? move.by : move.to - it.value;
            if (by === 0) return;
            if (it.kind === "counter") run.nudgeCounter(id, by);
            else run.turnResource(id, by);
          },
          clock: (id, doing) => {
            if (doing === "pause") run.pauseClock(id);
            else if (doing === "resume") run.resumeClock(id);
            else run.stopClock(id);
          },
          autoRoll: (on) => run.setAutoRoll(on),
          finish: () => {
            if (!closing || !closingStep || !run.canEnd.ok) return;
            // The page's own Finish button, to the letter: the receipts go
            // and the closing step ends the run in the same press.
            setReceipts([]);
            run.finish(closingStep.phase, closingStep.index);
          },
          setup: async (id) => {
            const picked = offeredSetups.find((s) => s.id === id);
            if (!picked) throw new Error("That setup is not here.");
            // Both halves of what Settings does in two presses: the run is
            // played under this from here on, and everyone attached now
            // gets it. The word goes out only once the write has landed,
            // because the server builds what a tool is sent from the run's
            // saved profile and would otherwise hand out the one before.
            const chosen = chose(picked);
            await run.setSetup(chosen);
            // What went out travels with the word, so the toast on every
            // other screen at the table can name it.
            sync.gesture(runId, "setup", handoutOf(chosen) ?? {});
          },
          command: (id) => {
            const picked = offeredSetups.find((s) => s.id === id);
            if (!picked) throw new Error("That command is not here.");
            // The file's own operations, as written, rather than the run's
            // combined profile: the whole point is that the run is left
            // where it was, so nothing is read from it and nothing is
            // written to it. The server hands them on and forgets them.
            //
            // Synchronous, unlike the setup above, because there is no
            // write to wait for -- and because the refusal below has to
            // reach `takePress` rather than a promise nobody is holding.
            const sent = sync.gesture(runId, "command", { id: picked.id, title: picked.title, ops: picked.ops });
            // A deck pressed a key on a page whose socket is down. Nothing
            // went anywhere, and the deck is told so rather than left to
            // read silence as success.
            if (!sent) throw new Error("The run is not synced.");
          },
        },
      );
      if (!verdict.ok) {
        sync.drove(news.from, news.ref, false, verdict.say, run.events.length);
        return;
      }
      // One press at a time: a verdict still waiting when the next press
      // lands is answered with where the run has got to, and the new one
      // takes the seat.
      settleVerdict(eventCount.current);
      heldVerdict.current = {
        to: news.from,
        ref: news.ref,
        was: run.events.length,
        timer: window.setTimeout(() => settleVerdict(eventCount.current), threw ? DICE_VERDICT_MS : HELD_VERDICT_MS),
      };
    });
  }, [run, currentOffer, due, sync, pack, settleVerdict, offeredSetups, carryOn, settled, closing, closingStep, seating]);
  const seen = useRef<number | null>(null);
  // How many answers this view has given, and how many it had given when
  // the last receipt was issued: what a step that came back with the run
  // had already resolved is shown as such, not as a throw just made.
  const committedSeen = useRef(0);
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
      // Undo, or the step canceled. Whatever the receipts were about has been unmade.
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
        table: throwing?.table ?? null,
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

  // What each move did, told to whoever is watching: a result landed, a
  // unit closed, the run ended. The owner's device tells it, whichever
  // device made the move, so a table has one voice; a viewer's copy, a
  // player's copy and the bench say nothing. See gestures.ts.
  const told = useRef<LifecycleMarks | null>(null);
  useEffect(() => {
    const record = run.record;
    const state = run.state;
    if (!record || !state) return;
    const before = told.current;
    told.current = marksOf(state, run.events);
    // First sight of a saved run: everything in it is old news.
    if (!before) return;
    if (record.role === "viewer" || record.role === "player" || run.readOnly || bench || remote) return;
    for (const g of lifecycleGestures(pack, state, run.events, before)) sync.gesture(record.runId, g.kind, g.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.events.length, run.state]);

  const lastReceipt = receipts[receipts.length - 1] ?? null;

  /* ---------------------------------------------------------------- *
   * Hands-free
   *
   * A pack whose units run themselves drops the two presses that only
   * ever meant "go": the one that starts a roll nobody is being asked
   * about, and the one that closes a unit with nothing left in it. What
   * is left is the result on screen and a button to move past it, which
   * is the whole interface for a game played with both hands busy.
   *
   * Everything that genuinely asks still stops. `closing` is false the
   * moment a confirmation, a checklist or something owed stands between
   * the player and the end of the unit. It and `handsFree` are declared
   * above, ahead of the drive effect that presses `carryOn`.
   * ---------------------------------------------------------------- */

  /**
   * A step that asks nothing, started without being asked to start it.
   *
   * Keyed by the unit so the same step in the next unit begins again,
   * and remembered so a step that somehow fails to complete is not
   * begun over and over.
   */
  const begun = useRef<string | null>(null);
  useEffect(() => {
    const active = run.activeStep;
    if (!handsFree || !live || !active || run.pending || receipts.length > 0) return;
    if (!startsItself(active.step)) return;
    if (active.step.kind !== "rollTable") return;
    const key = `u${run.state!.unit}:${active.phase.id}#${active.index}`;
    if (begun.current === key) return;
    begun.current = key;
    const table = pack.tables[active.step.table];
    run.begin({
      kind: "table",
      tableId: active.step.table,
      keyPrefix: key,
      label: table?.title ?? active.step.table,
      completes: { phase: active.phase, index: active.index },
    });
  }, [handsFree, live, run.activeStep, run.pending, receipts.length, pack, run]);

  useEffect(() => {
    // A receipt that closes the unit is never dismissed by the clock:
    // "carry on by itself" plus hands-free would play the whole run
    // without anybody in the room.
    if (!settled || closing || !carriesOnByItself()) return;
    const timer = setTimeout(() => setReceipts([]), CARRY_ON_HOLD_MS);
    return () => clearTimeout(timer);
  }, [settled, closing]);

  /**
   * Which of the three planes a phone is showing; see RunRail. A wide
   * screen shows all three and ignores this.
   *
   * The game asking for something takes the screen back to it. A question
   * put to a player who is reading the log would be asked where nobody is
   * looking, and the first they would know of it is a step that will not
   * move on. The same goes for a new step: the board is a thing you glance
   * at between moves, not a place to be left standing when the move comes.
   */
  const [pane, setPane] = useState<Pane>("now");
  // Enter presses the one onward button of whatever this screen is; see the hook.
  useEnterMoves();
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const waiting = Boolean(run.pending?.request) || receipts.length > 0;
  const stepNow = run.activeStep ? `${run.activeStep.phase.id}#${run.activeStep.index}` : "-";
  useEffect(() => {
    if (waiting) setPane("now");
  }, [waiting]);
  useEffect(() => {
    setPane("now");
  }, [stepNow]);

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
    if (remote) {
      return (
        <main className="main remote">
          <div className="pipPanel">
            <p className="muted">This run has not started. Start it in the app, and the dock follows.</p>
          </div>
        </main>
      );
    }
    return (
      <>
        {bench && (
          <div className="main benchOnly">
            <BenchBar pack={pack} bench={bench} />
          </div>
        )}
        <StartScreen
          pack={pack}
          onStart={run.startRun}
          others={run.runList}
          onContinue={run.switchRun}
          onBack={run.runList.length > 0 ? run.cancelAnother : undefined}
          {...(api && !bench
            ? {
                race: {
                  start: (mode, seed, name, setup) => void startRace(mode, seed, name, setup),
                  join: (code, setup) => void joinRace(code, setup),
                  note: raceNote,
                },
              }
            : {})}
        />
      </>
    );
  }

  const { state } = run;

  if (remote) {
    return (
      <main className="main remote">
        <RemoteControls
          pack={pack}
          run={run}
          state={state}
          receipt={settled ? lastReceipt : null}
          onCarryOn={carryOn}
          onAnswer={answer}
          {...receiptFollowUps(run, settled, lastReceipt)}
        />
      </main>
    );
  }

  return (
    <main className="main run">
      {bench && <BenchBar pack={pack} bench={bench} onRestart={run.discard} />}
      <RunHeader
        pack={pack}
        run={run}
        state={state}
        onSettings={() => setSettingsOpen(true)}
        open={runMenuOpen}
        onClose={() => setRunMenuOpen(false)}
      />

      {/*
        Three columns that are not three cards. The margin holds where the
        unit is up to, numbered because it is a sequence. The middle holds the
        one thing to do, which is the only raised object on the screen. The
        side holds the board and the trackers as ruled rows.

        On a phone the same three become three planes, one at a time, and the
        rail under them is the way between; the margin keeps its job as one
        sticky line. See RunRail, and the phone's half of the sheet.
      */}
      <div className="columns run" data-pane={pane}>
        <aside className="margin">
          <div className="stageNo">
            <small>{pack.modes[state.mode]?.label ?? state.mode}</small>
            {pack.vocabulary.unit.one} {state.unit || "-"}
          </div>
          {/* Which pack this is, beside the unit, on a phone: the bar above
              has given up the room for it, and the line that says where you
              are is where it belongs. The wide screen says it in the run's
              own bar and hides this. */}
          {/*
            Which run this is, where a phone has room for one name. A run
            somebody named is named to tell it from their others, so the
            name they chose beats the pack's title, which they picked on
            the way in and which the Rules button leads back to. An
            unnamed run says the pack, as it always did.
          */}
          <span
            className="stagePack"
            title={state.name ? `${state.name}, a ${pack.vocabulary.run.one.toLowerCase()} of ${pack.title}` : pack.title}
          >
            {state.name?.trim() || pack.title}
          </span>
          {/*
            On a phone the run's own bar, the name, the seed, undo, settings
            and the way out, is not worth the four rows it costs above the
            step. It folds behind this, at the end of the line that says
            where you are, and wears a mark when it is holding something the
            player would want to have seen: a forced unit, a rewind coming.
          */}
          <button
            type="button"
            className={`runMenuBtn${state.forcedUnits > 0 || state.rewindNext > 0 ? " flagged" : ""}`}
            aria-expanded={runMenuOpen}
            onClick={() => setRunMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">···</span>
            <span className="visuallyHidden">This {pack.vocabulary.run.one.toLowerCase()}</span>
          </button>
          {state.unit > 0 && <ClockPanel pack={pack} run={run} state={state} />}
          <Flow pack={pack} run={run} state={state} open={pane === "unit"} onOpen={() => setPane(pane === "unit" ? "now" : "unit")} />
        </aside>

        <div className={`col wide ${run.readOnly ? "watching" : ""}`}>
          {run.readOnly && (
            <p className="notice">
              You are watching this {pack.vocabulary.run.one.toLowerCase()}. Every move shows here as it is made; none can be made from
              here.
            </p>
          )}
          <DiceCurtain roll={othersRoll} />
          {receipts.length > 0 && (
            <Receipt
              receipts={receipts}
              nameOf={(id) => hitLabel(pack, state, id)}
              pack={pack}
              settled={settled}
              onDismiss={carryOn}
              {...(closing && closingStep && run.canEnd.ok
                ? {
                    onFinish: () => {
                      setReceipts([]);
                      run.finish(closingStep.phase, closingStep.index);
                    },
                    finishWord: `Finish the ${pack.vocabulary.run.one.toLowerCase()}`,
                  }
                : {})}
              {...receiptFollowUps(run, settled, lastReceipt)}
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
              machineRoll={machineRoll}
            />
          ) : receipts.length > 0 ? null : state.status === "ended" ? (
            <Ended pack={pack} state={state} />
          ) : state.unit === 0 ? (
            <StartFirstUnit pack={pack} onEnter={run.enterUnit} />
          ) : run.activeStep ? (
            <>
              <EntryWords pack={pack} state={state} />
              <StepPanel pack={pack} run={run} state={state} active={run.activeStep} />
            </>
          ) : (
            <BetweenUnits pack={pack} run={run} state={state} />
          )}

          {(run.thresholds.length > 0 || run.globals.length > 0) && <Thresholds pack={pack} run={run} />}

          {/* Whatever is owed and not already offered on the rule that
              incurred it, plus the standing notes. */}
          {(elsewhere(pack, run, state).length > 0 || run.notes.length > 0) && <Obligations pack={pack} run={run} state={state} />}

          {run.moderated && run.challenges.length > 0 && <Winners run={run} state={state} />}
          {run.moves.length > 0 && <Moves run={run} pack={pack} state={state} />}

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
              <ExportPanel pack={pack} state={state} events={run.events} onLoad={run.loadEvents} />
              <EnvironmentPanel pack={pack} state={state} />
            </details>
          )}
        </div>

        <div className="col side">
          {/* Who is here, first: a row a person, with what they have plugged in. */}
          {run.record && !bench && <Members pack={pack} run={run.record} tools={tools} deckSubs={deckSubs ?? []} />}
          {state.status === "ended" && <Scores pack={pack} run={run} state={state} />}
          {run.moderated && <Scoreboard run={run} state={state} pack={pack} tools={tools} />}
          {!run.moderated && tools.length > 0 && <Attached tools={tools} />}
          {run.roles.length > 0 && <Roles pack={pack} run={run} state={state} />}
          {/* A pack whose units make nothing has no board; the panel would
              say "nothing made yet" for the whole run. */}
          {pack.unit.createsSubject && (
            <Board pack={pack} state={state} onRename={run.renameSubject} onCorrect={run.readOnly ? undefined : run.correctState} />
          )}
          <Trackers
            pack={pack}
            state={state}
            onNudge={run.readOnly ? undefined : run.nudgeCounter}
            onTurn={run.readOnly ? undefined : run.turnResource}
          />
          {run.record && api && !bench && <RacePanel pack={pack} race={raceView} />}
          {run.record && !bench && api && <Asks pack={pack} run={run} record={run.record} />}
        </div>
      </div>
      {toast.node}
      <RunRail
        pane={pane}
        onPane={setPane}
        waiting={waiting}
        unit={pack.vocabulary.unit.one}
        board={`The ${pack.vocabulary.subject.many.toLowerCase()}, what is running, and who is here`}
      />
      {runMenuOpen && <button type="button" className="runBarScrim" aria-label="Close" onClick={() => setRunMenuOpen(false)} />}
      {settingsOpen && (
        <SettingsDialog
          runId={run.record?.runId ?? null}
          race={Boolean(run.record?.raceId)}
          alerts={alerts}
          onAlerts={setAlerts}
          rolling={{ auto: run.autoRoll, seeded: run.seededRun, onAuto: run.setAutoRoll }}
          pack={pack}
          record={run.record ?? null}
          onAsks={run.setAsks}
          onControl={run.setControl}
          reachable={reachable}
          onSetup={run.setSetup}
          onHandOut={(chosen) => {
            // The word goes out whatever it can be called. The gesture is
            // what hands the loadout to an attached tool, so a run whose
            // saved setup lost its credits still has something to hand
            // out; a page that cannot name it says nothing, which is its
            // own business.
            if (!run.record) return false;
            return sync.gesture(run.record.runId, "setup", handoutOf(chosen) ?? {});
          }}
          seats={(run.state?.contestants ?? []).map((c) => c.name)}
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
          onCarryOn={carryOn}
          onAnswer={answer}
          {...receiptFollowUps(run, settled, lastReceipt)}
          onClose={closeControls}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The strip over a test run. It says what this is, a trial that keeps
 * nothing, and holds the two things a tester wants: to start the same
 * pack over, and to go back to where they were testing from.
 */
function BenchBar({ pack, bench, onRestart }: { pack: Pack; bench: { from: string; onLeave: () => void }; onRestart?: () => void }) {
  return (
    <div className="benchBar" role="status">
      <span className="benchLabel">Test run</span>
      <span className="muted">
        Nothing is saved. Roll for me is a choice here as anywhere; with it off, the Table button beside the pad lands any roll on the line
        you pick.
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

/**
 * What this run is, and the four things you can do to the whole of it.
 *
 * A wide screen reads it as a bar over the columns. A phone has no row to
 * spare above the step, so the same bar is a sheet at the foot of the
 * screen, raised by the mark at the end of the line that says where you
 * are, and dismissed by the scrim behind it or by Close.
 */
function RunHeader({
  pack,
  run,
  state,
  onSettings,
  open,
  onClose,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
  onSettings: () => void;
  /** Whether the phone's sheet is raised; a wide screen shows the bar regardless. */
  open?: boolean;
  onClose?: () => void;
}) {
  const v = pack.vocabulary;
  const drawer = useDocDrawer();
  const mode = pack.modes[state.mode];
  // Discarding deletes the log, so it is asked first; see useConfirm.
  const { dialog, ask } = useConfirm();
  return (
    <section className={`runBar${open ? " open" : ""}`}>
      {dialog}
      <div className="runMeta">
        <strong>{pack.title}</strong>
        <span className="muted">{mode?.label ?? state.mode}</span>
        <RunName name={state.name} onRename={run.renameRun} noun={v.run.one.toLowerCase()} />
        {state.seed && <span className="chip">seed {state.seed}</span>}
        {state.status === "ended" && <span className="chip ok">ended</span>}
        {state.forcedUnits > 0 && <span className="chip warn">{state.forcedUnits} forced</span>}
        {state.rewindNext > 0 && (
          <span
            className="chip warn"
            title={`When this ${v.unit.one.toLowerCase()} closes, the ${v.run.one.toLowerCase()} goes back to ${v.unit.one.toLowerCase()} ${nextUnit(state)}`}
          >
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
        {/*
          The pack's paper, beside the run's own controls rather than up in
          the bar, because it is only worth reading while there is a run to
          read it against. The same word and the same drawer as the marketplace
          and the library use, so "Docs" means one thing everywhere.
        */}
        <button
          className="ghost"
          onClick={() => drawer.open(pack, "summary", { section: "packs", id: pack.id })}
          title="What this pack is, and the rules of what you are running"
        >
          Docs
        </button>
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
            void ask({
              ask: `Discard ${named}?`,
              detail: "Its log is deleted, and there is no undoing it.",
              confirm: "Discard",
              destructive: true,
            }).then((yes) => yes && run.discard());
          }}
        >
          Discard
        </button>
        {/* The phone's sheet needs a way down that is not the scrim. */}
        <button className="ghost sheetClose" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}

/** What the pack says on entering the unit: its welcome, once, and its word for every unit, until the first step is done. */
function EntryWords({ pack, state }: { pack: Pack; state: RunState }) {
  const words = entryWords(pack, state);
  if (words.length === 0) return null;
  return (
    <section className="panel runStep entryWords">
      {words.map((w, i) => (
        <p key={i} className={i === 0 && state.unit === 1 && pack.unit.intro ? "intro" : ""}>
          {w}
        </p>
      ))}
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
      <div className="stepAction">
        <button className="primary big" onClick={onEnter}>
          Enter {v.unit.one} 1
        </button>
      </div>
    </section>
  );
}

/**
 * The move a rule is still waiting on, to sit on the rule itself.
 *
 * A result can be a rule binding the step and a trigger that has not run,
 * at once. It used to be said three times over: the rule, a banner
 * counting what was owed, and a panel underneath with the button on it.
 * The rule is the statement, so the button belongs on it, and the other
 * two have nothing left to say.
 */
function owedAction(pack: Pack, run: ReturnType<typeof useRun>, state: RunState) {
  const owed = owedOn(state);
  return (line: { table: string; entryId: string }) => {
    if (!stillOwed(owed, line)) return null;
    const due = state.obligations.find(
      (o) =>
        !o.resolved && o.kind === "trigger" && o.ref?.kind === "tableEntry" && o.ref.table === line.table && o.ref.entryId === line.entryId,
    );
    if (!due || run.readOnly) return null;
    return (
      <button className="primary tiny owingMove" onClick={() => run.resolveObligation(due.id, due.text)}>
        {settleWords(pack, due)}
      </button>
    );
  };
}

function StepPanel({ pack, run, state, active }: { pack: Pack; run: ReturnType<typeof useRun>; state: RunState; active: ActiveStep }) {
  const { phase, step, index } = active;
  const v = pack.vocabulary;
  const [declared, setDeclared] = useState("");

  const key = `${phase.id}#${index}`;
  // What is ticked on this step, read back from the log rather than held
  // here: a reload lands on the same boxes, and a box can count.
  const ticked = useMemo(() => ticksFor(state, key), [state, key]);
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
              This {pack.vocabulary.unit.one.toLowerCase()} rolls {table?.title ?? step.table} {owed + 1} times:{" "}
              {owed === 1 ? "one more is owed" : `${owed} more are owed`} after this one.
            </p>
          )}
          <div className="stepAction">
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
          </div>
        </section>
      );
    }

    case "declareSubject": {
      const constraints = constraintLines(pack, state, step.constrainedBy);
      // What was drawn this unit, offered as a name. Most of the time
      // the thing the player is about to type is the thing they have
      // just read.
      const suggested = subjectSuggestions(pack, state, step.constrainedBy);
      return (
        <section className="panel runStep" key={key}>
          <StepHead phase={phase} label={step.label ?? `Declare the ${v.subject.one}`} />
          <Constraints lines={constraints} action={owedAction(pack, run, state)} />
          {state.bannedTypes.length > 0 && <p className="muted small">No longer allowed: {state.bannedTypes.join(", ")}</p>}
          {suggested.length > 0 && (
            <div className="padRow">
              {suggested.map((name) => (
                <button key={name} className="ghost tiny" onClick={() => run.declareSubject(phase, index, name)}>
                  {name}
                </button>
              ))}
              <span className="muted small">or say it in your own words</span>
            </div>
          )}
          <div className="padRow stepAction">
            <input
              className="textInput"
              autoFocus
              placeholder={`What is this ${v.subject.one.toLowerCase()}?`}
              value={declared}
              onChange={(e) => setDeclared(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && declared && run.declareSubject(phase, index, declared)}
            />
            <button className="primary" disabled={!declared} onClick={() => run.declareSubject(phase, index, declared)}>
              Declare
            </button>
          </div>
        </section>
      );
    }

    case "manual": {
      if (closesUnit(step))
        return <ClosingStep key={key} pack={pack} run={run} state={state} active={active} ticked={ticked} tick={tick} />;
      const list = step.checklist ?? [];
      const allTicked = checklistDone(list, pack, state, ticked);
      const constraints = constraintLines(pack, state, step.constrainedBy);
      return (
        <section className="panel runStep" key={key}>
          <StepHead phase={phase} label={step.label} />
          {step.description && <p className="muted">{step.description}</p>}
          <Constraints lines={constraints} action={owedAction(pack, run, state)} />
          {list.length > 0 && <Checklist items={list} pack={pack} state={state} ticked={ticked} onToggle={tick} />}
          {/*
            Never dim. A dimmed Done beside an unticked list read as broken;
            the button says what it is waiting for and points at the box.
          */}
          <div className="stepAction">
            <button
              className="primary big"
              onClick={(e) => (allTicked ? run.completeStep(phase, index) : nudgeFirstUnticked(e.currentTarget))}
            >
              {allTicked ? finishWords(pack, step) : "Tick what you honored"}
            </button>
          </div>
        </section>
      );
    }

    case "actions":
      return (
        <section className="panel runStep" key={key}>
          <StepHead phase={phase} label={phase.label} />
          <div className="stepAction">
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
          </div>
        </section>
      );

    case "finalizeUnit":
      return <ClosingStep key={key} pack={pack} run={run} state={state} active={active} ticked={ticked} tick={tick} />;
  }
}

/**
 * "1 Piece" rather than "1 Pieces".
 *
 * The singular and plural both come from the pack, because no rule about
 * English suffixes would survive a pack written in another language.
 */
/**
 * What the run has to show for itself so far, in its own words.
 *
 * Usually the subjects, which is what a unit is for. A pack whose units
 * make nothing has none to count and never will, so what it has done is
 * units, and counting those is the only number on that card that means
 * anything.
 */
function countMade(pack: Pack, state: RunState): string {
  if (!pack.unit.createsSubject) {
    const n = state.unit;
    return `${n} ${(n === 1 ? pack.vocabulary.unit.one : pack.vocabulary.unit.many).toLowerCase()} so far`;
  }
  const n = state.subjects.filter((s) => !s.removed).length;
  const noun = n === 1 ? pack.vocabulary.subject.one : pack.vocabulary.subject.many;
  return `${n} ${noun.toLowerCase()} made so far`;
}

function StepHead({ phase, label }: { phase: { label: string }; label: string }) {
  return (
    <>
      <h3 className="sectionTitle">{phase.label}</h3>
      <h4 className="stepLabel">{label}</h4>
    </>
  );
}

/**
 * The step that closes the unit, and the fork at its end: on to the next
 * unit in one press, or Finish, which ends the run outright where the pack
 * has one ending, and otherwise closes the unit and leaves the endings to
 * choose from. A manual step that closes the unit shows its work, its
 * constraints and its checklist here; a finalize step its confirmations.
 */
function ClosingStep({
  pack,
  run,
  state,
  active,
  ticked,
  tick,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
  active: ActiveStep;
  ticked: Set<string>;
  tick: (keys: string[], on: boolean, tally?: string) => void;
}) {
  const { phase, step, index } = active;
  const v = pack.vocabulary;
  // What stands in the way of closing: what the player owes, and what the
  // game is owed. A counter that crossed its threshold used to ride into
  // the next scene from this very button, because only the obligations
  // were counted here and the threshold was a panel further down the page.
  const blocked = run.blockingObligations.length + run.thresholds.length + run.globals.length;
  const points = step.kind === "manual" ? (step.checklist ?? []) : step.kind === "finalizeUnit" ? (step.confirm ?? []) : [];
  const constraints = step.kind === "manual" ? constraintLines(pack, state, step.constrainedBy) : [];
  /*
   * A result the step is held to is shown as a rule above, and the rule
   * carries whatever answers it: the move where the game owes one, the tick
   * where the player is the only one who can say it was honored. Either
   * way the confirmation does not list it again, and a point with nothing
   * left to list is not drawn at all.
   *
   * Which boxes belong to which result, so a tick on a rule is the same
   * tick the confirmation was asking for and the step is satisfied by it.
   * A result two points both show is ticked in both.
   */
  const settling = settlingFor(pack, state, constraints, points);
  const boxesFor = settling.boxes;
  const allTicked = checklistDone(points, pack, state, ticked, settling);
  const label = (step.kind === "manual" || step.kind === "finalizeUnit" ? step.label : undefined) ?? v.finalize;
  return (
    <section className="panel runStep finalize">
      <StepHead phase={phase} label={label} />
      {step.kind === "manual" && step.description && <p className="muted">{step.description}</p>}
      {constraints.length > 0 && (
        <Constraints
          lines={constraints}
          action={(line) => {
            const move = owedAction(pack, run, state)(line);
            if (move) return move;
            // Nothing owed on it: the player's word is what it is waiting
            // for, and this is the box the confirmation would have asked in.
            const boxes = boxesFor.get(`${line.table}/${line.entryId}`) ?? [];
            if (boxes.length === 0 || run.readOnly) return null;
            const on = boxes.every((k) => ticked.has(k));
            return (
              <label className="owningTick">
                <input type="checkbox" checked={on} onChange={() => tick(boxes, !on)} />
                <span>Honored</span>
              </label>
            );
          }}
        />
      )}
      {points.length > 0 && (
        <Checklist
          items={points}
          pack={pack}
          state={state}
          ticked={ticked}
          onToggle={tick}
          settling={settling}
          action={owedAction(pack, run, state)}
        />
      )}
      <div className="padRow stepAction">
        <button
          className="primary big"
          onClick={(e) =>
            blocked > 0 ? nudgeOwed(e.currentTarget) : allTicked ? run.closeAndEnter(phase, index) : nudgeFirstUnticked(e.currentTarget)
          }
        >
          {blocked > 0 ? "Settle what is owed first" : allTicked ? finishWords(pack, step) : "Tick what you honored"}
        </button>
        <button
          className="ghost big"
          disabled={!run.canEnd.ok}
          title={
            !run.canEnd.ok
              ? `Cannot finish yet: ${run.canEnd.reason}`
              : (pack.endings?.length ?? 0) > 1
                ? "Close this and choose how the run ends"
                : undefined
          }
          onClick={(e) =>
            blocked > 0 ? nudgeOwed(e.currentTarget) : allTicked ? run.finish(phase, index) : nudgeFirstUnticked(e.currentTarget)
          }
        >
          Finish
        </button>
      </div>
    </section>
  );
}

function BetweenUnits({ pack, run, state }: { pack: Pack; run: ReturnType<typeof useRun>; state: RunState }) {
  const v = pack.vocabulary;
  const [note, setNote] = useState(state.journal[state.unit] ?? "");
  const [ending, setEnding] = useState<string | null>(null);
  // The note is in the log once the state says so: the button then says
  // Saved and has nothing to do, and typing again makes it Save again.
  const kept = note.trim() !== "" && state.journal[state.unit] === note;
  const keep = () => note.trim() && !kept && run.writeJournal(state.unit, note);
  // A threshold the game reached, or a trigger it arrived at, still waiting
  // to be rolled. The unit closed with one pending and the next one opened
  // over the top of it, so the onward button points at the panel instead.
  // The same answer a deck gets, whose Next carries that roll.
  const held = run.thresholds.length + run.globals.length;

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
              onKeyDown={(e) => e.key === "Enter" && keep()}
              onBlur={keep}
            />
            <button className={kept ? "ghost saved" : "ghost"} disabled={!note.trim() || kept} onClick={keep} aria-live="polite">
              {kept ? "Saved" : "Save"}
            </button>
          </div>
        </>
      )}

      {/* The onward move and its alternative sit together, so the hint reads
          as a caption to the choice rather than a stray note at the margin.
          Not the big button the step cards use: this card is a pause, not
          a step, and the choice below it is as much the point as going on. */}
      <div className="primaryAction">
        <button className="primary" onClick={(e) => (held > 0 ? nudgeOwed(e.currentTarget) : run.enterUnit())}>
          {held > 0 ? "Settle what is owed first" : `Enter ${v.unit.one} ${state.unit + 1}`}
        </button>
        <span className="muted small">
          {state.unit >= pack.unit.min ? countMade(pack, state) : `at least ${pack.unit.min} needed before you can stop`}
        </span>
      </div>

      {!run.canEnd.ok && <p className="muted small">Cannot end yet: {run.canEnd.reason}.</p>}

      {run.canEnd.ok && (
        <div className="orEnd">
          <h3 className="sectionTitle">Or end here</h3>
          <div className="choices">
            {(pack.endings ?? [{ id: "done", label: "End", text: "" }]).map((e) => (
              <button key={e.id} className={`choice ${ending === e.id ? "on" : ""}`} onClick={() => setEnding(e.id)}>
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
        {state.unit} {v.unit.many.toLowerCase()} · {state.subjects.filter((s) => !s.removed).length} {v.subject.many.toLowerCase()}{" "}
        surviving
      </p>
    </section>
  );
}

/**
 * What the unit owes.
 *
 * Everything that is holding the close up, not only what came due earlier:
 * an obligation the pack defers to the close blocked the button and was
 * nowhere on the screen to settle, which left the unit with no way out.
 */
/**
 * What the game owes that is not already in front of the player.
 *
 * A debt incurred by a rule that binds the step in hand is offered on that
 * rule, where the rule is; listing it again underneath was the same thing
 * said twice, with the button on the second one. Anything the step is not
 * held to still needs somewhere to be, and this is it.
 */
function elsewhere(pack: Pack, run: ReturnType<typeof useRun>, state: RunState) {
  const step = run.activeStep?.step;
  const shown = new Set((step ? constraintLines(pack, state, constrainedByOf(step)) : []).map((l) => `${l.table}/${l.entryId}`));
  // And whatever its confirmation lists, which is where a closing step puts
  // what the unit drew.
  const points = step?.kind === "manual" ? (step.checklist ?? []) : step?.kind === "finalizeUnit" ? (step.confirm ?? []) : [];
  for (const point of points.map(pointOf)) {
    if (!point.shows) continue;
    for (const row of evidenceFor(pack, state, point.shows)) shown.add(`${row.table}/${row.entryId}`);
  }
  return run.blockingObligations.filter(
    (o) => !(o.kind === "trigger" && o.ref?.kind === "tableEntry" && shown.has(`${o.ref.table}/${o.ref.entryId}`)),
  );
}

function Obligations({ pack, run, state }: { pack: Pack; run: ReturnType<typeof useRun>; state: RunState }) {
  const v = pack.vocabulary;
  // The engine's word for when a thing comes due, in the pack's own nouns.
  const when = (on: string | undefined): string => {
    const unit = v.unit.one.toLowerCase();
    switch (on) {
      case "immediately":
        return "due now";
      case "onEnterUnit":
        return `due on entering a ${unit}`;
      case "onDeclareSubject":
        return `due once the ${v.subject.one.toLowerCase()} is named`;
      case "afterWork":
        return "due after the work";
      case "onTimerExpired":
        return "due when the clock ran out";
      case "onFinalize":
        return `due before this ${unit} closes`;
      default:
        return on ? `due ${on}` : "owed";
    }
  };
  return (
    <section className="panel owed">
      <h3 className="sectionTitle">Owed</h3>
      {elsewhere(pack, run, state).map((o) => (
        <div key={o.id} className="row owedRow">
          <div>
            <strong>{o.text}</strong>
            <span className="muted small"> · {when(o.on)}</span>
          </div>
          {/* What pressing it does, not whether it has been done: this is
              where the trigger runs, and "Resolve" read as confirming that
              somebody had already seen to it. */}
          <button className="primary" onClick={() => run.resolveObligation(o.id, o.text)}>
            {settleWords(pack, o)}
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
function Thresholds({ pack, run }: { pack: Pack; run: ReturnType<typeof useRun> }) {
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
            {globalWords(pack, g.index)}
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
            {thresholdWords(pack, t.counter, t.index)}
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
                        title={
                          mine
                            ? `${c.name} +${mine.points}${first && ch.awards.length > 1 ? ", first" : ""} - press to take it back`
                            : `${c.name} finished it`
                        }
                        onClick={press}
                      >
                        {mine ? `+${mine.points}` : "·"}
                        {/* A mark in the corner rather than a word beside the
                            score: in the run of the cell it made the button
                            wider than the ones without it, and every cell
                            here is meant to be the same button. */}
                        {mine && first && ch.awards.length > 1 && (
                          <span className="firstMark" aria-hidden="true">
                            ★
                          </span>
                        )}
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

/** "2nd" from 2, "11th" from 11: the teens are the exception the mod-10 rule misses. */
function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Where this run landed against the ones before it, once it has one.
 *
 * The open run's own score is folded in here rather than read from
 * `run.runList`: storage catches up with an ending asynchronously, and the
 * player should not wait on that write to be told where they stand.
 */
export function Scores({ pack, run, state }: { pack: Pack; run: ReturnType<typeof useRun>; state: RunState }) {
  const rows = useMemo((): ScoredRun[] => {
    if (!run.runId) return [];
    const nowMs = Date.now();
    const past = scoresOf(
      pack,
      run.runList.filter((r) => r.runId !== run.runId),
      nowMs,
    );
    const score = scoreOf(pack, state, run.events, nowMs);
    const mine: ScoredRun = { runId: run.runId, name: state.name, endedAt: state.updatedAt, score, text: formatScore(score, pack) };
    return [...past, mine].sort((a, b) => compareScores(a.score, b.score));
  }, [pack, run.runList, run.runId, run.events, state]);

  const mine = rows.find((r) => r.runId === run.runId);
  if (!mine) return null;
  const place = placeOf(rows, mine.runId) ?? rows.length;
  const isBest = bestOf(rows)?.runId === mine.runId;
  const past = rows.filter((r) => r.runId !== mine.runId).slice(0, 5);

  return (
    <SidePanel className="scores" title="Scores">
      <div className="row spread">
        <span>
          <strong>{mine.text}</strong> <span className="muted small">this run</span>
        </span>
        <span className="nudge">
          {isBest && <span className="chip ok">a new best</span>}
          <span className="muted small num">
            {ordinal(place)} of {rows.length}
          </span>
        </span>
      </div>
      {past.map((r) => (
        <div key={r.runId} className="row spread">
          <span className="muted small">
            #{placeOf(rows, r.runId)} {r.name ?? onDay(r.endedAt)}
          </span>
          <span className="muted num">{r.text}</span>
        </div>
      ))}
    </SidePanel>
  );
}

/** Standings, most points first. The moderator can add a late arrival or drop someone. */
/**
 * A tool is on the game.
 *
 * Shown where there is no roster to hang it on, which is every solo run:
 * the one thing a player wants to know before the dice are thrown is
 * whether what they say will actually happen, and the alternative is
 * finding out when it does not.
 */
/**
 * Which games this run is holding the other end of.
 *
 * Named where they say a name. The heading used to read "On the game, a
 * tool is attached" whether one person was playing alone or four were
 * on a roster, which told the one case that matters least and the one
 * that matters most exactly the same thing. A tool that says which seat
 * it is playing is a tool somebody can be told about by name.
 *
 * Decks are not named here any more: the people panel draws one row a
 * person with a mark for the deck, which says whose as well as how many.
 */
function Attached({ tools }: { tools: AttachedTool[] }) {
  const named = tools.map((t) => t.app).filter((a): a is string => Boolean(a));
  const seated = tools.map((t) => t.seat).filter((s): s is string => Boolean(s));
  const whose = seated.length > 0 ? seated.join(", ") : tools.length === 1 ? "your game" : `${tools.length} games`;
  return (
    <SidePanel
      title={
        <>
          On {whose}{" "}
          <span className="muted">{named.length > 0 ? named.join(", ") : tools.length === 1 ? "a tool" : `${tools.length} tools`}</span>
        </>
      }
    >
      <p className="muted small">Listening, so what the dice say happens in the game. Results still read the same with nothing attached.</p>
    </SidePanel>
  );
}

/** The badge a racer carries while their own game is on the other end. */
function ToolChip({ tool }: { tool: AttachedTool }) {
  return (
    <span className="chip tool" title={tool.app ? `${tool.app} is on this player's game` : "A tool is on this player's game"}>
      tool
    </span>
  );
}

function Scoreboard({ run, state, pack, tools }: { run: ReturnType<typeof useRun>; state: RunState; pack: Pack; tools: AttachedTool[] }) {
  const editable = !run.readOnly;
  const [name, setName] = useState("");
  const add = () => {
    run.addContestant(name);
    setName("");
  };
  /** The marks a contestant can be given: contestant-scoped states they do not carry. */
  const marks = (held: string[]) =>
    Object.entries(pack.states ?? {}).filter(([id, def]) => def.scope === "contestant" && !held.includes(id));
  /** The tallies the pack keeps per racer, which is what this board carries for each of them. */
  const theirs = Object.entries(pack.counters ?? {}).filter(([, def]) => def.per === "contestant" && !def.hidden);
  return (
    <SidePanel
      title={
        <>
          Scoreboard <span className="muted">{state.contestants.length} racing</span>
        </>
      }
    >
      {run.standings.length === 0 && <p className="muted small">Nobody on the roster yet.</p>}
      {run.standings.map((s) => (
        <div key={s.contestant.id} className="row spread">
          <span className="contestant">
            <span className="idx">#{s.place}</span> {s.contestant.name}
            {toolFor(tools, s.contestant.name) && <ToolChip tool={toolFor(tools, s.contestant.name)!} />}
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
              <select
                className="chipAdd"
                value=""
                aria-label={`Mark ${s.contestant.name}`}
                onChange={(e) => e.target.value && run.markContestant(s.contestant.id, e.target.value, true)}
              >
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
            {/* Their own tallies, beside their score, and turned here:
                a race with four names has four death counts and the
                trackers below keep only what belongs to the table.
                Shown from nought rather than from the first one, so
                there is something to press before anybody has died. */}
            {theirs.map(([id, def]) => (
              <span key={id} className="chip nudge" title={`${def.label}, for ${s.contestant.name}`}>
                {def.label}
                {editable && (
                  <button
                    className="chipX"
                    title={`One fewer for ${s.contestant.name}`}
                    onClick={() => run.nudgeCounter(id, -1, s.contestant.id)}
                  >
                    −
                  </button>
                )}
                <span className="num">{s.contestant.counters[id] ?? def.initial}</span>
                {editable && (
                  <button
                    className="chipX"
                    title={`One more for ${s.contestant.name}`}
                    onClick={() => run.nudgeCounter(id, 1, s.contestant.id)}
                  >
                    +
                  </button>
                )}
              </span>
            ))}
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
          <input
            className="textInput"
            value={name}
            placeholder="add a contestant"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="ghost tiny" onClick={add} disabled={!name.trim()}>
            Add
          </button>
        </div>
      )}
    </SidePanel>
  );
}

/**
 * The moves on offer, and whose they are.
 *
 * A move is the table's unless the pack says otherwise, and in a solo
 * or co-op run that is the end of it: one button, one press. In a race
 * it is the wrong question. "I died" on a board with four names on it
 * is four different things, and the run cannot know which without being
 * told, so a move the pack marks `per: contestant` is offered once per
 * racer and what it does is recorded against them.
 */
function Moves({ run, pack, state }: { run: ReturnType<typeof useRun>; pack: Pack; state: RunState }) {
  const owed = run.blockingObligations.length;
  // No roster, no question to ask: a per-contestant move in a run with
  // nobody on the board is the table's, the way it always was.
  const racing = run.moderated ? state.contestants : [];
  return (
    <section className="panel">
      <h3 className="sectionTitle">
        {racing.length > 0 ? "Moves" : "Your move"} <span className="muted">optional</span>
      </h3>
      <div className="choices">
        {run.moves.map(({ id, move }) => {
          const held = heldMove(move, owed);
          const why = held ? "Settle what is owed first; this move closes the unit." : undefined;
          const closes = move.finalizes ? `Closes the ${pack.vocabulary.unit.one.toLowerCase()}.` : null;

          if (!perRacer(move, racing)) {
            return (
              <button key={id} className="choice" disabled={held} title={why} onClick={() => run.takeMove(id, move.label)}>
                <strong>{move.label}</strong>
                <span className="muted small">{move.description}</span>
                {closes && <span className="muted small">{closes}</span>}
              </button>
            );
          }

          return (
            <div className="choice perRacer" key={id}>
              <strong>{move.label}</strong>
              <span className="muted small">{move.description}</span>
              {closes && <span className="muted small">{closes}</span>}
              <div className="padRow">
                {racing.map((c) => (
                  <button
                    key={c.id}
                    className="ghost tiny"
                    disabled={held}
                    title={why ?? `${move.label}: ${c.name}`}
                    onClick={() => run.takeMove(id, `${move.label} - ${c.name}`, undefined, c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Who is holding what, this unit.
 *
 * Co-op here is the same-room kind, so nobody is named: people are numbered
 * round the table and the roles walk with them. Shown as a panel rather than a
 * line of text because whoever has just been handed the device needs to find
 * it at a glance.
 */
function Roles({ pack, run, state }: { pack: Pack; run: ReturnType<typeof useRun>; state: RunState }) {
  const v = pack.vocabulary;
  return (
    <SidePanel
      title={
        <>
          At the table <span className="muted">{state.players} players</span>
        </>
      }
    >
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
    </SidePanel>
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
    if (name && subject && name !== subjectName(pack, subject)) onRename(editing.id, name);
    stopEditing();
  };

  return (
    <SidePanel
      title={
        <>
          {v.subject.many} <span className="muted">the board</span>
        </>
      }
    >
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
                  // not be read as clicking away, otherwise the edit is
                  // discarded a moment before the button it landed on fires.
                  if (!e.currentTarget.closest(".subjectRow")?.contains(e.relatedTarget)) {
                    stopEditing();
                  }
                }}
              />
            ) : !s.removed ? (
              <button className="renameTrigger" title="Click to rename" onClick={() => setEditing({ id: s.id, draft: s.name ?? "" })}>
                {subjectName(pack, s)}
              </button>
            ) : (
              <strong>{subjectName(pack, s)}</strong>
            )}
            {/* The declared type beside the name, unless the name already says it. */}
            {s.type && s.type !== s.name ? (
              <span className="muted subjectType"> · {s.type}</span>
            ) : (
              !s.type && <span className="muted subjectType"> · undeclared</span>
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
                    <button
                      className="chipX"
                      title="Take this state off: a correction, written to the log"
                      onClick={() => onCorrect(s.id, id, false)}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {/* Results that reached this one without leaving a state: worn here, with the text on hover. */}
              {hitsOn(pack, state, s.id).map((h, i) => (
                <span key={`hit-${i}`} className="chip heat" title={`${v.unit.one} ${h.unit}, ${h.table}: ${h.text}`}>
                  {h.table}
                </span>
              ))}
              {onCorrect && !s.removed && missing(s.states).length > 0 && (
                <select
                  className="chipAdd"
                  value=""
                  aria-label={`Mark ${v.subject.one} ${s.id}`}
                  title="Put a state on it by hand, a correction, written to the log"
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
            title={editing?.id === s.id ? "Save the new name" : "Copy the name with its states, to paste onto the thing itself"}
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
    </SidePanel>
  );
}

/**
 * The tallies this run shows: not the ones the pack hides, and not the
 * ones kept per racer while there is a board to keep them on.
 *
 * A tally kept per racer belongs on the scoreboard, next to the name it
 * belongs to. Keeping a run-wide copy here as well showed a nought beside
 * somebody's two, and there was nothing anybody could do with either.
 * Alone, there is no board and it is the run's as usual.
 *
 * Read by the panel below and by the offer a deck is given, which have to
 * list the same tallies.
 */
function shownCounters(pack: Pack, state: RunState) {
  const racing = state.contestants.length > 0;
  return Object.entries(pack.counters ?? {}).filter(([, c]) => !c.hidden && !(racing && c.per === "contestant"));
}

/** The dials and the tallies a deck may turn, as the panel below lists them. */
export function trackersOf(pack: Pack, state: RunState | null): OfferInput["trackers"] {
  if (!state) return [];
  return [
    ...Object.entries(pack.resources ?? {}).map(([id, def]) => ({
      id,
      kind: "resource" as const,
      label: def.label,
      value: state.resources[id] ?? def.initial,
      max: def.max ?? null,
    })),
    ...shownCounters(pack, state).map(([id, def]) => ({
      id,
      kind: "counter" as const,
      label: def.label,
      value: state.counters[id] ?? def.initial,
      max: def.max ?? null,
    })),
  ];
}

/**
 * The clock a deck's Pause, Resume and Stop act on: the one running, or
 * else one paused and waiting to be started again. A stopped clock is a
 * record of how long something took and there is nothing left to press.
 */
export function clockOf(state: RunState | null): OfferInput["clock"] {
  if (!state) return null;
  const ticking = liveClocks(state);
  const it = ticking.find((c) => c.status === "running") ?? ticking.find((c) => c.status === "paused");
  return it ? { id: it.id, label: it.label, status: it.status } : null;
}

/**
 * The dials and the tallies, side by side.
 *
 * A resource is a setting somebody chose and a counter is a tally of
 * what happened, and both are turned by hand from here. The dials had
 * no way to be turned at all: a resource with no bar and no boxes drew
 * its number and nothing else, so "Targets per stretch 1 / 4" was a
 * statement rather than a control, and the only way to change it was
 * to be asked at the start of the run.
 */
function Trackers({
  pack,
  state,
  onNudge,
  onTurn,
}: {
  pack: Pack;
  state: RunState;
  onNudge?: (counter: string, by: number) => void;
  onTurn?: (resource: string, by: number) => void;
}) {
  const resources = Object.entries(pack.resources ?? {});
  const counters = shownCounters(pack, state);
  const cards = state.hand;
  if (resources.length + counters.length + cards.length === 0) return null;

  return (
    <SidePanel title="Trackers">
      {resources.map(([id, def]) => {
        const value = state.resources[id] ?? def.initial;
        const max = def.max ?? Math.max(value, 10);
        const step = def.step ?? 1;
        const low = value <= (def.min ?? 0);
        const high = def.max !== undefined && value >= def.max;
        // What the dial would read after the press, said with its own
        // name. "Up to 11" was the honest arithmetic and the wrong
        // sentence: it reads as a ceiling, and on a dial that goes to
        // sixty it read as the wrong ceiling.
        const would = (by: number) => {
          const next = Math.max(def.min ?? 0, def.max !== undefined ? Math.min(def.max, value + by) : value + by);
          return `${next} ${def.label.toLowerCase()}`;
        };
        return (
          <div key={id} className="tracker">
            <div className="trackerHead">
              <strong title={def.description}>{def.label}</strong>
              <span className="nudge">
                {onTurn && (
                  <button
                    className="ghost tiny"
                    disabled={low}
                    aria-label={would(-step)}
                    title={would(-step)}
                    onClick={() => onTurn(id, -step)}
                  >
                    −
                  </button>
                )}
                <span className="muted num">
                  {value}
                  {def.max !== undefined && ` / ${def.max}`}
                </span>
                {onTurn && (
                  <button
                    className="ghost tiny"
                    disabled={high}
                    aria-label={would(step)}
                    title={would(step)}
                    onClick={() => onTurn(id, step)}
                  >
                    +
                  </button>
                )}
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
              <button className="ghost tiny" title="One fewer, a correction, written to the log" onClick={() => onNudge(id, -1)}>
                −
              </button>
            )}
            <span className="muted num">{state.counters[id] ?? def.initial}</span>
            {onNudge && (
              <button className="ghost tiny" title="One more: a correction, written to the log" onClick={() => onNudge(id, 1)}>
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
    </SidePanel>
  );
}

function Flow({
  pack,
  run,
  state,
  open,
  onOpen,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
  /** Whether the list is showing; on a phone that is a plane of its own. */
  open: boolean;
  onOpen: () => void;
}) {
  const strip = flowStrip(run.activePhases, run.activeStep, (p) => phaseSkipped(pack, state, p));
  // The same reading the watcher's page is built from, from the same call,
  // so a player and somebody watching over their shoulder are looking at
  // one thing rather than two things that drift.
  const phases = unitPhases(pack, state);
  // What the step in hand is being held to, so a result that is still
  // biting is marked where it landed and not only in the card.
  const holding = useMemo(
    () => new Set(run.activeStep ? constraintsFor(pack, state, constrainedByOf(run.activeStep.step)) : []),
    [pack, state, run.activeStep],
  );
  const listed =
    phases.length > 0
      ? phases
      : run.activePhases.map((p) => ({ id: p.id, label: p.label, state: "todo" as const, why: undefined, results: undefined }));
  return (
    <section className={`stageFlow${open ? " open" : ""}`}>
      {strip && (
        <button type="button" className="flowNow" aria-expanded={open} onClick={onOpen}>
          <span className="idx">
            {strip.index} of {strip.total}
          </span>
          <strong>{strip.label}</strong>
          {strip.next && <span className="muted">then {strip.next}</span>}
        </button>
      )}
      <h3 className="sectionTitle">This {pack.vocabulary.unit.one.toLowerCase()}</h3>
      <ol className="flow">
        {listed.map((phase, i) => {
          // Out of play this unit: grayed, with the reason under the name,
          // so a phase that only happens in the first room reads as skipped
          // for a reason rather than as broken. A dash on its own was read
          // as broken.
          const skipped = phase.state === "skipped";
          const found = skipped ? run.activePhases.find((p) => p.id === phase.id) : undefined;
          return (
            <li
              key={phase.id}
              className={phase.state === "todo" ? "" : phase.state}
              aria-current={phase.state === "current" ? "step" : undefined}
              title={found ? (describeSkip(pack, found) ?? undefined) : undefined}
            >
              <span className="idx">{phase.state === "current" ? "▸" : skipped ? "-" : i + 1}</span>
              <span>
                {phase.label}
                {phase.why && <span className="why">{phase.why}</span>}
                {(phase.results ?? []).map((r, k) => (
                  <PhaseLanded key={k} result={r} holding={holding} />
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * One thing a phase produced.
 *
 * Its own table's result is its text; one from a table the phase set off
 * names the table first, and where it hit a piece it carries the log's
 * color for a hit. A constraint the step in hand is still being held to is
 * marked, because that is the one worth seeing while the work is happening
 * rather than after it.
 */
function PhaseLanded({ result, holding }: { result: PhaseResult; holding: Set<string> }) {
  const text = resultText(result);
  const from = typeof result === "string" ? null : result;
  const hit = from?.hit !== null && from?.hit !== undefined;
  // Name the piece it reached. "hit #3" makes a reader go and find out
  // which piece that was, on a board that is a tap away rather than beside
  // them; a snapshot written before the name was carried still has only
  // the number.
  const reached = hit ? (from?.hitName ?? `#${from!.hit}`) : null;
  const held = holding.has(text);
  const cls = ["result", held ? "constrains" : "", hit ? "heat" : "", from?.table ? "chained" : "", from?.declared ? "declared" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} title={held ? "The game has already had its say: this holds over the step in hand" : undefined}>
      {from?.table && (
        <span className="head">
          {from.table}
          {reached ? ` - hit ${reached}` : ""}
          {": "}
        </span>
      )}
      {text}
    </span>
  );
}

function Timeline({ pack, state }: { pack: Pack; state: RunState }) {
  const total = state.outcomes.length;
  // Which end first, and how much: kept on this device, read once here.
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
  const lines = logLines(state.outcomes, order, limit);
  return (
    <section className="log">
      <div className="logHead">
        <h3 className="sectionTitle">
          The log
          {lines.length < total && (
            <span className="muted">
              {" "}
              · the last {lines.length} of {total}
            </span>
          )}
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
        {/* Numbered from the start whichever way it reads, so a line's number
            still says how far in it was. */}
        {lines.map(({ index, outcome: o }) => {
          const table = pack.tables[o.table];
          const entry = table?.entries.find((e) => e.id === o.entryId);
          const hit = o.targetSubject !== null;
          return (
            <li key={index} className={hit ? "heat" : ""}>
              <span className="idx">{index}</span>
              <div>
                <span className="where">
                  {pack.vocabulary.unit.one} {o.unit}, {table?.title ?? o.table}
                  {hit && ` - ${hitLabel(pack, state, o.targetSubject!)}`}
                  {/* Whose, where it was drawn for one of them: without
                      it the log reads as though the whole table got it. */}
                  {o.contestant && ` - ${state.contestants.find((c) => c.id === o.contestant)?.name ?? o.contestant}`}
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
 * The run's own name, in the bar. Click to change it; empty clears it. A run
 * without one is offered the chance rather than shown a blank.
 */
function RunName({ name, noun, onRename }: { name: string | null; noun: string; onRename: (name: string) => void }) {
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
