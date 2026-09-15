import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { setupFace, type DeckState, type Face } from "../state.ts";
import { RunlogAction } from "./base.ts";

export type SetupSettings = { setup?: { id: string; title: string } };

/** Changes the run's loadout to the setup the key was set to, and hands it out to the tool. */
@action({ UUID: "com.scrthq.runlog.setup" })
export class Setup extends RunlogAction<SetupSettings> {
  face(state: DeckState, settings: SetupSettings): Face {
    return setupFace(state, settings.setup);
  }

  override async onKeyDown(ev: KeyDownEvent<SetupSettings>): Promise<void> {
    const setup = ev.payload.settings.setup;
    if (!setup) {
      await ev.action.showAlert();
      return;
    }
    await this.send(ev.action, { press: "answer", answer: { setup: setup.id } });
  }

  /** The inspector cannot know the run's own setups, so its library is handed to it. */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await super.onPropertyInspectorDidAppear();
    const offer = store.state.snapshot?.offer;
    await streamDeck.ui.sendToPropertyInspector({ t: "setups", setups: offer?.setups ?? [] });
  }
}
