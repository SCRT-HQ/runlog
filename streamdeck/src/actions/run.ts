import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { runFace, type DeckState, type Face, type HeldRun } from "../state.ts";
import { RunlogAction } from "./base.ts";

/** Which held run pressing Run would move to next, wrapping past the last. */
export function nextPin(runs: Array<Pick<HeldRun, "id">>, pinned: string | null): string | null {
  if (runs.length === 0) return null;
  const i = runs.findIndex((r) => r.id === pinned);
  return runs[(i + 1) % runs.length]!.id;
}

/**
 * Which run the deck is on.
 *
 * Press to cycle through the held runs and pin the next one; the
 * inspector is the authoritative picker with full names. Pinning beats
 * following, permanently: a pinned run that ends says so rather than
 * drifting to whichever run moved last.
 */
@action({ UUID: "com.scrthq.runlog.run" })
export class Run extends RunlogAction {
  face(state: DeckState): Face {
    return runFace(state);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const id = nextPin(store.state.runs, store.state.pinned);
    if (!id) {
      await ev.action.showAlert();
      return;
    }
    await pin(id);
    await ev.action.showOk();
  }

  /** The picker needs the full list, named; the key face only ever shows the one attached. */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await super.onPropertyInspectorDidAppear();
    await streamDeck.ui.sendToPropertyInspector({ t: "runs", runs: runsForInspector(store.state.runs), pinned: store.state.pinned });
  }
}

/** Pins a run, or - with `null` - unpins, so the deck follows again. */
export async function pin(id: string | null): Promise<void> {
  await streamDeck.settings.setGlobalSettings({ ...(await streamDeck.settings.getGlobalSettings()), pinned: id });
  store.dispatch({ t: "pin", id });
}

/**
 * The held runs, as plain objects.
 *
 * `HeldRun[]` is a named interface, which TypeScript will not accept
 * where a JSON value is wanted without an explicit index signature; a
 * fresh object per run satisfies it instead.
 */
export function runsForInspector(runs: HeldRun[]): Array<{ id: string; name?: string; packTitle?: string }> {
  return runs.map((r) => ({ id: r.id, name: r.name, packTitle: r.packTitle }));
}
