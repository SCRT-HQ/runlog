import streamDeck, { action, type KeyDownEvent, type KeyUpEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { SetupGroup } from "@runlog/rules-schema";

import { store } from "../plugin.ts";
import { cyclingSetupFace, setupFace, setupsOfGroup, type DeckState, type Face } from "../state.ts";
import { HoldTimer, HOLD_MS, RunlogAction } from "./base.ts";

export type SetupSettings = {
  /** One setup, named. The key applies this and nothing else. */
  setup?: { id: string; title: string };
  /**
   * A whole kind, for a key that browses rather than one that applies.
   *
   * Read only where no setup is named. A pack with forty loadouts and
   * twenty warps would otherwise want sixty keys, which is more than most
   * decks have; this is one key per kind instead.
   */
  group?: SetupGroup;
};

/**
 * Changes the run's loadout to a setup, and hands it out to the tool.
 *
 * Two keys in one, and which it is depends on what it was set to. Named a
 * setup, it is what it always was: a press applies that one.
 *
 * Set to a group instead, it browses. A press moves to the next setup of
 * that kind and the face says which, so a hand can find one among forty
 * without looking at a screen. Applying is the hold, because it changes
 * the run's loadout and hands it to the tool while somebody is watching,
 * and that is not a thing to do by brushing a key. Finish already asks for
 * a hold for the same reason.
 */
@action({ UUID: "com.scrthq.runlog.setup" })
export class Setup extends RunlogAction<SetupSettings> {
  private holds = new HoldTimer();

  /**
   * Where each browsing key has got to.
   *
   * In memory rather than in settings: it is where a hand is, not what the
   * key is for, and writing a setting on every press to remember it would
   * outlive the thing it describes. A plugin that restarted starts the
   * cycle again, which is the right amount of memory for this.
   */
  private at = new Map<string, number>();

  face(state: DeckState, settings: SetupSettings, _now: number, on: string): Face {
    if (settings.setup) return setupFace(state, settings.setup);
    if (settings.group) return cyclingSetupFace(state, settings.group, this.at.get(on) ?? 0);
    return setupFace(state, undefined);
  }

  override onKeyDown(ev: KeyDownEvent<SetupSettings>): void {
    this.holds.down(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent<SetupSettings>): Promise<void> {
    const held = (this.holds.up(ev.action.id) ?? 0) >= HOLD_MS;
    const settings = ev.payload.settings;

    // Set to one setup: unchanged, a press applies it.
    if (settings.setup) {
      await this.send(ev.action, { press: "answer", answer: { setup: settings.setup.id } });
      return;
    }

    if (!settings.group) {
      await ev.action.showAlert();
      return;
    }

    const list = setupsOfGroup(store.state, settings.group);
    if (list.length === 0) {
      await ev.action.showAlert();
      return;
    }

    const now = (((this.at.get(ev.action.id) ?? 0) % list.length) + list.length) % list.length;
    if (!held) {
      this.at.set(ev.action.id, now + 1);
      await this.draw(ev.action, settings);
      return;
    }
    await this.send(ev.action, { press: "answer", answer: { setup: list[now]!.id } });
  }

  /** A key gone mid-hold leaves nothing here to time, and nowhere for its place in the cycle to mean anything. */
  override onWillDisappear(ev: WillDisappearEvent): void {
    this.holds.clear(ev.action.id);
    this.at.delete(ev.action.id);
    super.onWillDisappear(ev);
  }

  /** The inspector cannot know the run's own setups, so its library is handed to it. */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await super.onPropertyInspectorDidAppear();
    const offer = store.state.snapshot?.offer;
    await streamDeck.ui.sendToPropertyInspector({ t: "setups", setups: offer?.setups ?? [] });
  }
}
