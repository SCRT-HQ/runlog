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
  /** The setups the run could hand out, empty where the run names no tool or is not live. */
  setups: Array<{ id: string; title: string }>;
  /** The counters and resources this run will take a change to, from a deck as from the page. */
  trackers: Array<{ id: string; kind: "counter" | "resource"; label: string; value: number; max: number | null }>;
  /** The clock a deck may pause, resume or stop, or nothing where the run keeps none. */
  clock: { id: string; label: string; status: "running" | "paused" | "done" } | null;
  /** Whether the run is rolling for itself rather than waiting on a press. */
  autoRoll: boolean;
  /** How the run would end if it were finished now, or nothing while it cannot be. */
  ending: { label: string } | null;
}

export type SessionState = "none" | "expired" | "ok";
export type SocketState = "closed" | "connecting" | "open";
export interface HeldRun {
  id: string;
  name?: string;
  packTitle?: string;
}
export interface Snapshot {
  /** The run as the server knows it, which is where the pack's id travels. */
  run?: { id?: string; packId?: string };
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
}
export interface DeckState {
  session: SessionState;
  /** Whether the streamer has switched the deck on. No socket while false. */
  on: boolean;
  /** Whether the last time it went off, it was the idle timer rather than a press. */
  idleOff: boolean;
  socket: SocketState;
  runs: HeldRun[];
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
 * `deck` is the furniture - Connect, Run, Open, Apply setup - lit, but
 * without an accent claiming it does something to the run. `dim` and
 * `refuse` are states rather than families and belong to every key.
 */
export type Tone = "live" | "dim" | "refuse" | "undo" | "readout" | "deck";
export interface Face {
  title: string;
  tone: Tone;
  when?: string;
  /** 0-1, set only for a running timer clock so a dial's indicator can draw it. */
  fraction?: number;
}
export type PressTarget = { kind: "roll" } | { kind: "move"; id: string } | { kind: "answer"; preset: string; value: string };
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
  | { t: "pin"; id: string | null }
  | { t: "snapshot"; snapshot: Snapshot }
  | { t: "drove"; ref: string; ok: boolean; say?: string; seq?: number }
  | { t: "tick" };

const FLASH_MS = 3000;

/** How long a connection that is holding nothing waits before closing itself. */
export const IDLE_OFF_MS = 30 * 60_000;

export function initial(): DeckState {
  return {
    session: "none",
    on: false,
    idleOff: false,
    socket: "closed",
    runs: [],
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
  if (state.pinned && !state.runs.some((r) => r.id === state.pinned)) return { title: "That run has ended", tone: "dim" };
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

/** The run a deck is following, named, or nothing. */
function attachedName(state: DeckState): Face | null {
  const run = state.runs.find((r) => r.id === state.attached);
  if (!run) return null;
  return { title: run.name ?? run.packTitle ?? run.id, tone: "deck", ...(run.packTitle && run.name ? { when: run.packTitle } : {}) };
}

/**
 * The Connect key, which reports the connection rather than the run behind it.
 *
 * It is the one key that has something to say while the deck is off, so it
 * skips the "Not connected" every other key stops at and names the state it
 * is actually in - down by choice, down by the idle timer, or on its way up.
 * Once the socket is open it says **Disconnect**, one press away from off -
 * which run that carries, if any, is the Run key's business, not this one's.
 */
export function connectFace(state: DeckState): Face {
  if (state.session === "none") return { title: "Sign in", tone: "dim" };
  if (state.session === "expired") return { title: "Sign in again", tone: "dim" };
  if (!state.on) return { title: "Connect", tone: "dim", when: state.idleOff ? "went idle" : undefined };
  if (state.socket !== "open") return { title: "Connecting", tone: "dim" };
  return { title: "Disconnect", tone: "deck" };
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

export function nextFace(state: DeckState, settings: NextSettings): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim" };
  if (offer.primary) return { title: offer.primary.label, tone: "live" };
  // What the key would take, in the page's own words: the checklist's
  // button, or the name it would declare with the ask beneath it.
  const d = decision(offer, settings);
  if (d?.kind === "checklist") return { title: d.label, tone: "live" };
  if (d) return { title: d.suggestions![0]!, tone: "live", when: d.label };
  return { title: offer.needsPage ?? "Nothing to press", tone: offer.needsPage ? "refuse" : "dim" };
}

export function pressFace(state: DeckState, target: PressTarget): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim" };
  if (target.kind === "roll")
    return offer.primary?.id === "roll" ? { title: offer.primary.label, tone: "live" } : { title: "Nothing to roll", tone: "dim" };
  if (target.kind === "move") {
    const m = offer.moves.find((x) => x.id === target.id);
    return m ? { title: m.label, tone: "live" } : { title: "Not on offer", tone: "dim" };
  }
  const p = offer.presets.find((x) => x.kind === target.preset);
  return p ? { title: target.value, tone: "live", when: p.label } : { title: target.value, tone: "dim", when: "Not now" };
}

/** What the dedicated Roll key says: the waiting roll, in its own words, or nothing to roll. */
export function rollFace(state: DeckState): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim" };
  return offer.primary?.id === "roll"
    ? { title: offer.primary.label, tone: "live", when: "Roll" }
    : { title: "Nothing to roll", tone: "dim" };
}

/** What the setup key says: what it applies and hands out, whether that is on offer, or nothing chosen at all. */
export function setupFace(state: DeckState, setup?: { id: string; title: string }): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  if (!setup) return { title: "Set up", tone: "dim" };
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim" };
  // `?? []`: an older page's offer may not name any setups at all.
  return (offer.setups ?? []).some((s) => s.id === setup.id)
    ? { title: setup.title, tone: "deck", when: "Apply setup" }
    : { title: setup.title, tone: "dim", when: "Not here" };
}

export function undoFace(state: DeckState): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const undo = state.snapshot?.offer?.undo;
  // The key says "Undo" either way: what it would take back is the run's
  // business, and a key too small to read it is no help at the table.
  return undo ? { title: "Undo", tone: "undo" } : { title: "Undo", tone: "dim" };
}

/** Where the Open key points, chosen in its settings. */
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
 */
export function openFace(state: DeckState, target?: OpenTarget): Face {
  if (!target) return { title: "Set up", tone: "dim" };
  if (target === "guide") return { title: "Guide", tone: "deck", when: "in a browser" };
  const c = common(state);
  if (c) return c;
  return { title: OPEN_LABELS[target], tone: "deck", when: "in a browser" };
}

export function runFace(state: DeckState): Face {
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
  if (!snap?.offer) return { title: "Loading…", tone: "dim" };
  // `?? null` for an older page, which names no clock on its offer at all.
  const clock = snap.offer.clock ?? null;
  if (!clock) return { title: "No clock", tone: "dim" };
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

/**
 * What the Keep rolling key says: who is throwing the dice.
 *
 * The same words either way underneath, because twenty characters is not
 * room for two different sentences and the key is a switch: what it says on
 * top is the state, and pressing it is the other one.
 */
export function autoRollFace(state: DeckState): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim" };
  // `?? false` for an older page: a run that says nothing about this is one
  // rolling by hand.
  return (offer.autoRoll ?? false)
    ? { title: "Rolling for you", tone: "live", when: "press to switch" }
    : { title: "Roll by hand", tone: "deck", when: "press to switch" };
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
 * The kiln edge, which is the accent for a press there is no coming back
 * from, and the hold is the other half of the same guard: a run does not
 * end because somebody brushed a key mid-scene.
 */
export function finishFace(state: DeckState): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim" };
  // `?? null` for an older page, whose offer says nothing about an ending.
  const ending = offer.ending ?? null;
  return ending ? { title: ending.label, tone: "refuse", when: "hold to finish" } : { title: "Not yet", tone: "dim" };
}

/** What a held Finish key sends, or nothing where the run has no ending to take. */
export function finishPress(state: DeckState): AnswerPress | null {
  return state.snapshot?.offer?.ending ? { press: "answer", answer: { finish: true } } : null;
}
