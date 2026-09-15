import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { autoRollFace, autoRollPress, type DeckState, type Face } from "../state.ts";
import { RunlogAction } from "./base.ts";

/** Hands the dice to the run, and takes them back: one press, either way. */
@action({ UUID: "com.scrthq.runlog.autoroll" })
export class AutoRoll extends RunlogAction {
  face(state: DeckState): Face {
    return autoRollFace(state);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const p = autoRollPress(store.state);
    if (!p) {
      await ev.action.showAlert();
      return;
    }
    await this.send(ev.action, p);
  }
}
