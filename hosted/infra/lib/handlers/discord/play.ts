import { createRandom, drive, answer, reduce, agenda, snapshotOf, paperOf, awardValue, canEndRun, undoableIds, DriveError, type Agenda, type DriveAction, type DriveResult, type Pending, type RunEvent, type RunState } from "@runlog/engine";
import { loadPackText, rollDice, type Pack } from "@runlog/rules-schema";
import { SeqConflict, type Store } from "../store.js";
import type { GuildRun, GuildStore } from "../guilds.js";
import type { Notify } from "../live.js";
import { hashToken } from "../auth.js";
import { cardFor, lineFor, type Card } from "./card.js";
import { REACTIONS } from "./reactions.js";
import type { DiscordRest } from "./rest.js";

/**
 * The table, as the bot keeps it.
 *
 * This is the one place the hosting reduces a pack. A run hosted in
 * Discord has no device of its own: the bot is the device, so it reads
 * the pack from the server's vault, folds the log, decides what is due,
 * and writes the move — exactly what the app does on a phone, in a
 * Lambda that forgets everything between two presses. What it remembers
 * between them is in the session's rows (the log, as for any run) and
 * the guild-run row (where in Discord the run lives, and a block that is
 * waiting on an answer).
 *
 * After every move it writes the same snapshot the app writes for a
 * shared run and rings the same bell, so the live link, the stream
 * widgets and a watcher's page all work for a run nobody has open in
 * the app. The pack's text stops here: what leaves is the drawn line.
 */

export interface TableDeps {
  store: Store;
  guilds: GuildStore;
  /** Discord itself, for the thread and the messages; null when the bot has no token yet. */
  rest: DiscordRest | null;
  notify?: Notify;
  now: () => string;
  mintId: () => string;
  /** A live link's token; random by default, a test hands in its own. */
  token: () => string;
  appUrl: string;
}

/** The parsed pack, kept per container by the vault's hash, so a press after the first does not parse again. */
const parsed = new Map<string, { hash: string; pack: Pack }>();

export async function packFor(guilds: GuildStore, guildId: string, packId: string): Promise<{ pack: Pack; title: string } | null> {
  const key = `${guildId}/${packId}`;
  // The row first: where the container holds this pack at this hash, the text need not travel again.
  const meta = await guilds.guildPackMeta(guildId, packId);
  if (!meta) {
    parsed.delete(key);
    return null;
  }
  const kept = parsed.get(key);
  if (kept && kept.hash === meta.hash) return { pack: kept.pack, title: meta.title };
  const found = await guilds.getGuildPack(guildId, packId);
  if (!found) {
    parsed.delete(key);
    return null;
  }
  const loaded = loadPackText(found.source, found.meta.format);
  if (!loaded.ok) return null;
  parsed.set(key, { hash: found.meta.hash, pack: loaded.pack });
  return { pack: loaded.pack, title: found.meta.title };
}

/** The run as the engine sees it: the log with the server's own fields on each row, which the reducer ignores. */
export async function eventsOf(store: Store, sessionId: string): Promise<RunEvent[]> {
  return (await store.eventsAfter(sessionId, 0)) as unknown as RunEvent[];
}

export interface Seat {
  discordId: string;
  name: string;
  /** The Runlog account, where the person linked one; events they make are theirs. */
  sub: string | null;
}

export interface Opened {
  run: GuildRun;
  threadId: string;
  link: string;
  card: Card;
}

/**
 * Start a run in a server: the session (the host's, like any run), the
 * thread it lives in, its live link, and the card with the first press
 * on it. The seed, for a seeded mode, is minted here: the run is the
 * bot's to roll, so the bot holds the seed the way a device would.
 */
export async function openRun(
  deps: TableDeps,
  input: { guildId: string; channelId: string; pack: Pack; packTitle: string; modeId: string; name?: string; players?: number; host: Seat & { sub: string } },
): Promise<Opened | { error: string }> {
  if (!deps.rest) return { error: "The bot cannot post to Discord yet: its token is not filled in on this copy of Runlog." };
  const { pack, modeId } = input;
  const mode = pack.modes[modeId];
  if (!mode) return { error: `This pack has no mode "${modeId}".` };
  // Seats, in a mode played by several: the mode's fewest unless asked
  // for more, never more than it allows. The host takes seat one.
  const seatsWanted = mode.players ? Math.max(mode.players.min, Math.min(mode.players.max, input.players ?? mode.players.min)) : 1;
  if (mode.players && input.players !== undefined && (input.players < mode.players.min || input.players > mode.players.max)) {
    return { error: `${mode.label} is played by ${mode.players.min === mode.players.max ? mode.players.min : `${mode.players.min} to ${mode.players.max}`}.` };
  }
  const at = deps.now();
  const id = deps.mintId();
  const seed = mode.seeded ? deps.mintId().slice(10) : undefined;
  const first: RunEvent[] = [{ t: "RunStarted", at, packId: pack.id, packVersion: pack.version, runId: id, mode: modeId, ...(seed ? { seed } : {}), ...(seatsWanted > 1 ? { players: seatsWanted } : {}) } as RunEvent];
  // Opening draws, where the pack deals a hand at the start; the same
  // dealing the app does, from the seed where there is one.
  for (const [deckId, deck] of Object.entries(pack.decks ?? {})) {
    if (deck.kind !== "cards" || deck.drawAtStart < 1) continue;
    const rng = seed ? createRandom(`${seed}:deal`) : createRandom();
    const pool = [...deck.cards];
    for (let n = 0; n < deck.drawAtStart && pool.length > 0; n++) {
      const [card] = pool.splice(Math.floor(rng() * pool.length), 1);
      if (card) first.push({ t: "CardDrawn", at, deck: deckId, cardId: card.id } as RunEvent);
    }
  }
  if (input.name?.trim()) first.push({ t: "RunRenamed", at, name: input.name.trim() } as RunEvent);
  const stamped = first.map((e) => ({ ...e, id: deps.mintId() }));

  const created = await deps.store.createSession({ id, packId: pack.id, packVersion: pack.version, packTitle: input.packTitle, ...(input.name?.trim() ? { name: input.name.trim() } : {}), ownerSub: input.host.sub }, at, input.host.name, stamped as unknown as Record<string, unknown>[]);
  if (!created) return { error: "That run id is taken; try again." };

  const threadName = `${input.packTitle} · ${mode.label}${input.name?.trim() ? ` · ${input.name.trim()}` : ""}`;
  const threadId = await deps.rest.createThread(input.channelId, threadName);
  if (!threadId) return { error: "Discord would not open a thread here. The bot needs permission to create public threads in this channel." };

  const token = deps.token();
  await deps.store.updateSession(id, at, { publicTokenHash: hashToken(token) });
  const link = `${deps.appUrl.replace(/\/$/, "")}/r/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`;

  const run: GuildRun = {
    sessionId: id,
    guildId: input.guildId,
    hostDiscordId: input.host.discordId,
    hostSub: input.host.sub,
    hostName: input.host.name,
    packId: pack.id,
    channelId: input.channelId,
    threadId,
    contestants: {},
    ...(seatsWanted > 1 ? { seats: { "1": { discordId: input.host.discordId, name: input.host.name } } } : {}),
    createdAt: at,
    updatedAt: at,
  };
  const events = stamped as unknown as RunEvent[];
  const state = reduce(pack, events);
  await writeSnapshot(deps, run.sessionId, pack, state, events, created.meta.seq);
  const card = cardFor({ pack, state, events, agenda: agenda(pack, state, events), run });
  // One message carries the link and the card, so a start is one post and
  // one pin: Discord waits three seconds for the answer, and every call
  // to it spends some of them.
  const cardId = await deps.rest.postMessage(threadId, { content: `Watch it live, no account needed: ${link}`, ...card });
  if (cardId) {
    run.cardMessageId = cardId;
    await deps.rest.pinMessage(threadId, cardId);
  }
  await deps.guilds.putGuildRun(run);
  return { run, threadId, link, card };
}

export type TableAction =
  | { kind: "drive"; action: DriveAction }
  | { kind: "answer"; key: string; value: string | number | boolean }
  | { kind: "join" }
  | { kind: "leave" }
  | { kind: "award"; contestant: string; outcome: number }
  | { kind: "end"; ending: string }
  | { kind: "undo" }
  | { kind: "journal"; text: string }
  | { kind: "clock"; clock: string; to: "paused" | "running" }
  | { kind: "react"; emoji: string }
  | { kind: "seat"; seat: number }
  | { kind: "unseat" }
  | { kind: "follow" };

/** Whether this person may press the table's buttons: the host, or whoever holds a seat. */
export function mayPress(run: GuildRun, discordId: string): boolean {
  return run.hostDiscordId === discordId || Object.values(run.seats ?? {}).some((s) => s.discordId === discordId);
}

/** Events that begin a player-visible move, for undoing a log written before moves were named. Mirrors the app's rule. */
const isBoundary = (e: RunEvent): boolean =>
  ["UnitEntered", "StepCompleted", "SubjectRenamed", "Checked", "Corrected", "ClockStarted", "ClockPaused", "ClockResumed", "ClockStopped", "Awarded", "ContestantAdded", "ContestantRemoved", "ContestantStateApplied", "ContestantStateRemoved", "Rolled", "ObligationResolved", "JournalWritten", "RunEnded"].includes(e.t);

export interface Played {
  card: Card;
  /** What to say in the thread about the move, if anything. */
  line: string | null;
  run: GuildRun;
  ended: boolean;
}

/**
 * One press at the table. Reads the log, applies the action, writes
 * what it produced, and answers with the card as it now stands; a block
 * that stops to ask is kept on the guild-run row until the next press
 * answers it.
 */
export async function play(deps: TableDeps, run: GuildRun, pack: Pack, actor: Seat, action: TableAction): Promise<Played | { error: string }> {
  const at = deps.now();
  const events = await eventsOf(deps.store, run.sessionId);
  const state = reduce(pack, events);
  // What a member without an account does at the table is written as the
  // host's, the way a moderator's device writes a roster: the log names
  // members of the session, and a Discord id is not one.
  const author = actor.sub ?? run.hostSub;
  const seed = seedOf(events);
  const ctx = { now: at, ...(seed ? { seed } : {}), autoRoll: true, mintId: deps.mintId };
  let produced: RunEvent[] = [];
  // A block waiting on an answer stays waiting through anything that is not
  // an answer to it, an undo, or a step that supersedes it.
  let pending: Pending | undefined = run.pending as unknown as Pending | undefined;
  let line: string | null = null;
  let ended = false;
  const redraw = () => cardFor({ pack, state, events, agenda: agenda(pack, state, events), run, ...(pending ? { pending } : {}) });

  try {
    switch (action.kind) {
      case "drive": {
        if ("enter" in action.action && state.unit > 0 && agenda(pack, state, events).phase === "step") {
          return { error: `${pack.vocabulary.unit.one} ${state.unit} is still open; this card is stale. /run status posts a fresh one.` };
        }
        const out = drive(pack, events, action.action, ctx);
        ({ produced, pending } = settle(out));
        break;
      }
      case "answer": {
        if (!run.pending) return { error: "Nothing is waiting for an answer." };
        const waiting = run.pending as unknown as Pending;
        // A roll the block asks for is the bot's to throw, and said so in
        // the log; a person's choice is theirs, and is not.
        const req = waiting.request;
        const rolled = req.kind === "roll";
        const value = req.kind === "roll" ? rollDice(req.dice, createRandom()).total : action.value;
        const out = answer(pack, events, waiting, action.key, value, { ...ctx, autoRoll: rolled });
        ({ produced, pending } = settle(out));
        break;
      }
      case "join": {
        if (run.contestants[actor.discordId]) return { error: "You are on the roster already." };
        const contestant = `d${actor.discordId}`;
        produced = [{ t: "ContestantAdded", at, contestant, name: actor.name } as RunEvent];
        run.contestants = { ...run.contestants, [actor.discordId]: contestant };
        line = `${actor.name} joined the roster.`;
        break;
      }
      case "leave": {
        const contestant = run.contestants[actor.discordId];
        if (!contestant) return { error: "You are not on the roster." };
        produced = [{ t: "ContestantRemoved", at, contestant } as RunEvent];
        const { [actor.discordId]: _gone, ...rest } = run.contestants;
        run.contestants = rest;
        line = `${actor.name} left the roster.`;
        break;
      }
      case "award": {
        const points = awardValue(pack, state, action.outcome, action.contestant);
        const outcome = state.outcomes[action.outcome];
        if (points === null || !outcome) return { error: "That result cannot be awarded to them." };
        produced = [{ t: "Awarded", at, contestant: action.contestant, outcome: action.outcome, table: outcome.table, entryId: outcome.entryId, points } as RunEvent];
        const who = state.contestants.find((c) => c.id === action.contestant)?.name ?? action.contestant;
        line = `${who} takes ${points} point${points === 1 ? "" : "s"}.`;
        break;
      }
      case "end": {
        if (pending) return { error: "The table is waiting on an answer; answer it, or take the move back, before ending." };
        const may = canEndRun(state);
        if (!may.ok) return { error: may.reason ?? "The run cannot end here." };
        produced = [{ t: "RunEnded", at, ending: action.ending } as RunEvent];
        ended = true;
        line = `The ${pack.vocabulary.run.one.toLowerCase()} is over: ${pack.endings?.find((e) => e.id === action.ending)?.label ?? action.ending}.`;
        break;
      }
      case "undo": {
        const ids = undoableIds(events, isBoundary);
        if (ids.length === 0) return { error: "Nothing to take back." };
        produced = [{ t: "Undone", at, ids } as RunEvent];
        // A block waiting on an answer belongs to the move being unmade.
        pending = undefined;
        line = "Took the last move back.";
        break;
      }
      case "journal": {
        if (state.unit === 0) return { error: `Nothing to write about before the first ${pack.vocabulary.unit.one.toLowerCase()}.` };
        produced = [{ t: "JournalWritten", at, unit: state.unit, text: action.text } as RunEvent];
        line = `📓 ${action.text}`;
        break;
      }
      case "clock": {
        const clock = state.clocks.find((c) => c.id === action.clock);
        if (!clock || clock.status === "done") return { error: "That clock is not running any more." };
        if (action.to === "paused" && clock.status !== "running") return { error: "That clock is paused already." };
        if (action.to === "running" && clock.status !== "paused") return { error: "That clock is running already." };
        produced = [{ t: action.to === "paused" ? "ClockPaused" : "ClockResumed", at, clock: clock.id } as RunEvent];
        line = `${clock.label} ${action.to === "paused" ? "paused" : "resumed"}.`;
        break;
      }
      case "react": {
        // Not a move: the same wave the live page takes, kept beside the run, and rung.
        if (!(REACTIONS as readonly string[]).includes(action.emoji)) return { error: "Not one of the six." };
        await deps.store.addReaction(run.sessionId, { emoji: action.emoji, name: actor.name, at });
        await deps.notify?.(run.sessionId, (await deps.store.getSession(run.sessionId))?.meta.seq ?? 0);
        return { card: redraw(), line: null, run, ended: false };
      }
      case "seat": {
        // Not a move either: who sits where is Discord's, beside the run.
        // A seat is one person's, a person has one seat, and a linked
        // person becomes a player at the session so the run follows them.
        if (!run.seats || state.players < 2) return { error: "This run has no seats to take; the host plays it." };
        const key = String(action.seat);
        if (action.seat < 1 || action.seat > state.players) return { error: "No such seat." };
        if (run.seats[key] && run.seats[key]!.discordId !== actor.discordId) return { error: `Seat ${action.seat} is ${run.seats[key]!.name}'s.` };
        const mine = Object.entries(run.seats).find(([, s]) => s.discordId === actor.discordId);
        if (mine) delete run.seats[mine[0]];
        run.seats[key] = { discordId: actor.discordId, name: actor.name };
        if (actor.sub && actor.sub !== run.hostSub) await deps.store.joinAs(run.sessionId, actor.sub, "player", actor.name, at);
        run.updatedAt = at;
        await deps.guilds.putGuildRun(run);
        line = `${actor.name} takes seat ${action.seat}.`;
        if (deps.rest && line) await deps.rest.postMessage(run.threadId, { content: line });
        return { card: redraw(), line: null, run, ended: false };
      }
      case "unseat": {
        const mine = Object.entries(run.seats ?? {}).find(([, s]) => s.discordId === actor.discordId);
        if (!mine || !run.seats) return { error: "You have no seat here." };
        if (actor.discordId === run.hostDiscordId) return { error: "The host keeps a seat." };
        delete run.seats[mine[0]];
        run.updatedAt = at;
        await deps.guilds.putGuildRun(run);
        if (deps.rest) await deps.rest.postMessage(run.threadId, { content: `${actor.name} leaves seat ${mine[0]}.` });
        return { card: redraw(), line: null, run, ended: false };
      }
      case "follow": {
        if (!actor.sub) return { error: "Run /link first, so the run has an account to follow you to." };
        if (actor.sub === run.hostSub) return { error: "It is your run already; it is in your library." };
        const seat = await deps.store.joinAs(run.sessionId, actor.sub, "viewer", actor.name, at);
        if (!seat) return { error: "This run cannot be followed any more." };
        return { card: redraw(), line: null, run, ended: false };
      }
    }
  } catch (error) {
    if (error instanceof DriveError) return { error: error.message };
    throw error;
  }

  // What the driver produced is stamped already; what this file makes by
  // hand is stamped here, each as a move of its own, so an undo takes it
  // back as one.
  const move = deps.mintId();
  const stamped = produced.map((e) => ({ ...e, id: (e as { id?: string }).id ?? deps.mintId(), move: (e as { move?: string }).move ?? move }));
  const next = [...events, ...stamped];
  const after = reduce(pack, next);
  if (stamped.length > 0) {
    // Written only onto the log as it was read: the host may be playing
    // the same run in the app, and a move that landed between the read
    // and this write must not be built over.
    const tail = (events[events.length - 1] as { seq?: number } | undefined)?.seq ?? 0;
    let seq: number;
    try {
      ({ seq } = await deps.store.appendEvents(run.sessionId, author, at, stamped as unknown as Record<string, unknown>[], { expectSeq: tail }));
    } catch (error) {
      if (error instanceof SeqConflict) return { error: "The table moved since this card was drawn, from the app perhaps. /run status posts a fresh card; press again there." };
      throw error;
    }
    if (ended) await deps.store.updateSession(run.sessionId, at, { endedAt: at });
    await writeSnapshot(deps, run.sessionId, pack, after, next, seq);
    if (!line) line = lineFor(pack, state, after, stamped);
  }
  run.pending = pending ? (JSON.parse(JSON.stringify(pending)) as Record<string, unknown>) : undefined;
  run.updatedAt = at;
  if (ended) run.endedAt = at;
  await deps.guilds.putGuildRun(run);
  const card = cardFor({ pack, state: after, events: next, agenda: agenda(pack, after, next), run, ...(pending ? { pending } : {}) });
  return { card, line, run, ended };
}

function settle(out: DriveResult): { produced: RunEvent[]; pending?: Pending } {
  return out.status === "done" ? { produced: out.events } : { produced: [], pending: out.pending };
}

/** The seed the run started with, for a seeded mode's rolls. */
export function seedOf(events: readonly RunEvent[]): string | undefined {
  const first = events[0];
  return first && first.t === "RunStarted" && typeof first.seed === "string" ? first.seed : undefined;
}

async function writeSnapshot(deps: TableDeps, sessionId: string, pack: Pack, state: RunState, events: readonly RunEvent[], seq: number): Promise<void> {
  const at = deps.now();
  await deps.store.putSnapshot(sessionId, at, { ...snapshotOf(pack, state, events, at), paper: paperOf(pack, state.mode) });
  await deps.notify?.(sessionId, seq);
}

/** What can happen now, for a card drawn without a press. */
export function agendaFor(pack: Pack, events: readonly RunEvent[]): { state: RunState; agenda: Agenda } {
  const state = reduce(pack, events);
  return { state, agenda: agenda(pack, state, events) };
}
