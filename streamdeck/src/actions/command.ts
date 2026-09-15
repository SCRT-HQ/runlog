import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { commandFace, type DeckState, type Face } from "../state.ts";
import { RunlogAction } from "./base.ts";

export type CommandSettings = { command?: { id: string; title: string } };

/** Sends a setup's operations to the tool once, leaving the run's own setup untouched. */
@action({ UUID: "com.scrthq.runlog.command" })
export class Command extends RunlogAction<CommandSettings> {
  face(state: DeckState, settings: CommandSettings): Face {
    return commandFace(state, settings.command);
  }

  override async onKeyDown(ev: KeyDownEvent<CommandSettings>): Promise<void> {
    const command = ev.payload.settings.command;
    if (!command) {
      await ev.action.showAlert();
      return;
    }
    await this.send(ev.action, { press: "answer", answer: { command: command.id } });
  }

  /** The inspector cannot know the run's own commands, so its library is handed to it. */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await super.onPropertyInspectorDidAppear();
    const offer = store.state.snapshot?.offer;
    await streamDeck.ui.sendToPropertyInspector({ t: "commands", commands: offer?.commands ?? [] });
  }
}
