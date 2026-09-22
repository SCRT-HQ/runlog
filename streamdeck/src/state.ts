import type { SetupGroup } from "@runlog/rules-schema";

/**
 * Everything the plugin decides, with nothing from the SDK in it.
 *
 * A key face is a function of what the plugin knows: whether it is
 * signed in, whether its socket is open, which runs are held, which is
 * pinned, and what that run last published. `reduce` moves the state on
 * one event at a time; the `*Face` functions read it. Keeping them pure
 * is what lets the twelve states a key can be in have a test each.
 */

/**
 * What a deck may press, right now, in the pack's own words.
 *
 * Copied from `apps/web/src/run/offer.ts`: the plugin does not import
 * from `apps/web`, so this shape is mirrored rather than shared.
 */
export interface Offer {
  seq: number;
  /**
   * The one press the run is waiting on.
   *
   * `owed` is a threshold or a global roll the run owes, which a deck
   * presses like any other primary: the page decides what it turns into.
   */
  primary: { id: "roll" | "carry-on" | "close" | "enter" | "owed"; label: string; kind: string } | null;
  moves: Array<{ id: string; label: string }>;
  undo: { what: string } | null;
  /** Why a deck cannot press this, in words a key face can carry. */
  needsPage: string | null;
  presets: Array<{ kind: string; label: string; suggestions?: string[]; items?: number }>;
  /**
   * The setups the run could hand out, empty where the run names no tool or is
   * not live, and absent from an older page's offer entirely.
   *
   * `group` says what kind each one is, so a key can cycle the loadouts
   * without the warps in among them. Absent from an older page, which is
   * why a key that filters treats a setup with no group as one that
   * matches nothing rather than one that matches everything: a page too
   * old to say should not fill a Warp key with loadouts.
   */
  setups?: Array<{ id: string; title: string; group?: SetupGroup; standout?: boolean }>;
  /**
   * The setups the run could send a tool once, without touching the run's
   * own setup - empty where the run names no tool or is not live, and
   * absent from an older page's offer entirely.
   */
  commands?: Array<{ id: string; title: string; group?: SetupGroup; standout?: boolean }>;
  /**
   * The counters and resources this run will take a change to, from a deck
   * as from the page - absent from an older page's offer entirely.
   */
  trackers?: Array<{ id: string; kind: "counter" | "resource"; label: string; value: number; max: number | null }>;
  /**
   * The clock a deck may pause, resume or stop, or nothing where the run
   * keeps none - absent from an older page's offer entirely.
   */
  clock?: { id: string; label: string; status: "running" | "paused" | "done" } | null;
  /** Whether the run is rolling for itself rather than waiting on a press, or absent from an older page's offer. */
  autoRoll?: boolean;
  /** How the run would end if it were finished now, or nothing while it cannot be, or absent from an older page's offer. */
  ending?: { label: string } | null;
}

export type SessionState = "none" | "expired" | "ok";
export type SocketState = "closed" | "connecting" | "open";
/**
 * A run the account has open.
 *
 * `runs` on the state is the ones a device is holding, which are the ones
 * a deck can press. `known` is every open run the account has, held or
 * not: it is what a picker offers, and it is what lets a deck be set on a
 * run before there is a socket or a page for it.
 */
export interface OpenRun {
  id: string;
  /** Which pack the run is of, for a key set to one pack. Absent from an older page or server. */
  packId?: string;
  name?: string;
  packTitle?: string;
}
export type HeldRun = OpenRun;
export interface Snapshot {
  /** The run as the server knows it, which is where the pack's id and title travel. */
  run?: { id?: string; packId?: string; packTitle?: string };
  unit?: number;
  words?: { unit: string };
  score?: { text: string };
  latest?: { text: string } | null;
  clocks?: Array<{ id: string; label: string; kind: "timer" | "stopwatch"; seconds: number | null; status: string; elapsedMs: number }>;
  standings?: Array<{ name: string; points: number; place: number }>;
  counters?: Array<{ id: string; label: string; value: number }>;
  resources?: Array<{ id: string; label: string; value: number; max: number | null }>;
  at?: string;
  offer?: Offer;
  /**
   * The pack's own moves and numbers, whatever the run is waiting on, for a
   * deck laying out keys. Absent from an older page, which leaves the offer.
   */
  layout?: {
    moves: Array<{ id: string; label: string }>;
    counters: Array<{ id: string; label: string }>;
    resources: Array<{ id: string; label: string }>;
  };
}
export interface DeckState {
  session: SessionState;
  /** Whether the streamer has switched the deck on. No socket while false. */
  on: boolean;
  /** Whether the last time it went off, it was the idle timer rather than a press. */
  idleOff: boolean;
  socket: SocketState;
  runs: HeldRun[];
  /** Every open run the account has, held or not. Read over HTTP, so it survives a closed socket. */
  known: OpenRun[];
  any: boolean;
  pinned: string | null;
  attached: string | null;
  snapshot: Snapshot | null;
  flash: { ref: string; ok: boolean; say?: string; until: number } | null;
}
/**
 * How a face is drawn, by what the key is for rather than by how it feels.
 *
 * `live` is a key that moves the run - Next, Roll, Press - and it is the
 * only one that takes the celadon edge. `undo` is the same lit face with
 * the kiln edge, because taking a result back is the consequence the
 * second accent is for. `readout` is a Metric key, which is a number
 * rather than a button: the app's own ground, a hairline, and lit ink.
 * `deck` is the furniture - Run, Open, Install a profile - lit, but
 * without an accent claiming it does something to the run. `link` is the
 * connection itself, blue while it is up, and `end` is the key that closes
 * the run, on a wine ground nothing else wears: both were `deck` and were
 * the hardest keys to pick out of a full deck at a glance. `dim` and
 * `refuse` are states rather than families and belong to every key.
 */
export type Tone = "live" | "dim" | "refuse" | "undo" | "readout" | "deck" | "link" | "end";
export interface Face {
  title: string;
  tone: Tone;
  when?: string;
  /** 0-1, set only for a running timer clock so a dial's indicator can draw it. */
  fraction?: number;
}
export type PressTarget = { kind: "move"; id: string } | { kind: "answer"; preset: string; value: string };
/** A press target as it may still sit on disk: an older key's `kind: "roll"`, or any other shape the plugin no longer reads. */
export type StoredPressTarget = PressTarget | { kind: string };
/** Whether a stored press target is still a shape the plugin knows how to read. */
export function isPressTarget(target: StoredPressTarget): target is PressTarget {
  return target.kind === "move" || target.kind === "answer";
}
export type MetricField = "score" | "unit" | "clock" | "latest" | "leader" | { counter: string } | { resource: string };
/** What a short press of an adjustable Metric key does: step it up by one, or put it at a number. */
export type MetricPress = { kind: "step" } | { kind: "set"; value: number };
/** The answer form of a press, which is how everything but the primary and undo goes over the wire. */
export type AnswerPress = { press: "answer"; answer: Record<string, unknown> };
export type DeckEvent =
  | { t: "session"; state: SessionState }
  | { t: "on"; on: boolean; idle?: boolean }
  | { t: "socket"; state: SocketState }
  | { t: "runs"; runs: HeldRun[]; any: boolean }
  | { t: "known"; runs: OpenRun[] }
  | { t: "pin"; id: string | null }
  | { t: "snapshot"; snapshot: Snapshot }
  | { t: "drove"; ref: string; ok: boolean; say?: string; seq?: number }
  | { t: "tick" };

/** How long a key says what just happened before going back to what it was saying. */
export const FLASH_MS = 3000;

/** How long a connection that is holding nothing waits before closing itself. */
export const IDLE_OFF_MS = 30 * 60_000;

export function initial(): DeckState {
  return {
    session: "none",
    on: false,
    idleOff: false,
    socket: "closed",
    runs: [],
    known: [],
    any: false,
    pinned: null,
    attached: null,
    snapshot: null,
    flash: null,
  };
}

export function attachedRun(state: DeckState): string | null {
  if (state.pinned) return state.runs.some((r) => r.id === state.pinned) ? state.pinned : null;
  return state.runs.length === 1 ? state.runs[0]!.id : null;
}

export function reduce(state: DeckState, event: DeckEvent, now: number): DeckState {
  switch (event.t) {
    case "session":
      return event.state === "ok" ? { ...state, session: "ok" } : { ...initial(), session: event.state, pinned: state.pinned };
    case "on":
      // Going off is a full stop: no socket, nothing held, nothing to draw
      // a number from. The pin is a preference, not a holding, and stays.
      return event.on
        ? { ...state, on: true, idleOff: false }
        : { ...state, on: false, idleOff: event.idle === true, socket: "closed", runs: [], attached: null, snapshot: null };
    case "socket":
      return event.state === "open"
        ? { ...state, socket: "open" }
        : { ...state, socket: event.state, runs: [], attached: null, snapshot: null };
    case "known":
      // What the account has open, which a closed socket does not change.
      // Only the holding does, and that is `runs`.
      return { ...state, known: event.runs };
    case "runs": {
      const next = { ...state, runs: event.runs, any: event.any };
      const attached = attachedRun(next);
      // A run that went away takes its numbers with it; a run that is
      // still here keeps them until the next snapshot lands.
      return { ...next, attached, snapshot: attached === state.attached ? state.snapshot : null };
    }
    case "pin": {
      const next = { ...state, pinned: event.id };
      const attached = attachedRun(next);
      return { ...next, attached, snapshot: attached === state.attached ? state.snapshot : null };
    }
    case "snapshot":
      return { ...state, snapshot: event.snapshot };
    case "drove": {
      const flash = { ref: event.ref, ok: event.ok, ...(event.say ? { say: event.say } : {}), until: now + FLASH_MS };
      // A `drove` verdict is the freshest seq source: the next press
      // should not carry a seq gone stale while it was in flight.
      if (event.seq === undefined || !state.snapshot?.offer) return { ...state, flash };
      return { ...state, flash, snapshot: { ...state.snapshot, offer: { ...state.snapshot.offer, seq: event.seq } } };
    }
    case "tick": {
      const expired = state.flash !== null && state.flash.until <= now;
      // Controller ruling 3: a dial redraws every second while a clock is
      // running, so its remaining time keeps moving between snapshots. An
      // idle deck has nothing that changes on the tick, so it stays the
      // same object and nothing redraws.
      const running = state.snapshot?.clocks?.some((c) => c.status === "running") ?? false;
      if (!expired && !running) return state;
      return expired ? { ...state, flash: null } : { ...state };
    }
  }
}

/** What a key says about the run once the deck is signed in and switched on. */
function held(state: DeckState): Face | null {
  if (state.socket !== "open") return { title: "Offline", tone: "dim" };
  if (state.pinned && !state.runs.some((r) => r.id === state.pinned)) {
    // Pinned and not held is two different things, and saying the wrong
    // one strands a deck. A run the account still has open is waiting for
    // a page to take it up; one the account no longer has is over, and the
    // way out of that is written on the key, because the Run key is the
    // only thing that can clear a pin and it looks dead from here.
    const waiting = state.known.find((r) => r.id === state.pinned);
    return waiting
      ? { title: `Waiting for ${runName(waiting)}`, tone: "dim", when: "open the run" }
      : { title: "That run has ended", tone: "dim", when: "press Run" };
  }
  if (state.runs.length === 0) return state.any ? { title: "No run open", tone: "dim" } : { title: "Not synced", tone: "dim" };
  if (!state.attached) return { title: "Pick a run", tone: "dim" };
  return null;
}

/** The state every key shares before any of them has something of its own to say. */
function common(state: DeckState): Face | null {
  if (state.session === "none") return { title: "Sign in", tone: "dim" };
  if (state.session === "expired") return { title: "Sign in again", tone: "dim" };
  // A key that depends on the connection says to make it first: the state
  // on top, the thing to do about it beneath.
  if (!state.on) return { title: "Not connected", tone: "dim", when: "press Connect" };
  return held(state);
}

/** What to call a run on a key: its own name, else its pack, else its id. */
export function runName(run: OpenRun): string {
  return run.name ?? run.packTitle ?? run.id;
}

/** The run a deck is following, named, or nothing. */
function attachedName(state: DeckState): Face | null {
  const run = state.runs.find((r) => r.id === state.attached);
  if (!run) return null;
  return { title: runName(run), tone: "deck", ...(run.packTitle && run.name ? { when: run.packTitle } : {}) };
}

/**
 * The Connect key, which reports the connection rather than the run behind it.
 *
 * It is the one key that has something to say while the deck is off, so it
 * skips the "Not connected" every other key stops at and names the state it
 * is actually in - down by choice, down by the idle timer, or on its way up.
 * Once the socket is open it says **Disconnect**, one press away from off -
 * which run that carries, if any, is the Run key's business, not this one's.
 *
 * The blue ground is the switch: the key is dim while the deck is off and
 * lights as soon as the streamer has turned it on, so whether the deck is
 * connected reads across the room without reading the word.
 */
export function connectFace(state: DeckState): Face {
  if (state.session === "none") return { title: "Sign in", tone: "dim" };
  if (state.session === "expired") return { title: "Sign in again", tone: "dim" };
  if (!state.on) return { title: "Connect", tone: "dim", when: state.idleOff ? "went idle" : undefined };
  if (state.socket !== "open") return { title: "Connecting", tone: "link" };
  return { title: "Disconnect", tone: "link" };
}

/**
 * When a connection that is holding nothing should close itself.
 *
 * `since` is when it last had nothing to follow. Null means the clock is not
 * running at all - a deck following a live run never times out, however long
 * the stream goes, and a deck that is off or still dialing has nothing to
 * give up on.
 */
export function idleDeadline(state: DeckState, since: number): number | null {
  if (!state.on || state.socket !== "open" || state.runs.length > 0) return null;
  return since + IDLE_OFF_MS;
}

function flashed(state: DeckState): Face | null {
  if (!state.flash || state.flash.ok) return null;
  return { title: state.flash.say ?? "No", tone: "refuse" };
}

/** What the follow key was told about decisions. Re-exported by `actions/next.ts`. */
export type NextSettings = { stop?: boolean };

/**
 * The decision the follow key takes for the streamer, or nothing.
 *
 * A checklist first, then a declaration with something to suggest: the two
 * the page publishes as presets. Placing the key and leaving *Stop at
 * decisions* unticked is the streamer choosing to skip the reading, which
 * is the rule `apps/web/src/run/handsFree.ts` asks for - a decision is
 * skipped only where somebody chose to skip it.
 */
function decision(offer: Offer, settings: NextSettings): Offer["presets"][number] | null {
  if (settings.stop) return null;
  const list = offer.presets.find((p) => p.kind === "checklist");
  if (list) return list;
  return offer.presets.find((p) => p.kind === "declareSubject" && (p.suggestions?.[0] ?? "") !== "") ?? null;
}

/** What one press of the follow key sends, or nothing for it to send. */
export function nextPress(
  state: DeckState,
  settings: NextSettings,
): { press: "primary" } | { press: "answer"; answer: Record<string, string> } | null {
  const offer = state.snapshot?.offer;
  if (!offer) return null;
  if (offer.primary) return { press: "primary" };
  const d = decision(offer, settings);
  if (!d) return null;
  // The words the page takes for each preset, from `takePress.ts`.
  return d.kind === "checklist"
    ? { press: "answer", answer: { ticks: "all" } }
    : { press: "answer", answer: { subject: d.suggestions![0]! } };
}

/**
 * What the follow key always says underneath, whatever it is offering.
 *
 * The line beneath a title moves with the run on every other key, which
 * left this one blank as often as not. It is the key's own name instead:
 * on a deck of twelve, the streamer needs to know which key this is more
 * than they need the decision's label, which the page is already showing.
 */
const NEXT_WHEN = "Next action";

export function nextFace(state: DeckState, settings: NextSettings): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim", when: NEXT_WHEN };
  if (offer.primary) return { title: offer.primary.label, tone: "live", when: NEXT_WHEN };
  // What the key would take, in the page's own words: the checklist's
  // button, or the first name it would declare.
  const d = decision(offer, settings);
  if (d?.kind === "checklist") return { title: d.label, tone: "live", when: NEXT_WHEN };
  if (d) return { title: d.suggestions![0]!, tone: "live", when: NEXT_WHEN };
  return { title: offer.needsPage ?? "Nothing to press", tone: offer.needsPage ? "refuse" : "dim", when: NEXT_WHEN };
}

export function pressFace(state: DeckState, target: StoredPressTarget): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  // What a move key says underneath while it has nothing to press, so a
  // dim key is not four words about the run with nothing saying which key
  // it is. The pack's own layout names every move, gated or not; a page
  // too old to publish one leaves the key's own name.
  const move = isPressTarget(target) && target.kind === "move" ? target.id : null;
  const named = move === null ? undefined : (state.snapshot?.layout?.moves.find((x) => x.id === move)?.label ?? "Press");
  if (!offer) return { title: "Loading…", tone: "dim", ...(named ? { when: named } : {}) };
  if (!isPressTarget(target)) return { title: "Set up", tone: "dim" };
  if (target.kind === "move") {
    const m = offer.moves.find((x) => x.id === target.id);
    return m ? { title: m.label, tone: "live" } : { title: "Not on offer", tone: "dim", when: named };
  }
  const p = offer.presets.find((x) => x.kind === target.preset);
  return p ? { title: target.value, tone: "live", when: p.label } : { title: target.value, tone: "dim", when: "Not now" };
}

/** What the dedicated Roll key says: the waiting roll, in its own words, or nothing to roll. */
export function rollFace(state: DeckState): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim", when: "Roll" };
  return offer.primary?.id === "roll"
    ? { title: offer.primary.label, tone: "live", when: "Roll" }
    : { title: "Nothing to roll", tone: "dim", when: "Roll" };
}

/** What the setup key says: what it applies and hands out, whether that is on offer, or nothing chosen at all. */
export function setupFace(state: DeckState, setup?: { id: string; title: string }): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  if (!setup) return { title: "Set up", tone: "dim", when: "Apply setup" };
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim", when: "Apply setup" };
  // `?? []`: an older page's offer may not name any setups at all.
  return (offer.setups ?? []).some((s) => s.id === setup.id)
    ? { title: setup.title, tone: "deck", when: "Apply setup" }
    : { title: setup.title, tone: "dim", when: "Not here" };
}

/**
 * What kind a setup on offer is, for a page that did not say.
 *
 * A page older than the groups sends an id and a title and nothing else.
 * Excluding those outright was the first thing this did, on the reasoning
 * that filling a key labelled Warp with loadouts is worse than a key that
 * admits it cannot tell. That reasoning was right about the Warp key and
 * wrong about everything else: it left every cycling key on the deck
 * reading "None here" against any page that had not deployed yet, which is
 * every page for as long as it takes a release to go out.
 *
 * So the title decides, the way it does in `seen.ts` and in the profile
 * generator. A `Warp` prefix is a warp, and the rest are loadouts: on an
 * older page the Loadout key cycles everything and the others are empty,
 * which is honest about what such a page can tell us and still leaves the
 * deck working.
 */
function kindOf(s: SetupOnOffer): SetupGroup {
  return s.group ?? (s.title.startsWith("Warp") ? "warp" : "loadout");
}

/** The setups on offer of one kind, in the order a cycling key moves through them. */
export function setupsOfGroup(state: DeckState, group: SetupGroup, from: "setups" | "commands" = "setups"): SetupOnOffer[] {
  return (state.snapshot?.offer?.[from] ?? []).filter((s) => kindOf(s) === group);
}

/** What a Setup key set to a whole group rather than one file says. */
export function cyclingSetupFace(state: DeckState, group: SetupGroup, at: number): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim", when: GROUP_WORDS[group] };
  const list = setupsOfGroup(state, group);
  if (list.length === 0) return { title: "None here", tone: "dim", when: GROUP_WORDS[group] };
  const i = ((at % list.length) + list.length) % list.length;
  // The count is on the key because a cycling key is the one key where a
  // hand needs to know how far round it has got.
  return { title: list[i]!.title, tone: "deck", when: `${GROUP_WORDS[group]} ${i + 1}/${list.length}` };
}

/** What each group is called on a key. */
export const GROUP_WORDS: Record<SetupGroup, string> = {
  loadout: "Loadout",
  items: "Items",
  unlocks: "Unlocks",
  warp: "Warp",
  effects: "Effects",
};

/** One setup as a run offers it to a deck. */
export type SetupOnOffer = { id: string; title: string; group?: SetupGroup };

/** What the Command key says: the setup it would send the tool once, whether that is on offer, or nothing chosen at all. */
export function commandFace(state: DeckState, command?: { id: string; title: string }): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  if (!command) return { title: "Set up", tone: "dim", when: "Command" };
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim", when: "Command" };
  // `?? []`: an older page's offer may not name any commands at all.
  return (offer.commands ?? []).some((x) => x.id === command.id)
    ? { title: command.title, tone: "live", when: "Send to tool" }
    : { title: command.title, tone: "dim", when: "Not here" };
}

export function undoFace(state: DeckState): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const undo = state.snapshot?.offer?.undo;
  // The key says "Undo" either way: what it would take back is the run's
  // business, and a key too small to read it is no help at the table.
  return undo ? { title: "Undo", tone: "undo" } : { title: "Undo", tone: "dim" };
}

/**
 * Where the Open key points, chosen in its settings.
 *
 * Every one of them is a page. Handing the Stream Deck app a profile to
 * import was on this list once; Install a profile is a key of its own, and
 * a picker never offers what a dedicated key does.
 */
export type OpenTarget = "run" | "guide" | "rules" | "newrun" | "dock";

/** What each page is called on the key, the guide aside. */
const OPEN_LABELS: Record<Exclude<OpenTarget, "guide">, string> = {
  run: "Open the run",
  rules: "Rules",
  newrun: "A new run",
  dock: "The dock",
};

/**
 * What the Open key says: the page it would put in front of the streamer.
 *
 * The guide is the one target that needs nothing - no account, no
 * connection, no run - so it skips the gating every other key stops at.
 * The rest name something the deck is holding, so they say what is missing
 * the way the rest of the deck does.
 *
 * A key set to a target this no longer reads, which on a profile installed
 * before the profile hand-over moved to its own key is `profile`, says
 * what an unset one says rather than drawing nothing at all.
 */
export function openFace(state: DeckState, target?: OpenTarget): Face {
  if (!target || (target !== "guide" && !Object.hasOwn(OPEN_LABELS, target))) return { title: "Set up", tone: "dim" };
  if (target === "guide") return { title: "Guide", tone: "deck", when: "in a browser" };
  // `newrun` opens `/create`, which needs no run to already be held, so it
  // is answered beside `guide` rather than waiting on `common()`.
  if (target === "newrun") return { title: OPEN_LABELS.newrun, tone: "deck", when: "in a browser" };
  const c = common(state);
  if (c) return c;
  return { title: OPEN_LABELS[target], tone: "deck", when: "in a browser" };
}

/**
 * The flash an Install key raises for itself, which no other key answers.
 *
 * A flash is normally the server's verdict on a press and carries the ref
 * the press went out under. This one is the deck talking to itself, so it
 * takes a ref of its own. Two things keep it to the one key that raised it:
 * it is marked as having gone fine, and {@link flashed} speaks only for a
 * refusal, so nothing else on the deck says a word about it; and the ref
 * names the key that was pressed, so a second Install key set to another
 * pack is not made to say what happened on the first.
 */
export function importedAsCopy(actionId: string): string {
  return `imported-as-copy:${actionId}`;
}

/**
 * The other flash an Install key raises for itself: a shipped profile.
 *
 * A pack the plugin ships a profile for is switched to rather than built
 * and handed over, so nothing is imported and the key would otherwise look
 * as though the press did nothing. Same shape as {@link importedAsCopy}:
 * marked as having gone fine, and named after the key that was pressed.
 */
export function switchedToShipped(actionId: string): string {
  return `switched-to-shipped:${actionId}`;
}

/**
 * What the Install a profile key says: the pack it would build one for.
 *
 * It asks nothing of the run. The pack is picked in the key's settings and
 * fetched off the account, so a deck that is following nothing at all still
 * has something to press, and the key says which pack it would hand over.
 *
 * After a hand-over for a pack that already had a profile, the key that was
 * pressed says so for three seconds. The Stream Deck app does not replace a
 * profile it already has: it keeps both and calls the second one "copy",
 * and this key is the only place the streamer would hear about it. `on` is
 * that key's own id, which is what tells its flash from another one's.
 *
 * A pack the plugin ships a profile for says so instead: the deck was put
 * on the profile in the package and nothing was imported.
 */
export function installFace(state: DeckState, pack?: { id: string; title: string }, on?: string): Face {
  if (on !== undefined && state.flash?.ref === importedAsCopy(on)) return { title: "Imported as a copy", tone: "refuse" };
  if (on !== undefined && state.flash?.ref === switchedToShipped(on)) return { title: "Installed from the plugin", tone: "deck" };
  if (!pack) return { title: "Set up", tone: "dim" };
  return { title: pack.title, tone: "deck", when: "to import" };
}

/**
 * Which run the deck is on, or which it will be on.
 *
 * The one key besides Connect with something to say before the socket is
 * up. Choosing the run to connect to is only worth doing if the choice can
 * be seen and changed while the deck is off, so this skips the "Not
 * connected" and the "Offline" every other key stops at and names what a
 * press of Connect would attach to.
 */
export function runFace(state: DeckState): Face {
  if (state.session !== "ok") return common(state)!;
  if (!state.on || state.socket !== "open") {
    const when = state.on ? "connecting" : "on connect";
    const chosen = state.known.find((r) => r.id === state.pinned);
    if (chosen) return { title: runName(chosen), tone: "deck", when };
    if (state.known.length > 0) return { title: "Pick a run", tone: "dim", when };
    return common(state)!;
  }
  return common(state) ?? attachedName(state) ?? { title: "Pick a run", tone: "dim" };
}

/** How far a clock has moved since the snapshot that reported it, in ms. */
function clockElapsedMs(c: NonNullable<Snapshot["clocks"]>[number], at: string, now: number): number {
  const since = c.status === "running" ? now - Date.parse(at) : 0;
  return c.elapsedMs + since;
}

/** The arithmetic `stream-api.md` publishes, so a key agrees with a widget to the second. */
function clockText(c: NonNullable<Snapshot["clocks"]>[number], at: string, now: number): string {
  const elapsed = clockElapsedMs(c, at, now);
  const ms = c.seconds === null ? elapsed : Math.max(0, c.seconds * 1000 - elapsed);
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function metricFace(state: DeckState, field: MetricField, now: number): Face {
  const c = common(state);
  if (c) return c;
  const snap = state.snapshot;
  if (!snap) return { title: "Loading…", tone: "dim" };
  if (field === "score") return { title: snap.score?.text ?? "–", tone: "readout", when: "Score" };
  if (field === "unit") return { title: String(snap.unit ?? "–"), tone: "readout", when: snap.words?.unit ?? "Unit" };
  if (field === "latest") return { title: snap.latest?.text ?? "–", tone: "readout" };
  if (field === "leader") {
    const top = snap.standings?.[0];
    return top ? { title: top.name, tone: "readout", when: `${top.points} pts` } : { title: "–", tone: "dim", when: "Leader" };
  }
  if (field === "clock") {
    const clock = snap.clocks?.find((x) => x.status === "running") ?? snap.clocks?.[0];
    if (!clock || !snap.at) return { title: "–", tone: "dim", when: "Clock" };
    const running = clock.kind === "timer" && clock.status === "running" && clock.seconds !== null;
    const fraction = running ? clockElapsedMs(clock, snap.at, now) / (clock.seconds! * 1000) : undefined;
    return { title: clockText(clock, snap.at, now), tone: "readout", when: clock.label, ...(fraction !== undefined ? { fraction } : {}) };
  }
  if ("counter" in field) {
    const x = snap.counters?.find((k) => k.id === field.counter);
    return x ? { title: String(x.value), tone: "readout", when: x.label } : { title: "–", tone: "dim" };
  }
  const r = snap.resources?.find((k) => k.id === field.resource);
  return r
    ? { title: r.max === null ? String(r.value) : `${r.value}/${r.max}`, tone: "readout", when: r.label }
    : { title: "–", tone: "dim" };
}

/**
 * The tracker a Metric key would move, or nothing where it cannot move one.
 *
 * Only a counter or a resource: the score, the unit, a clock, the last
 * result and the leader are the run's own arithmetic and a key set to one
 * of those is a readout. The offer names which trackers the run will take a
 * change to, so a key set to a number this run does not keep presses
 * nothing rather than being refused on the way out. `?? []` for an older
 * page, whose offer names none at all.
 */
function trackerOf(state: DeckState, field: MetricField | undefined): string | null {
  if (!field || typeof field === "string") return null;
  const id = "counter" in field ? field.counter : field.resource;
  const kind = "counter" in field ? "counter" : "resource";
  const offer = state.snapshot?.offer;
  return (offer?.trackers ?? []).some((t) => t.id === id && t.kind === kind) ? id : null;
}

/**
 * What one press of a Metric key sends, or nothing for it to send.
 *
 * A short press does what the key was set to: one up, or straight to a
 * number. A hold takes one back off, whichever way it was set, because a
 * key that can only count up is a key you have to reach past to the page
 * the first time you miscount.
 */
export function metricPress(
  state: DeckState,
  field: MetricField | undefined,
  press: MetricPress | undefined,
  long: boolean,
): AnswerPress | null {
  const tracker = trackerOf(state, field);
  if (!tracker) return null;
  if (long) return { press: "answer", answer: { tracker, by: -1 } };
  return press?.kind === "set"
    ? { press: "answer", answer: { tracker, to: press.value } }
    : { press: "answer", answer: { tracker, by: 1 } };
}

/**
 * What the Clock key says: the run's clock, and what pressing it would do.
 *
 * The same arithmetic a Metric key set to the clock draws, in the tone of a
 * key that moves something rather than a readout. A paused clock keeps its
 * time on the face and says so underneath; a clock that has run out says
 * the same thing the page does.
 */
export function clockFace(state: DeckState, now: number): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const snap = state.snapshot;
  if (!snap?.offer) return { title: "Loading…", tone: "dim", when: "Clock" };
  // `?? null` for an older page, which names no clock on its offer at all.
  const clock = snap.offer.clock ?? null;
  if (!clock) return { title: "No clock", tone: "dim", when: "Clock" };
  if (clock.status === "done") return { title: "0:00", tone: "dim", when: "done" };
  const kept = snap.clocks?.find((x) => x.id === clock.id);
  if (!kept || !snap.at) return { title: "–", tone: "dim", when: clock.label };
  const text = clockText(kept, snap.at, now);
  if (clock.status === "paused") return { title: text, tone: "dim", when: "paused" };
  const counting = kept.kind === "timer" && kept.seconds !== null;
  const fraction = counting ? clockElapsedMs(kept, snap.at, now) / (kept.seconds! * 1000) : undefined;
  return { title: text, tone: "live", when: clock.label, ...(fraction !== undefined ? { fraction } : {}) };
}

/** What one press of the Clock key sends: the stop on a hold, the pause or the resume on a tap. */
export function clockPress(state: DeckState, long: boolean): AnswerPress | null {
  const clock = state.snapshot?.offer?.clock;
  if (!clock || clock.status === "done") return null;
  if (long) return { press: "answer", answer: { clock: clock.id, do: "stop" } };
  return { press: "answer", answer: { clock: clock.id, do: clock.status === "running" ? "pause" : "resume" } };
}

/** What the Keep rolling key always says underneath, whichever way it is set. */
const AUTO_ROLL_WHEN = "Keep rolling";

/**
 * What the Keep rolling key says: who is throwing the dice.
 *
 * The key's own name underneath, whichever way it is set: what it says on
 * top is the state, which changes with the run, so the line under it is
 * what says which key this is on a deck of twelve.
 */
export function autoRollFace(state: DeckState): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim", when: AUTO_ROLL_WHEN };
  // `?? false` for an older page: a run that says nothing about this is one
  // rolling by hand.
  return (offer.autoRoll ?? false)
    ? { title: "Rolling for you", tone: "live", when: AUTO_ROLL_WHEN }
    : { title: "Roll by hand", tone: "deck", when: AUTO_ROLL_WHEN };
}

/** What one press of the Keep rolling key sends: the other setting. */
export function autoRollPress(state: DeckState): AnswerPress | null {
  const offer = state.snapshot?.offer;
  if (!offer) return null;
  return { press: "answer", answer: { autoRoll: !(offer.autoRoll ?? false) } };
}

/**
 * What the Finish key says: how the run would end, or that it cannot yet.
 *
 * The wine ground, which no other key wears, and the hold, which is the
 * other half of the same guard: a run does not end because somebody brushed
 * a key mid-scene. It goes dim while there is no ending to take, so the
 * color is on the key only when the press would land.
 */
export function finishFace(state: DeckState): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim", when: "Finish" };
  // `?? null` for an older page, whose offer says nothing about an ending.
  const ending = offer.ending ?? null;
  return ending ? { title: ending.label, tone: "end", when: "hold to finish" } : { title: "Not yet", tone: "dim", when: "Finish" };
}

/** What a held Finish key sends, or nothing where the run has no ending to take. */
export function finishPress(state: DeckState): AnswerPress | null {
  return state.snapshot?.offer?.ending ? { press: "answer", answer: { finish: true } } : null;
}
