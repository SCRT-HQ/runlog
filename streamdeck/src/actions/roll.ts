import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { rollFace, type DeckState, type Face } from "../state.ts";
import { RunlogAction } from "./base.ts";

/** Throws the dice the run is waiting on; lit only while a roll is on offer. */
@action({ UUID: "com.scrthq.runlog.roll" })
export class Roll extends RunlogAction {
  face(state: DeckState): Face {
    return rollFace(state);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (store.state.snapshot?.offer?.primary?.id !== "roll") {
      await ev.action.showAlert();
      return;
    }
    await this.send(ev.action, { press: "primary" });
  }
}
