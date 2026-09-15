import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { pressFace, type DeckState, type Face, type PressTarget } from "../state.ts";
import { RunlogAction } from "./base.ts";

export type PressSettings = { target?: PressTarget };

/** One move, the waiting roll, a preset answer, or a setup - whichever the key was set to. */
@action({ UUID: "com.scrthq.runlog.press" })
export class Press extends RunlogAction<PressSettings> {
  face(state: DeckState, settings: PressSettings): Face {
    return settings.target ? pressFace(state, settings.target) : { title: "Set up", tone: "dim" };
  }

  override async onKeyDown(ev: KeyDownEvent<PressSettings>): Promise<void> {
    const target = ev.payload.settings.target;
    if (!target) {
      await ev.action.showAlert();
      return;
    }
    if (target.kind === "roll") await this.send(ev.action, { press: "primary" });
    else if (target.kind === "move") await this.send(ev.action, { press: "move", move: target.id });
    else if (target.kind === "setup") await this.send(ev.action, { press: "answer", answer: { setup: target.id } });
    // The two presets answer in the page's own words: a subject is the
    // typed value, and a list is ticked whole - `takePress` takes
    // `{ ticks: "all" }` and nothing else for it.
    else if (target.preset === "checklist") await this.send(ev.action, { press: "answer", answer: { ticks: "all" } });
    else await this.send(ev.action, { press: "answer", answer: { subject: target.value } });
  }

  /** The inspector cannot know the pack's own words, so the run's offer is handed to it. */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await super.onPropertyInspectorDidAppear();
    const offer = store.state.snapshot?.offer;
    await streamDeck.ui.sendToPropertyInspector({
      t: "offer",
      moves: offer?.moves ?? [],
      presets: offer?.presets ?? [],
      setups: offer?.setups ?? [],
    });
  }
}
