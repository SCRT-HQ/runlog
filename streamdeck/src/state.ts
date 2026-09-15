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
  primary: { id: "roll" | "carry-on" | "close" | "enter"; label: string; kind: string } | null;
  moves: Array<{ id: string; label: string }>;
  undo: { what: string } | null;
  /** Why a deck cannot press this, in words a key face can carry. */
  needsPage: string | null;
  presets: Array<{ kind: string; label: string; suggestions?: string[]; items?: number }>;
}

export type SessionState = "none" | "expired" | "ok";
export type SocketState = "closed" | "connecting" | "open";
export interface HeldRun {
  id: string;
  name?: string;
  packTitle?: string;
}
export interface Snapshot {
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
  socket: SocketState;
  runs: HeldRun[];
  any: boolean;
  pinned: string | null;
  attached: string | null;
  snapshot: Snapshot | null;
  flash: { ref: string; ok: boolean; say?: string; until: number } | null;
}
export type Tone = "live" | "dim" | "refuse";
export interface Face {
  title: string;
  tone: Tone;
  when?: string;
  /** 0-1, set only for a running timer clock so a dial's indicator can draw it. */
  fraction?: number;
}
export type PressTarget = { kind: "roll" } | { kind: "move"; id: string } | { kind: "answer"; preset: string; value: string };
export type MetricField = "score" | "unit" | "clock" | "latest" | "leader" | { counter: string } | { resource: string };
export type DeckEvent =
  | { t: "session"; state: SessionState }
  | { t: "socket"; state: SocketState }
  | { t: "runs"; runs: HeldRun[]; any: boolean }
  | { t: "pin"; id: string | null }
  | { t: "snapshot"; snapshot: Snapshot }
  | { t: "drove"; ref: string; ok: boolean; say?: string; seq?: number }
  | { t: "tick" };

const FLASH_MS = 3000;

export function initial(): DeckState {
  return { session: "none", socket: "closed", runs: [], any: false, pinned: null, attached: null, snapshot: null, flash: null };
}

export function attachedRun(state: DeckState): string | null {
  if (state.pinned) return state.runs.some((r) => r.id === state.pinned) ? state.pinned : null;
  return state.runs.length === 1 ? state.runs[0]!.id : null;
}

export function reduce(state: DeckState, event: DeckEvent, now: number): DeckState {
  switch (event.t) {
    case "session":
      return event.state === "ok" ? { ...state, session: "ok" } : { ...initial(), session: event.state, pinned: state.pinned };
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
    case "tick":
      return state.flash && state.flash.until <= now ? { ...state, flash: null } : state;
  }
}

/** The state every key shares before any of them has something of its own to say. */
function common(state: DeckState): Face | null {
  if (state.session === "none") return { title: "Sign in", tone: "dim" };
  if (state.session === "expired") return { title: "Sign in again", tone: "dim" };
  if (state.socket !== "open") return { title: "Offline", tone: "dim" };
  if (state.pinned && !state.runs.some((r) => r.id === state.pinned)) return { title: "That run has ended", tone: "dim" };
  if (state.runs.length === 0) return state.any ? { title: "No run open", tone: "dim" } : { title: "Not synced", tone: "dim" };
  if (!state.attached) return { title: "Pick a run", tone: "dim" };
  return null;
}

function flashed(state: DeckState): Face | null {
  if (!state.flash || state.flash.ok) return null;
  return { title: state.flash.say ?? "No", tone: "refuse" };
}

export function nextFace(state: DeckState): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const offer = state.snapshot?.offer;
  if (!offer) return { title: "Loading…", tone: "dim" };
  if (offer.primary) return { title: offer.primary.label, tone: "live" };
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

export function undoFace(state: DeckState): Face {
  const c = common(state) ?? flashed(state);
  if (c) return c;
  const undo = state.snapshot?.offer?.undo;
  return undo ? { title: "Undo", tone: "live", when: undo.what } : { title: "Nothing to undo", tone: "dim" };
}

export function runFace(state: DeckState): Face {
  if (state.session !== "ok") return common(state)!;
  if (state.socket !== "open") return { title: "Offline", tone: "dim" };
  const run = state.runs.find((r) => r.id === state.attached);
  if (run)
    return { title: run.name ?? run.packTitle ?? run.id, tone: "live", ...(run.packTitle && run.name ? { when: run.packTitle } : {}) };
  return common(state) ?? { title: "Pick a run", tone: "dim" };
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
  if (field === "score") return { title: snap.score?.text ?? "—", tone: "live", when: "Score" };
  if (field === "unit") return { title: String(snap.unit ?? "—"), tone: "live", when: snap.words?.unit ?? "Unit" };
  if (field === "latest") return { title: snap.latest?.text ?? "—", tone: "live" };
  if (field === "leader") {
    const top = snap.standings?.[0];
    return top ? { title: top.name, tone: "live", when: `${top.points} pts` } : { title: "—", tone: "dim", when: "Leader" };
  }
  if (field === "clock") {
    const clock = snap.clocks?.find((x) => x.status === "running") ?? snap.clocks?.[0];
    if (!clock || !snap.at) return { title: "—", tone: "dim", when: "Clock" };
    const running = clock.kind === "timer" && clock.status === "running" && clock.seconds !== null;
    const fraction = running ? clockElapsedMs(clock, snap.at, now) / (clock.seconds! * 1000) : undefined;
    return { title: clockText(clock, snap.at, now), tone: "live", when: clock.label, ...(fraction !== undefined ? { fraction } : {}) };
  }
  if ("counter" in field) {
    const x = snap.counters?.find((k) => k.id === field.counter);
    return x ? { title: String(x.value), tone: "live", when: x.label } : { title: "—", tone: "dim" };
  }
  const r = snap.resources?.find((k) => k.id === field.resource);
  return r ? { title: r.max === null ? String(r.value) : `${r.value}/${r.max}`, tone: "live", when: r.label } : { title: "—", tone: "dim" };
}
