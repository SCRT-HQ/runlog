import streamDeck, { action, type KeyDownEvent, type KeyUpEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { readOpenRuns, store, wire } from "../plugin.ts";
import { runFace, type DeckState, type Face, type OpenRun } from "../state.ts";
import { HoldTimer, HOLD_MS, RunlogAction } from "./base.ts";

/** What a Run key was set to: one pack, or every run the account has. */
export type RunSettings = { pack?: string };

/**
 * The runs a press of Run moves between.
 *
 * The held ones where there are any, because those are the ones that can
 * be pressed. Where there are none, every run the account has open, so the
 * key still chooses: a deck sitting in front of a stream that has not
 * started yet is the case this is for, and so is a deck whose run the page
 * has let go of.
 *
 * A key set to a pack shows that pack's runs and no others. A profile is
 * laid out for one pack, so its Run key is set to that pack: pressing it on
 * an Elden Ring deck should not land on last night's Rocket League run. The
 * generic profile names no pack and cycles everything.
 *
 * A run whose pack the deck cannot tell is left in rather than filtered
 * out, because an older server sends no pack id and a key that hid every
 * run would look broken rather than filtered.
 */
export function choices(state: DeckState, pack?: string): OpenRun[] {
  const all = state.runs.length > 0 ? state.runs : state.known;
  if (!pack) return all;
  const mine = all.filter((r) => r.packId === undefined || r.packId === pack);
  // Every run named a pack and none of them this one: the filter is doing
  // its job and the key has nothing of its own to offer.
  return mine;
}

/** Which run pressing Run would move to next, wrapping past the last. */
export function nextPin(runs: Array<Pick<OpenRun, "id">>, pinned: string | null): string | null {
  if (runs.length === 0) return null;
  const i = runs.findIndex((r) => r.id === pinned);
  return runs[(i + 1) % runs.length]!.id;
}

/**
 * Which run the deck is on.
 *
 * Press to move to the next run and pin it; the inspector is the
 * authoritative picker with full names. Pinning beats following,
 * permanently: a pinned run that ends says so rather than drifting to
 * whichever run moved last.
 *
 * Hold to ask for the lists again. Nothing else on the deck could: the
 * held list is pushed rather than fetched, and a push that never arrived
 * left every key reading a run that was over with no way to say otherwise.
 *
 * A press with nothing to move to is the other half of that. It used to
 * shrug, which on a deck pinned to a run that had ended meant the pin
 * could not be cleared from the deck at all: the keys said "That run has
 * ended" and the picker, fed the same empty list, offered nothing. Now it
 * unpins, so the key always has something to do.
 */
@action({ UUID: "com.scrthq.runlog.run" })
export class Run extends RunlogAction<RunSettings> {
  private holds = new HoldTimer();

  face(state: DeckState, _settings: RunSettings): Face {
    return runFace(state);
  }

  override onKeyDown(ev: KeyDownEvent<RunSettings>): void {
    this.holds.down(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent<RunSettings>): Promise<void> {
    if ((this.holds.up(ev.action.id) ?? 0) >= HOLD_MS) {
      await refresh();
      await ev.action.showOk();
      return;
    }
    const id = nextPin(choices(store.state, ev.payload.settings.pack), store.state.pinned);
    if (!id) {
      // Nothing to move to. If a pin is what is stranding the deck, clearing
      // it is the useful thing to do; otherwise there is genuinely nothing.
      if (store.state.pinned === null) {
        await ev.action.showAlert();
        return;
      }
      await pin(null);
      await ev.action.showOk();
      return;
    }
    await pin(id);
    await ev.action.showOk();
  }

  /** A key gone mid-hold leaves nothing here to time: clear its entry along with the shared cleanup. */
  override onWillDisappear(ev: WillDisappearEvent): void {
    this.holds.clear(ev.action.id);
    super.onWillDisappear(ev);
  }

  /** The picker needs the full list, named; the key face only ever shows the one attached. */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await super.onPropertyInspectorDidAppear();
    // The picker is this key's, so it is filtered the way this key is.
    // The base hook carries no event, and the open inspector's own action
    // is where the SDK keeps which key it belongs to.
    const pack = ((await streamDeck.ui.action?.getSettings()) as RunSettings | undefined)?.pack;
    await tellInspector(pack);
    // And again once the account has answered, which is what puts a run the
    // socket knows nothing about in front of somebody who is choosing one.
    await readOpenRuns();
    await tellInspector(pack);
  }
}

/** Asks both lists again: the held one down the socket, the account's over HTTP. */
export async function refresh(): Promise<void> {
  wire.refresh();
  await readOpenRuns();
}

/** Pins a run, or - with `null` - unpins, so the deck follows again. */
export async function pin(id: string | null): Promise<void> {
  await streamDeck.settings.setGlobalSettings({ ...(await streamDeck.settings.getGlobalSettings()), pinned: id });
  store.dispatch({ t: "pin", id });
}

/** Says the picker to whichever inspector is open, filtered the way that key is. */
export async function tellInspector(pack?: string): Promise<void> {
  await streamDeck.ui.sendToPropertyInspector({
    t: "runs",
    runs: runsForInspector(store.state, pack),
    pinned: store.state.pinned,
    packs: packsOnOffer(store.state),
    pack: pack ?? "",
  });
}

/** The packs the account has runs of, for the key's own pack chooser. */
export function packsOnOffer(state: Pick<DeckState, "runs" | "known">): Array<{ id: string; title: string }> {
  const out = new Map<string, string>();
  for (const r of [...state.runs, ...state.known]) {
    if (r.packId) out.set(r.packId, r.packTitle ?? r.packId);
  }
  return [...out].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Every run worth offering, each marked with whether it can be pressed now.
 *
 * The held ones first, because those are the ones a press does something
 * with, then the rest of the account's open runs. A run in both lists is
 * listed once.
 *
 * `OpenRun[]` is a named interface, which TypeScript will not accept where
 * a JSON value is wanted without an explicit index signature; a fresh
 * object per run satisfies it instead.
 */
export function runsForInspector(
  state: Pick<DeckState, "runs" | "known">,
  pack?: string,
): Array<{
  id: string;
  name?: string;
  packTitle?: string;
  held: boolean;
}> {
  const held = new Set(state.runs.map((r) => r.id));
  const rest = state.known.filter((r) => !held.has(r.id));
  // A run whose pack the deck cannot tell stays in: an older server sends
  // no pack id, and a picker that hid every run would read as broken.
  const mine = (r: { packId?: string }) => !pack || r.packId === undefined || r.packId === pack;
  return [...state.runs, ...rest].filter(mine).map((r) => ({ id: r.id, name: r.name, packTitle: r.packTitle, held: held.has(r.id) }));
}
